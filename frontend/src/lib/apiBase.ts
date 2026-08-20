type QueryValue = string | number | boolean | Array<string | number | boolean> | undefined;

export function getApiBaseUrl() {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!value || value === "/" || value === "/api") return "";
  return value.replace(/\/+$/, "");
}

export function getApiMediaBaseUrl() {
  const baseUrl = getApiBaseUrl();
  if (baseUrl) return baseUrl;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function buildApiUrl(path: string, params?: Record<string, QueryValue>) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  const url = new URL(`${baseUrl}${normalizedPath}`, "http://flowlink.local");

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        const normalizedItem = String(item).trim();
        if (normalizedItem) url.searchParams.append(key, normalizedItem);
      });
      return;
    }
    const normalized = String(value).trim();
    if (normalized) url.searchParams.set(key, normalized);
  });

  if (!baseUrl) return `${url.pathname}${url.search}`;
  return url.toString();
}

export function buildServerApiUrl(path: string, requestOrigin?: string | null) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  const origin = baseUrl || requestOrigin?.replace(/\/+$/, "");
  return origin ? `${origin}${normalizedPath}` : null;
}
