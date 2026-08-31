from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import export_model_comparison as exporter

np = pytest.importorskip("numpy")


class FakeDataset:
    def __init__(self, count: int) -> None:
        self.count = count

    def __len__(self) -> int:
        return self.count


class FakeDataloader:
    def __init__(self, count: int) -> None:
        self.dataset = FakeDataset(count)


class FakeValidator:
    def __init__(self, count: int) -> None:
        self.dataloader = FakeDataloader(count)


class FakeBox:
    def __init__(
        self,
        ap_class_index,
        p,
        r,
        ap50,
        ap,
        *,
        mp: float = 0.81,
        mr: float = 0.72,
        map50: float = 0.86,
        map_value: float = 0.64,
    ) -> None:
        self.mp = mp
        self.mr = mr
        self.map50 = map50
        self.map = map_value
        self.ap_class_index = np.array(ap_class_index)
        self.p = np.array(p)
        self.r = np.array(r)
        self.ap50 = np.array(ap50)
        self.ap = np.array(ap)


class FakeResults:
    def __init__(
        self,
        box: FakeBox,
        *,
        speed: dict[str, float] | None = None,
        seen: int | None = 12,
        validator: FakeValidator | None = None,
    ) -> None:
        self.box = box
        self.speed = speed or {"inference": 8.0}
        if seen is not None:
            self.seen = seen
        self.validator = validator


class FakeYOLO:
    names_by_file: dict[str, dict[int, str]] = {
        "best_v6.7_8n_100_16_AdamW_0005.pt": {2: "trash", 0: "ball", 1: "shoe"},
        "best_v7_8n_100_640_16_SGD_0005.pt": {3: "trash", 1: "hat", 0: "ball", 2: "shoe"},
    }
    counts_by_file: dict[str, int] = {
        "best_v6.7_8n_100_16_AdamW_0005.pt": 12,
        "best_v7_8n_100_640_16_SGD_0005.pt": 12,
    }
    include_hat_metrics = False
    use_validator_count = False
    instances: list["FakeYOLO"] = []

    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self.names = self.names_by_file[self.path.name]
        self.val_called = 0
        self.instances.append(self)

    def val(self, **kwargs):
        self.val_called += 1
        assert kwargs["split"] == "test"
        assert kwargs["imgsz"] == 640
        assert Path(kwargs["data"]).is_absolute()
        count = self.counts_by_file[self.path.name]
        seen = None if self.use_validator_count else count
        validator = FakeValidator(count) if self.use_validator_count else None

        if self.path.name == "best_v6.7_8n_100_16_AdamW_0005.pt":
            box = FakeBox(
                ap_class_index=[0, 1, 2],
                p=[0.80, 0.70, 0.60],
                r=[0.75, 0.65, 0.55],
                ap50=[0.90, 0.80, 0.70],
                ap=[0.70, 0.60, 0.50],
            )
        elif self.include_hat_metrics:
            box = FakeBox(
                ap_class_index=[0, 1, 2, 3],
                p=[0.80, 0.42, 0.60, 0.50],
                r=[0.75, 0.41, 0.55, 0.45],
                ap50=[0.90, 0.44, 0.70, 0.60],
                ap=[0.70, 0.33, 0.50, 0.40],
            )
        else:
            box = FakeBox(
                ap_class_index=[0, 2, 3],
                p=[0.80, 0.60, 0.50],
                r=[0.75, 0.55, 0.45],
                ap50=[0.90, 0.70, 0.60],
                ap=[0.70, 0.50, 0.40],
            )
        return FakeResults(box, seen=seen, validator=validator)


def _write_required_files(tmp_path: Path) -> tuple[Path, Path]:
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    for spec in exporter.MODEL_SPECS:
        (models_dir / spec["file_name"]).write_bytes(b"checkpoint")
    data = tmp_path / "dataset.yaml"
    data.write_text("path: dataset\ntest: images/test\n", encoding="utf-8")
    return models_dir, data


def _args(models_dir: Path, data: Path, output: Path | None = None):
    return SimpleNamespace(
        data=data,
        models_dir=models_dir,
        output=output or data.parent / "model_comparison.json",
        dataset_name="test dataset",
        dataset_version=None,
        dataset_hash=None,
        imgsz=640,
        batch=16,
        conf=0.001,
        iou=0.7,
        device="cpu",
    )


def _mock_runtime(monkeypatch) -> None:
    monkeypatch.setattr(exporter, "YOLO", FakeYOLO)
    monkeypatch.setattr(exporter, "get_ultralytics_version", lambda: "test-ultralytics")
    FakeYOLO.instances = []
    FakeYOLO.include_hat_metrics = False
    FakeYOLO.use_validator_count = False


def test_default_paths_are_repo_root_based_even_when_cwd_changes(monkeypatch):
    monkeypatch.chdir(exporter.REPO_ROOT)
    root_args = exporter.parse_args(["--data", "dataset.yaml"])

    monkeypatch.chdir(exporter.REPO_ROOT / "backend-ai")
    backend_ai_args = exporter.parse_args(["--data", "dataset.yaml"])

    assert exporter.DEFAULT_MODELS_DIR == exporter.REPO_ROOT / "models"
    assert exporter.DEFAULT_OUTPUT_PATH == exporter.REPO_ROOT / "backend" / "app" / "data" / "model_comparison.json"
    assert root_args.models_dir == exporter.DEFAULT_MODELS_DIR
    assert backend_ai_args.models_dir == exporter.DEFAULT_MODELS_DIR
    assert root_args.output == backend_ai_args.output == exporter.DEFAULT_OUTPUT_PATH


def test_explicit_models_dir_and_output_override_defaults(tmp_path):
    custom_models = tmp_path / "custom-models"
    custom_output = tmp_path / "out" / "comparison.json"

    args = exporter.parse_args([
        "--data",
        "dataset.yaml",
        "--models-dir",
        str(custom_models),
        "--output",
        str(custom_output),
    ])

    assert args.models_dir == custom_models
    assert args.output == custom_output


def test_model_class_normalization_is_name_based_and_order_independent():
    assert exporter.normalize_class_name(" shoe ") == "FOOTWEAR"
    assert exporter.normalize_class_name("shoes") == "FOOTWEAR"
    assert exporter.normalize_class_name("sneaker") == "FOOTWEAR"
    assert exporter.normalize_class_name("FOOT-WEAR") == "FOOTWEAR"
    assert exporter.normalize_class_name("foot_wear") == "FOOTWEAR"
    assert exporter.normalize_class_name(" foot  wear ") == "FOOTWEAR"
    assert exporter.normalize_class_name("hat") == "HAT"

    model = SimpleNamespace(names={3: "trash", 1: "shoe", 0: "ball"})
    assert exporter._validate_model_classes(model, {"BALL", "FOOTWEAR", "TRASH"}, "old.pt") == {"BALL", "FOOTWEAR", "TRASH"}


def test_metric_at_accepts_numpy_arrays_and_filters_invalid_values():
    values = np.array([0.0, 0.5, np.nan, np.inf])

    assert exporter.metric_at(values, 0) == 0.0
    assert exporter.metric_at(values, 1) == 0.5
    assert exporter.metric_at(values, 2) is None
    assert exporter.metric_at(values, 3) is None
    assert exporter.metric_at("0.5", 0) is None
    assert exporter.metric_at({"value": 0.5}, 0) is None


def test_class_metrics_use_ap_class_index_not_model_class_order():
    model = SimpleNamespace(names={0: "ball", 1: "hat", 2: "shoe", 3: "trash"})
    results = SimpleNamespace(
        box=FakeBox(
            ap_class_index=[0, 2, 3],
            p=[0.10, 0.20, 0.30],
            r=[0.40, 0.50, 0.60],
            ap50=[0.70, 0.80, 0.90],
            ap=[0.11, 0.22, 0.33],
        ),
    )

    metrics = {item["code"]: item for item in exporter.class_metrics_from_results(model, results, {"BALL", "FOOTWEAR", "TRASH", "HAT"})}

    assert metrics["BALL"]["precision"] == 0.10
    assert metrics["FOOTWEAR"]["precision"] == 0.20
    assert metrics["TRASH"]["precision"] == 0.30
    assert metrics["HAT"]["precision"] is None
    assert metrics["FOOTWEAR"]["map50_95"] == 0.22


def test_export_uses_validated_classes_test_count_and_validation_speed(monkeypatch, tmp_path):
    models_dir, data = _write_required_files(tmp_path)
    _mock_runtime(monkeypatch)

    payload = exporter.export(_args(models_dir, data))

    assert payload["evaluation"]["test_image_count"] == 12
    assert payload["evaluation"]["image_size"] == 640
    assert payload["models"][0]["classes"] == ["BALL", "FOOTWEAR", "TRASH"]
    assert payload["models"][1]["classes"] == ["BALL", "FOOTWEAR", "HAT", "TRASH"]
    assert payload["models"][0]["average_inference_ms"] == 8.0
    assert payload["models"][0]["fps"] == 125.0

    old_hat = next(item for item in payload["models"][0]["class_metrics"] if item["code"] == "HAT")
    new_metrics = {item["code"]: item for item in payload["models"][1]["class_metrics"]}
    assert old_hat["supported"] is False
    assert old_hat["map50_95"] is None
    assert new_metrics["HAT"]["supported"] is True
    assert new_metrics["HAT"]["map50_95"] is None
    assert new_metrics["FOOTWEAR"]["map50_95"] == 0.50
    assert new_metrics["TRASH"]["map50_95"] == 0.40
    assert all(instance.val_called == 1 for instance in FakeYOLO.instances)


def test_export_records_hat_metrics_when_test_split_contains_hat(monkeypatch, tmp_path):
    models_dir, data = _write_required_files(tmp_path)
    _mock_runtime(monkeypatch)
    FakeYOLO.include_hat_metrics = True

    payload = exporter.export(_args(models_dir, data))
    new_hat = next(item for item in payload["models"][1]["class_metrics"] if item["code"] == "HAT")

    assert new_hat["supported"] is True
    assert new_hat["precision"] == 0.42
    assert new_hat["map50"] == 0.44
    assert new_hat["map50_95"] == 0.33


def test_test_image_count_can_use_results_validator_or_local_test_split(tmp_path):
    data_root = tmp_path / "dataset"
    image_dir = data_root / "images" / "test"
    image_dir.mkdir(parents=True)
    (image_dir / "a.jpg").write_bytes(b"x")
    (image_dir / "b.png").write_bytes(b"x")
    data = tmp_path / "dataset.yaml"
    data.write_text(f"path: {data_root}\ntest: images/test\n", encoding="utf-8")

    assert exporter.test_image_count_from_results(SimpleNamespace(validator=FakeValidator(7)), data) == 7
    assert exporter.test_image_count_from_results(SimpleNamespace(), data) == 2


def test_export_fails_before_evaluation_when_model_directory_or_checkpoint_is_missing(tmp_path):
    data = tmp_path / "dataset.yaml"
    data.write_text("test: images/test\n", encoding="utf-8")

    with pytest.raises(exporter.ModelComparisonExportError, match="Model directory"):
        exporter.export(_args(tmp_path / "missing", data))

    models_dir = tmp_path / "models"
    models_dir.mkdir()
    with pytest.raises(exporter.ModelComparisonExportError, match="Missing model checkpoint"):
        exporter.export(_args(models_dir, data))


def test_export_fails_before_evaluation_without_test_split(monkeypatch, tmp_path):
    models_dir, data = _write_required_files(tmp_path)
    data.write_text("path: dataset\nval: images/valid\n", encoding="utf-8")
    _mock_runtime(monkeypatch)

    with pytest.raises(exporter.ModelComparisonExportError, match="test split"):
        exporter.export(_args(models_dir, data))
    assert FakeYOLO.instances == []


def test_export_refuses_missing_or_unexpected_model_classes_before_val(monkeypatch, tmp_path):
    models_dir, data = _write_required_files(tmp_path)
    _mock_runtime(monkeypatch)
    original_names = FakeYOLO.names_by_file.copy()
    FakeYOLO.names_by_file = {
        **original_names,
        "best_v7_8n_100_640_16_SGD_0005.pt": {0: "ball", 1: "hat", 2: "shoe", 3: "trash", 4: "bag"},
    }

    try:
        with pytest.raises(exporter.ModelComparisonExportError, match="unexpected"):
            exporter.export(_args(models_dir, data))
    finally:
        FakeYOLO.names_by_file = original_names

    assert FakeYOLO.instances[-1].val_called == 0


def test_export_refuses_mismatched_test_counts_and_does_not_update_existing_output(monkeypatch, tmp_path):
    models_dir, data = _write_required_files(tmp_path)
    output = tmp_path / "model_comparison.json"
    output.write_text("existing json\n", encoding="utf-8")
    _mock_runtime(monkeypatch)
    original_counts = FakeYOLO.counts_by_file.copy()
    FakeYOLO.counts_by_file = {
        "best_v6.7_8n_100_16_AdamW_0005.pt": 12,
        "best_v7_8n_100_640_16_SGD_0005.pt": 13,
    }

    try:
        with pytest.raises(exporter.ModelComparisonExportError, match="different test image counts"):
            exporter.main([
                "--data",
                str(data),
                "--models-dir",
                str(models_dir),
                "--output",
                str(output),
            ])
    finally:
        FakeYOLO.counts_by_file = original_counts

    assert output.read_text(encoding="utf-8") == "existing json\n"


def test_written_output_excludes_absolute_model_paths_and_sensitive_values(monkeypatch, tmp_path):
    models_dir, data = _write_required_files(tmp_path)
    output = tmp_path / "model_comparison.json"
    _mock_runtime(monkeypatch)

    exporter.main([
        "--data",
        str(data),
        "--models-dir",
        str(models_dir),
        "--output",
        str(output),
    ])

    serialized = output.read_text(encoding="utf-8")
    payload = json.loads(serialized)
    assert payload["models"][0]["file_name"] == "best_v6.7_8n_100_16_AdamW_0005.pt"
    assert str(models_dir) not in serialized
    assert "API_KEY" not in serialized
    assert "SECRET" not in serialized
