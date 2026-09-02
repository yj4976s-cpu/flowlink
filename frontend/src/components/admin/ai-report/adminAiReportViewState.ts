export const adminOperationsBriefingFallbackTasks = [
  { key: "operation_detection_pending", label: "탐지 검토 대기", count: 0, href: "/admin/detections" },
  { key: "waste_collection_pending", label: "폐기물 수거 대기", count: 0, href: "/admin/detections?followUp=WASTE_PENDING" },
  { key: "citizen_review_pending", label: "시민 제보 검토 대기", count: 0, href: "/admin/citizen-reports?status=PENDING" },
  { key: "ownership_claim_pending", label: "소유권 요청 검토 대기", count: 0, href: "/admin/ownership-claims?status=PENDING" },
  { key: "ownership_return_pending", label: "승인 후 반환 대기", count: 0, href: "/admin/ownership-claims?status=APPROVED" },
];

export const ADMIN_REPORT_PERIODS = [7, 30, 90] as const;
export type AdminReportPeriod = typeof ADMIN_REPORT_PERIODS[number];

export function geminiBriefingLabel(status?: { gemini_connected?: boolean; gemini_configured?: boolean; fallback_used?: boolean } | null) {
  if (status?.gemini_connected) return "Gemini 연결됨";
  if (status?.fallback_used) return "규칙 기반 요약";
  if (status?.gemini_configured) return "Gemini 설정됨";
  return "규칙 기반 요약";
}

export function isAdminReportPeriod(value: number): value is AdminReportPeriod {
  return value === 7 || value === 30 || value === 90;
}

export function safePercent(count: number, total: number) {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, count / total * 100));
}

export function formatAdminReportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(date);
}

export function getTrendChartMax(points: Array<Record<string, number | string>>, keys: string[]) {
  return Math.max(1, ...points.flatMap((point) => keys.map((key) => Number(point[key]) || 0)));
}

export function buildSvgTrendPath(points: Array<Record<string, number | string>>, key: string, max: number, width = 720, height = 220) {
  if (!points.length) return "";
  const xStep = points.length > 1 ? width / (points.length - 1) : 0;
  return points
    .map((point, index) => {
      const x = index * xStep;
      const y = height - safePercent(Number(point[key]) || 0, max) / 100 * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function shouldShowTrendLabel(index: number, total: number) {
  if (total <= 14) return true;
  if (index === 0 || index === total - 1) return true;
  const interval = total > 45 ? 14 : 7;
  return index % interval === 0;
}
