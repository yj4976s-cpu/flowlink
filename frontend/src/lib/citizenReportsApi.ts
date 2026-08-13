import type { CitizenReport, CitizenReportDraft, SightingDraft } from "@/types/discoveryNetwork";

type ApiSighting = { id: number; sighted_at: string; location_name: string; description: string; image_url: string | null };
type ApiReport = { id: number; item_category: string; item_category_name: string; color: string | null; description: string; image_url: string | null; area_name: string; found_at: string; status: string; sightings: ApiSighting[]; linked_found_item: { id: number; status: string } | null };
type ApiValidationError = { msg?: string };

export class CitizenReportsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CitizenReportsApiError";
  }
}

const categoryCodes: Record<string, string> = { "공": "BALL", "가방": "BAG", "우산": "UMBRELLA", "신발·슬리퍼류": "FOOTWEAR", "신발/슬리퍼": "FOOTWEAR" };
const statusLabels: Record<string, CitizenReport["status"]> = { PENDING: "검토 대기", UNDER_REVIEW: "관리자 확인 중", LINKED: "기존 발견물 연결", REJECTED: "반려", CANCELLED: "취소" };

function baseUrl() { const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim(); if (!value) throw new CitizenReportsApiError("API 서버 주소가 설정되지 않았습니다."); return value.replace(/\/+$/, ""); }
function fallbackMessage(status: number) {
  if (status === 401) return "로그인 세션이 만료되었습니다. 다시 로그인해주세요.";
  if (status === 413) return "첨부 이미지가 너무 큽니다. 5MB 이하 이미지를 사용해주세요.";
  if (status === 415) return "첨부 이미지를 읽을 수 없습니다. JPG, PNG 또는 WebP 이미지를 사용해주세요.";
  if (status === 422) return "발견 제보 입력 내용을 확인해주세요.";
  return "발견 제보 요청을 처리하지 못했습니다.";
}
function detailMessage(detail: unknown, status: number) {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item: ApiValidationError) => item?.msg).filter((message): message is string => Boolean(message));
    if (messages.length) return messages.join(" ");
  }
  return fallbackMessage(status);
}
async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl()}${path}`, { ...init, credentials: "include" });
  if (!response.ok) {
    let message = fallbackMessage(response.status);
    try {
      const body = await response.json() as { detail?: unknown };
      message = detailMessage(body.detail, response.status);
    } catch { /* Keep the status-specific fallback for non-JSON responses. */ }
    throw new CitizenReportsApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
function imageUrl(value: string | null) { return value ? new URL(value, `${baseUrl()}/`).toString() : null; }
function mapReport(report: ApiReport): CitizenReport {
  const category = report.item_category_name;
  return { id: String(report.id), category, title: `${report.color ?? ""} ${category}`.trim(), color: report.color ?? "",
    description: report.description, areaName: report.area_name, foundAt: report.found_at, imageUrl: imageUrl(report.image_url),
    imageClass: category.includes("우산") ? "umbrella" : category.includes("가방") ? "backpack" : category.includes("공") ? "ball" : "shoe",
    status: statusLabels[report.status] ?? "검토 대기", mapPosition: { x: 24 + report.id % 55, y: 28 + report.id % 38 },
    history: [{ id: `report-${report.id}`, at: report.found_at, label: "최초 발견 제보", place: report.area_name, detail: report.description, source: "발견 제보" },
      ...report.sightings.map((item) => ({ id: String(item.id), at: item.sighted_at, label: "다른 시민 추가 목격", place: item.location_name, detail: item.description, imageUrl: imageUrl(item.image_url), source: "발견 제보" as const }))] };
}
export async function listCitizenReports() { return (await request<ApiReport[]>("/api/citizen-reports")).map(mapReport); }
export async function getCitizenReport(reportId: string, signal?: AbortSignal) { return mapReport(await request<ApiReport>(`/api/citizen-reports/${reportId}`, { signal })); }
export async function listMyCitizenReports(signal?: AbortSignal) { return (await request<ApiReport[]>("/api/citizen-reports/mine", { signal })).map(mapReport); }
export async function createCitizenReport(draft: CitizenReportDraft) { const body = new FormData(); body.set("object_class", categoryCodes[draft.category] ?? draft.category); body.set("color", draft.color); body.set("description", draft.description); body.set("area_name", draft.areaName); body.set("found_at", draft.foundAt); if (draft.image) body.set("image", draft.image); return mapReport(await request<ApiReport>("/api/citizen-reports", { method: "POST", body })); }
export async function addCitizenSighting(reportId: string, draft: SightingDraft) { const body = new FormData(); body.set("sighted_at", draft.foundAt); body.set("location_name", draft.areaName); body.set("description", draft.description); if (draft.image) body.set("image", draft.image); return mapReport(await request<ApiReport>(`/api/citizen-reports/${reportId}/sightings`, { method: "POST", body })); }
