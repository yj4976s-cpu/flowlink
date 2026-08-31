from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence
from zoneinfo import ZoneInfo


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[2]
DEFAULT_MODELS_DIR = REPO_ROOT / "models"
DEFAULT_OUTPUT_PATH = REPO_ROOT / "backend" / "app" / "data" / "model_comparison.json"
YOLO = None


MODEL_SPECS = [
    {
        "id": "flowlink-3class-v6-7",
        "display_name": "\uae30\uc874 3\ud074\ub798\uc2a4 \ubaa8\ub378",
        "file_name": "best_v6.7_8n_100_16_AdamW_0005.pt",
        "architecture": "YOLO 8n",
        "optimizer": "AdamW",
        "epochs": 100,
        "image_size": None,
        "batch_size": 16,
        "expected_classes": {"BALL", "FOOTWEAR", "TRASH"},
    },
    {
        "id": "flowlink-4class-hat-v7",
        "display_name": "\uc2e0\uaddc HAT 4\ud074\ub798\uc2a4 \ubaa8\ub378",
        "file_name": "best_v7_8n_100_640_16_SGD_0005.pt",
        "architecture": "YOLO 8n",
        "optimizer": "SGD",
        "epochs": 100,
        "image_size": 640,
        "batch_size": 16,
        "expected_classes": {"BALL", "FOOTWEAR", "TRASH", "HAT"},
    },
]


CLASS_ORDER = ["BALL", "FOOTWEAR", "TRASH", "HAT"]

CLASS_LABELS = {
    "BALL": "\uacf5",
    "FOOTWEAR": "\uc2e0\ubc1c\u00b7\uc2ac\ub9ac\ud37c\ub958",
    "TRASH": "\ud3d0\uae30\ubb3c",
    "HAT": "\ubaa8\uc790",
}


class ModelComparisonExportError(RuntimeError):
    pass


def normalize_class_name(value: str) -> str:
    normalized = " ".join(value.strip().lower().replace("_", " ").replace("-", " ").split())
    if normalized in {"shoe", "shoes", "sneaker", "sneakers", "footwear"}:
        return "FOOTWEAR"
    if normalized == "ball":
        return "BALL"
    if normalized == "trash":
        return "TRASH"
    if normalized == "hat":
        return "HAT"
    return normalized.upper().replace(" ", "_")


def default_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export FlowLink model comparison JSON from the same YOLO test split.")
    parser.add_argument("--data", required=True, help="Dataset YAML path with a test split.")
    parser.add_argument("--models-dir", type=Path, default=DEFAULT_MODELS_DIR, help="Directory containing local .pt files.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH, help="Output JSON path.")
    parser.add_argument("--dataset-name", default="FlowLink Roboflow test split")
    parser.add_argument("--dataset-version")
    parser.add_argument("--dataset-hash")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--conf", type=float, default=0.001)
    parser.add_argument("--iou", type=float, default=0.7)
    parser.add_argument("--device", default="cpu")
    return parser


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    return default_parser().parse_args(argv)


def _display_path(path: Path) -> str:
    return path.name


def _resolve_path(path: Path) -> Path:
    return path.expanduser().resolve()


def get_yolo_class() -> Any:
    global YOLO
    if YOLO is None:
        from ultralytics import YOLO as loaded_yolo

        YOLO = loaded_yolo
    return YOLO


def get_ultralytics_version() -> str:
    import ultralytics

    return str(ultralytics.__version__)


def _ensure_models_exist(models_dir: Path) -> None:
    if not models_dir.is_dir():
        raise ModelComparisonExportError(f"Model directory does not exist: {_display_path(models_dir)}")

    missing = [spec["file_name"] for spec in MODEL_SPECS if not (models_dir / str(spec["file_name"])).is_file()]
    if missing:
        raise ModelComparisonExportError(f"Missing model checkpoint file(s): {', '.join(missing)}")


def _ensure_dataset_has_test_split(data_path: Path) -> None:
    if not data_path.is_file():
        raise ModelComparisonExportError(f"Dataset YAML does not exist: {_display_path(data_path)}")

    try:
        lines = data_path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        lines = data_path.read_text().splitlines()

    has_test_split = any(line.strip().startswith("test:") for line in lines)
    if not has_test_split:
        raise ModelComparisonExportError("Dataset YAML must define a test split before exporting model comparison metrics.")


def _normalized_model_classes(model: Any) -> set[str]:
    return {normalize_class_name(str(name)) for name in model.names.values()}


def _validate_model_classes(model: Any, expected_classes: set[str], file_name: str) -> set[str]:
    actual = _normalized_model_classes(model)
    if actual != expected_classes:
        missing = sorted(expected_classes - actual)
        unexpected = sorted(actual - expected_classes)
        details = []
        if missing:
            details.append(f"missing={missing}")
        if unexpected:
            details.append(f"unexpected={unexpected}")
        raise ModelComparisonExportError(f"{file_name} class set mismatch: {', '.join(details)}")
    return actual


def null_metrics_for_classes(classes: set[str]) -> list[dict[str, Any]]:
    return [
        {
            "code": code,
            "label": CLASS_LABELS[code],
            "supported": code in classes,
            "precision": None,
            "recall": None,
            "map50": None,
            "map50_95": None,
        }
        for code in CLASS_ORDER
    ]


def _metric_sequence(metric: Any) -> Sequence[Any] | None:
    if metric is None:
        return None
    return metric if isinstance(metric, Sequence) else None


def _metric_at(metric: Any, index: int) -> float | None:
    values = _metric_sequence(metric)
    if values is None or index >= len(values):
        return None
    value = values[index]
    return float(value) if value is not None else None


def class_metrics_from_results(model: Any, results: Any, classes: set[str]) -> list[dict[str, Any]]:
    names = {int(index): normalize_class_name(str(name)) for index, name in model.names.items()}
    metrics = null_metrics_for_classes(classes)
    by_code = {item["code"]: item for item in metrics}

    box = getattr(results, "box", None)
    maps = getattr(box, "maps", None)
    precision = getattr(box, "p", None)
    recall = getattr(box, "r", None)
    map50 = getattr(box, "ap50", None)

    for index, code in names.items():
        if code not in by_code:
            continue
        by_code[code]["map50_95"] = _metric_at(maps, index)
        by_code[code]["precision"] = _metric_at(precision, index)
        by_code[code]["recall"] = _metric_at(recall, index)
        by_code[code]["map50"] = _metric_at(map50, index)
    return metrics


def test_image_count_from_model(model: Any) -> int | None:
    dataset = getattr(getattr(getattr(model, "validator", None), "dataloader", None), "dataset", None)
    if dataset is None:
        return None
    try:
        return len(dataset)
    except TypeError:
        return None


def average_inference_ms_from_results(results: Any) -> float | None:
    speed = getattr(results, "speed", None)
    if not isinstance(speed, dict):
        return None
    inference_ms = speed.get("inference")
    if inference_ms is None:
        return None
    inference_ms = float(inference_ms)
    return inference_ms if inference_ms > 0 else None


def _box_metric(box: Any, name: str) -> float | None:
    value = getattr(box, name, None)
    return float(value) if value is not None else None


def export(args: argparse.Namespace) -> dict[str, Any]:
    models_dir = _resolve_path(Path(args.models_dir))
    data_path = _resolve_path(Path(args.data))
    _ensure_models_exist(models_dir)
    _ensure_dataset_has_test_split(data_path)

    output_models = []
    test_counts: list[int | None] = []
    yolo_class = get_yolo_class()

    for spec in MODEL_SPECS:
        file_name = str(spec["file_name"])
        model_path = models_dir / file_name
        model = yolo_class(str(model_path))
        expected_classes = set(spec["expected_classes"])
        classes = _validate_model_classes(model, expected_classes, file_name)

        results = model.val(
            data=str(data_path),
            split="test",
            imgsz=args.imgsz,
            batch=args.batch,
            conf=args.conf,
            iou=args.iou,
            device=args.device,
            verbose=False,
        )
        test_counts.append(test_image_count_from_model(model))
        avg_ms = average_inference_ms_from_results(results)
        box = getattr(results, "box", None)
        export_spec = {key: value for key, value in spec.items() if key != "expected_classes"}
        output_models.append({
            **export_spec,
            "classes": sorted(classes),
            "file_size_bytes": model_path.stat().st_size,
            "precision": _box_metric(box, "mp") if box is not None else None,
            "recall": _box_metric(box, "mr") if box is not None else None,
            "map50": _box_metric(box, "map50") if box is not None else None,
            "map50_95": _box_metric(box, "map") if box is not None else None,
            "class_metrics": class_metrics_from_results(model, results, classes),
            "average_inference_ms": avg_ms,
            "fps": 1000 / avg_ms if avg_ms and avg_ms > 0 else None,
            "example_results": [],
            "notes": "Average inference time comes from Ultralytics validation speed['inference'] and excludes preprocessing/postprocessing.",
        })

    known_test_counts = {count for count in test_counts if count is not None}
    if len(known_test_counts) > 1:
        raise ModelComparisonExportError("Compared models reported different test image counts; refusing to write partial comparison data.")
    test_image_count = next(iter(known_test_counts), None)
    count_note = "" if test_image_count is not None else " Test image count could not be read from the Ultralytics validator."

    return {
        "schema_version": 1,
        "generated_at": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "evaluation": {
            "dataset_name": args.dataset_name,
            "dataset_version": args.dataset_version,
            "dataset_hash": args.dataset_hash,
            "test_image_count": test_image_count,
            "image_size": args.imgsz,
            "confidence_threshold": args.conf,
            "iou_threshold": args.iou,
            "batch": args.batch,
            "device": args.device,
            "ultralytics_version": get_ultralytics_version(),
            "notes": "Same test split evaluation via Ultralytics model.val(split='test'). Average inference time is the validation image inference stage only and excludes preprocessing/postprocessing." + count_note,
        },
        "current_deployed_model_id": None,
        "current_deployed_model_status": "\ud655\uc778 \ud544\uc694",
        "models": output_models,
    }


def write_payload(payload: dict[str, Any], output_path: Path) -> None:
    output_path = _resolve_path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    payload = export(args)
    write_payload(payload, Path(args.output))


if __name__ == "__main__":
    main()
