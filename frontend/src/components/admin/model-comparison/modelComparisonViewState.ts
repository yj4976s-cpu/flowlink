import type { AdminModelClassMetric, AdminModelComparisonModel } from "@/lib/adminModelComparisonApi";

export type DeltaTone = "better" | "worse" | "neutral" | "new" | "missing";

export type MetricDeltaResult = {
  label: string;
  tone: DeltaTone;
};

export function metricLabel(value: number | null, options: { percent?: boolean; suffix?: string; digits?: number } = {}) {
  if (value == null || Number.isNaN(value)) return "측정 전";
  const digits = options.digits ?? 1;
  if (options.percent) return `${(value * 100).toFixed(digits)}%`;
  return `${value.toFixed(digits)}${options.suffix ?? ""}`;
}

export function fileSizeLabel(bytes: number | null) {
  if (bytes == null) return "측정 전";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function metricDelta(
  before: number | null,
  after: number | null,
  options: { percentPoint?: boolean; lowerIsBetter?: boolean } = {},
): MetricDeltaResult {
  if (before == null || after == null || Number.isNaN(before) || Number.isNaN(after)) {
    return { label: "비교 전", tone: "missing" };
  }

  const diff = after - before;
  const improved = options.lowerIsBetter ? diff < 0 : diff > 0;
  const worsened = options.lowerIsBetter ? diff > 0 : diff < 0;
  const sign = diff > 0 ? "+" : "";
  const label = options.percentPoint ? `${sign}${(diff * 100).toFixed(1)}%p` : `${sign}${diff.toFixed(1)}`;

  return { label, tone: improved ? "better" : worsened ? "worse" : "neutral" };
}

export function classComparisonStatus(
  before: AdminModelClassMetric | undefined,
  after: AdminModelClassMetric | undefined,
): MetricDeltaResult {
  if (!before?.supported && after?.supported) return { label: "신규 클래스", tone: "new" };
  if (before?.supported && !after?.supported) return { label: "미지원", tone: "missing" };
  if (!before?.supported && !after?.supported) return { label: "미지원", tone: "missing" };
  return metricDelta(before?.map50 ?? null, after?.map50 ?? null, { percentPoint: true });
}

export function classMetricByCode(model: Pick<AdminModelComparisonModel, "class_metrics">, code: string) {
  return model.class_metrics.find((item) => item.code === code);
}

export function currentModelLabel(
  models: Array<Pick<AdminModelComparisonModel, "id" | "display_name">>,
  currentId: string | null,
  fallback: string | null,
) {
  if (!currentId) return fallback ?? "확인 필요";
  return models.find((model) => model.id === currentId)?.display_name ?? fallback ?? currentId;
}
