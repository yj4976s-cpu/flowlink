import { buildApiUrl } from "@/lib/apiBase";

export type OwnershipClaimCreateRequest = {
  found_item_id: number;
  lost_report_id: number | null;
  verification_details: string;
};

export type OwnershipClaimResponse = {
  id: number;
  user_id: number;
  found_item_id: number;
  lost_report_id: number | null;
  status: string;
  verification_details: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  admin_memo: string | null;
  created_at: string;
};

export class OwnershipClaimsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OwnershipClaimsApiError";
  }
}

function getFallbackMessage(status: number) {
  if (status === 401) return "로그인이 필요하거나 로그인 세션이 만료되었습니다.";
  if (status === 404) {
    return "현재 이 발견물에 확인 요청을 진행할 수 없습니다. 매칭 목록을 새로 확인해주세요.";
  }
  if (status === 409) return "현재 상태에서는 소유권 확인 요청을 진행할 수 없습니다.";
  if (status === 422) return "확인 내용은 10자 이상 1000자 이하로 입력해주세요.";
  return "소유권 확인 요청을 보내지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function normalizeDetailMessage(detail: unknown, status: number) {
  if (status === 401 || status === 404 || status === 422) return getFallbackMessage(status);
  if (typeof detail !== "string") return getFallbackMessage(status);
  if (detail === "Ownership claim already exists") {
    return "이미 이 발견물에 대한 확인 요청이 등록되어 있습니다.";
  }
  if (detail === "Lost report is not claimable") {
    return "현재 상태의 분실 신고로는 확인 요청을 진행할 수 없습니다.";
  }
  if (detail === "Lost report category does not match found item") {
    return "분실 신고와 발견물의 물품 종류가 일치하지 않아 요청할 수 없습니다.";
  }
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

export async function createOwnershipClaim(request: OwnershipClaimCreateRequest) {
  const response = await fetch(buildApiUrl("/api/ownership-claims"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      found_item_id: request.found_item_id,
      lost_report_id: request.lost_report_id,
      verification_details: request.verification_details.trim(),
    }),
  });

  if (!response.ok) {
    throw new OwnershipClaimsApiError(await readErrorMessage(response), response.status);
  }

  return response.json() as Promise<OwnershipClaimResponse>;
}

export async function listMyOwnershipClaims(signal?: AbortSignal) {
  const response = await fetch(`${buildApiUrl("/api/ownership-claims/me")}?skip=0&limit=100`, {
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    throw new OwnershipClaimsApiError(await readErrorMessage(response), response.status);
  }

  return response.json() as Promise<OwnershipClaimResponse[]>;
}

export async function listMyOwnershipClaimProgress(lostReportIds: number[], signal?: AbortSignal) {
  const response = await fetch(
    buildApiUrl("/api/ownership-claims/me/progress", { lost_report_ids: lostReportIds }),
    { credentials: "include", signal },
  );
  if (!response.ok) throw new OwnershipClaimsApiError(await readErrorMessage(response), response.status);
  return response.json() as Promise<OwnershipClaimResponse[]>;
}

export async function listMyOwnershipClaimActivity(lostReportIds: number[], signal?: AbortSignal) {
  const response = await fetch(
    buildApiUrl("/api/ownership-claims/me/activity", { lost_report_ids: lostReportIds }),
    { credentials: "include", signal },
  );
  if (!response.ok) throw new OwnershipClaimsApiError(await readErrorMessage(response), response.status);
  return response.json() as Promise<OwnershipClaimResponse[]>;
}
