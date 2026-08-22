import Image from "next/image";
import { useEffect, useRef } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { DARU_TIME_OVER_ASSETS } from "./game.config";
import { formatElapsedTime } from "./game.utils";
import { ResultRecordNotice, type ResultRecordStatus } from "./ResultRecordNotice";
import styles from "./DaruGame.module.css";

export function PartialResult({ matchedPairs, pairCount, maxCombo, daruPoints, elapsedSeconds, recordStatus, onRestart, onChangeDifficulty }: { matchedPairs: number; pairCount: number; maxCombo: number; daruPoints: number; elapsedSeconds: number; recordStatus: ResultRecordStatus; onRestart: () => void; onChangeDifficulty: () => void }) {
  const { theme } = useTheme();
  const ref = useRef<HTMLElement>(null);
  const missionPercent = pairCount > 0 ? Math.min(100, Math.max(0, Math.round((matchedPairs / pairCount) * 100))) : 0;
  const remainingPairs = Math.max(0, pairCount - matchedPairs);
  useEffect(() => { ref.current?.focus(); Object.values(DARU_TIME_OVER_ASSETS).forEach((src) => { const image = new window.Image(); image.src = src; }); }, []);
  return <section ref={ref} className={`${styles.result} ${styles.partialResult}`} role="dialog" aria-modal="true" aria-labelledby="partial-result-title" tabIndex={-1}>
    <div className={styles.timeOverDaru}><Image key={theme} src={DARU_TIME_OVER_ASSETS[theme]} alt="아쉬워하는 다루" fill sizes="(max-width: 720px) 104px, 132px" priority unoptimized /></div>
    <p className={styles.clearLabel}>TIME OVER</p><h2 id="partial-result-title">이번엔 여기까지!</h2>
    <p className={styles.partialMessage}>다루와 함께 다음 도전에서 더 찾아봐요!</p>
    <div className={styles.partialOverview}><div><span>찾은 짝</span><strong>{matchedPairs} / {pairCount}</strong></div><div><span>미션 달성</span><strong>{missionPercent}%</strong><progress max={100} value={missionPercent} aria-label={`미션 달성 ${missionPercent}%`} /><small>남은 짝 {remainingPairs}</small></div></div>
    <dl className={styles.partialStats}><div><dt>최고 콤보</dt><dd>{maxCombo}</dd></div><div><dt>플레이 시간</dt><dd>{formatElapsedTime(elapsedSeconds)}</dd></div>{daruPoints > 0 && <div><dt>이번 판 획득</dt><dd>+{daruPoints.toLocaleString("ko-KR")}P</dd></div>}</dl>
    <ResultRecordNotice status={recordStatus} />
    <div className={styles.resultActions}><button className="button button-primary" type="button" onClick={onRestart}>한 번 더 찾기</button><button className="button button-secondary" type="button" onClick={onChangeDifficulty}>다른 난이도<br />도전하기</button></div>
  </section>;
}
