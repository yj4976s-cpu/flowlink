import { resolveMediaUrl } from "@/lib/apiBase";

export function resolveUploadedMediaUrl(value: string | null | undefined, apiBaseUrl: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).toString();
    const sameOriginMediaUrl = resolveMediaUrl(trimmed);
    if (sameOriginMediaUrl) return sameOriginMediaUrl;
    const relative = trimmed.replace(/^\/+/, "");
    const mediaPath = relative.startsWith("uploads/") ? `/${relative}` : `/uploads/${relative}`;
    return new URL(mediaPath, `${apiBaseUrl.replace(/\/+$/, "")}/`).toString();
  } catch {
    return null;
  }
}
