import "server-only";

import type { HomeSummary, ObjectKind } from "@/types/home";
import { resolveMediaUrl } from "@/lib/apiBase";

type ApiHomeSummary = {
  stats: {
    recent_found: number;
    matching_active: number;
    returned: number;
    today_detections: number;
  };
  recent_items: Array<{
    id: number;
    category: string;
    title: string;
    location: string;
    image_url: string | null;
    confidence: number | null;
    found_at: string;
    object_kind: string;
  }>;
};

export const emptyHomeSummary: HomeSummary = {
  stats: { recentFound: 0, matchingActive: 0, returned: 0, todayDetections: 0 },
  recentItems: [],
};

const objectKinds = new Set<ObjectKind>(["backpack", "umbrella", "branch", "ball", "container"]);

function objectKind(value: string): ObjectKind {
  return objectKinds.has(value as ObjectKind) ? value as ObjectKind : "container";
}

function mediaUrl(value: string | null): string | null {
  return resolveMediaUrl(value);
}

function mapSummary(summary: ApiHomeSummary): HomeSummary {
  return {
    stats: {
      recentFound: summary.stats.recent_found,
      matchingActive: summary.stats.matching_active,
      returned: summary.stats.returned,
      todayDetections: summary.stats.today_detections,
    },
    recentItems: summary.recent_items.map((item) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      location: item.location,
      imageUrl: mediaUrl(item.image_url),
      confidence: item.confidence,
      foundAt: item.found_at,
      objectKind: objectKind(item.object_kind),
    })),
  };
}

function buildServerApiUrl(path: string) {
  const internalApiBaseUrl = process.env.INTERNAL_API_BASE_URL?.trim() || "http://backend:8000";
  return `${internalApiBaseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function getHomeSummary(): Promise<HomeSummary | null> {
  try {
    const url = buildServerApiUrl("/api/system/home-summary");
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return mapSummary(await response.json() as ApiHomeSummary);
  } catch {
    return null;
  }
}
