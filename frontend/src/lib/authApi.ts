export type AuthUser = {
  id: number;
  email: string;
  nickname: string;
  role: "USER" | "ADMIN";
  active: boolean;
  created_at: string;
};

type LoginRequest = {
  email: string;
  password: string;
};

type RegisterRequest = LoginRequest & {
  nickname: string;
  terms_agreed: boolean;
  privacy_agreed: boolean;
};

export class AuthApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AuthApiError";
  }
}

type ApiValidationError = {
  loc?: Array<string | number>;
  msg?: string;
};

function getErrorMessage(detail: unknown) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: ApiValidationError) => item?.msg)
      .filter((message): message is string => Boolean(message));
    if (messages.length > 0) return messages.join(" ");
  }
  return "입력 내용을 확인해주세요.";
}

function getApiBaseUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!baseUrl) throw new AuthApiError("API 서버 주소가 설정되지 않았습니다.");
  return baseUrl.replace(/\/+$/, "");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = "인증 요청을 처리하지 못했습니다.";
    try {
      const body = await response.json() as { detail?: unknown };
      if (body.detail) message = getErrorMessage(body.detail);
    } catch {
      // Keep the safe fallback when the server does not return JSON.
    }
    throw new AuthApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export function login(payload: LoginRequest) {
  return request<{ expires_in: number; user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function register(payload: RegisterRequest) {
  return request<AuthUser>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getCurrentUser() {
  return request<AuthUser>("/api/auth/me");
}

export function logout() {
  return request<{ message: string }>("/api/auth/logout", { method: "POST" });
}

export function updateNickname(nickname: string) {
  return request<AuthUser>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ nickname }),
  });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ message: string }>("/api/auth/me/password", {
    method: "PATCH",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export function deleteAccount() {
  return request<{ message: string }>("/api/auth/me", { method: "DELETE" });
}
