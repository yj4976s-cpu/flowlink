import { buildApiUrl } from "@/lib/apiBase";

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

type SocialRegisterRequest = {
  nickname: string;
  terms_agreed: boolean;
  privacy_agreed: boolean;
};

export type SocialAuthProvider = "google" | "naver" | "kakao";

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

export function getOAuthStartUrl(provider: SocialAuthProvider) {
  return buildApiUrl(`/api/auth/oauth/${provider}/start`);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
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

export async function login(payload: LoginRequest) {
  const result = await request<{ expires_in: number; user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  window.dispatchEvent(new CustomEvent("flowlink:auth-changed", { detail: result.user }));
  return result;
}

export async function register(payload: RegisterRequest) {
  const result = await request<AuthUser>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  window.dispatchEvent(new CustomEvent("flowlink:auth-changed", { detail: result }));
  return result;
}

export async function completeSocialRegistration(payload: SocialRegisterRequest) {
  const result = await request<AuthUser>("/api/auth/oauth/complete", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  window.dispatchEvent(new CustomEvent("flowlink:auth-changed", { detail: result }));
  return result;
}

export function getCurrentUser() {
  return request<AuthUser>("/api/auth/me");
}

export async function logout() {
  const result = await request<{ message: string }>("/api/auth/logout", { method: "POST" });
  window.dispatchEvent(new CustomEvent("flowlink:auth-changed", { detail: null }));
  return result;
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
