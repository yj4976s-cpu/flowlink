import logging
from pathlib import Path
import subprocess

import pytest
from fastapi import HTTPException

from app.core.config import get_settings
from app.services import user_media_uploads as media
from app.services.video_diagnostics import video_job_context


@pytest.mark.parametrize(("stderr", "reason"), [
    ("Permission denied", "permission_denied"),
    ("No space left on device", "disk_full"),
    ("Cannot allocate memory", "memory_allocation"),
    ("Resource temporarily unavailable", "resource_unavailable"),
    ("No such file or directory", "file_missing"),
    ("Invalid data found", "invalid_media"),
    ("Unexpected private server error", "unclassified"),
])
def test_command_logs_safe_exit_classification(monkeypatch, caplog, stderr, reason):
    caplog.set_level(logging.INFO)
    secret = "/private/models/secret.pt https://user:password@db.invalid token=secret"
    result = subprocess.CompletedProcess([], 1, stdout=secret, stderr=f"{stderr}: {secret}")
    monkeypatch.setattr(media.subprocess, "run", lambda *args, **kwargs: result)
    token = video_job_context.set((141, 314))
    try:
        assert media._run_command(["/private/bin/ffmpeg", secret], timeout=1) is result
    finally:
        video_job_context.reset(token)
    assert "job_id=141 event_id=314 tool=ffmpeg returncode=1" in caplog.text
    assert f"reason={reason}" in caplog.text
    assert secret not in caplog.text
    assert "/private" not in caplog.text
    assert all(record.exc_info is None for record in caplog.records)


def test_timeout_keeps_original_http_error_without_leaking_command(monkeypatch, caplog):
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(["ffprobe", "/private/video.mp4"], 1, stderr="token=secret")
    monkeypatch.setattr(media.subprocess, "run", timeout)
    with pytest.raises(HTTPException) as raised:
        media._run_command(["ffprobe", "/private/video.mp4"], timeout=1)
    assert raised.value.status_code == 504
    assert raised.value.detail == "Video processing timed out"
    assert "phase=FFPROBE outcome=failed error_type=HTTPException cause_type=TimeoutExpired" in caplog.text
    assert "http_status=504" in caplog.text
    assert "/private" not in caplog.text
    assert "secret" not in caplog.text


def test_successful_command_keeps_arguments_and_never_logs_output(monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    command = ["ffprobe", "/private/video.mp4"]
    result = subprocess.CompletedProcess(command, 0, "private metadata", "private warning")

    def run(args, **kwargs):
        assert args == command
        assert kwargs == dict(shell=False, capture_output=True, text=True, timeout=20, check=False)
        return result

    monkeypatch.setattr(media.subprocess, "run", run)
    assert media._run_command(command, timeout=20) is result
    assert "tool=ffprobe returncode=0 reason=none" in caplog.text
    assert "phase=FFPROBE outcome=completed" in caplog.text
    assert "private" not in caplog.text


@pytest.mark.parametrize("failure_phase", ["VALIDATE_INPUT", "CONVERT_VIDEO", "REPLACE_ORIGINAL", "VALIDATE_OUTPUT", None])
def test_normalization_logs_exact_phase_and_preserves_behavior(tmp_path, monkeypatch, caplog, failure_phase):
    caplog.set_level(logging.INFO)
    source = tmp_path / "private-video.mp4"
    source.write_bytes(b"original")
    probe_calls = 0
    failure = PermissionError(13, "secret token", str(source))

    def validate(*args, **kwargs):
        nonlocal probe_calls
        probe_calls += 1
        if failure_phase == ("VALIDATE_INPUT" if probe_calls == 1 else "VALIDATE_OUTPUT"):
            raise failure
        return {"fps": 24}

    def convert(raw, destination, **kwargs):
        if failure_phase == "CONVERT_VIDEO":
            raise failure
        destination.write_bytes(b"normalized")

    original_replace = Path.replace

    def replace(path, target):
        if failure_phase == "REPLACE_ORIGINAL" and target == source:
            raise failure
        return original_replace(path, target)

    monkeypatch.setattr(media, "validate_saved_user_video", validate)
    monkeypatch.setattr(media, "normalize_video_to_mp4", convert)
    monkeypatch.setattr(Path, "replace", replace)
    if failure_phase:
        with pytest.raises(PermissionError) as raised:
            media.normalize_user_video_in_place(source, settings=get_settings())
        assert raised.value is failure
        assert f"phase={failure_phase} outcome=failed error_type=PermissionError" in caplog.text
        assert "errno=13" in caplog.text
    else:
        assert media.normalize_user_video_in_place(source, settings=get_settings()) == len(b"normalized")
        assert source.read_bytes() == b"normalized"
        for phase in ["VALIDATE_INPUT", "CONVERT_VIDEO", "REPLACE_ORIGINAL", "VALIDATE_OUTPUT"]:
            assert f"phase={phase} outcome=completed" in caplog.text
    assert str(source) not in caplog.text
    assert "secret token" not in caplog.text


def test_normalized_output_install_failure_is_distinguishable(tmp_path, monkeypatch, caplog):
    source = tmp_path / "source.mp4"
    destination = tmp_path / "output.mp4"
    monkeypatch.setattr(media, "_ffmpeg_bin", lambda name: name)

    def command(args, **kwargs):
        Path(args[-1]).write_bytes(b"converted")
        return subprocess.CompletedProcess(args, 0, "", "")

    def denied(*args):
        raise PermissionError(13, "private detail")

    monkeypatch.setattr(media, "_run_command", command)
    monkeypatch.setattr(Path, "replace", denied)
    with pytest.raises(PermissionError):
        media.normalize_video_to_mp4(source, destination, source_probe={"fps": 24}, settings=get_settings())
    assert "phase=INSTALL_NORMALIZED_OUTPUT outcome=failed" in caplog.text
    assert "private detail" not in caplog.text
