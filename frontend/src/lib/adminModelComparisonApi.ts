import { buildApiUrl } from "@/lib/apiBase";

export type AdminModelComparisonEvaluation = {
  dataset_name: string;
  dataset_version: string | null;
  dataset_hash: string | null;
  test_image_count: number | null;
  image_size: number | null;
  confidence_threshold: number | null;
  iou_threshold: number | null;
  batch: number | null;
  device: string | null;
  ultralytics_version: string | null;
  notes: string | null;
};

export type AdminModelClassMetric = {
  code: string;
  label: string;
  supported: boolean;
  precision: number | null;
  recall: number | null;
  map50: number | null;
  map50_95: number | null;
};

export type AdminModelExampleResult = {
  title: string;
  media_url: string;
  description: string | null;
};

export type AdminModelComparisonModel = {
  id: string;
  display_name: string;
  file_name: string;
  architecture: string | null;
  optimizer: string | null;
  epochs: number | null;
  image_size: number | null;
  batch_size: number | null;
  classes: string[];
  file_size_bytes: number | null;
  precision: number | null;
  recall: number | null;
  map50: number | null;
  map50_95: number | null;
  class_metrics: AdminModelClassMetric[];
  average_inference_ms: number | null;
  fps: number | null;
  example_results: AdminModelExampleResult[];
  notes: string | null;
};

export type AdminModelComparison = {
  schema_version: number;
  generated_at: string;
  evaluation: AdminModelComparisonEvaluation;
  current_deployed_model_id: string | null;
  current_deployed_model_status: string | null;
  models: AdminModelComparisonModel[];
};

export function getAdminModelComparison(signal?: AbortSignal) {
  return fetch(buildApiUrl("/api/admin/model-comparison"), { signal, credentials: "include" }).then((response) => {
    if (!response.ok) {
      throw new Error(response.status === 403 ? "관리자 권한이 필요합니다." : "모델 비교 데이터를 불러오지 못했습니다.");
    }
    return response.json() as Promise<AdminModelComparison>;
  });
}
