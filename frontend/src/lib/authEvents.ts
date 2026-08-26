import type { AuthUser } from "@/lib/authApi";

export const AUTH_CHANGED_EVENT = "flowlink:auth-changed";

export function publishAuthChange(user: AuthUser | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AuthUser | null>(AUTH_CHANGED_EVENT, { detail: user }));
}

export function invalidateAuthOnUnauthorized(status: number) {
  if (status === 401) publishAuthChange(null);
}
