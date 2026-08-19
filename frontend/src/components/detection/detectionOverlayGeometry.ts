import type { CSSProperties } from "react";
import type { DetectionBBox } from "@/lib/detectionApi";

export type OverlaySize = {
  width: number;
  height: number;
};

export type ContainedMediaRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type NormalizedBBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function clamp(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function getContainedMediaRect(frame: OverlaySize, media: OverlaySize): ContainedMediaRect | null {
  if (frame.width <= 0 || frame.height <= 0 || media.width <= 0 || media.height <= 0) return null;

  const scale = Math.min(frame.width / media.width, frame.height / media.height);
  const width = media.width * scale;
  const height = media.height * scale;

  return {
    left: Math.max(0, (frame.width - width) / 2),
    top: Math.max(0, (frame.height - height) / 2),
    width,
    height,
  };
}

export function normalizeBBox(
  bbox: DetectionBBox,
  mediaWidth: number | null | undefined,
  mediaHeight: number | null | undefined,
): NormalizedBBox | null {
  if (!mediaWidth || !mediaHeight || mediaWidth <= 0 || mediaHeight <= 0) return null;

  const x1 = clamp(bbox.x / mediaWidth);
  const y1 = clamp(bbox.y / mediaHeight);
  const x2 = clamp((bbox.x + bbox.width) / mediaWidth);
  const y2 = clamp((bbox.y + bbox.height) / mediaHeight);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

export function normalizeBBoxForDisplayMedia(
  bbox: DetectionBBox,
  sourceMedia: OverlaySize,
  displayMedia: OverlaySize,
): NormalizedBBox | null {
  if (
    sourceMedia.width <= 0
    || sourceMedia.height <= 0
    || displayMedia.width <= 0
    || displayMedia.height <= 0
  ) return null;

  return normalizeBBox({
    x: bbox.x * (displayMedia.width / sourceMedia.width),
    y: bbox.y * (displayMedia.height / sourceMedia.height),
    width: bbox.width * (displayMedia.width / sourceMedia.width),
    height: bbox.height * (displayMedia.height / sourceMedia.height),
  }, displayMedia.width, displayMedia.height);
}

export function getOverlayPercentageStyle(normalizedBBox: NormalizedBBox): CSSProperties {
  return {
    left: `${normalizedBBox.left * 100}%`,
    top: `${normalizedBBox.top * 100}%`,
    width: `${normalizedBBox.width * 100}%`,
    height: `${normalizedBBox.height * 100}%`,
  };
}

export function getContainedMediaRectStyle(rect: ContainedMediaRect): CSSProperties {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}
