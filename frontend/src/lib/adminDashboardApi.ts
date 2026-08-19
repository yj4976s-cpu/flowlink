import { resolveUploadedMediaUrl } from "@/lib/mediaUrl";

export type AdminDashboardData = {
  period: "today" | "7d" | "all";
  metrics: {
    discovered: number;
    ai_detections: number;
    official_found_items: number;
    confirmed: number;
    matched: number;
    claims: number;
    approved: number;
    returned: number;
    lost_reports: number;
    match_notifications: number;
    citizen_reports: number;
    citizen_pending: number;
    operation_detection_pending: number;
    waste_collection_pending: number;
    citizen_review_pending: number;
    ownership_claim_pending: number;
    ownership_return_pending: number;
    citizen_linked: number;
    citizen_sightings: number;
  };
  recent_items: Array<{ id: number; item_category: string; item_category_name: string; color: string | null; public_description: string | null; area_name: string; found_at: string; status: string; image_url: string | null }>;
  recent_detections: Array<{ id: number; detection_event_id: number; item_category: string; item_category_name: string; confidence: number; image_url: string | null; detected_at: string; processing_status: string }>;
  category_counts: Array<{ code: string; name: string; count: number }>;
  claim_status_counts: Array<{ status: string; count: number }>;
  average_confidence: number | null;
  recent_history: Array<{ id: number; entity_type: string; entity_id: number; action_type: string; new_status: string | null; note: string | null; created_at: string }>;
  trend: Array<{ label: string; discovered: number; matched: number; returned: number }>;
  latest_flow: { detection_id: number | null; detected_object_id: number | null; found_item_id: number | null; lost_report_id: number | null; match_candidate_id: number | null; notification_id: number | null; ownership_claim_id: number | null; returned: boolean } | null;
  recent_activity: Array<{ kind: string; entity_id: number; label: string; occurred_at: string }>;
};

export class AdminDashboardApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "AdminDashboardApiError"; }
}

function getApiBaseUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!baseUrl) throw new AdminDashboardApiError("API 서버 주소가 설정되지 않았습니다.");
  return baseUrl.replace(/\/+$/, "");
}

export function resolveAdminDashboardImageUrl(value?: string | null) {
  return resolveUploadedMediaUrl(value, getApiBaseUrl());
}

export async function getAdminDashboard(period: "today" | "7d" | "all" = "today", signal?: AbortSignal) {
  const response = await fetch(`${getApiBaseUrl()}/api/admin/dashboard?period=${period}`, { credentials: "include", signal });
  if (!response.ok) throw new AdminDashboardApiError(response.status === 403 ? "관리자 권한이 필요합니다." : "운영 현황을 불러오지 못했습니다.", response.status);
  return response.json() as Promise<AdminDashboardData>;
}
