export type AdminAiReport = {
  summary: { total: number; average_confidence: string | null; reviewed: number; corrected: number };
  class_metrics: Array<{ code: string; name: string; count: number; average_confidence: string | null; reviewed: number; corrected: number }>;
  confidence_distribution: Array<{ key: string; label: string; count: number }>;
  correction_patterns: Array<{ predicted_code: string; predicted_name: string; final_code: string; final_name: string; count: number }>;
};

export function getAdminAiReport(signal?: AbortSignal) {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!baseUrl) return Promise.reject(new Error("API 서버 주소가 설정되지 않았습니다."));
  return fetch(`${baseUrl.replace(/\/+$/, "")}/api/admin/ai-report`, { signal, credentials: "include" }).then((response) => {
    if (!response.ok) throw new Error(response.status === 403 ? "관리자 권한이 필요합니다." : "AI 운영 분석 데이터를 불러오지 못했습니다.");
    return response.json() as Promise<AdminAiReport>;
  });
}
