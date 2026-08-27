"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useDaru } from "@/components/mascot";
import { getCurrentUser, type AuthUser } from "@/lib/authApi";
import { AUTH_CHANGED_EVENT } from "@/lib/authEvents";
import { clearDaruActiveRun, loadDaruActiveRun, storeDaruActiveRun } from "@/lib/daruActiveRun";
import { createDaruGameRun, DaruGameApiError, flipDaruGameCard, getDaruGameRecords, getDaruGameRunPreview, getDaruGameRunState, requestDaruGameHint, startDaruGameRun, submitDaruGameResult, type GameRecord, type ServerGameMetrics, type ServerGameResult, type ServerRunState } from "@/lib/daruGameApi";
import { terminalRunRecoveryReason } from "@/lib/daruRunRecovery";
import { DARU_CARD_BACK_ASSETS, DARU_MEMORY_GUIDE_ASSETS, DIFFICULTY_CONFIG, MISMATCH_REVEAL_MS } from "./game.config";
import { BEST_RECORD_STORAGE_KEYS, resolveGuestBest } from "./game.storage";
import { CARD_CATALOG, getCardThemeImages } from "./card.catalog";
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

function hiddenServerCards(positions: number[]): GameCard[] {
  return positions.map((position) => ({ id: `server-${position}`, pairId: `hidden-${position}`, kind: "daru", image: DARU_CARD_BACK_ASSETS.day, label: "숨겨진 카드", themeImages: DARU_CARD_BACK_ASSETS }));
}

function revealServerCard(cards: GameCard[], position: number, cardId: string): GameCard[] {
  const catalog = CARD_CATALOG.find((card) => card.id === cardId);
  if (!catalog) throw new Error(`Unknown server card: ${cardId}`);
  return cards.map((card, index) => index === position ? { ...card, pairId: cardId, kind: catalog.kind, image: getCardThemeImages(catalog).day, label: catalog.label, themeImages: getCardThemeImages(catalog) } : card);
}

function previewServerCards(positions: number[], revealed: { position: number; card_id: string }[]): GameCard[] {
  return revealed.reduce((cards, card) => revealServerCard(cards, card.position, card.card_id), hiddenServerCards(positions));
}

function responseMetrics(metrics: ServerGameMetrics): DetectionMetrics {
  return { memoryAccuracy: metrics.memory_accuracy, speedScore: metrics.speed_score, comboScore: metrics.combo_score, hintScore: metrics.hint_score, detectionPower: metrics.detection_power };
}

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
  const actionPendingRef = useRef(false);
  const lastPairCueShownRef = useRef(false);
  const phaseRef = useRef<GamePhase>("lobby");
  const resumeAttemptedRef = useRef(false);
  const authExpiredRef = useRef(false);
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
  const [authExpired, setAuthExpired] = useState(false);
  const [previewRetry, setPreviewRetry] = useState<{ runId: string; difficulty: GameDifficulty } | null>(null);
  const [runRecoveryNotice, setRunRecoveryNotice] = useState<string | null>(null);

  const setPhase = useCallback((next: GamePhase) => { phaseRef.current = next; setPhaseState(next); }, []);
  useEffect(() => { void getCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null)).finally(() => setAuthResolved(true)); }, []);
  useEffect(() => {
    const syncAuth = (event: Event) => {
      const user = (event as CustomEvent<AuthUser | null>).detail;
      setCurrentUser(user);
      setAuthResolved(true);
      authExpiredRef.current = !user && (Boolean(runIdRef.current) || startPendingRef.current || authExpiredRef.current);
      setAuthExpired(authExpiredRef.current);
      if (authExpiredRef.current) setLocked(true);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, syncAuth);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, syncAuth);
  }, []);
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
  const beginFlipping = useCallback(() => {
    if (phaseRef.current !== "preview") return;
    clearSequenceTimer();
    if (runIdRef.current) setCards((current) => hiddenServerCards(current.map((_card, position) => position)));
    setPhase("flipping");
  }, [clearSequenceTimer, setPhase]);
  const resetState = useCallback((nextDifficulty?: GameDifficulty) => {
    clearMismatchTimer(); clearFeedbackTimer(); clearSequenceTimer(); clearCompletionTimer(); clearHintTimer();
    completionAnnouncedRef.current = false; submitInProgressRef.current = false; lastPairCueShownRef.current = false;
    authExpiredRef.current = false; setFlippedIds([]); setMatchedPairIds([]); setAttempts(0); setCombo(0); setMaxCombo(0); setDaruPoints(0); setFeedback(null); setMetrics(null); setRank("C"); setNewBest(false); setElapsedSeconds(0); setStartedAt(0); setLocked(false); setPreviewProgress(1); setReadyCue(null); setWithinTimeLimit(true); setLeaderboardRank(null); setPersonalBestPower(null); setPreviousBestPower(null); setRecordStatus("idle"); setAuthExpired(false); setPreviewRetry(null);
    if (nextDifficulty) { const config = DIFFICULTY_CONFIG[nextDifficulty]; setTimeRemaining(config.timeLimitSeconds); setHintsRemaining(config.hintCount); }
    else { setTimeRemaining(0); setHintsRemaining(0); }
  }, [clearCompletionTimer, clearFeedbackTimer, clearHintTimer, clearMismatchTimer, clearSequenceTimer]);
  const handleTerminalRunError = useCallback((error: unknown) => {
    const reason = terminalRunRecoveryReason(error);
    if (!reason) return false;
    resetState(); clearDaruActiveRun(); runIdRef.current = null; setDifficulty(null); setCards([]); setPhase("lobby");
    setRunRecoveryNotice(reason === "expired"
      ? "이전 게임 시간이 만료되어 새 게임으로 시작할 수 있어요."
      : "이전 게임은 카드 구성이 변경되어 새 게임으로 시작해야 해요.");
    return true;
  }, [resetState, setPhase]);
  const startGame = useCallback(async (nextDifficulty: GameDifficulty) => {
    if (!authResolved || startPendingRef.current || authExpiredRef.current) return;
    setRunRecoveryNotice(null);
    startPendingRef.current = true; setStartPending(true);
    let runId: string | null = null;
    try {
      if (currentUser?.role === "USER") {
        try {
          const response = await createDaruGameRun(DIFFICULTY_CONFIG[nextDifficulty].key);
          runId = response.run_id; storeDaruActiveRun({ runId, difficulty: response.difficulty }); runIdRef.current = runId;
          const preview = await getDaruGameRunPreview(runId);
          setCards(previewServerCards(response.positions, preview.cards)); setPreviewRetry(null);
        }
        catch (error) {
          if (handleTerminalRunError(error)) return;
          setRecordStatus("failed");
          if (runId) setPreviewRetry({ runId, difficulty: nextDifficulty });
          if (error instanceof DaruGameApiError && error.status === 401) { authExpiredRef.current = true; setAuthExpired(true); }
          return;
        }
      }
      resetState(nextDifficulty); const record = bestRecords[nextDifficulty]; setPreviousBestPower(record?.score_version !== 2 || record.best_attempts == null ? null : record.best_detection_power); runIdRef.current = runId;
      setDifficulty(nextDifficulty); if (currentUser?.role !== "USER" || !runId) setCards(createGameDeck(nextDifficulty)); setPhase("preview");
    } finally {
      startPendingRef.current = false; setStartPending(false);
    }
  }, [authResolved, bestRecords, currentUser, handleTerminalRunError, resetState, setPhase]);
  const retryPreview = useCallback(async () => {
    if (!previewRetry || startPendingRef.current) return;
    startPendingRef.current = true; setStartPending(true);
    try {
      const state = await getDaruGameRunState(previewRetry.runId);
      if (state.status !== "CREATED") throw new DaruGameApiError(409);
      const preview = await getDaruGameRunPreview(previewRetry.runId);
      resetState(previewRetry.difficulty); runIdRef.current = previewRetry.runId; setDifficulty(previewRetry.difficulty);
      setCards(previewServerCards(state.positions, preview.cards)); setPhase("preview");
    } catch (error) {
      if (handleTerminalRunError(error)) return;
      setRecordStatus("failed");
      if (error instanceof DaruGameApiError && error.status === 401) { authExpiredRef.current = true; setAuthExpired(true); }
    } finally { startPendingRef.current = false; setStartPending(false); }
  }, [handleTerminalRunError, previewRetry, resetState, setPhase]);
  const chooseDifficulty = useCallback(() => { if (startPendingRef.current || submitInProgressRef.current || (completionAnnouncedRef.current && Boolean(runIdRef.current))) return; resetState(); clearDaruActiveRun(); runIdRef.current = null; setDifficulty(null); setCards([]); setPhase("lobby"); }, [resetState, setPhase]);

  useEffect(() => {
    if (phase !== "preview" || !difficulty) return;
    const duration = DIFFICULTY_CONFIG[difficulty].previewSeconds * 1000; const deadline = performance.now() + duration;
    const progressTimer = window.setInterval(() => setPreviewProgress(Math.max(0, (deadline - performance.now()) / duration)), 50);
    sequenceTimerRef.current = window.setTimeout(beginFlipping, duration);
    return () => { window.clearInterval(progressTimer); clearSequenceTimer(); };
  }, [beginFlipping, clearSequenceTimer, difficulty, phase]);
  useEffect(() => {
    if (phase === "flipping") { sequenceTimerRef.current = window.setTimeout(() => { setReadyCue("READY"); setPhase("ready"); }, 650); return clearSequenceTimer; }
    if (phase === "ready") { sequenceTimerRef.current = window.setTimeout(() => { void (async () => { const runId = runIdRef.current; let authoritativeStart: number | null = null; if (currentUser?.role === "USER" && runId) { try { const response = await startDaruGameRun(runId); authoritativeStart = new Date(response.play_started_at).getTime(); } catch (error) { if (handleTerminalRunError(error)) return; try { const state = await getDaruGameRunState(runId); if (!state.play_started_at) throw new Error("Run did not start"); authoritativeStart = new Date(state.play_started_at).getTime(); } catch (recoveryError) { if (!handleTerminalRunError(recoveryError)) setRecordStatus("failed"); return; } } } setReadyCue("GO!"); setStartedAt(authoritativeStart ?? Date.now()); setPhase("playing"); })(); }, 700); return clearSequenceTimer; }
    if (phase === "playing" && readyCue === "GO!") { sequenceTimerRef.current = window.setTimeout(() => setReadyCue(null), 500); return clearSequenceTimer; }
  }, [clearSequenceTimer, currentUser, handleTerminalRunError, phase, readyCue, setPhase]);
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

  const beginHintPresentation = (duration: number) => {
    const deadline = performance.now() + duration * 1000;
    setFlippedIds([]); setHintActive(true); setHintRemainingSeconds(duration); setHintProgress(1);
    hintIntervalRef.current = window.setInterval(() => { const remainingMs = Math.max(0, deadline - performance.now()); setHintRemainingSeconds(Math.max(1, Math.ceil(remainingMs / 1000))); setHintProgress(remainingMs / (duration * 1000)); }, 100);
    hintTimerRef.current = window.setTimeout(clearHintTimer, duration * 1000);
  };
  const applyCompletionResult = useCallback((response: ServerGameResult, nextDifficulty: GameDifficulty) => {
    const authoritative = response.metrics;
    submitInProgressRef.current = false; clearDaruActiveRun(); runIdRef.current = null; authExpiredRef.current = false; setAuthExpired(false); setLocked(false); setMetrics(responseMetrics(authoritative)); setRank(getGameRank(authoritative.detection_power)); setAttempts(authoritative.attempts); setMaxCombo(authoritative.max_combo); setHintsRemaining(DIFFICULTY_CONFIG[nextDifficulty].hintCount - authoritative.hints_used); setElapsedSeconds(authoritative.elapsed_seconds); setDaruPoints(authoritative.earned_daru_points); setWithinTimeLimit(authoritative.within_time_limit); setNewBest(response.is_new_best); setLeaderboardRank(response.leaderboard_rank); setPersonalBestPower(response.record.best_detection_power); setBestRecords((records) => ({ ...records, [nextDifficulty]: response.record })); setRecordStatus("saved"); setPhase(authoritative.completed ? "finished" : "partial"); if (response.is_new_best) setLeaderboardRefresh((value) => value + 1);
  }, [setPhase]);
  const applyRunState = useCallback((state: ServerRunState, nextDifficulty: GameDifficulty) => {
    const visibleByPosition = new Map(state.visible_cards.map((card) => [card.position, card.card_id]));
    setCards(state.positions.reduce((current, position) => { const cardId = visibleByPosition.get(position); return cardId ? revealServerCard(current, position, cardId) : current; }, hiddenServerCards(state.positions)));
    setAttempts(state.attempts); setCombo(state.current_combo); setMaxCombo(state.max_combo); setDaruPoints(state.earned_daru_points); setHintsRemaining(DIFFICULTY_CONFIG[nextDifficulty].hintCount - state.hints_used);
    const matchedIds = [...new Set(state.matched_positions.map((position) => visibleByPosition.get(position)).filter((value): value is string => Boolean(value)))];
    setMatchedPairIds(matchedIds); setFlippedIds(state.first_position === null ? [] : [`server-${state.first_position}`]);
    if (state.play_started_at) {
      const elapsedAtResponse = Math.max(0, new Date(state.server_now).getTime() - new Date(state.play_started_at).getTime());
      setStartedAt(Date.now() - elapsedAtResponse);
    }
    if (state.completion_result) applyCompletionResult(state.completion_result, nextDifficulty);
    else if (state.status === "PLAYING") setPhase("playing");
  }, [applyCompletionResult, setPhase]);
  const recoverRunState = useCallback(async (runId: string, nextDifficulty: GameDifficulty) => {
    try {
      const state = await getDaruGameRunState(runId); applyRunState(state, nextDifficulty); return state;
    } catch (error) {
      if (handleTerminalRunError(error)) return null;
      throw error;
    }
  }, [applyRunState, handleTerminalRunError]);
  useEffect(() => {
    if (!authResolved || currentUser?.role !== "USER" || resumeAttemptedRef.current || phaseRef.current !== "lobby") return;
    resumeAttemptedRef.current = true;
    const stored = loadDaruActiveRun();
    if (!stored) return;
    const nextDifficulty = stored.difficulty.toLowerCase() as GameDifficulty;
    void getDaruGameRunState(stored.runId).then(async (state) => {
      resetState(nextDifficulty); runIdRef.current = stored.runId; setDifficulty(nextDifficulty); setAuthExpired(false);
      if (state.status === "CREATED") {
        const preview = await getDaruGameRunPreview(stored.runId);
        setCards(previewServerCards(state.positions, preview.cards)); setPhase("preview");
      } else applyRunState(state, nextDifficulty);
    }).catch((error) => {
      if (handleTerminalRunError(error)) return;
      else if (error instanceof DaruGameApiError && error.status === 404) { clearDaruActiveRun(); runIdRef.current = null; }
      else { runIdRef.current = stored.runId; setRecordStatus("failed"); setPreviewRetry({ runId: stored.runId, difficulty: nextDifficulty }); }
    });
  }, [applyRunState, authResolved, currentUser, handleTerminalRunError, resetState, setPhase]);
  const useHint = () => {
    if (!difficulty || phase !== "playing" || locked || hintActive || hintsRemaining <= 0) return;
    const duration = DIFFICULTY_CONFIG[difficulty].hintRevealSeconds;
    const runId = runIdRef.current;
    if (runId) {
      if (actionPendingRef.current) return;
      actionPendingRef.current = true; setLocked(true);
      void requestDaruGameHint(runId).then((response) => { setCards((current) => response.cards.reduce((next, card) => revealServerCard(next, card.position, card.card_id), current)); setHintsRemaining(response.hints_remaining); beginHintPresentation(duration); }).catch(async () => { try { await recoverRunState(runId, difficulty); } catch { setRecordStatus("failed"); } }).finally(() => { actionPendingRef.current = false; setLocked(authExpiredRef.current); });
      return;
    }
    setHintsRemaining((value) => value - 1); beginHintPresentation(duration);
  };
  const submitResult = useCallback((finishPartial = false) => {
    if (submitInProgressRef.current || !difficulty) return;
    const runId = runIdRef.current;
    if (!runId) { setRecordStatus("failed"); return; }
    submitInProgressRef.current = true; setLocked(true); setRecordStatus("saving");
    void submitDaruGameResult({ run_id: runId, finish_partial: finishPartial }).then((response) => applyCompletionResult(response, difficulty)).catch(async () => { try { const state = await recoverRunState(runId, difficulty); if (state && !state.completion_result) { submitInProgressRef.current = false; setLocked(true); setRecordStatus("failed"); } } catch { submitInProgressRef.current = false; setLocked(true); setRecordStatus("failed"); } });
  }, [applyCompletionResult, difficulty, recoverRunState]);
  useEffect(() => {
    if (phase !== "playing" || !difficulty || matchedPairIds.length !== DIFFICULTY_CONFIG[difficulty].pairCount || completionAnnouncedRef.current) return;
    completionAnnouncedRef.current = true; clearHintTimer(); clearFeedbackTimer(); const finalElapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    const isServerGame = Boolean(runIdRef.current);
    if (isServerGame) {
      setLocked(true); setFeedback(null); setRecordStatus("saving");
      completionTimerRef.current = window.setTimeout(() => { completionTimerRef.current = null; submitResult(false); }, 380);
      return;
    }
    const hintsUsed = DIFFICULTY_CONFIG[difficulty].hintCount - hintsRemaining;
    const finalMetrics = calculateDetectionMetricsWithEligibility(difficulty, finalElapsed, attempts, maxCombo, hintsUsed, withinTimeLimit);
    const guestBestResult = resolveGuestBest(localStorage.getItem(BEST_RECORD_STORAGE_KEYS[difficulty]), finalMetrics.detectionPower, !isServerGame);
    const guestBest = guestBestResult.isNewBest;
    const guestPreviousBest = !isServerGame ? guestBestResult.previousBest : null;
    if (!isServerGame && guestBest) localStorage.setItem(BEST_RECORD_STORAGE_KEYS[difficulty], String(finalMetrics.detectionPower));
    const finalPoints = daruPoints + DIFFICULTY_CONFIG[difficulty].clearBonus;
    setElapsedSeconds(finalElapsed); setDaruPoints(finalPoints); setMetrics(finalMetrics); setRank(getGameRank(finalMetrics.detectionPower)); setNewBest(!isServerGame && guestBest); setFeedback(null);
    completionTimerRef.current = window.setTimeout(() => { completionTimerRef.current = null; setPreviousBestPower(guestPreviousBest); setPhase("finished"); cue("happy", { source: "direct" }); }, 380);
  }, [attempts, clearFeedbackTimer, clearHintTimer, cue, daruPoints, difficulty, hintsRemaining, matchedPairIds.length, maxCombo, phase, setPhase, startedAt, submitResult, withinTimeLimit]);
  const finishPartial = () => {
    clearHintTimer();
    if (runIdRef.current) {
      submitResult(true);
      return;
    }
    const finalElapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    setElapsedSeconds(finalElapsed);
    setPhase("partial");
  };
  const handleFlip = (card: GameCard) => {
    if (phase !== "playing" || locked || hintActive || matchedPairIds.includes(card.pairId) || flippedIds.includes(card.id) || flippedIds.length >= 2) return;
    const runId = runIdRef.current;
    if (runId) {
      if (actionPendingRef.current) return;
      const position = cards.findIndex((candidate) => candidate.id === card.id);
      if (position < 0) return;
      let completionReached = false;
      actionPendingRef.current = true; setLocked(true);
      void flipDaruGameCard(runId, position).then((response) => {
        setCards((current) => revealServerCard(current, response.card.position, response.card.card_id));
        setAttempts(response.attempts); setCombo(response.current_combo); setMaxCombo(response.max_combo); setDaruPoints(response.earned_daru_points);
        if (response.matched === null) { setFlippedIds([card.id]); return; }
        const firstId = flippedIds[0]; setFlippedIds([firstId, card.id]);
        if (response.matched) {
          const remaining = DIFFICULTY_CONFIG[difficulty!].pairCount - response.matched_pairs;
          completionReached = remaining === 0;
          setMatchedPairIds((current) => [...current, response.card.card_id]); setFlippedIds([]); clearFeedbackTimer();
          if (remaining > 0 && (remaining !== 1 || !lastPairCueShownRef.current)) { const isLastPair = remaining === 1; const message: MatchFeedbackData["message"] = isLastPair ? "거의 다 찾았어!" : response.current_combo >= 3 ? "감 잡았네!" : response.current_combo === 2 ? "좋은데!" : "찾았다!"; if (isLastPair) lastPairCueShownRef.current = true; setFeedback({ id: Date.now(), message, combo: response.current_combo, points: response.points_awarded, remainingPairs: remaining }); feedbackTimerRef.current = window.setTimeout(() => { setFeedback(null); feedbackTimerRef.current = null; }, isLastPair ? LAST_PAIR_FEEDBACK_MS : 1100); }
          return;
        }
        mismatchTimerRef.current = window.setTimeout(() => { setFlippedIds([]); mismatchTimerRef.current = null; }, MISMATCH_REVEAL_MS);
      }).catch(async () => { try { await recoverRunState(runId, difficulty!); } catch { setRecordStatus("failed"); } }).finally(() => { actionPendingRef.current = false; setLocked(authExpiredRef.current || completionReached); });
      return;
    }
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
  const viewLeaderboard = () => { if (startPendingRef.current || submitInProgressRef.current) return; chooseDifficulty(); window.setTimeout(() => document.getElementById("daru-leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); };
  useEffect(() => () => { clearMismatchTimer(); clearFeedbackTimer(); clearSequenceTimer(); clearCompletionTimer(); clearHintTimer(); }, [clearCompletionTimer, clearFeedbackTimer, clearHintTimer, clearMismatchTimer, clearSequenceTimer]);

  if (phase === "lobby" || !difficulty) return <>{runRecoveryNotice && <p className={styles.authRecoveryNotice} role="status">{runRecoveryNotice}</p>}{authExpired && <p className={styles.authRecoveryNotice} role="alert">로그인 세션이 만료되었습니다. 게임을 시작하려면 <Link href="/login?next=%2Fdaru-game">다시 로그인</Link>해 주세요.</p>}{previewRetry && !authExpired && <p className={styles.authRecoveryNotice} role="alert">카드 미리보기를 불러오지 못했어요. <button type="button" onClick={() => void retryPreview()} disabled={startPending}>다시 시도</button></p>}<DifficultySelector onSelect={startGame} startDisabled={!authResolved || Boolean(previewRetry)} startPending={startPending} />{authResolved && currentUser?.role === "USER" && <DaruLeaderboard refreshKey={leaderboardRefresh} />}</>;
  const hintsUsed = DIFFICULTY_CONFIG[difficulty].hintCount - hintsRemaining;
  const previewSecondsRemaining = Math.max(1, Math.ceil(previewProgress * DIFFICULTY_CONFIG[difficulty].previewSeconds));
  return <section className={styles.game} data-phase={phase} aria-labelledby="active-game-title">
    <header className={styles.gameHeader}><div><span>{DIFFICULTY_CONFIG[difficulty].label}</span><h1 id="active-game-title">다루 카드 찾기</h1></div><button className={styles.changeButton} type="button" onClick={chooseDifficulty} disabled={currentUser?.role === "USER" && phase === "playing" && matchedPairIds.length === DIFFICULTY_CONFIG[difficulty].pairCount}>나가기</button></header>
    <div className={styles.memoryGuide} data-preview={phase === "preview" || undefined}>
      <div className={styles.memoryGuideDaru}><Image key={theme} src={DARU_MEMORY_GUIDE_ASSETS[theme]} alt="돋보기로 카드를 살펴보는 다루" fill sizes="(max-width: 720px) 58px, 76px" priority unoptimized /></div>
      <div className={styles.memoryGuideCopy}><span className={styles.guideEyebrow}>DARU MISSION GUIDE</span><strong>{phase === "preview" ? "카드를 잘 기억해둬!" : "좋아, 짝을 찾아볼까?"}</strong><span>{phase === "preview" ? "잠시 후 카드가 뒤집혀요." : "같은 그림의 카드를 찾아보세요."}</span>{phase === "preview" && <small className={styles.previewTip}>카드 위치를 기억해 같은 짝을 찾아보세요.</small>}</div>
      {phase === "preview" ? <div className={styles.memoryGuideActions}><span><small>기억 시간</small><b key={previewSecondsRemaining} className={styles.memoryCountdown} aria-label={`기억 시간 ${previewSecondsRemaining}초 남음`}>{String(previewSecondsRemaining).padStart(2, "0")}초</b></span><button className="button button-primary" type="button" onClick={beginFlipping}>바로 시작</button></div> : <span className={styles.missionLive}>MISSION</span>}
    </div>
    <GameStatus timeRemaining={timeRemaining} timeLimit={DIFFICULTY_CONFIG[difficulty].timeLimitSeconds} isPreview={phase === "preview"} attempts={attempts} foundPairs={matchedPairIds.length} pairCount={DIFFICULTY_CONFIG[difficulty].pairCount} combo={combo} daruPoints={daruPoints} hintsRemaining={hintsRemaining} hintActive={hintActive} onHint={useHint} />
    {authExpired && <p className={styles.authRecoveryNotice} role="alert">로그인 세션이 만료되었습니다. 진행 중인 게임은 안전하게 보관했어요. <Link href="/login?next=%2Fdaru-game">다시 로그인</Link></p>}
    {recordStatus === "saving" && <p className={styles.authRecoveryNotice} role="status">서버에서 결과를 확인하고 있어요…</p>}
    {recordStatus === "failed" && matchedPairIds.length === DIFFICULTY_CONFIG[difficulty].pairCount && <p className={styles.authRecoveryNotice} role="alert">결과 확인이 지연되고 있어요. <button type="button" onClick={() => submitResult(false)}>결과 다시 확인</button></p>}
    {hintActive && <div className={styles.hintProgress} role="status" aria-live="polite">
      <div className={styles.hintProgressDaru}><Image key={theme} src={DARU_MEMORY_GUIDE_ASSETS[theme]} alt="카드를 기억하도록 응원하는 다루" fill sizes="(max-width: 720px) 38px, 48px" unoptimized /></div>
      <div className={styles.hintProgressContent}><span>카드를 잘 기억해둬! <b>{hintRemainingSeconds}초</b></span><progress max="1" value={hintProgress} aria-label={`힌트 공개 ${hintRemainingSeconds}초 남음`} /></div>
    </div>}
    <div className={styles.boardStage} data-complete={phase === "finished" || phase === "partial" || undefined} data-dimmed={phase === "time-over" || undefined}>
      <MemoryBoard cards={cards} difficulty={difficulty} theme={theme} phase={phase} flippedIds={flippedIds} matchedPairIds={matchedPairIds} locked={locked} hintActive={hintActive} onFlip={handleFlip} />
      {feedback && <DaruMatchFeedback feedback={feedback} />}
      {phase === "flipping" && <div className={styles.waveCue} aria-live="polite"><span>그럼, 시작해볼까?</span><i aria-hidden="true" /></div>}
      {readyCue && <div className={styles.readyCue} aria-live="assertive">{readyCue}</div>}
    </div>
    {phase === "time-over" && recordStatus !== "saving" && <TimeOverDialog onContinue={() => setPhase("playing")} onFinish={finishPartial} />}
    {phase === "finished" && metrics && <GameResult rank={rank} metrics={metrics} daruPoints={daruPoints} elapsedSeconds={elapsedSeconds} attempts={attempts} maxCombo={maxCombo} hintsUsed={hintsUsed} withinTimeLimit={withinTimeLimit} newBest={newBest} leaderboardRank={leaderboardRank} personalBestPower={personalBestPower} previousBestPower={previousBestPower} recordStatus={currentUser?.role === "USER" ? recordStatus : currentUser?.role === "ADMIN" ? "admin" : "guest"} difficultyLabel={DIFFICULTY_CONFIG[difficulty].label} onRestart={() => startGame(difficulty)} onChangeDifficulty={chooseDifficulty} onViewLeaderboard={currentUser?.role === "USER" ? viewLeaderboard : undefined} startPending={startPending} />}
    {phase === "partial" && <PartialResult matchedPairs={matchedPairIds.length} pairCount={DIFFICULTY_CONFIG[difficulty].pairCount} maxCombo={maxCombo} daruPoints={daruPoints} elapsedSeconds={elapsedSeconds} recordStatus={currentUser?.role === "USER" ? recordStatus : currentUser?.role === "ADMIN" ? "admin" : "guest"} onRestart={() => startGame(difficulty)} onChangeDifficulty={chooseDifficulty} startPending={startPending} />}
  </section>;
}
