import { buildApiUrl } from "@/lib/apiBase";

export type AdminAiReport = {
  period_days: 7 | 30 | 90;
  period_start: string;
  period_end: string;
  generated_at: string;
  operation_summary: {
    operation_detection_events: number;
    detected_objects: number;
    reviewed_objects: number;
    corrected_objects: number;
    official_found_items: number;
    waste_items: number;
    lost_reports: number;
    match_candidates: number;
    ownership_claims: number;
    approved_claims: number;
    returned_items: number;
    average_confidence: string | null;
  };
  queue_tasks: AdminOperationsBriefingTask[];
  daily_trend: Array<{
    date: string;
    detection_count: number;
    detected_object_count: number;
    found_item_count: number;
    match_count: number;
    returned_count: number;
  }>;
  operation_flow: Array<{ key: string; label: string; count: number; ratio: number }>;
  summary: { total: number; average_confidence: string | null; reviewed: number; corrected: number };
  class_metrics: Array<{ code: string; name: string; count: number; ratio: number; average_confidence: string | null; reviewed: number; corrected: number }>;
  confidence_distribution: Array<{ key: string; label: string; count: number }>;
  correction_patterns: Array<{ predicted_code: string; predicted_name: string; final_code: string; final_name: string; count: number }>;
};

export type AdminOperationsBriefingTask = {
  key: string;
  label: string;
  count: number;
  href: string;
};

export type AdminOperationsBriefingStatus = {
  provider: string;
  model: string | null;
  gemini_configured: boolean;
  gemini_connected: boolean;
  fallback_used: boolean;
  fallback_reason: string | null;
};

export type AdminOperationsBriefing = AdminOperationsBriefingStatus & {
  summary: string;
  generated_at: string;
  metrics: {
    operation_detection_pending: number;
    waste_collection_pending: number;
    citizen_review_pending: number;
    ownership_claim_pending: number;
    ownership_return_pending: number;
    average_confidence: string | null;
  };
  priority_task: AdminOperationsBriefingTask | null;
  tasks: AdminOperationsBriefingTask[];
};

export function getAdminAiReport(days: 7 | 30 | 90 = 30, signal?: AbortSignal) {
  return fetch(buildApiUrl(`/api/admin/ai-report?days=${days}`), { signal, credentials: "include" }).then((response) => {
    if (!response.ok) throw new Error(response.status === 403 ? "관리자 권한이 필요합니다." : "AI 운영 분석 데이터를 불러오지 못했습니다.");
    return response.json() as Promise<AdminAiReport>;
  });
}

export function getAdminOperationsBriefingStatus(signal?: AbortSignal) {
  return fetch(buildApiUrl("/api/admin/ai-report/operations-briefing/status"), { signal, credentials: "include" }).then((response) => {
    if (!response.ok) throw new Error(response.status === 403 ? "관리자 권한이 필요합니다." : "운영 AI 브리핑 연결 상태를 확인하지 못했습니다.");
    return response.json() as Promise<AdminOperationsBriefingStatus>;
  });
}

export function generateAdminOperationsBriefing(signal?: AbortSignal) {
  return fetch(buildApiUrl("/api/admin/ai-report/operations-briefing"), { method: "POST", signal, credentials: "include" }).then((response) => {
    if (!response.ok) throw new Error(response.status === 403 ? "관리자 권한이 필요합니다." : "운영 AI 브리핑을 생성하지 못했습니다.");
    return response.json() as Promise<AdminOperationsBriefing>;
  });
}
