import { formatElapsedTime } from "./game.utils";
import styles from "./DaruGame.module.css";

function ClockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M9 2h6M12 5v8l4 2" /></svg>;
}

function HintIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 16.5h7M9.5 20h5M8 13.5a6 6 0 118 0c-1.2 1-1.7 1.8-1.8 3h-4.4c-.1-1.2-.6-2-1.8-3z" /></svg>;
}

export function GameStatus({ timeRemaining, isPreview = false, attempts, foundPairs, pairCount, combo, daruPoints, hintsRemaining, hintActive, onHint }: { timeRemaining: number; timeLimit: number; isPreview?: boolean; attempts: number; foundPairs: number; pairCount: number; combo: number; daruPoints: number; hintsRemaining: number; hintActive: boolean; onHint: () => void }) {
  const timerState = timeRemaining <= 10 ? "critical" : timeRemaining <= 30 ? "warning" : "normal";
  return <section className={styles.liveHud} aria-label="실시간 게임 현황" data-timer-state={timerState} data-daru-game-blocker>
    <span className={styles.hudEyebrow}>LIVE GAME HUD</span>
    <dl className={styles.primaryHud}>
      <div className={styles.timerZone}>
        <dt><span className={styles.timerIcon}><ClockIcon /><i aria-hidden="true" /></span>{isPreview ? "게임 시간" : "남은 시간"}</dt>
        <dd>{formatElapsedTime(timeRemaining)}</dd>
      </div>
      <div className={styles.foundZone}>
        <dt>카드 매칭</dt><dd>{foundPairs} <span>/ {pairCount}</span></dd>
      </div>
    </dl>
    <span className={styles.hudDivider} aria-hidden="true" />
    <dl className={styles.secondaryHud}>
      <div><dt>시도 횟수</dt><dd>{attempts}회</dd></div>
      <div data-combo={combo >= 2 ? combo : undefined}><dt>콤보</dt><dd>{combo}</dd></div>
      <div><dt>다루 포인트</dt><dd>{daruPoints.toLocaleString("ko-KR")}P</dd></div>
      <div><dt>힌트</dt><dd><button className={styles.hintButton} type="button" disabled={hintActive || hintsRemaining === 0} onClick={onHint} aria-label={`힌트 ${hintsRemaining}회 남음`}><HintIcon /><span>{hintsRemaining}회</span></button></dd></div>
    </dl>
  </section>;
}
