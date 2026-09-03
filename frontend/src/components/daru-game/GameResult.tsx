import Image from "next/image";
import { useEffect, useRef } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { DARU_CLEAR_ASSETS } from "./game.config";
import type { DaruGameTheme, DetectionMetrics, GameRank } from "./game.types";
import { formatElapsedTime, formatMemoryScore, roundToTenth } from "./game.utils";
import { ResultRecordNotice, type ResultRecordStatus } from "./ResultRecordNotice";
import styles from "./DaruGame.module.css";

const RANK_MESSAGES: Record<GameRank, string> = {
  S: "역시 기억력이 대단해!", A: "정말 잘 찾았어!", B: "좋아! 다음에는 더 빠르게 찾아보자.", C: "끝까지 전부 찾았네!",
};

export function GameResult({ rank, metrics, daruPoints, elapsedSeconds, attempts, maxCombo, hintsUsed, withinTimeLimit, newBest, leaderboardRank, personalBestPower, previousBestPower, recordStatus, difficultyLabel, onRestart, onChangeDifficulty, onViewLeaderboard, previewTheme, startPending = false }: { rank: GameRank; metrics: DetectionMetrics; daruPoints: number; elapsedSeconds: number; attempts: number; maxCombo: number; hintsUsed: number; withinTimeLimit: boolean; newBest: boolean; leaderboardRank: number | null; personalBestPower?: number | null; previousBestPower?: number | null; recordStatus: ResultRecordStatus; difficultyLabel: string; onRestart: () => void; onChangeDifficulty: () => void; onViewLeaderboard?: () => void; previewTheme?: DaruGameTheme; startPending?: boolean }) {
  const { theme } = useTheme();
  const activeTheme = previewTheme ?? theme;
  const stageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    stageRef.current?.focus();
  }, []);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const improvement = newBest && previousBestPower !== null && previousBestPower !== undefined ? roundToTenth(metrics.detectionPower - previousBestPower) : null;
  const newBestTitle = activeTheme === "day" ? "최고 기록 갱신!" : "다루와 새로운 기록을 세웠어요!";
  const newBestMessage = activeTheme === "night" ? "대단해요! 역대 최고 기록을 갱신했어요!" : activeTheme === "dawn" ? "정말 멋져요! 새로운 기록을 세웠어요!" : "짝짝! 오늘의 최고 기록을 갱신했어요!";
  const overtimeMessage = recordStatus === "saved"
    ? newBest
      ? "제한시간을 초과해 속도 점수는 0점으로 반영되었어요. 새로운 최고 기록이 랭킹 점수로 사용됩니다."
      : "제한시간을 초과해 속도 점수는 0점으로 반영되었어요. 플레이 기록은 저장되고 기존 최고 기록과 랭킹은 유지됩니다."
    : recordStatus === "guest"
      ? "제한시간을 초과해 속도 점수는 0점으로 반영되었어요. 완주 기록도 개인 최고기록 비교 대상에 포함됩니다."
      : "제한시간을 초과해 속도 점수는 0점으로 반영되었어요.";

  return <section ref={stageRef} className={styles.result} data-theme={activeTheme} data-new-best={newBest || undefined} role="dialog" aria-modal="true" aria-labelledby="game-result-title" tabIndex={-1}>
    <div className={styles.clearParticles} aria-hidden="true"><i /><i /><i /><i /><i /></div>
    {newBest && <div className={styles.newBestSparkles} aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i><i>✧</i></div>}
    <p className={styles.clearLabel}>✦ CLEAR! ✦</p>
    <div className={styles.clearDaru} aria-hidden="true">{previewTheme ? <Image src={DARU_CLEAR_ASSETS[previewTheme]} alt="" fill sizes="190px" priority style={{ opacity: 1 }} /> : <><Image className={styles.daruDawn} src={DARU_CLEAR_ASSETS.dawn} alt="" fill sizes="190px" priority /><Image className={styles.daruDay} src={DARU_CLEAR_ASSETS.day} alt="" fill sizes="190px" priority /><Image className={styles.daruNight} src={DARU_CLEAR_ASSETS.night} alt="" fill sizes="190px" priority /></>}</div>
    <h2 id="game-result-title">{newBest ? newBestTitle : withinTimeLimit ? "다루와 전부 찾았어요!" : "클리어 완료!"}</h2><p className={styles.rankMessage}>{withinTimeLimit ? newBest ? newBestMessage : RANK_MESSAGES[rank] : overtimeMessage}</p>
    {newBest && <div className={styles.newBestRibbon} aria-label="새로운 최고 기록"><span aria-hidden="true">♛</span> NEW BEST</div>}
    <div className={styles.rankSummary}><strong>{rank} RANK</strong><span>메모리 점수 <b>{formatMemoryScore(metrics.detectionPower)}</b></span></div>
    <dl className={styles.resultMetrics}><div><dt>기억 정확도</dt><dd>{formatMemoryScore(metrics.memoryAccuracy)}</dd></div><div><dt>플레이 속도</dt><dd>{formatMemoryScore(metrics.speedScore)}</dd></div><div><dt>최고 콤보</dt><dd>{formatMemoryScore(metrics.comboScore)}</dd><small>{maxCombo}콤보</small></div><div><dt>힌트 절약</dt><dd>{formatMemoryScore(metrics.hintScore)}</dd><small>{hintsUsed}회 사용</small></div></dl>
    <div className={styles.resultMeta}><p><strong>{formatElapsedTime(elapsedSeconds)}</strong><span>플레이 시간 · {attempts}회 시도</span></p><p><span>이번 판 획득</span><strong>+{daruPoints.toLocaleString("ko-KR")}P</strong></p></div>
    {newBest && <div className={styles.bestComparison}><span>♛ {previousBestPower === null || previousBestPower === undefined ? "첫 최고 기록" : <>이전 최고 <b>{formatMemoryScore(previousBestPower)}</b> <i aria-hidden="true">→</i></>}</span><strong>현재 {formatMemoryScore(metrics.detectionPower)}</strong>{improvement !== null && improvement > 0 && <em>+{formatMemoryScore(improvement)}</em>}</div>}
    <ResultRecordNotice status={recordStatus} currentScore={recordStatus === "saved" ? metrics.detectionPower : undefined} bestScore={personalBestPower} rankText={recordStatus === "saved" && leaderboardRank ? `${difficultyLabel} 랭킹 현재 ${leaderboardRank}위` : undefined} />
    <div className={styles.resultActions} data-has-leaderboard={onViewLeaderboard ? true : undefined}><button className="button button-primary" type="button" disabled={startPending} aria-busy={startPending || undefined} onClick={onRestart}>{startPending ? "게임 준비 중…" : "한 번 더 찾기"}</button><button className="button button-secondary" type="button" disabled={startPending} onClick={onChangeDifficulty}>다른 난이도 도전하기</button>{onViewLeaderboard && <button className="button button-secondary" type="button" disabled={startPending} onClick={onViewLeaderboard}>랭킹 보기</button>}</div>
  </section>;
}
