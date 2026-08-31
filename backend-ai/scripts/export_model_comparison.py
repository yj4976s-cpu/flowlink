from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from ultralytics import YOLO
import ultralytics


MODEL_SPECS = [
    {
        "id": "flowlink-3class-v6-7",
        "display_name": "기존 3클래스 모델",
        "file_name": "best_v6.7_8n_100_16_AdamW_0005.pt",
        "architecture": "YOLO 8n",
        "optimizer": "AdamW",
        "epochs": 100,
        "image_size": None,
        "batch_size": 16,
    },
    {
        "id": "flowlink-4class-hat-v7",
        "display_name": "신규 HAT 4클래스 모델",
        "file_name": "best_v7_8n_100_640_16_SGD_0005.pt",
        "architecture": "YOLO 8n",
        "optimizer": "SGD",
        "epochs": 100,
        "image_size": 640,
        "batch_size": 16,
    },
]


CLASS_LABELS = {
    "BALL": "공",
    "FOOTWEAR": "신발·슬리퍼류",
    "TRASH": "폐기물",
    "HAT": "모자",
}


def normalize_class_name(value: str) -> str:
    normalized = value.strip().lower().replace("_", " ").replace("-", " ")
    if normalized in {"shoe", "shoes", "sneaker", "footwear"}:
        return "FOOTWEAR"
    if normalized == "ball":
        return "BALL"
    if normalized == "trash":
        return "TRASH"
    if normalized == "hat":
        return "HAT"
    return normalized.upper().replace(" ", "_")


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
        for code in ["BALL", "FOOTWEAR", "TRASH", "HAT"]
    ]


def class_metrics_from_results(model: YOLO, results: Any, classes: set[str]) -> list[dict[str, Any]]:
    names = {int(index): normalize_class_name(str(name)) for index, name in model.names.items()}
    metrics = null_metrics_for_classes(classes)
    by_code = {item["code"]: item for item in metrics}

    maps = getattr(getattr(results, "box", None), "maps", None)
    precision = getattr(getattr(results, "box", None), "p", None)
    recall = getattr(getattr(results, "box", None), "r", None)
    map50 = getattr(getattr(results, "box", None), "ap50", None)

    for index, code in names.items():
        if code not in by_code:
            continue
        by_code[code]["map50_95"] = float(maps[index]) if maps is not None and index < len(maps) else None
        by_code[code]["precision"] = float(precision[index]) if precision is not None and index < len(precision) else None
        by_code[code]["recall"] = float(recall[index]) if recall is not None and index < len(recall) else None
        by_code[code]["map50"] = float(map50[index]) if map50 is not None and index < len(map50) else None
    return metrics


def average_inference_ms(model: YOLO, sample: Path | None, imgsz: int, warmup: int, runs: int) -> float | None:
    if sample is None:
        return None
    for _ in range(warmup):
        model.predict(str(sample), imgsz=imgsz, verbose=False)
    started = time.perf_counter()
    for _ in range(runs):
        model.predict(str(sample), imgsz=imgsz, verbose=False)
    elapsed = time.perf_counter() - started
    return elapsed * 1000 / runs


def export(args: argparse.Namespace) -> dict[str, Any]:
    models_dir = Path(args.models_dir)
    sample = Path(args.sample_image) if args.sample_image else None
    output_models = []

    for spec in MODEL_SPECS:
        model_path = models_dir / spec["file_name"]
        model = YOLO(str(model_path))
        classes = {normalize_class_name(str(name)) for name in model.names.values()}
        results = model.val(
            data=args.data,
            split="test",
            imgsz=args.imgsz,
            batch=args.batch,
            conf=args.conf,
            iou=args.iou,
            device=args.device,
            verbose=False,
        )
        avg_ms = average_inference_ms(model, sample, args.imgsz, args.warmup, args.runs)
        output_models.append({
            **spec,
            "classes": sorted(classes),
            "file_size_bytes": model_path.stat().st_size,
            "precision": float(results.box.mp) if getattr(results, "box", None) is not None else None,
            "recall": float(results.box.mr) if getattr(results, "box", None) is not None else None,
            "map50": float(results.box.map50) if getattr(results, "box", None) is not None else None,
            "map50_95": float(results.box.map) if getattr(results, "box", None) is not None else None,
            "class_metrics": class_metrics_from_results(model, results, classes),
            "average_inference_ms": avg_ms,
            "fps": 1000 / avg_ms if avg_ms and avg_ms > 0 else None,
            "example_results": [],
            "notes": None,
        })

    return {
        "schema_version": 1,
        "generated_at": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "evaluation": {
            "dataset_name": args.dataset_name,
            "dataset_version": args.dataset_version,
            "dataset_hash": args.dataset_hash,
            "test_image_count": None,
            "image_size": args.imgsz,
            "confidence_threshold": args.conf,
            "iou_threshold": args.iou,
            "batch": args.batch,
            "device": args.device,
            "ultralytics_version": ultralytics.__version__,
            "notes": "Ultralytics model.val(split='test') 기준 동일 조건 평가 결과입니다.",
        },
        "current_deployed_model_id": None,
        "current_deployed_model_status": "확인 필요",
        "models": output_models,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export FlowLink model comparison JSON from the same YOLO test split.")
    parser.add_argument("--data", required=True, help="Dataset YAML path with a test split.")
    parser.add_argument("--models-dir", default="models", help="Directory containing local .pt files.")
    parser.add_argument("--output", default="../backend/app/data/model_comparison.json", help="Output JSON path.")
    parser.add_argument("--dataset-name", default="FlowLink Roboflow test split")
    parser.add_argument("--dataset-version")
    parser.add_argument("--dataset-hash")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--conf", type=float, default=0.001)
    parser.add_argument("--iou", type=float, default=0.7)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--sample-image", help="Optional representative test image for warm-up inference timing.")
    parser.add_argument("--warmup", type=int, default=2)
    parser.add_argument("--runs", type=int, default=10)
    args = parser.parse_args()

    payload = export(args)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
