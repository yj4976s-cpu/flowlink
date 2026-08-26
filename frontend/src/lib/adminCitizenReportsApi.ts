import { resolveUploadedMediaUrl } from "@/lib/mediaUrl";
import { buildApiUrl, getPublicApiBaseUrl } from "@/lib/apiBase";

export type AdminCitizenSighting = {
  id: number;
  sighted_at: string;
  location_name: string;
  description: string;
  image_url: string | null;
  created_at: string;
};

export type AdminCitizenReport = {
  id: number;
  item_category: string;
  item_category_name: string;
  color: string | null;
  description: string;
  image_url: string | null;
  area_name: string;
  latitude: number | null;
  longitude: number | null;
  found_at: string;
  status: "PENDING" | "UNDER_REVIEW" | "LINKED" | "REJECTED" | "CANCELLED";
  sighting_count: number;
  sightings: AdminCitizenSighting[];
  linked_found_item: { id: number; status: string } | null;
  created_at: string;
  updated_at: string;
  user_id: number;
  user_nickname: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  admin_memo: string | null;
  linked_at: string | null;
};

export class AdminCitizenReportsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AdminCitizenReportsApiError";
  }
}

function baseUrl() {
  const value = getPublicApiBaseUrl();
  if (!value) throw new AdminCitizenReportsApiError("API 서버 주소가 설정되지 않았습니다.");
  return value.replace(/\/+$/, "");
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const message = response.status === 403
      ? "관리자 권한이 필요합니다."
      : response.status === 404
        ? "해당 발견 제보 또는 발견물을 찾을 수 없습니다."
        : response.status === 409
          ? "이미 처리되었거나 현재 상태에서 실행할 수 없는 작업입니다."
          : response.status === 422
            ? "입력한 처리 정보를 다시 확인해 주세요."
            : "발견 제보 관리 요청을 처리하지 못했습니다.";
    throw new AdminCitizenReportsApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export function adminImageUrl(value: string | null) {
  return resolveUploadedMediaUrl(value, baseUrl());
}

export function listAdminCitizenReports(status?: string, signal?: AbortSignal) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<AdminCitizenReport[]>(`/api/admin/citizen-reports${query}`, { signal });
}

export function getAdminCitizenReport(id: number, signal?: AbortSignal) {
  return request<AdminCitizenReport>(`/api/admin/citizen-reports/${id}`, { signal });
}

export function markCitizenReportUnderReview(id: number, adminMemo?: string) {
  return request<AdminCitizenReport>(`/api/admin/citizen-reports/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "UNDER_REVIEW", admin_memo: adminMemo?.trim() || null }),
  });
}

export function rejectCitizenReport(id: number, rejectionReason: string, adminMemo?: string) {
  return request<AdminCitizenReport>(`/api/admin/citizen-reports/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "REJECTED", rejection_reason: rejectionReason.trim(), admin_memo: adminMemo?.trim() || null }),
  });
}

export function createFoundItemFromCitizen(report: AdminCitizenReport, storageLocation?: string) {
  return request<AdminCitizenReport>(`/api/admin/citizen-reports/${report.id}/resolve`, {
    method: "POST",
    body: JSON.stringify({
      mode: "CREATE_FOUND_ITEM",
      found_item: {
        object_class: report.item_category,
        color: report.color,
        public_description: report.description,
        area_name: report.area_name,
        latitude: report.latitude,
        longitude: report.longitude,
        found_at: report.found_at,
        storage_location: storageLocation?.trim() || null,
      },
    }),
  });
}

export function linkCitizenReportToFoundItem(reportId: number, foundItemId: number) {
  return request<AdminCitizenReport>(`/api/admin/citizen-reports/${reportId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ mode: "LINK_EXISTING", found_item_id: foundItemId }),
  });
}
