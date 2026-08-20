import { buildApiUrl } from "@/lib/apiBase";

export type AdminClaimantSummary = {
  id: number;
  nickname: string;
};

export type AdminFoundItemSummary = {
  id: number;
  item_category: string;
  item_category_name: string;
  color: string | null;
  public_description: string | null;
  private_features: string | null;
  area_name: string;
  found_at: string;
  status: string;
  is_public: boolean;
};

export type AdminLostReportSummary = {
  id: number;
  item_category: string;
  item_category_name: string;
  color: string | null;
  description: string;
  area_name: string;
  lost_from: string;
  lost_to: string | null;
  status: string;
};

export type AdminOwnershipClaim = {
  id: number;
  status: string;
  verification_details: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  admin_memo: string | null;
  created_at: string;
  updated_at?: string;
  claimant: AdminClaimantSummary;
  found_item: AdminFoundItemSummary;
  lost_report: AdminLostReportSummary | null;
};

export type AdminOwnershipClaimUpdateRequest = {
  status: string;
  admin_memo: string | null;
};

export class AdminOwnershipClaimsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AdminOwnershipClaimsApiError";
  }
}

function getFallbackMessage(status: number) {
  if (status === 401) return "로그인이 필요하거나 로그인 세션이 만료되었습니다.";
  if (status === 403) return "관리자 권한이 필요한 페이지입니다.";
  if (status === 404) return "해당 요청을 찾을 수 없습니다. 최신 목록을 다시 불러옵니다.";
  if (status === 409) {
    return "요청 상태가 이미 변경되었거나 현재 상태에서는 이 작업을 처리할 수 없습니다. 최신 정보를 다시 불러왔습니다.";
  }
  if (status === 422) return "요청 상태 변경 값이 올바르지 않습니다.";
  return "소유권 확인 요청 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
}

async function readErrorMessage(response: Response) {
  return getFallbackMessage(response.status);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
  });

  if (!response.ok) {
    throw new AdminOwnershipClaimsApiError(await readErrorMessage(response), response.status);
  }

  return response.json() as Promise<T>;
}

export function listAdminOwnershipClaims(signal?: AbortSignal) {
  return requestJson<AdminOwnershipClaim[]>(
    buildApiUrl("/api/admin/ownership-claims", { skip: 0, limit: 20 }),
    { signal },
  );
}

export function updateAdminOwnershipClaim(
  id: number,
  request: AdminOwnershipClaimUpdateRequest,
) {
  return requestJson<AdminOwnershipClaim>(buildApiUrl(`/api/admin/ownership-claims/${id}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}
