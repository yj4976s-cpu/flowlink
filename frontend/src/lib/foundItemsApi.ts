export type FoundItemListItem = {
  id: number;
  item_category: string;
  item_category_name: string;
  color: string | null;
  public_description: string | null;
  area_name: string;
  found_at: string;
  status: string;
  source_type: "AI" | "CITIZEN" | "ADMIN";
  image_url: string | null;
};

export type FoundItemDetail = FoundItemListItem & {
  created_at: string;
};

export type FoundItemFilters = {
  q?: string;
  item_category?: string;
  color?: string;
  area_name?: string;
};

export class FoundItemsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "FoundItemsApiError";
  }
}

function getApiBaseUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!baseUrl) {
    throw new FoundItemsApiError("NEXT_PUBLIC_API_BASE_URL 환경 변수가 설정되지 않았습니다.");
  }
  return baseUrl.replace(/\/+$/, "");
}

export function resolveFoundItemImageUrl(value: string | null) {
  return value ? new URL(value, `${getApiBaseUrl()}/`).toString() : null;
}

function buildApiUrl(path: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(`${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === undefined) return;
    const normalized = String(value).trim();
    if (normalized) url.searchParams.set(key, normalized);
  });
  return url.toString();
}

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new FoundItemsApiError("발견물 정보를 불러오지 못했습니다.", response.status);
  }
  return response.json() as Promise<T>;
}

export function listFoundItems(filters: FoundItemFilters, signal?: AbortSignal) {
  return requestJson<FoundItemListItem[]>(
    buildApiUrl("/api/found-items", { skip: 0, limit: 20, ...filters }),
    signal,
  );
}

export function getFoundItem(id: string, signal?: AbortSignal) {
  return requestJson<FoundItemDetail>(buildApiUrl(`/api/found-items/${id}`), signal);
}
