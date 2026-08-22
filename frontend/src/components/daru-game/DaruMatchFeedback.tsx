import { DaruIcon } from "@/components/mascot/DaruIcon";
import styles from "./DaruGame.module.css";

export interface MatchFeedbackData {
  id: number;
  message: string;
  combo: number;
  points: number;
  remainingPairs?: number;
}

export function DaruMatchFeedback({ feedback }: { feedback: MatchFeedbackData }) {
  const isLastPair = feedback.remainingPairs === 1;
  return (
    <div key={feedback.id} className={styles.matchBanner} data-last-pair={isLastPair || undefined} role="status" aria-live="polite">
      <span className={styles.matchBannerIcon} aria-hidden="true"><DaruIcon size={24} /></span>
      <strong>{feedback.message}</strong>
      {!isLastPair && <span className={styles.matchBannerDetails}>
        {feedback.combo >= 2 ? <em className={styles.comboBadge}>{feedback.combo} COMBO</em> : null}
        <b>+{feedback.points.toLocaleString("ko-KR")}P</b>
      </span>}
    </div>
  );
}
