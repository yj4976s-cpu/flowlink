import { buildApiUrl } from "@/lib/apiBase";

export type AdminFoundItemUpdate = {
  status?: string;
  area_name?: string;
  latitude?: number;
  longitude?: number;
  storage_location?: string;
  admin_memo?: string;
};

export type AdminFoundItem = {
  id: number;
  item_category: string;
  item_category_name: string;
  color: string | null;
  public_description: string | null;
  area_name: string;
  found_at: string;
  status: string;
  source_type: "AI" | "CITIZEN" | "ADMIN";
  storage_location: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminFoundItemList = {
  items: AdminFoundItem[];
  total: number;
  status_counts: Array<{ status: string; count: number }>;
};

export class AdminFoundItemsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AdminFoundItemsApiError";
  }
}


export async function listAdminFoundItems(filters: { skip: number; limit: number; status?: string; item_category?: string; q?: string; found_date?: string }, signal?: AbortSignal) {
  const url = buildApiUrl("/api/admin/found-items", {
    ...filters,
    found_date: filters.found_date ? `${filters.found_date}T00:00:00` : undefined,
  });
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) throw new AdminFoundItemsApiError(response.status === 403 ? "관리자 권한이 필요합니다." : "발견물 정보를 불러오지 못했습니다.", response.status);
  return response.json() as Promise<AdminFoundItemList>;
}

export async function updateAdminFoundItem(id: number, update: AdminFoundItemUpdate) {
  const response = await fetch(buildApiUrl(`/api/admin/found-items/${id}`), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!response.ok) {
    let serverDetail = "";
    try { serverDetail = ((await response.json()) as { detail?: string }).detail ?? ""; } catch { /* fallback below */ }
    const message = serverDetail || (response.status === 403
      ? "관리자 권한이 필요합니다."
      : response.status === 404
        ? "발견물을 찾을 수 없습니다."
        : response.status === 422
          ? "현재 상태로 변경할 수 없습니다."
          : "발견물 관리 정보를 저장하지 못했습니다.");
    throw new AdminFoundItemsApiError(message, response.status);
  }
  return response.json() as Promise<{ message: string }>;
}

export async function archiveAdminFoundItem(id: number) {
  const response = await fetch(buildApiUrl(`/api/admin/found-items/${id}/archive`), {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    let serverDetail = "";
    try { serverDetail = ((await response.json()) as { detail?: string }).detail ?? ""; } catch { /* fallback below */ }
    const message = serverDetail || (response.status === 403
      ? "관리자 권한이 필요합니다."
      : response.status === 404
        ? "발견물을 찾을 수 없습니다."
        : response.status === 409
          ? "진행 중인 소유권 요청을 먼저 처리해야 보관할 수 있습니다."
          : "발견물을 보관하지 못했습니다.");
    throw new AdminFoundItemsApiError(message, response.status);
  }
  return response.json() as Promise<{ message: string }>;
}
