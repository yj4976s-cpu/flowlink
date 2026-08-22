import { formatElapsedTime } from "./game.utils";
import styles from "./DaruGame.module.css";

export function GameStatus({ timeRemaining, attempts, foundPairs, pairCount, combo, daruPoints, hintsRemaining, hintActive, onHint }: { timeRemaining: number; attempts: number; foundPairs: number; pairCount: number; combo: number; daruPoints: number; hintsRemaining: number; hintActive: boolean; onHint: () => void }) {
  return <dl className={styles.status} aria-label="게임 현황">
    <div className={timeRemaining <= 10 ? styles.timerCritical : timeRemaining <= 30 ? styles.timerWarning : undefined}><dt>남은 시간</dt><dd>{formatElapsedTime(timeRemaining)}</dd></div>
    <div><dt>시도</dt><dd>{attempts}회</dd></div>
    <div><dt>발견</dt><dd>{foundPairs} / {pairCount}</dd></div>
    <div><dt>콤보</dt><dd>{combo} COMBO</dd></div>
    <div><dt>다루 포인트</dt><dd>{daruPoints.toLocaleString("ko-KR")}P</dd></div>
    <div><dt>도움</dt><dd><button className={styles.hintButton} type="button" disabled={hintActive || hintsRemaining === 0} onClick={onHint}>💡 힌트 {hintsRemaining}</button></dd></div>
  </dl>;
}
