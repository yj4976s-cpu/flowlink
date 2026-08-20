export type AdminUserSummary = {
  total: number;
  active: number;
  inactive: number;
  admins: number;
  users: number;
  deleted: number;
  new_today: number;
  new_last_7_days: number;
};

export type AdminUserListItem = {
  id: number;
  email: string;
  nickname: string;
  role: "ADMIN" | "USER" | string;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
  deleted_at: string | null;
};

export type AdminUsersResponse = {
  summary: AdminUserSummary;
  role_breakdown: Array<{ role: string; count: number }>;
  status_breakdown: Array<{ status: string; count: number }>;
  signup_trend: Array<{ date: string; count: number }>;
  users: AdminUserListItem[];
  total: number;
};

export class AdminUsersApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AdminUsersApiError";
  }
}

function apiBaseUrl() {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!value) throw new AdminUsersApiError("API 서버 주소가 설정되지 않았습니다.");
  return value.replace(/\/+$/, "");
}

export async function getAdminUsers(
  filters: { skip: number; limit: number; q?: string; role?: string; active?: string; include_deleted?: boolean },
  signal?: AbortSignal,
) {
  const url = new URL(`${apiBaseUrl()}/api/admin/users`);
  Object.entries(filters).forEach(([key, value]) => {
    const normalized = String(value ?? "").trim();
    if (normalized) url.searchParams.set(key, normalized);
  });
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) {
    throw new AdminUsersApiError(
      response.status === 403 ? "관리자 권한이 필요합니다." : "사용자 현황을 불러오지 못했습니다.",
      response.status,
    );
  }
  return response.json() as Promise<AdminUsersResponse>;
}
