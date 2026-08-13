export type AdminFoundItemUpdate = {
  status?: string;
  area_name?: string;
  latitude?: number;
  longitude?: number;
  storage_location?: string;
  admin_memo?: string;
};

export class AdminFoundItemsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AdminFoundItemsApiError";
  }
}

function apiBaseUrl() {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!value) throw new AdminFoundItemsApiError("API 서버 주소가 설정되지 않았습니다.");
  return value.replace(/\/+$/, "");
}

export async function updateAdminFoundItem(id: number, update: AdminFoundItemUpdate) {
  const response = await fetch(`${apiBaseUrl()}/api/admin/found-items/${id}`, {
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
