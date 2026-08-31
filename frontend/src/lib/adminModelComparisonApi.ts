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

export type AdminRuntimeModelInfo = {
  id: string;
  display_name: string;
  classes: string[];
  supports_hat: boolean;
  available: boolean;
  active: boolean;
};

export type AdminModelDeploymentStatus = {
  active_model_id: string | null;
  previous_model_id: string | null;
  active_display_name: string | null;
  active_classes: string[];
  switched_at: string | null;
  model_ready: boolean;
  switching: boolean;
  available_models: AdminRuntimeModelInfo[];
  rollback_available: boolean;
  status_source: "runtime";
};

export type AdminModelDeploymentEvent = {
  id: number;
  requested_by: number | null;
  requester_email: string | null;
  action: "ACTIVATE" | "ROLLBACK";
  requested_model_id: string | null;
  from_model_id: string | null;
  to_model_id: string | null;
  status: "REQUESTED" | "SUCCEEDED" | "FAILED";
  failure_code: string | null;
  requested_at: string;
  completed_at: string | null;
};

export type AdminModelDeploymentHistory = {
  events: AdminModelDeploymentEvent[];
};

export type AdminModelDeploymentSwitchResponse = {
  changed: boolean;
  previous_model_id: string | null;
  active_model_id: string;
  active_classes: string[];
  switched_at: string;
  model_ready: boolean;
  audit_event: AdminModelDeploymentEvent;
};

async function parseError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = await response.json() as { detail?: unknown };
    if (typeof body.detail === "string") message = body.detail;
  } catch {
    // keep safe fallback
  }
  throw new Error(message);
}

export function getAdminModelComparison(signal?: AbortSignal) {
  return fetch(buildApiUrl("/api/admin/model-comparison"), { signal, credentials: "include" }).then((response) => {
    if (!response.ok) {
      throw new Error(response.status === 403 ? "관리자 권한이 필요합니다." : "모델 비교 데이터를 불러오지 못했습니다.");
    }
    return response.json() as Promise<AdminModelComparison>;
  });
}

export function getAdminModelDeployment(signal?: AbortSignal) {
  return fetch(buildApiUrl("/api/admin/model-deployment"), { signal, credentials: "include" }).then((response) => {
    if (!response.ok) return parseError(response, "모델 서비스 상태를 확인할 수 없습니다.");
    return response.json() as Promise<AdminModelDeploymentStatus>;
  });
}

export function getAdminModelDeploymentHistory(signal?: AbortSignal) {
  return fetch(buildApiUrl("/api/admin/model-deployment/history", { limit: 20 }), { signal, credentials: "include" }).then((response) => {
    if (!response.ok) return parseError(response, "모델 전환 이력을 불러오지 못했습니다.");
    return response.json() as Promise<AdminModelDeploymentHistory>;
  });
}

export function activateAdminModel(modelId: string, expectedActiveModelId: string | null, requestId: string) {
  return fetch(buildApiUrl("/api/admin/model-deployment/activate"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId, expected_active_model_id: expectedActiveModelId, request_id: requestId }),
  }).then((response) => {
    if (!response.ok) return parseError(response, "모델 전환 요청을 처리하지 못했습니다.");
    return response.json() as Promise<AdminModelDeploymentSwitchResponse>;
  });
}

export function rollbackAdminModel(expectedActiveModelId: string | null, requestId: string) {
  return fetch(buildApiUrl("/api/admin/model-deployment/rollback"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected_active_model_id: expectedActiveModelId, request_id: requestId }),
  }).then((response) => {
    if (!response.ok) return parseError(response, "모델 롤백 요청을 처리하지 못했습니다.");
    return response.json() as Promise<AdminModelDeploymentSwitchResponse>;
  });
}
