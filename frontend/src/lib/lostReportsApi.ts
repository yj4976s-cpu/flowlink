export type LostReportCreateRequest = {
  item_category: string;
  color: string | null;
  colors: string[];
  description: string;
  lost_location: string;
  lost_at: string;
};

export type LostReportResponse = {
  id: number;
  item_category: string;
  item_category_name: string;
  color: string | null;
  colors: string[];
  description: string;
  area_name: string;
  lost_from: string;
  lost_to: string | null;
  image_url: string | null;
  status: string;
  created_at: string;
};

export class LostReportsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "LostReportsApiError";
  }
}

function getApiBaseUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!baseUrl) {
    throw new LostReportsApiError("NEXT_PUBLIC_API_BASE_URL 환경 변수가 설정되지 않았습니다.");
  }
  return baseUrl.replace(/\/+$/, "");
}

function buildApiUrl(path: string) {
  return `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function getFallbackMessage(status: number) {
  if (status === 401) return "로그인이 필요하거나 로그인 세션이 만료되었습니다.";
  if (status === 400) return "입력한 신고 내용을 다시 확인해주세요.";
  if (status === 409) return "분실 신고를 저장하는 중 충돌이 발생했습니다. 잠시 후 다시 시도해주세요.";
  if (status === 422) return "입력값 검증에 실패했습니다. 필수 항목과 형식을 확인해주세요.";
  if (status === 413) return "이미지는 5MB 이하만 업로드할 수 있습니다.";
  if (status === 415) return "JPEG, PNG, WebP 이미지 파일만 업로드할 수 있습니다.";
  return "분실 신고를 등록하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function normalizeDetailMessage(detail: unknown, status: number) {
  if (status === 401) return getFallbackMessage(status);
  if (typeof detail !== "string") return getFallbackMessage(status);
  if (detail === "Invalid personal item category") return "선택한 물품 종류를 다시 확인해주세요.";
  if (detail === "Lost time cannot be in the future") return "분실 시각은 미래일 수 없습니다.";
  if (detail === "Description and location are required") return "물품 설명과 분실 위치를 입력해주세요.";
  return getFallbackMessage(status);
}

async function readErrorMessage(response: Response) {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "detail" in body) {
      return normalizeDetailMessage((body as { detail: unknown }).detail, response.status);
    }
  } catch {
    return getFallbackMessage(response.status);
  }
  return getFallbackMessage(response.status);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: "include",
  });
  if (!response.ok) throw new LostReportsApiError(await readErrorMessage(response), response.status);
  return response.json() as Promise<T>;
}

export async function createLostReport(request: LostReportCreateRequest, image?: File) {
  const body = new FormData();
  body.set("item_category", request.item_category);
  if (request.color) body.set("color", request.color);
  request.colors.forEach((color) => body.append("colors", color));
  body.set("description", request.description);
  body.set("lost_location", request.lost_location);
  body.set("lost_at", request.lost_at);
  if (image) body.set("image", image);
  return requestJson<LostReportResponse>("/api/lost-reports", {
    method: "POST",
    body,
  });
}

export function listMyLostReports(signal?: AbortSignal) {
  return requestJson<LostReportResponse[]>("/api/lost-reports/me?skip=0&limit=20", { signal });
}
