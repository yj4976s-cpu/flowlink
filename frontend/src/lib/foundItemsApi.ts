import { resolveUploadedMediaUrl } from "@/lib/mediaUrl";
import { buildApiUrl as buildCommonApiUrl, getPublicApiBaseUrl } from "@/lib/apiBase";

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

export type FoundItemMapItem = FoundItemListItem & {
  latitude: number;
  longitude: number;
};

export type FoundItemFilters = {
  q?: string;
  item_category?: string;
  color?: string;
  area_name?: string;
  status?: string;
  found_date?: string;
};

export class FoundItemsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "FoundItemsApiError";
  }
}

function getApiBaseUrl() { return getPublicApiBaseUrl(); }

export function resolveFoundItemImageUrl(value: string | null) {
  return resolveUploadedMediaUrl(value, getApiBaseUrl());
}

function buildApiUrl(path: string, params?: Record<string, string | number | undefined>) {
  return buildCommonApiUrl(path, params);
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
    buildApiUrl("/api/found-items", { skip: 0, limit: 100, ...filters }),
    signal,
  );
}

export function listMapFoundItems(signal?: AbortSignal) {
  return requestJson<FoundItemMapItem[]>(buildApiUrl("/api/found-items/map"), signal);
}

export function getFoundItem(id: string, signal?: AbortSignal) {
  return requestJson<FoundItemDetail>(buildApiUrl(`/api/found-items/${id}`), signal);
}
