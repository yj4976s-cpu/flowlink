import { buildApiUrl } from "@/lib/apiBase";

export type AdminNotificationFilter = "all" | "unread" | "actionable" | "resolved";

export type AdminNotificationItem = {
  id: number;
  notification_type: string;
  title: string;
  message: string;
  related_type: string;
  related_id: number;
  read_at: string | null;
  resolved_at: string | null;
  created_at: string;
  is_read: boolean;
  is_actionable: boolean;
};

export type AdminNotificationListResponse = {
  items: AdminNotificationItem[];
  total: number;
  unread_count: number;
  actionable_count: number;
};

export class AdminNotificationsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AdminNotificationsApiError";
  }
}

function fallbackMessage(status: number) {
  if (status === 401) return "관리자 로그인이 필요합니다.";
  if (status === 403) return "관리자 권한이 필요합니다.";
  if (status === 404) return "관리자 알림을 찾을 수 없습니다.";
  return "관리자 알림을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include" });
  if (!response.ok) {
    throw new AdminNotificationsApiError(fallbackMessage(response.status), response.status);
  }
  return response.json() as Promise<T>;
}

export function listAdminNotifications(
  filter: AdminNotificationFilter = "all",
  signal?: AbortSignal,
  limit = 20,
  skip = 0,
) {
  return requestJson<AdminNotificationListResponse>(
    buildApiUrl("/api/admin/notifications", { filter, skip, limit }),
    { signal },
  );
}

export function markAdminNotificationRead(id: number) {
  return requestJson<AdminNotificationItem>(
    buildApiUrl(`/api/admin/notifications/${id}/read`),
    { method: "PATCH" },
  );
}

export function markAllAdminNotificationsRead() {
  return requestJson<{ marked_read_count: number }>(
    buildApiUrl("/api/admin/notifications/read-all"),
    { method: "POST" },
  );
}
