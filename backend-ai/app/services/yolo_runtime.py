from __future__ import annotations

import subprocess
import statistics
import time
from collections import Counter, deque
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from shutil import which
from threading import Lock

from PIL import Image

from app.core.config import BACKEND_AI_DIR, REPO_ROOT, get_settings

INTERMEDIATE_VIDEO_CODEC = "mp4v"


@dataclass(frozen=True)
class YoloBBox:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class YoloPrediction:
    model_label: str
    confidence: float
    bbox: YoloBBox


@dataclass(frozen=True)
class YoloTrackPrediction:
    model_label: str
    confidence: float
    bbox: YoloBBox
    track_id: int | None
    first_seen_ms: int
    last_seen_ms: int
    appearance_count: int


@dataclass(frozen=True)
class YoloTrackObservation:
    prediction: YoloTrackPrediction
    frame_index: int


@dataclass(frozen=True)
class TrackQualityPolicy:
    min_appearances: int
    min_duration_ms: int
    min_median_confidence: float
    min_density: float
    min_dominant_class_ratio: float


@dataclass
class WebcamTrackSession:
    tracker: object
    observations: dict[int, deque[YoloTrackObservation]]
    appearance_counts: dict[int, int]
    class_counts: dict[int, Counter[str]]
    first_seen_ms: dict[int, int]
    last_seen_ms: dict[int, int]
    last_seen_frame: dict[int, int]
    tracker_count: int
    frame_index: int
    started_at: float
    last_accessed_at: float


class YoloRuntimeUnavailableError(RuntimeError):
    pass


class YoloRuntime:
    def __init__(
        self,
        *,
        model_path: str,
        confidence: float,
        imgsz: int,
        model_id: str | None = None,
        display_name: str | None = None,
        expected_classes: list[str] | None = None,
        track_quality: TrackQualityPolicy | None = None,
        webcam_session_ttl_seconds: int = 30,
        webcam_max_sessions: int = 100,
        webcam_observation_window: int = 120,
        webcam_max_tracks: int = 64,
        webcam_stale_frames: int = 90,
    ) -> None:
        self.model_path = model_path
        self.confidence = confidence
        self.imgsz = imgsz
        self.model_id = model_id
        self.display_name = display_name
        self.expected_classes = expected_classes or []
        self._model: object | None = None
        self._model_lock = Lock()
        self._inference_lock = Lock()
        self.track_quality = track_quality
        self.webcam_session_ttl_seconds = webcam_session_ttl_seconds
        self.webcam_max_sessions = webcam_max_sessions
        self.webcam_observation_window = webcam_observation_window
        self.webcam_max_tracks = webcam_max_tracks
        self.webcam_stale_frames = webcam_stale_frames
        self._webcam_sessions: dict[str, WebcamTrackSession] = {}
        self._validated_classes: tuple[str, ...] | None = None

    def validate_ready(self, *, expected_classes: list[str] | None = None) -> None:
        model = self._get_model()
        classes = expected_classes or self.expected_classes
        normalized_expected = tuple(sorted(classes))
        if self._validated_classes == normalized_expected:
            return
        if classes:
            from app.services.model_registry import validate_model_class_names

            names = getattr(model, "names", {})
            if not validate_model_class_names(names, classes):
                raise YoloRuntimeUnavailableError("YOLO detection model class names do not match registry")
        with self._inference_lock:
            try:
                results = model.predict(source=Image.new("RGB", (32, 32), color=(255, 255, 255)), conf=self.confidence, imgsz=self.imgsz, verbose=False)
            except Exception as exc:
                raise YoloRuntimeUnavailableError("YOLO detection model warm-up failed") from exc
        if not isinstance(results, (list, tuple)) or not results or not hasattr(results[0], "boxes"):
            raise YoloRuntimeUnavailableError("YOLO detection model warm-up returned an invalid result")
        self._validated_classes = normalized_expected

    def predict(self, image: Image.Image) -> list[YoloPrediction]:
        model = self._get_model()
        with self._inference_lock:
            try:
                results = model.predict(source=image, conf=self.confidence, imgsz=self.imgsz, verbose=False)
            except Exception as exc:
                raise YoloRuntimeUnavailableError("YOLO detection model is unavailable") from exc
        return self._parse_result(model, results[0] if results else None, image.width, image.height)

    def track_video(
        self,
        video_path: Path,
        *,
        fps: float,
        media_width: int,
        media_height: int,
        rendered_video_path: Path | None = None,
        total_frames: int | None = None,
        progress_callback: Callable[[str, int | None, int | None, bool], None] | None = None,
    ) -> list[YoloTrackPrediction]:
        model = self._get_model()
        observations: dict[int, list[YoloTrackObservation]] = {}
        writer = None
        intermediate_video_path: Path | None = None
        frames_written = 0
        processed_frame_count = 0
        with self._inference_lock:
            tracking_error: Exception | None = None
            try:
                if rendered_video_path is not None:
                    import cv2

                    intermediate_video_path = rendered_video_path.with_name(
                        f"{rendered_video_path.stem}-opencv{rendered_video_path.suffix}"
                    )
                    candidate = cv2.VideoWriter(
                        str(intermediate_video_path),
                        cv2.VideoWriter_fourcc(*INTERMEDIATE_VIDEO_CODEC),
                        fps,
                        (media_width, media_height),
                    )
                    if candidate.isOpened():
                        writer = candidate
                    else:
                        candidate.release()
                    if writer is None:
                        raise RuntimeError("Rendered video writer could not be opened")
                results = model.track(
                    source=str(video_path),
                    tracker="bytetrack.yaml",
                    stream=True,
                    persist=False,
                    conf=self.confidence,
                    imgsz=self.imgsz,
                    verbose=False,
                )
                for frame_index, result in enumerate(results):
                    processed_frame_count = frame_index + 1
                    if writer is not None:
                        writer.write(result.plot())
                        frames_written += 1
                    frame_seen_ms = int(round((frame_index / fps) * 1000))
                    for prediction in self._parse_track_result(
                        model,
                        result,
                        media_width,
                        media_height,
                        seen_ms=frame_seen_ms,
                    ):
                        if prediction.track_id is None:
                            continue
                        observations.setdefault(prediction.track_id, []).append(
                            YoloTrackObservation(prediction=prediction, frame_index=frame_index)
                        )
                    if progress_callback is not None:
                        progress_callback("ANALYZING", processed_frame_count, total_frames, False)
            except Exception as exc:
                tracking_error = exc
            finally:
                if writer is not None:
                    writer.release()
            if tracking_error is not None:
                if intermediate_video_path is not None:
                    intermediate_video_path.unlink(missing_ok=True)
                if rendered_video_path is not None:
                    rendered_video_path.unlink(missing_ok=True)
                raise YoloRuntimeUnavailableError("YOLO video tracking model is unavailable") from tracking_error
            if rendered_video_path is not None:
                try:
                    if intermediate_video_path is None or frames_written <= 0:
                        raise RuntimeError("Rendered video contains no frames")
                    if progress_callback is not None:
                        progress_callback("ANALYZING", processed_frame_count, total_frames, True)
                        progress_callback("RENDERING", None, total_frames, True)
                    _transcode_h264_mp4(intermediate_video_path, rendered_video_path)
                except Exception as exc:
                    raise YoloRuntimeUnavailableError("YOLO video tracking model is unavailable") from exc
                finally:
                    if intermediate_video_path is not None:
                        intermediate_video_path.unlink(missing_ok=True)
        return sorted(
            _aggregate_track_observations(observations, policy=self.track_quality),
            key=lambda prediction: (
                prediction.first_seen_ms,
                prediction.track_id if prediction.track_id is not None else 10**12,
                -prediction.confidence,
            ),
        )

    def track_webcam_frame(self, image: Image.Image, *, session_id: str) -> list[YoloTrackPrediction]:
        """Track one webcam frame while keeping ByteTrack state isolated per browser session."""
        model = self._get_model()
        with self._inference_lock:
            try:
                now = time.monotonic()
                self._expire_webcam_sessions(now)
                session = self._webcam_sessions.get(session_id)
                if session is None:
                    session = WebcamTrackSession(
                        tracker=self._new_byte_tracker(), observations={}, appearance_counts={},
                        class_counts={}, first_seen_ms={}, last_seen_ms={}, last_seen_frame={}, tracker_count=0, frame_index=0,
                        started_at=now, last_accessed_at=now,
                    )
                    self._webcam_sessions[session_id] = session
                session.last_accessed_at = now
                results = model.predict(source=image, conf=self.confidence, imgsz=self.imgsz, verbose=False)
                result = results[0] if results else None
                boxes = getattr(result, "boxes", None)
                if result is None or boxes is None:
                    session.frame_index += 1
                    self._remove_stale_webcam_tracks(session)
                    return []
                tracks = self._update_webcam_tracker(session, boxes.cpu().numpy(), result.orig_img)
                current: list[YoloTrackPrediction] = []
                names = getattr(model, "names", {})
                seen_ms = int(round((now - session.started_at) * 1000))
                for row in tracks:
                    x1, y1, x2, y2, track_id, confidence, class_id = row[:7]
                    label = names.get(int(class_id), str(int(class_id))) if isinstance(names, dict) else str(int(class_id))
                    prediction = YoloTrackPrediction(
                        model_label=label, confidence=float(confidence),
                        bbox=_clamped_bbox(float(x1), float(y1), float(x2), float(y2), image.width, image.height),
                        track_id=int(track_id), first_seen_ms=seen_ms, last_seen_ms=seen_ms, appearance_count=1,
                    )
                    normalized_track_id = int(track_id)
                    if normalized_track_id not in session.observations and len(session.observations) >= self.webcam_max_tracks:
                        self._remove_oldest_webcam_track(session)
                    session.observations.setdefault(
                        normalized_track_id, deque(maxlen=self.webcam_observation_window)
                    ).append(YoloTrackObservation(prediction=prediction, frame_index=session.frame_index))
                    session.appearance_counts[normalized_track_id] = session.appearance_counts.get(normalized_track_id, 0) + 1
                    session.class_counts.setdefault(normalized_track_id, Counter())[label] += 1
                    session.first_seen_ms.setdefault(normalized_track_id, seen_ms)
                    session.last_seen_ms[normalized_track_id] = seen_ms
                    session.last_seen_frame[normalized_track_id] = session.frame_index
                    current.append(prediction)
                session.frame_index += 1
                self._remove_stale_webcam_tracks(session)
                accepted = self._aggregate_webcam_session(session)
                return [
                    YoloTrackPrediction(
                        model_label=accepted[item.track_id].model_label,
                        confidence=accepted[item.track_id].confidence,
                        bbox=item.bbox,
                        track_id=item.track_id,
                        first_seen_ms=accepted[item.track_id].first_seen_ms,
                        last_seen_ms=accepted[item.track_id].last_seen_ms,
                        appearance_count=accepted[item.track_id].appearance_count,
                    )
                    for item in current if item.track_id in accepted
                ]
            except Exception as exc:
                raise YoloRuntimeUnavailableError("YOLO webcam tracking model is unavailable") from exc

    def close_webcam_session(self, session_id: str) -> None:
        with self._inference_lock:
            self._webcam_sessions.pop(session_id, None)

    def _new_byte_tracker(self):
        from ultralytics.trackers.basetrack import BaseTrack
        from ultralytics.trackers.byte_tracker import BYTETracker
        from ultralytics.utils import IterableSimpleNamespace, YAML
        from ultralytics.utils.checks import check_yaml

        config = IterableSimpleNamespace(**YAML.load(check_yaml("bytetrack.yaml")))
        previous_id = BaseTrack._count
        tracker = BYTETracker(args=config)
        BaseTrack._count = previous_id
        return tracker

    def _update_webcam_tracker(self, session: WebcamTrackSession, detections, image):
        from ultralytics.trackers.basetrack import BaseTrack

        original_count = BaseTrack._count
        try:
            BaseTrack._count = session.tracker_count
            return session.tracker.update(detections, image)
        finally:
            session.tracker_count = BaseTrack._count
            BaseTrack._count = original_count

    def _remove_stale_webcam_tracks(self, session: WebcamTrackSession) -> None:
        stale_ids = [
            track_id for track_id, last_frame in session.last_seen_frame.items()
            if session.frame_index - last_frame > self.webcam_stale_frames
        ]
        for track_id in stale_ids:
            self._remove_webcam_track(session, track_id)

    def _remove_oldest_webcam_track(self, session: WebcamTrackSession) -> None:
        if session.last_seen_frame:
            self._remove_webcam_track(session, min(session.last_seen_frame, key=session.last_seen_frame.get))

    @staticmethod
    def _remove_webcam_track(session: WebcamTrackSession, track_id: int) -> None:
        for values in (
            session.observations, session.appearance_counts, session.class_counts,
            session.first_seen_ms, session.last_seen_ms, session.last_seen_frame,
        ):
            values.pop(track_id, None)

    def _aggregate_webcam_session(self, session: WebcamTrackSession) -> dict[int, YoloTrackPrediction]:
        accepted: dict[int, YoloTrackPrediction] = {}
        for track_id, observations in session.observations.items():
            if not observations:
                continue
            class_counts = session.class_counts[track_id]
            dominant_label, dominant_count = max(class_counts.items(), key=lambda item: (item[1], item[0]))
            representative_samples = [item for item in observations if item.prediction.model_label == dominant_label]
            confidences = [item.prediction.confidence for item in representative_samples]
            first_seen = session.first_seen_ms[track_id]
            last_seen = session.last_seen_ms[track_id]
            appearance_count = session.appearance_counts[track_id]
            frame_span = max(1, session.last_seen_frame[track_id] - observations[0].frame_index + 1)
            density = min(1.0, len(observations) / frame_span)
            if self.track_quality is not None and (
                appearance_count < self.track_quality.min_appearances
                or last_seen - first_seen < self.track_quality.min_duration_ms
                or statistics.median(confidences) < self.track_quality.min_median_confidence
                or density < self.track_quality.min_density
                or dominant_count / appearance_count < self.track_quality.min_dominant_class_ratio
            ):
                continue
            representative = representative_samples[-1].prediction
            accepted[track_id] = YoloTrackPrediction(
                model_label=dominant_label,
                confidence=statistics.median(confidences), bbox=representative.bbox, track_id=track_id,
                first_seen_ms=first_seen, last_seen_ms=last_seen, appearance_count=appearance_count,
            )
        return accepted

    def _expire_webcam_sessions(self, now: float) -> None:
        expired = [key for key, value in self._webcam_sessions.items()
                   if now - value.last_accessed_at > self.webcam_session_ttl_seconds]
        for key in expired:
            self._webcam_sessions.pop(key, None)
        while len(self._webcam_sessions) >= self.webcam_max_sessions:
            oldest = min(self._webcam_sessions, key=lambda key: self._webcam_sessions[key].last_accessed_at)
            self._webcam_sessions.pop(oldest, None)

    def _get_model(self):
        if self._model is not None:
            return self._model
        with self._model_lock:
            if self._model is not None:
                return self._model
            try:
                from ultralytics import YOLO

                self._model = YOLO(self._resolve_model_source())
            except Exception as exc:
                raise YoloRuntimeUnavailableError("YOLO detection model is unavailable") from exc
            return self._model

    def _resolve_model_source(self) -> str:
        configured = Path(self.model_path)
        if configured.is_absolute():
            return str(configured)
        candidates = [
            (BACKEND_AI_DIR / configured).resolve(),
            (REPO_ROOT / configured).resolve(),
        ]
        if len(configured.parts) == 1:
            candidates.extend(
                [
                    (BACKEND_AI_DIR / "models" / configured).resolve(),
                    (REPO_ROOT / "models" / configured).resolve(),
                    (REPO_ROOT / "ai" / configured).resolve(),
                ]
            )
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
        return self.model_path

    def _parse_result(self, model, result, media_width: int, media_height: int) -> list[YoloPrediction]:
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            return []

        names = getattr(model, "names", {})
        predictions: list[YoloPrediction] = []
        for box in boxes:
            xyxy = box.xyxy[0].tolist()
            confidence = float(box.conf[0])
            class_id = int(box.cls[0])
            model_label = names.get(class_id, str(class_id)) if isinstance(names, dict) else str(class_id)
            x1, y1, x2, y2 = [float(value) for value in xyxy]
            left = max(0.0, min(x1, float(media_width)))
            top = max(0.0, min(y1, float(media_height)))
            right = max(left, min(x2, float(media_width)))
            bottom = max(top, min(y2, float(media_height)))
            predictions.append(
                YoloPrediction(
                    model_label=model_label,
                    confidence=confidence,
                    bbox=YoloBBox(
                        x=left,
                        y=top,
                        width=right - left,
                        height=bottom - top,
                    ),
                )
            )
        return predictions

    def _parse_track_result(
        self,
        model,
        result,
        media_width: int,
        media_height: int,
        *,
        seen_ms: int,
    ) -> list[YoloTrackPrediction]:
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            return []

        names = getattr(model, "names", {})
        predictions: list[YoloTrackPrediction] = []
        for box in boxes:
            xyxy = box.xyxy[0].tolist()
            confidence = float(box.conf[0])
            class_id = int(box.cls[0])
            model_label = names.get(class_id, str(class_id)) if isinstance(names, dict) else str(class_id)
            x1, y1, x2, y2 = [float(value) for value in xyxy]
            left = max(0.0, min(x1, float(media_width)))
            top = max(0.0, min(y1, float(media_height)))
            right = max(left, min(x2, float(media_width)))
            bottom = max(top, min(y2, float(media_height)))
            predictions.append(
                YoloTrackPrediction(
                    model_label=model_label,
                    confidence=confidence,
                    bbox=YoloBBox(
                        x=left,
                        y=top,
                        width=right - left,
                        height=bottom - top,
                    ),
                    track_id=self._parse_track_id(box),
                    first_seen_ms=seen_ms,
                    last_seen_ms=seen_ms,
                    appearance_count=1,
                )
            )
        return predictions

    def _parse_track_id(self, box) -> int | None:
        raw_track_id = getattr(box, "id", None)
        if raw_track_id is None:
            return None
        try:
            if hasattr(raw_track_id, "numel") and raw_track_id.numel() == 0:
                return None
            if hasattr(raw_track_id, "tolist"):
                value = raw_track_id.tolist()
                if isinstance(value, list):
                    return int(value[0]) if value else None
                return int(value)
            return int(raw_track_id[0])
        except (TypeError, ValueError, IndexError):
            return None


@lru_cache
def get_yolo_runtime() -> YoloRuntime:
    settings = get_settings()
    return YoloRuntime(
        model_path=settings.DETECTION_MODEL,
        confidence=settings.DETECTION_CONFIDENCE,
        imgsz=settings.DETECTION_IMGSZ,
        track_quality=TrackQualityPolicy(
            min_appearances=settings.TRACK_MIN_APPEARANCES,
            min_duration_ms=settings.TRACK_MIN_DURATION_MS,
            min_median_confidence=settings.TRACK_MIN_MEDIAN_CONFIDENCE,
            min_density=settings.TRACK_MIN_DENSITY,
            min_dominant_class_ratio=settings.TRACK_MIN_DOMINANT_CLASS_RATIO,
        ),
        webcam_session_ttl_seconds=settings.WEBCAM_TRACK_SESSION_TTL_SECONDS,
        webcam_max_sessions=settings.WEBCAM_TRACK_MAX_SESSIONS,
        model_id=Path(settings.DETECTION_MODEL).stem,
        webcam_observation_window=settings.WEBCAM_TRACK_OBSERVATION_WINDOW,
        webcam_max_tracks=settings.WEBCAM_TRACK_MAX_TRACKS,
        webcam_stale_frames=settings.WEBCAM_TRACK_STALE_FRAMES,
    )


def _ffmpeg_executable() -> str:
    system_ffmpeg = which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg
    try:
        import imageio_ffmpeg
    except ImportError as exc:
        raise RuntimeError("FFmpeg executable is not available") from exc
    return imageio_ffmpeg.get_ffmpeg_exe()


def _transcode_h264_mp4(input_path: Path, output_path: Path) -> None:
    if not input_path.exists() or input_path.stat().st_size == 0:
        raise RuntimeError("Rendered intermediate video was not created")
    output_path.unlink(missing_ok=True)
    completed = subprocess.run(
        [
            _ffmpeg_executable(),
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError("FFmpeg H.264 conversion failed")
    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("FFmpeg did not create a rendered video")


def _aggregate_track_observations(
    observations_by_track: dict[int, list[YoloTrackObservation]],
    *,
    policy: TrackQualityPolicy | None = None,
) -> list[YoloTrackPrediction]:
    predictions: list[YoloTrackPrediction] = []
    for observations in observations_by_track.values():
        if not observations:
            continue
        frame_indexes = [observation.frame_index for observation in observations]
        frame_span = max(frame_indexes) - min(frame_indexes) + 1
        density = len(observations) / frame_span
        labels: dict[str, int] = {}
        for observation in observations:
            label = observation.prediction.model_label
            labels[label] = labels.get(label, 0) + 1
        dominant_label, dominant_count = max(labels.items(), key=lambda item: (item[1], item[0]))
        dominant_observations = [item for item in observations if item.prediction.model_label == dominant_label]
        seen_ms_values = [observation.prediction.first_seen_ms for observation in observations]
        first_seen_ms = min(seen_ms_values)
        last_seen_ms = max(seen_ms_values)
        midpoint_ms = (first_seen_ms + last_seen_ms) / 2
        confidences = [observation.prediction.confidence for observation in dominant_observations]
        median_confidence = statistics.median(confidences)
        if policy is not None and (
            len(observations) < policy.min_appearances
            or last_seen_ms - first_seen_ms < policy.min_duration_ms
            or median_confidence < policy.min_median_confidence
            or density < policy.min_density
            or dominant_count / len(observations) < policy.min_dominant_class_ratio
        ):
            continue
        representative = min(
            dominant_observations,
            key=lambda observation: (
                abs(observation.prediction.first_seen_ms - midpoint_ms),
                -observation.prediction.confidence,
                observation.frame_index,
            ),
        ).prediction
        predictions.append(
            YoloTrackPrediction(
                model_label=representative.model_label,
                confidence=median_confidence if policy is not None else max(confidences),
                bbox=representative.bbox,
                track_id=representative.track_id,
                first_seen_ms=first_seen_ms,
                last_seen_ms=last_seen_ms,
                appearance_count=len(observations),
            )
        )
    return predictions


def _clamped_bbox(x1: float, y1: float, x2: float, y2: float, width: int, height: int) -> YoloBBox:
    left = max(0.0, min(x1, float(width)))
    top = max(0.0, min(y1, float(height)))
    right = max(left, min(x2, float(width)))
    bottom = max(top, min(y2, float(height)))
    return YoloBBox(x=left, y=top, width=right - left, height=bottom - top)
