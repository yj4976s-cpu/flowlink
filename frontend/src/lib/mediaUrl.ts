import { resolveMediaUrl } from "@/lib/apiBase";

export function resolveUploadedMediaUrl(value: string | null | undefined, apiBaseUrl: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const fallbackBaseUrl = typeof window !== "undefined" ? window.location.origin : "http://flowlink.local";
  const normalizedBaseUrl = apiBaseUrl.trim() || fallbackBaseUrl;
  try {
    if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).toString();
    const sameOriginMediaUrl = resolveMediaUrl(trimmed);
    if (sameOriginMediaUrl) return sameOriginMediaUrl;
    const relative = trimmed.replace(/^\/+/, "");
    const mediaPath = relative.startsWith("uploads/") ? `/${relative}` : `/uploads/${relative}`;
    return new URL(mediaPath, `${normalizedBaseUrl.replace(/\/+$/, "")}/`).toString();
  } catch {
    return null;
  }
}
