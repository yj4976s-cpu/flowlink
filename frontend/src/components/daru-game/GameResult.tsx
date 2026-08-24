import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { DARU_CLEAR_ASSETS } from "./game.config";
import type { DaruGameTheme, DetectionMetrics, GameRank } from "./game.types";
import { formatElapsedTime } from "./game.utils";
import { ResultRecordNotice, type ResultRecordStatus } from "./ResultRecordNotice";
import styles from "./DaruGame.module.css";

const RANK_MESSAGES: Record<GameRank, string> = {
  S: "역시 기억력이 대단해!", A: "정말 잘 찾았어!", B: "좋아! 다음에는 더 빠르게 찾아보자.", C: "끝까지 전부 찾았네!",
};

export function GameResult({ rank, metrics, daruPoints, elapsedSeconds, attempts, maxCombo, hintsUsed, withinTimeLimit, newBest, leaderboardRank, personalBestPower, previousBestPower, recordStatus, difficultyLabel, onRestart, onChangeDifficulty, onViewLeaderboard, previewTheme }: { rank: GameRank; metrics: DetectionMetrics; daruPoints: number; elapsedSeconds: number; attempts: number; maxCombo: number; hintsUsed: number; withinTimeLimit: boolean; newBest: boolean; leaderboardRank: number | null; personalBestPower?: number | null; previousBestPower?: number | null; recordStatus: ResultRecordStatus; difficultyLabel: string; onRestart: () => void; onChangeDifficulty: () => void; onViewLeaderboard?: () => void; previewTheme?: DaruGameTheme }) {
  const { theme } = useTheme();
  const activeTheme = previewTheme ?? theme;
  const stageRef = useRef<HTMLElement>(null);
  const [displayedPower, setDisplayedPower] = useState(0);
  useEffect(() => {
    stageRef.current?.focus();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { const frame = window.requestAnimationFrame(() => setDisplayedPower(metrics.detectionPower)); return () => window.cancelAnimationFrame(frame); }
    const startedAt = performance.now(); let frame = 0;
    const update = (now: number) => { const progress = Math.min(1, (now - startedAt) / 650); setDisplayedPower(Math.round(metrics.detectionPower * progress)); if (progress < 1) frame = window.requestAnimationFrame(update); };
    frame = window.requestAnimationFrame(update); return () => window.cancelAnimationFrame(frame);
  }, [metrics.detectionPower]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const improvement = newBest && previousBestPower !== null && previousBestPower !== undefined ? metrics.detectionPower - previousBestPower : null;
  const newBestTitle = activeTheme === "day" ? "최고 기록 갱신!" : "다루와 새로운 기록을 세웠어요!";
  const newBestMessage = activeTheme === "night" ? "대단해요! 역대 최고 기록을 갱신했어요!" : activeTheme === "dawn" ? "정말 멋져요! 새로운 기록을 세웠어요!" : "짝짝! 오늘의 최고 기록을 갱신했어요!";

  return <section ref={stageRef} className={styles.result} data-theme={activeTheme} data-new-best={newBest || undefined} role="dialog" aria-modal="true" aria-labelledby="game-result-title" tabIndex={-1}>
    <div className={styles.clearParticles} aria-hidden="true"><i /><i /><i /><i /><i /></div>
    {newBest && <div className={styles.newBestSparkles} aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i><i>✧</i></div>}
    <p className={styles.clearLabel}>✦ CLEAR! ✦</p>
    <div className={styles.clearDaru} aria-hidden="true">{previewTheme ? <Image src={DARU_CLEAR_ASSETS[previewTheme]} alt="" fill sizes="190px" priority style={{ opacity: 1 }} /> : <><Image className={styles.daruDawn} src={DARU_CLEAR_ASSETS.dawn} alt="" fill sizes="190px" priority /><Image className={styles.daruDay} src={DARU_CLEAR_ASSETS.day} alt="" fill sizes="190px" priority /><Image className={styles.daruNight} src={DARU_CLEAR_ASSETS.night} alt="" fill sizes="190px" priority /></>}</div>
    <h2 id="game-result-title">{newBest ? newBestTitle : "다루와 전부 찾았어요!"}</h2><p className={styles.rankMessage}>{newBest ? newBestMessage : withinTimeLimit ? RANK_MESSAGES[rank] : "시간 초과 후 완주했어요. 공식 랭킹에는 반영되지 않아요."}</p>
    {newBest && <div className={styles.newBestRibbon} aria-label="새로운 최고 기록"><span aria-hidden="true">♛</span> NEW BEST</div>}
    <div className={styles.rankSummary}><strong>{rank} RANK</strong><span>메모리 점수 <b>{displayedPower}</b></span></div>
    <dl className={styles.resultMetrics}><div><dt>기억 효율</dt><dd>{metrics.memoryEfficiency}</dd></div><div><dt>플레이 속도</dt><dd>{metrics.speedScore}</dd></div><div><dt>최고 콤보</dt><dd>{maxCombo}</dd></div><div><dt>힌트 사용</dt><dd>{hintsUsed}회</dd></div></dl>
    <div className={styles.resultMeta}><p><strong>{formatElapsedTime(elapsedSeconds)}</strong><span>플레이 시간 · {attempts}회 시도</span></p><p><span>이번 판 획득</span><strong>+{daruPoints.toLocaleString("ko-KR")}P</strong></p></div>
    {newBest && <div className={styles.bestComparison}><span>♛ {previousBestPower === null || previousBestPower === undefined ? "첫 최고 기록" : <>이전 최고 <b>{previousBestPower}</b> <i aria-hidden="true">→</i></>}</span><strong>현재 {metrics.detectionPower}</strong>{improvement !== null && improvement > 0 && <em>+{improvement}</em>}</div>}
    <ResultRecordNotice status={recordStatus} currentScore={recordStatus === "saved" ? metrics.detectionPower : undefined} bestScore={personalBestPower} rankText={recordStatus === "saved" && leaderboardRank ? `${difficultyLabel} 랭킹 현재 ${leaderboardRank}위` : undefined} />
    <div className={styles.resultActions} data-has-leaderboard={onViewLeaderboard ? true : undefined}><button className="button button-primary" type="button" onClick={onRestart}>한 번 더 찾기</button><button className="button button-secondary" type="button" onClick={onChangeDifficulty}>다른 난이도 도전하기</button>{onViewLeaderboard && <button className="button button-secondary" type="button" onClick={onViewLeaderboard}>랭킹 보기</button>}</div>
  </section>;
}
