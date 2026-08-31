export const adminOperationsBriefingFallbackTasks = [
  { key: "operation_detection_pending", label: "탐지 검토 대기", count: 0, href: "/admin/detections" },
  { key: "waste_collection_pending", label: "폐기물 수거 대기", count: 0, href: "/admin/detections?followUp=WASTE_PENDING" },
  { key: "citizen_review_pending", label: "시민 제보 검토 대기", count: 0, href: "/admin/citizen-reports?status=PENDING" },
  { key: "ownership_claim_pending", label: "소유권 요청 검토 대기", count: 0, href: "/admin/ownership-claims?status=PENDING" },
  { key: "ownership_return_pending", label: "승인 후 반환 대기", count: 0, href: "/admin/ownership-claims?status=APPROVED" },
];

export function geminiBriefingLabel(status?: { gemini_connected?: boolean; gemini_configured?: boolean; fallback_used?: boolean } | null) {
  if (status?.gemini_connected) return "Gemini 연결됨";
  if (status?.fallback_used) return "규칙 기반 요약";
  if (status?.gemini_configured) return "Gemini 설정됨";
  return "규칙 기반 요약";
}
