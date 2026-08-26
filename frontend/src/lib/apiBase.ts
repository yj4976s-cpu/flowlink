type QueryValue = string | number | boolean | null | undefined;

const API_PREFIX = "/api";
const UPLOADS_PREFIX = "/uploads";

function stripTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

function ensureLeadingSlash(value: string) {
  return value.startsWith("/") ? value : `/${value}`;
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export function getPublicApiBaseUrl() {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!value || value === "/") return API_PREFIX;
  return stripTrailingSlashes(value);
}

export function getPublicOAuthBaseUrl() {
  const value = process.env.NEXT_PUBLIC_OAUTH_BASE_URL?.trim();
  return value ? stripTrailingSlashes(value) : null;
}

export function joinApiUrl(baseUrl: string, path: string) {
  const base = stripTrailingSlashes(baseUrl.trim() || API_PREFIX);
  let apiPath = ensureLeadingSlash(path.trim() || API_PREFIX);

  if (base.endsWith(API_PREFIX) && (apiPath === API_PREFIX || apiPath.startsWith(`${API_PREFIX}/`))) {
    apiPath = apiPath.slice(API_PREFIX.length) || "/";
  }

  return `${base}${apiPath === "/" ? "" : apiPath}`;
}

export function withQueryParams(url: string, params?: Record<string, QueryValue | QueryValue[]>) {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      if (item === null || item === undefined) return;
      const normalized = String(item).trim();
      if (normalized) query.append(key, normalized);
    });
  });
  const serialized = query.toString();
  if (!serialized) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${serialized}`;
}

export function buildApiUrl(path: string, params?: Record<string, QueryValue | QueryValue[]>) {
  return withQueryParams(joinApiUrl(getPublicApiBaseUrl(), path), params);
}

export function buildOAuthUrl(path: string, params?: Record<string, QueryValue | QueryValue[]>) {
  return withQueryParams(joinApiUrl(getPublicOAuthBaseUrl() ?? getPublicApiBaseUrl(), path), params);
}

export function resolveMediaUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (isHttpUrl(trimmed)) {
    try {
      return new URL(trimmed).toString();
    } catch {
      return null;
    }
  }

  const relative = trimmed.replace(/^\/+/, "");
  const mediaPath = relative.startsWith("uploads/")
    ? `/${relative}`
    : `${UPLOADS_PREFIX}/${relative}`;

  const base = getPublicApiBaseUrl();
  if (!isHttpUrl(base)) return mediaPath;

  try {
    return new URL(mediaPath, `${base}/`).toString();
  } catch {
    return null;
  }
}
