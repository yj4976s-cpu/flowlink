import styles from "./DaruGame.module.css";
import { formatMemoryScore } from "./game.utils";

export type ResultRecordStatus = "idle" | "saving" | "saved" | "failed" | "guest" | "admin";

export function ResultRecordNotice({ status, currentScore, bestScore, rankText }: { status: ResultRecordStatus; currentScore?: number; bestScore?: number | null; rankText?: string }) {
  if (status === "idle") return null;
  return <div className={styles.resultRecordNotice} data-status={status} role="status" aria-live="polite">
    {status === "guest" ? <span>로그인하면 기록을 저장하고 랭킹에 참여할 수 있어요.</span> :
      status === "admin" ? <span>관리자 플레이는 USER 기록과 랭킹에 저장되지 않아요.</span> :
      status === "saving" ? <span>기록을 저장하고 있어요...</span> :
      status === "failed" ? <span>기록을 저장하지 못했어요.</span> : <><strong>✓ 이번 기록이 저장됐어요.</strong>{currentScore !== undefined && bestScore !== null && bestScore !== undefined && <small>이번 기록 {formatMemoryScore(currentScore)} · 내 최고 기록 {formatMemoryScore(bestScore)}</small>}{rankText && <small>{rankText}</small>}</>}
  </div>;
}
