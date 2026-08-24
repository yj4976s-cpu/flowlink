"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useDaru } from "@/components/mascot";
import { getCurrentUser, type AuthUser } from "@/lib/authApi";
import { createDaruGameRun, getDaruGameRecords, submitDaruGameResult, type GameRecord } from "@/lib/daruGameApi";
import { BEST_RECORD_STORAGE_KEYS, DARU_MEMORY_GUIDE_ASSETS, DIFFICULTY_CONFIG, MISMATCH_REVEAL_MS } from "./game.config";
import type { DetectionMetrics, GameCard, GameDifficulty, GamePhase, GameRank } from "./game.types";
import { calculateDetectionMetricsWithEligibility, calculatePairPoints, createGameDeck, getGameRank } from "./game.utils";
import { DifficultySelector } from "./DifficultySelector";
import { GameResult } from "./GameResult";
import { GameStatus } from "./GameStatus";
import { MemoryBoard } from "./MemoryBoard";
import { DaruLeaderboard } from "./DaruLeaderboard";
import { DaruMatchFeedback, type MatchFeedbackData } from "./DaruMatchFeedback";
import { TimeOverDialog } from "./TimeOverDialog";
import { PartialResult } from "./PartialResult";
import styles from "./DaruGame.module.css";

const ACTIVE_PHASES: GamePhase[] = ["preview", "flipping", "ready", "playing", "time-over"];
const LAST_PAIR_FEEDBACK_MS = 1800;
type SaveStatus = "idle" | "saving" | "saved" | "failed";

export function DaruGame() {
  const { theme } = useTheme();
  const { cue } = useDaru();
  const mismatchTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const sequenceTimerRef = useRef<number | null>(null);
  const completionTimerRef = useRef<number | null>(null);
  const hintTimerRef = useRef<number | null>(null);
  const hintIntervalRef = useRef<number | null>(null);
  const completionAnnouncedRef = useRef(false);
  const submitInProgressRef = useRef(false);
  const runIdRef = useRef<string | null>(null);
  const startPendingRef = useRef(false);
  const lastPairCueShownRef = useRef(false);
  const phaseRef = useRef<GamePhase>("lobby");
  const [phase, setPhaseState] = useState<GamePhase>("lobby");
  const [difficulty, setDifficulty] = useState<GameDifficulty | null>(null);
  const [cards, setCards] = useState<GameCard[]>([]);
  const [flippedIds, setFlippedIds] = useState<string[]>([]);
  const [matchedPairIds, setMatchedPairIds] = useState<string[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [daruPoints, setDaruPoints] = useState(0);
  const [feedback, setFeedback] = useState<MatchFeedbackData | null>(null);
  const [metrics, setMetrics] = useState<DetectionMetrics | null>(null);
  const [rank, setRank] = useState<GameRank>("C");
  const [newBest, setNewBest] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [locked, setLocked] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(1);
  const [readyCue, setReadyCue] = useState<"READY" | "GO!" | null>(null);
  const [hintsRemaining, setHintsRemaining] = useState(0);
  const [hintActive, setHintActive] = useState(false);
  const [hintRemainingSeconds, setHintRemainingSeconds] = useState(0);
  const [hintProgress, setHintProgress] = useState(0);
  const [withinTimeLimit, setWithinTimeLimit] = useState(true);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [leaderboardRank, setLeaderboardRank] = useState<number | null>(null);
  const [personalBestPower, setPersonalBestPower] = useState<number | null>(null);
  const [previousBestPower, setPreviousBestPower] = useState<number | null>(null);
  const [bestRecords, setBestRecords] = useState<Partial<Record<GameDifficulty, GameRecord>>>({});
  const [recordStatus, setRecordStatus] = useState<SaveStatus>("idle");
  const [startPending, setStartPending] = useState(false);
  const [leaderboardRefresh, setLeaderboardRefresh] = useState(0);

  const setPhase = useCallback((next: GamePhase) => { phaseRef.current = next; setPhaseState(next); }, []);
  useEffect(() => { void getCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null)).finally(() => setAuthResolved(true)); }, []);
  useEffect(() => {
    if (currentUser?.role !== "USER") return;
    const controller = new AbortController();
    void getDaruGameRecords(controller.signal).then((records) => {
      const next: Partial<Record<GameDifficulty, GameRecord>> = {};
      for (const record of records) next[record.difficulty.toLowerCase() as GameDifficulty] = record;
      setBestRecords(next);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [currentUser]);
  useEffect(() => { Object.values(DARU_MEMORY_GUIDE_ASSETS).forEach((src) => { const image = new window.Image(); image.src = src; }); }, []);
  const clearSequenceTimer = useCallback(() => { if (sequenceTimerRef.current !== null) window.clearTimeout(sequenceTimerRef.current); sequenceTimerRef.current = null; }, []);
  const clearMismatchTimer = useCallback(() => { if (mismatchTimerRef.current !== null) window.clearTimeout(mismatchTimerRef.current); mismatchTimerRef.current = null; }, []);
  const clearFeedbackTimer = useCallback(() => { if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current); feedbackTimerRef.current = null; }, []);
  const clearCompletionTimer = useCallback(() => { if (completionTimerRef.current !== null) window.clearTimeout(completionTimerRef.current); completionTimerRef.current = null; }, []);
  const clearHintTimer = useCallback(() => {
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    if (hintIntervalRef.current !== null) window.clearInterval(hintIntervalRef.current);
    hintTimerRef.current = null; hintIntervalRef.current = null; setHintActive(false); setHintRemainingSeconds(0); setHintProgress(0);
  }, []);
  const beginFlipping = useCallback(() => { if (phaseRef.current !== "preview") return; clearSequenceTimer(); setPhase("flipping"); }, [clearSequenceTimer, setPhase]);
  const resetState = useCallback((nextDifficulty?: GameDifficulty) => {
    clearMismatchTimer(); clearFeedbackTimer(); clearSequenceTimer(); clearCompletionTimer(); clearHintTimer();
    completionAnnouncedRef.current = false; submitInProgressRef.current = false; lastPairCueShownRef.current = false;
    setFlippedIds([]); setMatchedPairIds([]); setAttempts(0); setCombo(0); setMaxCombo(0); setDaruPoints(0); setFeedback(null); setMetrics(null); setRank("C"); setNewBest(false); setElapsedSeconds(0); setStartedAt(0); setLocked(false); setPreviewProgress(1); setReadyCue(null); setWithinTimeLimit(true); setLeaderboardRank(null); setPersonalBestPower(null); setPreviousBestPower(null); setRecordStatus("idle");
    if (nextDifficulty) { const config = DIFFICULTY_CONFIG[nextDifficulty]; setTimeRemaining(config.timeLimitSeconds); setHintsRemaining(config.hintCount); }
    else { setTimeRemaining(0); setHintsRemaining(0); }
  }, [clearCompletionTimer, clearFeedbackTimer, clearHintTimer, clearMismatchTimer, clearSequenceTimer]);
  const startGame = useCallback(async (nextDifficulty: GameDifficulty) => {
    if (!authResolved || startPendingRef.current) return;
    startPendingRef.current = true; setStartPending(true);
    let runId: string | null = null; let runFailed = false;
    try {
      if (currentUser?.role === "USER") {
        try { runId = (await createDaruGameRun(DIFFICULTY_CONFIG[nextDifficulty].key)).run_id; }
        catch { runFailed = true; }
      }
      resetState(nextDifficulty); const record = bestRecords[nextDifficulty]; setPreviousBestPower(record?.best_attempts == null ? null : record.best_detection_power); runIdRef.current = runId;
      if (runFailed) setRecordStatus("failed");
      setDifficulty(nextDifficulty); setCards(createGameDeck(nextDifficulty)); setPhase("preview");
    } finally {
      startPendingRef.current = false; setStartPending(false);
    }
  }, [authResolved, bestRecords, currentUser, resetState, setPhase]);
  const chooseDifficulty = useCallback(() => { if (startPendingRef.current) return; resetState(); runIdRef.current = null; setDifficulty(null); setCards([]); setPhase("lobby"); }, [resetState, setPhase]);

  useEffect(() => {
    if (phase !== "preview" || !difficulty) return;
    const duration = DIFFICULTY_CONFIG[difficulty].previewSeconds * 1000; const deadline = performance.now() + duration;
    const progressTimer = window.setInterval(() => setPreviewProgress(Math.max(0, (deadline - performance.now()) / duration)), 50);
    sequenceTimerRef.current = window.setTimeout(beginFlipping, duration);
    return () => { window.clearInterval(progressTimer); clearSequenceTimer(); };
  }, [beginFlipping, clearSequenceTimer, difficulty, phase]);
  useEffect(() => {
    if (phase === "flipping") { sequenceTimerRef.current = window.setTimeout(() => { setReadyCue("READY"); setPhase("ready"); }, 650); return clearSequenceTimer; }
    if (phase === "ready") { sequenceTimerRef.current = window.setTimeout(() => { setReadyCue("GO!"); setStartedAt(Date.now()); setPhase("playing"); }, 700); return clearSequenceTimer; }
    if (phase === "playing" && readyCue === "GO!") { sequenceTimerRef.current = window.setTimeout(() => setReadyCue(null), 500); return clearSequenceTimer; }
  }, [clearSequenceTimer, phase, readyCue, setPhase]);
  useEffect(() => {
    if (phase !== "playing" || startedAt === 0 || !difficulty) return;
    const update = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000); setElapsedSeconds(elapsed);
      if (withinTimeLimit) { const remaining = Math.max(0, DIFFICULTY_CONFIG[difficulty].timeLimitSeconds - elapsed); setTimeRemaining(remaining); if (remaining === 0) { clearHintTimer(); setWithinTimeLimit(false); setPhase("time-over"); } }
    };
    update(); const timer = window.setInterval(update, 250); return () => window.clearInterval(timer);
  }, [clearHintTimer, difficulty, phase, setPhase, startedAt, withinTimeLimit]);
  useEffect(() => {
    if (!ACTIVE_PHASES.includes(phase)) return;
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; };
  }, [phase]);

  const useHint = () => {
    if (!difficulty || phase !== "playing" || hintActive || hintsRemaining <= 0) return;
    const duration = DIFFICULTY_CONFIG[difficulty].hintRevealSeconds; const deadline = performance.now() + duration * 1000;
    setHintsRemaining((value) => value - 1); setFlippedIds([]); setHintActive(true); setHintRemainingSeconds(duration); setHintProgress(1);
    hintIntervalRef.current = window.setInterval(() => { const remainingMs = Math.max(0, deadline - performance.now()); setHintRemainingSeconds(Math.max(1, Math.ceil(remainingMs / 1000))); setHintProgress(remainingMs / (duration * 1000)); }, 100);
    hintTimerRef.current = window.setTimeout(clearHintTimer, duration * 1000);
  };
  const submitResult = useCallback((completed: boolean, eligible: boolean, finalElapsed: number, finalPoints: number) => {
    if (currentUser?.role !== "USER" || submitInProgressRef.current || !difficulty) return;
    const runId = runIdRef.current;
    if (!runId) { setRecordStatus("failed"); return; }
    submitInProgressRef.current = true; setRecordStatus("saving");
    void submitDaruGameResult({ run_id: runId, difficulty: DIFFICULTY_CONFIG[difficulty].key, completed, within_time_limit: eligible, matched_pairs: matchedPairIds.length, attempts, elapsed_seconds: finalElapsed, max_combo: maxCombo, hints_used: DIFFICULTY_CONFIG[difficulty].hintCount - hintsRemaining, earned_daru_points: finalPoints }).then((response) => { setNewBest(response.is_new_best); setLeaderboardRank(response.leaderboard_rank); setPersonalBestPower(response.record.best_detection_power); setBestRecords((records) => ({ ...records, [difficulty]: response.record })); setRecordStatus("saved"); if (response.is_new_best) setLeaderboardRefresh((value) => value + 1); }).catch(() => setRecordStatus("failed"));
  }, [attempts, currentUser, difficulty, hintsRemaining, matchedPairIds.length, maxCombo]);
  useEffect(() => {
    if (phase !== "playing" || !difficulty || matchedPairIds.length !== DIFFICULTY_CONFIG[difficulty].pairCount || completionAnnouncedRef.current) return;
    completionAnnouncedRef.current = true; clearHintTimer(); clearFeedbackTimer(); const finalElapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    const finalMetrics = calculateDetectionMetricsWithEligibility(difficulty, finalElapsed, attempts, maxCombo, withinTimeLimit);
    const storedBest = Number.parseInt(localStorage.getItem(BEST_RECORD_STORAGE_KEYS[difficulty]) ?? "-1", 10); const guestBest = withinTimeLimit && (!Number.isFinite(storedBest) || finalMetrics.detectionPower > storedBest);
    const guestPreviousBest = !currentUser && Number.isFinite(storedBest) && storedBest >= 0 ? storedBest : null;
    if (!currentUser && guestBest) localStorage.setItem(BEST_RECORD_STORAGE_KEYS[difficulty], String(finalMetrics.detectionPower));
    const finalPoints = daruPoints + DIFFICULTY_CONFIG[difficulty].clearBonus;
    setElapsedSeconds(finalElapsed); setDaruPoints(finalPoints); setMetrics(finalMetrics); setRank(getGameRank(finalMetrics.detectionPower)); setNewBest(!currentUser && guestBest); setFeedback(null);
    completionTimerRef.current = window.setTimeout(() => { completionTimerRef.current = null; if (!currentUser) setPreviousBestPower(guestPreviousBest); setPhase("finished"); cue("happy", { source: "direct" }); submitResult(true, withinTimeLimit, finalElapsed, finalPoints); }, 380);
  }, [attempts, clearFeedbackTimer, clearHintTimer, cue, currentUser, daruPoints, difficulty, matchedPairIds.length, maxCombo, phase, setPhase, startedAt, submitResult, withinTimeLimit]);
  const finishPartial = () => { clearHintTimer(); const finalElapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000)); setElapsedSeconds(finalElapsed); setPhase("partial"); submitResult(false, false, finalElapsed, daruPoints); };
  const handleFlip = (card: GameCard) => {
    if (phase !== "playing" || locked || hintActive || matchedPairIds.includes(card.pairId) || flippedIds.includes(card.id) || flippedIds.length >= 2) return;
    if (flippedIds.length === 0) { setFlippedIds([card.id]); return; }
    const firstCard = cards.find((candidate) => candidate.id === flippedIds[0]); if (!firstCard) { setFlippedIds([card.id]); return; }
    setAttempts((current) => current + 1); setFlippedIds([firstCard.id, card.id]);
    if (firstCard.pairId === card.pairId) {
      const nextCombo = combo + 1; const reward = calculatePairPoints(nextCombo); const remaining = DIFFICULTY_CONFIG[difficulty!].pairCount - matchedPairIds.length - 1;
      setMatchedPairIds((current) => [...current, card.pairId]); setCombo(nextCombo); setMaxCombo((current) => Math.max(current, nextCombo)); setDaruPoints((current) => current + reward.total); clearFeedbackTimer();
      if (remaining > 0 && (remaining !== 1 || !lastPairCueShownRef.current)) { const isLastPair = remaining === 1; const message: MatchFeedbackData["message"] = isLastPair ? "거의 다 찾았어!" : nextCombo >= 3 ? "감 잡았네!" : nextCombo === 2 ? "좋은데!" : "찾았다!"; if (isLastPair) lastPairCueShownRef.current = true; setFeedback({ id: Date.now(), message, combo: nextCombo, points: reward.total, remainingPairs: remaining }); feedbackTimerRef.current = window.setTimeout(() => { setFeedback(null); feedbackTimerRef.current = null; }, isLastPair ? LAST_PAIR_FEEDBACK_MS : 1100); }
      setFlippedIds([]); return;
    }
    setCombo(0); setLocked(true); mismatchTimerRef.current = window.setTimeout(() => { setFlippedIds([]); setLocked(false); mismatchTimerRef.current = null; }, MISMATCH_REVEAL_MS);
  };
  const viewLeaderboard = () => { if (startPendingRef.current) return; chooseDifficulty(); window.setTimeout(() => document.getElementById("daru-leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); };
  useEffect(() => () => { clearMismatchTimer(); clearFeedbackTimer(); clearSequenceTimer(); clearCompletionTimer(); clearHintTimer(); }, [clearCompletionTimer, clearFeedbackTimer, clearHintTimer, clearMismatchTimer, clearSequenceTimer]);

  if (phase === "lobby" || !difficulty) return <><DifficultySelector onSelect={startGame} startDisabled={!authResolved} startPending={startPending} />{authResolved && currentUser?.role === "USER" && <DaruLeaderboard refreshKey={leaderboardRefresh} />}</>;
  const hintsUsed = DIFFICULTY_CONFIG[difficulty].hintCount - hintsRemaining;
  const previewSecondsRemaining = Math.max(1, Math.ceil(previewProgress * DIFFICULTY_CONFIG[difficulty].previewSeconds));
  return <section className={styles.game} data-phase={phase} aria-labelledby="active-game-title">
    <header className={styles.gameHeader}><div><span>{DIFFICULTY_CONFIG[difficulty].label}</span><h1 id="active-game-title">다루 카드 찾기</h1></div><button className={styles.changeButton} type="button" onClick={chooseDifficulty}>나가기</button></header>
    <GameStatus timeRemaining={timeRemaining} attempts={attempts} foundPairs={matchedPairIds.length} pairCount={DIFFICULTY_CONFIG[difficulty].pairCount} combo={combo} daruPoints={daruPoints} hintsRemaining={hintsRemaining} hintActive={hintActive} onHint={useHint} />
    {hintActive && <div className={styles.hintProgress} role="status" aria-live="polite"><span>💡 카드를 잘 기억해둬! <b>{hintRemainingSeconds}초</b></span><progress max="1" value={hintProgress} aria-label={`힌트 공개 ${hintRemainingSeconds}초 남음`} /></div>}
    {phase === "preview" && <div className={styles.memoryGuide}>
      <div className={styles.memoryGuideDaru}><Image key={theme} src={DARU_MEMORY_GUIDE_ASSETS[theme]} alt="돋보기로 카드를 살펴보는 다루" fill sizes="(max-width: 720px) 58px, 76px" priority unoptimized /></div>
      <div className={styles.memoryGuideCopy}><strong>카드를 잘 기억해둬!</strong><span>잠시 후 카드가 뒤집혀요.</span></div>
      <div className={styles.memoryGuideActions}><span className={styles.memoryCountdown} aria-label={`기억 시간 ${previewSecondsRemaining}초 남음`}>{String(previewSecondsRemaining).padStart(2, "0")}초</span><button className="button button-primary" type="button" onClick={beginFlipping}>바로 시작</button></div>
      <progress className={styles.memoryProgress} max={1} value={previewProgress} aria-label="카드 기억 시간 진행률" />
    </div>}
    <div className={styles.boardStage} data-complete={phase === "finished" || phase === "partial" || undefined} data-dimmed={phase === "time-over" || undefined}>
      <MemoryBoard cards={cards} difficulty={difficulty} theme={theme} phase={phase} flippedIds={flippedIds} matchedPairIds={matchedPairIds} locked={locked} hintActive={hintActive} onFlip={handleFlip} />
      {feedback && <DaruMatchFeedback feedback={feedback} />}
      {phase === "flipping" && <div className={styles.waveCue} aria-live="polite"><span>그럼, 시작해볼까?</span><i aria-hidden="true" /></div>}
      {readyCue && <div className={styles.readyCue} aria-live="assertive">{readyCue}</div>}
    </div>
    {phase === "time-over" && <TimeOverDialog onContinue={() => setPhase("playing")} onFinish={finishPartial} />}
    {phase === "finished" && metrics && <GameResult rank={rank} metrics={metrics} daruPoints={daruPoints} elapsedSeconds={elapsedSeconds} attempts={attempts} maxCombo={maxCombo} hintsUsed={hintsUsed} withinTimeLimit={withinTimeLimit} newBest={newBest} leaderboardRank={leaderboardRank} personalBestPower={personalBestPower} previousBestPower={previousBestPower} recordStatus={currentUser?.role === "USER" ? recordStatus : currentUser?.role === "ADMIN" ? "admin" : "guest"} difficultyLabel={DIFFICULTY_CONFIG[difficulty].label} onRestart={() => startGame(difficulty)} onChangeDifficulty={chooseDifficulty} onViewLeaderboard={currentUser?.role === "USER" && withinTimeLimit ? viewLeaderboard : undefined} startPending={startPending} />}
    {phase === "partial" && <PartialResult matchedPairs={matchedPairIds.length} pairCount={DIFFICULTY_CONFIG[difficulty].pairCount} maxCombo={maxCombo} daruPoints={daruPoints} elapsedSeconds={elapsedSeconds} recordStatus={currentUser?.role === "USER" ? recordStatus : currentUser?.role === "ADMIN" ? "admin" : "guest"} onRestart={() => startGame(difficulty)} onChangeDifficulty={chooseDifficulty} startPending={startPending} />}
  </section>;
}
