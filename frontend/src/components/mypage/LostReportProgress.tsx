import styles from "./LostReportProgress.module.css";

export const lostReportProgressLabels = ["신고 접수", "후보 발견", "소유권 확인 중", "반환 준비", "반환 완료"] as const;

export type LostReportProgressModel = {
  step: 1 | 2 | 3 | 4 | 5;
  key: "REPORT_RECEIVED" | "CANDIDATE_FOUND" | "CLAIM_REVIEW" | "RETURN_READY" | "RETURN_COMPLETE";
  title: (typeof lostReportProgressLabels)[number];
  description: string;
  exception?: { type: "REJECTED"; title: string; description: string };
};

export function deriveLostReportProgress({ activeCandidateCount, representativeClaimStatus }: { activeCandidateCount: number; representativeClaimStatus: string | null }): LostReportProgressModel {
  if (representativeClaimStatus === "RETURNED") return { step: 5, key: "RETURN_COMPLETE", title: "반환 완료", description: "물건 반환이 완료됐어요." };
  if (representativeClaimStatus === "APPROVED") return { step: 4, key: "RETURN_READY", title: "반환 준비", description: "소유권 확인이 완료됐어요. 반환 안내를 확인해 주세요." };
  if (representativeClaimStatus === "PENDING") return { step: 3, key: "CLAIM_REVIEW", title: "소유권 확인 중", description: "선택하신 발견물이 맞는지 관리자가 확인하고 있어요." };
  const hasCandidates = activeCandidateCount > 0;
  const progress: LostReportProgressModel = hasCandidates
    ? { step: 2, key: "CANDIDATE_FOUND", title: "후보 발견", description: "비슷한 발견물을 찾았어요. 내 물건과 맞는지 확인해 보세요." }
    : { step: 1, key: "REPORT_RECEIVED", title: "신고 접수", description: "분실 신고가 접수됐어요. 비슷한 발견물을 자동으로 찾고 있어요." };
  if (representativeClaimStatus !== "REJECTED") return progress;
  return { ...progress, exception: { type: "REJECTED", title: "요청 미승인", description: hasCandidates ? "이전 소유권 확인 요청이 승인되지 않았어요. 다른 매칭 후보를 확인해 보세요." : "이전 요청은 승인되지 않았어요. 다른 발견물을 계속 찾고 있어요." } };
}

export function LostReportProgress({ progress }: { progress: LostReportProgressModel }) {
  return <section className={styles.progress} aria-label={`전체 5단계 중 ${progress.step}단계, ${progress.title}`}>
    <div className={styles.currentSummary}><span>{progress.step} / 5</span><div><strong>{progress.title}</strong><p>{progress.description}</p></div></div>
    <ol>{lostReportProgressLabels.map((label, index) => { const step = index + 1; const state = step < progress.step ? "complete" : step === progress.step ? "current" : "upcoming"; return <li key={label} data-state={state} aria-current={state === "current" ? "step" : undefined}><i aria-hidden="true">{state === "complete" ? "✓" : step}</i><span>{label}</span><small className="sr-only">{state === "complete" ? "완료" : state === "current" ? "현재 단계" : "예정"}</small></li>; })}</ol>
    {progress.exception && <aside className={styles.exception}><strong>{progress.exception.title}</strong><p>{progress.exception.description}</p></aside>}
  </section>;
}
