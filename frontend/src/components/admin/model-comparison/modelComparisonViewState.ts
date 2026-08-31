import type { AdminModelClassMetric, AdminModelComparisonModel } from "@/lib/adminModelComparisonApi";

export type DeltaTone = "better" | "worse" | "neutral" | "new" | "missing";

export type MetricDeltaResult = {
  label: string;
  tone: DeltaTone;
};

export type MetricBarViewState = {
  measured: boolean;
  zero: boolean;
  width: number;
};

export type MetricRatioViewState = {
  measured: boolean;
  zero: boolean;
  ratio: number | null;
};

export function isMeasuredNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function metricBarViewState(value: number | null | undefined, max: number): MetricBarViewState {
  const measured = isMeasuredNumber(value);
  const zero = measured && value === 0;
  const width = measured && max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0;

  return { measured, zero, width };
}

export function metricRatioViewState(value: number | null | undefined, max: number): MetricRatioViewState {
  const measured = isMeasuredNumber(value);
  const zero = measured && value === 0;
  const ratio = measured && max > 0 ? Math.max(0, Math.min(1, value / max)) : null;

  return { measured, zero, ratio };
}

export function metricLabel(value: number | null, options: { percent?: boolean; suffix?: string; digits?: number } = {}) {
  if (!isMeasuredNumber(value)) return "측정 전";
  const digits = options.digits ?? 1;
  if (options.percent) return `${(value * 100).toFixed(digits)}%`;
  return `${value.toFixed(digits)}${options.suffix ?? ""}`;
}

export function fileSizeLabel(bytes: number | null) {
  if (!isMeasuredNumber(bytes)) return "측정 전";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function metricDelta(
  before: number | null,
  after: number | null,
  options: { percentPoint?: boolean; lowerIsBetter?: boolean } = {},
): MetricDeltaResult {
  if (!isMeasuredNumber(before) || !isMeasuredNumber(after)) {
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

type ModelComparisonStatusInput = {
  current_deployed_model_id: string | null;
  current_deployed_model_status: string | null;
  models: Array<Pick<AdminModelComparisonModel, "id" | "display_name" | "precision" | "recall" | "map50" | "map50_95" | "average_inference_ms" | "fps" | "class_metrics">>;
};

export type ModelComparisonStatusView = {
  title: string;
  description: string;
  actionLabel: string;
  tone: "deployed" | "measured" | "pending" | "error";
};

export function hasMeasuredModelComparison(data: ModelComparisonStatusInput | null) {
  return Boolean(data?.models.some((model) => (
    [model.precision, model.recall, model.map50, model.map50_95, model.average_inference_ms, model.fps].some(isMeasuredNumber)
    || model.class_metrics.some((metric) => [metric.precision, metric.recall, metric.map50, metric.map50_95].some(isMeasuredNumber))
  )));
}

export function modelComparisonStatusView(
  data: ModelComparisonStatusInput | null,
  options: { loading?: boolean; error?: boolean } = {},
): ModelComparisonStatusView {
  if (options.loading) {
    return {
      title: "모델 비교 상태를 확인하고 있습니다.",
      description: "운영 통계와 별도로 사전 평가 JSON의 배포 모델과 성능 평가 상태를 읽고 있어요.",
      actionLabel: "모델 비교 현황 보기",
      tone: "pending",
    };
  }

  if (options.error || !data || data.models.length < 2) {
    return {
      title: "모델 비교 정보를 불러오지 못했습니다.",
      description: "잠시 후 다시 시도하거나 모델 비교 페이지에서 사전 평가 JSON 상태를 확인해 주세요.",
      actionLabel: "모델 비교 현황 보기",
      tone: "error",
    };
  }

  if (hasMeasuredModelComparison(data)) {
    return {
      title: "모델 비교 평가 결과가 등록되어 있습니다.",
      description: "동일 테스트셋 기준 Precision, Recall, mAP와 클래스별 성능을 모델 비교 페이지에서 확인할 수 있습니다.",
      actionLabel: "평가 결과 확인하기",
      tone: "measured",
    };
  }

  const deployedName = currentModelLabel(data.models, data.current_deployed_model_id, data.current_deployed_model_status);
  if (data.current_deployed_model_id) {
    return {
      title: `${deployedName}이 서비스에 연결되어 있습니다.`,
      description: "현재 배포 모델 상태는 확인됐지만, 동일 테스트셋 기반 Precision, Recall, mAP 평가는 아직 등록되지 않았습니다.",
      actionLabel: "모델 비교 현황 보기",
      tone: "deployed",
    };
  }

  return {
    title: "모델 비교 기본 정보가 준비되어 있습니다.",
    description: "현재 배포 모델 확인과 동일 테스트셋 기반 성능 평가는 아직 별도 확인이 필요합니다.",
    actionLabel: "모델 비교 현황 보기",
    tone: "pending",
  };
}
