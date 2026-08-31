export type CitizenReportStatusFilter = "" | "PENDING" | "UNDER_REVIEW" | "LINKED";
export type OwnershipClaimStatusFocus = "PENDING" | "APPROVED" | "REJECTED" | "RETURNED" | null;

const citizenReportStatuses = new Set<CitizenReportStatusFilter>(["PENDING", "UNDER_REVIEW", "LINKED"]);
const ownershipClaimStatuses = new Set<NonNullable<OwnershipClaimStatusFocus>>(["PENDING", "APPROVED", "REJECTED", "RETURNED"]);

export function parseCitizenReportStatusParam(value: string | null): CitizenReportStatusFilter {
  if (!value) return "";
  const normalized = value.trim().toUpperCase();
  return citizenReportStatuses.has(normalized as CitizenReportStatusFilter)
    ? normalized as CitizenReportStatusFilter
    : "";
}

export function parseOwnershipClaimStatusParam(value: string | null): OwnershipClaimStatusFocus {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return ownershipClaimStatuses.has(normalized as NonNullable<OwnershipClaimStatusFocus>)
    ? normalized as OwnershipClaimStatusFocus
    : null;
}

export function chooseOwnershipClaimId<T extends { id: number; status: string }>(
  claims: T[],
  currentId: number | null,
  preferredStatus: OwnershipClaimStatusFocus,
) {
  if (currentId != null && claims.some((claim) => claim.id === currentId)) return currentId;
  if (preferredStatus) {
    const preferred = claims.find((claim) => claim.status === preferredStatus);
    if (preferred) return preferred.id;
  }
  return claims[0]?.id ?? null;
}
