import type { DetectionAnalysisSummary, DetectionEvent, DetectionSummaryPeriod } from "@/lib/detectionApi";

export const ANALYSIS_PERIODS: DetectionSummaryPeriod[] = [7, 30, 90];

export function parseAnalysisPeriod(value: string | null): DetectionSummaryPeriod {
  const parsed = Number(value);
  return ANALYSIS_PERIODS.includes(parsed as DetectionSummaryPeriod) ? parsed as DetectionSummaryPeriod : 30;
}

export function parseReportEventId(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function formatPercentValue(value: number | null | undefined, empty = "탐지 객체 없음") {
  if (value === null || value === undefined) return empty;
  return `${Math.round(value * 100)}%`;
}

export function formatCompletionRate(value: number) {
  return `${value.toFixed(1)}%`;
}

export function getRatioPercent(ratio: number | null | undefined) {
  if (!ratio || ratio < 0) return 0;
  return Math.min(100, Math.round(ratio * 100));
}

export function getCountRatioPercent(count: number, total: number) {
  if (!total || count <= 0) return 0;
  return Math.min(100, Math.round(count / total * 100));
}

export function getReportHref(eventId: number) {
  return `/mypage/analysis-report?eventId=${eventId}`;
}

export function getDetectionReportState(event: DetectionEvent | null, eventId: number | null) {
  if (eventId !== null && !event) return "not-found" as const;
  if (!event) return "summary" as const;
  if (event.status === "PROCESSING" || event.status === "PENDING") return "processing" as const;
  if (event.status === "FAILED") return "failed" as const;
  return "completed" as const;
}

export function getPrimaryClass(event: DetectionEvent | null) {
  if (!event?.detected_objects.length) return null;
  return [...event.detected_objects].sort((left, right) => right.confidence - left.confidence)[0];
}

export function summarizeEventObjects(event: DetectionEvent | null) {
  const objects = event?.detected_objects ?? [];
  const total = objects.length;
  const averageConfidence = total
    ? objects.reduce((sum, object) => sum + object.confidence, 0) / total
    : null;
  const maxConfidence = total ? Math.max(...objects.map((object) => object.confidence)) : null;
  const classCounts = new Map<string, { name: string; count: number }>();
  objects.forEach((object) => {
    const current = classCounts.get(object.class_code) ?? { name: object.class_name_ko, count: 0 };
    current.count += 1;
    classCounts.set(object.class_code, current);
  });
  return {
    total,
    averageConfidence,
    maxConfidence,
    classes: [...classCounts.entries()].map(([code, item]) => ({ code, name: item.name, count: item.count })),
  };
}

export function hasSummaryChartData(summary: DetectionAnalysisSummary) {
  return summary.total_detected_objects > 0;
}

export function buildClassDonutGradient(summary: DetectionAnalysisSummary) {
  if (!hasSummaryChartData(summary)) return "";
  const palette: Record<string, string> = {
    BALL: "var(--color-primary)",
    FOOTWEAR: "var(--color-secondary)",
    TRASH: "var(--color-accent)",
    HAT: "var(--color-success)",
  };
  let current = 0;
  const segments = summary.class_distribution
    .filter((item) => item.count > 0)
    .map((item) => {
      const next = current + getRatioPercent(item.ratio);
      const segment = `${palette[item.class_code] ?? "var(--color-text-muted)"} ${current}% ${next}%`;
      current = next;
      return segment;
    });
  return segments.length ? `conic-gradient(${segments.join(", ")})` : "";
}
