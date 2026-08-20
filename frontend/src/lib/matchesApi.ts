import { buildApiUrl as buildSameOriginApiUrl, getApiMediaBaseUrl } from "@/lib/apiBase";

export type MatchLostReport = {
  id: number;
  item_category: string;
  item_category_name: string;
  color: string | null;
  description: string;
  area_name: string;
  lost_from: string;
  lost_to: string | null;
  image_url: string | null;
  status: string;
  created_at: string;
};

export type MatchFoundItem = {
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

export type MatchCandidate = {
  id: number;
  lost_report: MatchLostReport;
  found_item: MatchFoundItem;
  total_score: number;
  type_score: number;
  area_score: number;
  time_score: number;
  keyword_score: number;
  status: string;
  created_at: string;
};

export class MatchesApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MatchesApiError";
  }
}

function getFallbackMessage(status: number) {
  if (status === 401) return "로그인이 필요하거나 로그인 세션이 만료되었습니다.";
  if (status === 422) return "매칭 후보 조회 요청 값을 확인해주세요.";
  return "매칭 후보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
}

export function listMyMatches(signal?: AbortSignal) {
  return requestJson<MatchCandidate[]>(
    buildSameOriginApiUrl("/api/matches/me", { skip: 0, limit: 100 }),
    signal,
  );
}

export function listMyMatchesForReport(lostReportId: number, signal?: AbortSignal) {
  return requestJson<MatchCandidate[]>(
    buildSameOriginApiUrl("/api/matches/me", { lost_report_id: lostReportId, skip: 0, limit: 100 }),
    signal,
  );
}

export function listMyProgressMatches(lostReportIds: number[], signal?: AbortSignal) {
  return requestJson<MatchCandidate[]>(
    buildSameOriginApiUrl("/api/matches/me/progress", { lost_report_ids: lostReportIds }),
    signal,
  );
}

export function resolveMatchImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const resolved = new URL(value, `${getApiMediaBaseUrl()}/`);
    return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.toString() : null;
  } catch {
    return null;
  }
}

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    throw new MatchesApiError(getFallbackMessage(response.status), response.status);
  }

  return response.json() as Promise<T>;
}
