import { buildApiUrl as buildCommonApiUrl } from "@/lib/apiBase";

export type NotificationResponse = {
  id: number;
  notification_type: string;
  title: string;
  message: string;
  related_type: string | null;
  related_id: number | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationFilter = "all" | "unread";

export class NotificationsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "NotificationsApiError";
  }
}


function buildApiUrl(path: string, params?: Record<string, string | number | boolean | undefined>) {
  return buildCommonApiUrl(path, params);
}

function getListFallbackMessage(status: number) {
  if (status === 401) return "로그인이 필요하거나 로그인 세션이 만료되었습니다.";
  if (status === 422) return "알림 조회 요청 값을 확인해주세요.";
  return "알림을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function getReadFallbackMessage(status: number) {
  if (status === 401) return "로그인이 필요하거나 로그인 세션이 만료되었습니다.";
  if (status === 404) return "알림을 찾을 수 없거나 더 이상 처리할 수 없습니다.";
  if (status === 422) return "읽음 처리할 알림을 다시 확인해주세요.";
  return "알림을 읽음 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

async function requestJson<T>(
  url: string,
  fallbackMessage: (status: number) => string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
  });

  if (!response.ok) {
    throw new NotificationsApiError(fallbackMessage(response.status), response.status);
  }

  return response.json() as Promise<T>;
}

export function listNotifications(filter: NotificationFilter, signal?: AbortSignal, limit = 20) {
  return requestJson<NotificationResponse[]>(
    buildApiUrl("/api/notifications", {
      skip: 0,
      limit,
      unread_only: filter === "unread",
    }),
    getListFallbackMessage,
    { signal },
  );
}

export function markNotificationRead(id: number) {
  return requestJson<NotificationResponse>(
    buildApiUrl(`/api/notifications/${id}/read`),
    getReadFallbackMessage,
    { method: "PATCH" },
  );
}
