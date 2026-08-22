"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DaruLeaderboard } from "../DaruLeaderboard";
import { DaruMatchFeedback, type MatchFeedbackData } from "../DaruMatchFeedback";
import { GameResult } from "../GameResult";
import { GameStatus } from "../GameStatus";
import { MemoryBoard } from "../MemoryBoard";
import { PartialResult } from "../PartialResult";
import { TimeOverDialog } from "../TimeOverDialog";
import { calculatePairPoints, createGameDeck } from "../game.utils";
import type { DaruGameTheme, GameCard, GamePhase, GameRank, LeaderboardEntry } from "../game.types";
import gameStyles from "../DaruGame.module.css";
import styles from "./DaruMemoryDevLab.module.css";

type AuthPreview = "guest" | "user" | "admin";
type Preview = "game" | "match" | "hint" | "time-over" | "partial-result" | "result" | "ranking";
type MatchPreview = "normal" | "combo2" | "combo3" | "last";
type RankingPreview = "top" | "mine-top" | "mine-below" | "empty";
type ResultPreview = "normal" | "overtime";

const RANK_SCORES: Record<GameRank, number> = { S: 86, A: 72, B: 58, C: 43 };
const BASE_RANKING: LeaderboardEntry[] = [
  [1, "물결다루", 91, 0, 12, 67], [2, "푸른우산", 87, 0, 14, 78], [3, "다루좋아", 83, 1, 15, 84],
  [4, "나의 다루", 80, 1, 16, 91], [5, "강물", 76, 2, 18, 100],
].map(([rank, nickname, score, hints, attempts, elapsed]) => ({ rank: Number(rank), nickname: String(nickname), best_detection_power: Number(score), best_hints_used: Number(hints), best_attempts: Number(attempts), best_elapsed_seconds: Number(elapsed), best_combo: 5, achieved_at: "2026-08-22T00:00:00Z", is_me: rank === 4 }));

function createDevDeck() {
  const deck = createGameDeck("easy", () => 0.37);
  const pairIds = [...new Set(deck.map((card) => card.pairId))].slice(0, 2);
  return deck.filter((card) => pairIds.includes(card.pairId));
}

export function DaruMemoryDevLab() {
  const [theme, setTheme] = useState<DaruGameTheme>("day");
  const [auth, setAuth] = useState<AuthPreview>("guest");
  const [preview, setPreview] = useState<Preview>("game");
  const [phase, setPhase] = useState<GamePhase>("lobby");
  const [cards, setCards] = useState<GameCard[]>(createDevDeck);
  const [flippedIds, setFlippedIds] = useState<string[]>([]);
  const [matchedPairIds, setMatchedPairIds] = useState<string[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [combo, setCombo] = useState(0);
  const [points, setPoints] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [hintActive, setHintActive] = useState(false);
  const [hintRemaining, setHintRemaining] = useState(0);
  const [hintsRemaining, setHintsRemaining] = useState(2);
  const [feedback, setFeedback] = useState<MatchFeedbackData | null>(null);
  const [matchPreview, setMatchPreview] = useState<MatchPreview>("normal");
  const [resultRank, setResultRank] = useState<GameRank>("S");
  const [newBest, setNewBest] = useState(false);
  const [resultPreview, setResultPreview] = useState<ResultPreview>("normal");
  const [rankingPreview, setRankingPreview] = useState<RankingPreview>("top");
  const sequenceRef = useRef<number[]>([]);
  const originalDocumentThemeRef = useRef<DaruGameTheme | null>(null);

  const clearTimers = () => { sequenceRef.current.forEach(window.clearTimeout); sequenceRef.current = []; };
  useEffect(() => () => clearTimers(), []);
  useEffect(() => {
    const root = document.documentElement;
    if (originalDocumentThemeRef.current === null) {
      const activeTheme = root.dataset.theme;
      originalDocumentThemeRef.current = activeTheme === "dawn" || activeTheme === "night" ? activeTheme : "day";
    }
    root.dataset.theme = theme;
  }, [theme]);
  useEffect(() => () => {
    if (originalDocumentThemeRef.current) document.documentElement.dataset.theme = originalDocumentThemeRef.current;
  }, []);
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => setTimeRemaining((value) => Math.max(0, value - 1)), 1000);
    const timeout = window.setTimeout(() => setPhase("time-over"), 30_000);
    return () => { window.clearInterval(timer); window.clearTimeout(timeout); };
  }, [phase]);
  useEffect(() => {
    if (!hintActive) return;
    const timer = window.setInterval(() => setHintRemaining((value) => value <= 1 ? 0 : value - 1), 1000);
    const timeout = window.setTimeout(() => setHintActive(false), 8_000);
    return () => { window.clearInterval(timer); window.clearTimeout(timeout); };
  }, [hintActive]);

  const startGame = () => {
    clearTimers(); setPreview("game"); setCards(createDevDeck()); setFlippedIds([]); setMatchedPairIds([]); setAttempts(0); setCombo(0); setPoints(0); setTimeRemaining(30); setHintsRemaining(2); setHintActive(false); setFeedback(null); setPhase("preview");
    sequenceRef.current.push(window.setTimeout(() => setPhase("flipping"), 900));
    sequenceRef.current.push(window.setTimeout(() => setPhase("ready"), 1500));
    sequenceRef.current.push(window.setTimeout(() => setPhase("playing"), 2250));
  };
  const useHint = () => { if (phase !== "playing" || hintActive || hintsRemaining === 0) return; setHintsRemaining((value) => value - 1); setHintRemaining(4); setHintActive(true); };
  const flip = (card: GameCard) => {
    if (phase !== "playing" || hintActive || flippedIds.includes(card.id) || matchedPairIds.includes(card.pairId)) return;
    if (flippedIds.length === 0) { setFlippedIds([card.id]); return; }
    const first = cards.find((item) => item.id === flippedIds[0]); if (!first) return;
    setAttempts((value) => value + 1); setFlippedIds([first.id, card.id]);
    if (first.pairId === card.pairId) {
      const nextCombo = combo + 1; const reward = calculatePairPoints(nextCombo); const nextMatched = [...matchedPairIds, card.pairId];
      setMatchedPairIds(nextMatched); setCombo(nextCombo); setPoints((value) => value + reward.total); setFlippedIds([]);
      const remainingPairs = 2 - nextMatched.length;
      if (remainingPairs > 0) setFeedback({ id: Date.now(), message: remainingPairs === 1 ? "거의 다 찾았어!" : nextCombo === 2 ? "좋은데!" : "찾았다!", combo: nextCombo, points: reward.total, remainingPairs });
      sequenceRef.current.push(window.setTimeout(() => setFeedback(null), 1100));
      if (nextMatched.length === 2) sequenceRef.current.push(window.setTimeout(() => setPhase("finished"), 500));
    } else sequenceRef.current.push(window.setTimeout(() => setFlippedIds([]), 850));
  };

  const showMatch = (kind: MatchPreview) => {
    const data = { normal: ["찾았다!", 1, 100, 4], combo2: ["좋은데!", 2, 125, 3], combo3: ["감 잡았네!", 3, 150, 2], last: ["거의 다 찾았어!", 3, 150, 1] }[kind] as [string, number, number, number];
    setMatchPreview(kind); setPreview("match"); setFeedback({ id: Date.now(), message: data[0], combo: data[1], points: data[2], remainingPairs: data[3] });
  };
  const showHint = () => { setPreview("hint"); setPhase("playing"); setHintActive(true); setHintRemaining(8); setHintsRemaining(1); };
  const ranking = useMemo(() => {
    if (rankingPreview === "empty") return { entries: [], myEntry: null };
    if (rankingPreview === "mine-top") return { entries: BASE_RANKING, myEntry: BASE_RANKING[3] };
    if (rankingPreview === "mine-below") return { entries: BASE_RANKING.map((entry) => ({ ...entry, is_me: false })), myEntry: { ...BASE_RANKING[3], rank: 14, best_detection_power: 72, is_me: true } };
    return { entries: BASE_RANKING.map((entry) => ({ ...entry, is_me: false })), myEntry: null };
  }, [rankingPreview]);
  const recordStatus = auth === "guest" ? "guest" : auth === "admin" ? "admin" : "saved";
  const metrics = { memoryEfficiency: resultRank === "S" ? 94 : RANK_SCORES[resultRank], speedScore: RANK_SCORES[resultRank], comboScore: 75, detectionPower: RANK_SCORES[resultRank] };
  const resultFixture = auth === "guest" && preview === "partial-result" ? "guest-time-over" : auth === "user" && preview === "partial-result" ? "user-time-over" : auth === "guest" && preview === "result" ? "guest-clear" : auth === "user" && preview === "result" ? "user-clear" : "";
  const showResultFixture = (value: string) => {
    const userFixture = value.startsWith("user-");
    setAuth(userFixture ? "user" : "guest");
    setPreview(value.endsWith("time-over") ? "partial-result" : "result");
    setResultPreview("normal");
  };

  return <main className={styles.lab} data-preview-theme={theme}>
    <header className={styles.labHeader}><p>DARU MEMORY · DEV LAB</p><h1>Production UI 상태 미리보기</h1><span>실제 데이터 저장 없이 4장 게임과 화면 상태를 빠르게 확인합니다.</span></header>
    <section className={styles.controls} aria-label="DEV controls">
      <Control label="THEME" values={["dawn", "day", "night"]} active={theme} onSelect={(value) => setTheme(value as DaruGameTheme)} />
      <Control label="AUTH PREVIEW" values={["guest", "user", "admin"]} active={auth} onSelect={(value) => setAuth(value as AuthPreview)} />
      <div className={styles.controlGroup}><strong>실제 흐름</strong><button type="button" onClick={startGame}>4장 테스트 시작</button></div>
      <Control label="빠른 화면 확인" values={["match", "hint", "time-over", "partial-result", "result", "ranking"]} active={preview} onSelect={(value) => { setPreview(value as Preview); if (value === "hint") showHint(); }} />
      <Control label="결과 인증 FIXTURE" values={["guest-time-over", "user-time-over", "guest-clear", "user-clear"]} active={resultFixture} onSelect={showResultFixture} />
      {preview === "match" && <Control label="매칭 연출" values={["normal", "combo2", "combo3", "last"]} active={matchPreview} onSelect={(value) => showMatch(value as MatchPreview)} />}
      {preview === "result" && <><Control label="결과 상태" values={["normal", "overtime"]} active={resultPreview} onSelect={(value) => setResultPreview(value as ResultPreview)} /><Control label="결과 등급" values={["S", "A", "B", "C"]} active={resultRank} onSelect={(value) => setResultRank(value as GameRank)} /><label className={styles.check}><input type="checkbox" checked={newBest} onChange={(event) => setNewBest(event.target.checked)} /> NEW BEST</label></>}
      {preview === "ranking" && <Control label="랭킹 상태" values={["top", "mine-top", "mine-below", "empty"]} active={rankingPreview} onSelect={(value) => setRankingPreview(value as RankingPreview)} />}
    </section>
    <section className={styles.preview}><p className={styles.previewLabel}>PRODUCTION PREVIEW</p>
      {preview === "ranking" ? auth === "user" ? <DaruLeaderboard preview={ranking} /> : <div className={styles.authNotice}>{auth === "guest" ? "GUEST에서는 랭킹이 노출되지 않습니다." : "ADMIN 플레이는 USER 랭킹에 포함되지 않습니다."}</div> :
      preview === "partial-result" ? <PartialResult matchedPairs={6} pairCount={10} maxCombo={3} daruPoints={725} elapsedSeconds={120} recordStatus={auth === "user" ? "saved" : auth === "admin" ? "admin" : "guest"} onRestart={() => setPreview("game")} onChangeDifficulty={() => setPreview("game")} /> :
      preview === "result" ? <GameResult rank={resultRank} metrics={metrics} daruPoints={1375} elapsedSeconds={resultPreview === "overtime" ? 145 : 66} attempts={28} maxCombo={3} hintsUsed={1} withinTimeLimit={resultPreview !== "overtime"} newBest={newBest && resultPreview === "normal"} leaderboardRank={auth === "user" && resultPreview === "normal" ? 4 : null} personalBestPower={auth === "user" ? newBest ? metrics.detectionPower : Math.max(metrics.detectionPower, 94) : null} recordStatus={recordStatus} difficultyLabel="쉬움" onRestart={() => setPreview("game")} onChangeDifficulty={() => setPreview("game")} onViewLeaderboard={auth === "user" && resultPreview === "normal" ? () => setPreview("ranking") : undefined} previewTheme={theme} /> :
      <div className={styles.miniGame}>
        <GameStatus timeRemaining={timeRemaining} attempts={attempts} foundPairs={preview === "match" && matchPreview === "last" ? 9 : matchedPairIds.length} pairCount={preview === "match" && matchPreview === "last" ? 10 : 2} combo={combo} daruPoints={points} hintsRemaining={hintsRemaining} hintActive={hintActive} onHint={useHint} />
        {hintActive && <div className={gameStyles.hintProgress}><span>💡 카드를 잘 기억해봐! <b>{hintRemaining}초</b></span><progress max="8" value={hintRemaining} /></div>}
        <div className={`${gameStyles.boardStage} ${styles.boardStage}`} data-dimmed={preview === "time-over" || undefined}>
          <MemoryBoard cards={cards} difficulty="easy" theme={theme} phase={phase === "lobby" ? "playing" : phase} flippedIds={flippedIds} matchedPairIds={matchedPairIds} locked={false} hintActive={hintActive} onFlip={flip} />
          {feedback && <DaruMatchFeedback feedback={feedback} />}
          {(phase === "ready" || phase === "flipping") && <div className={gameStyles.readyCue}>{phase === "flipping" ? "READY" : "GO!"}</div>}
        </div>
        {preview === "time-over" && <TimeOverDialog onContinue={() => { setPreview("game"); setPhase("playing"); }} onFinish={() => setPreview("partial-result")} />}
        {phase === "finished" && <GameResult rank="S" metrics={{ memoryEfficiency: 100, speedScore: 98, comboScore: 40, detectionPower: 90 }} daruPoints={points + 300} elapsedSeconds={Math.max(1, 30 - timeRemaining)} attempts={attempts} maxCombo={combo} hintsUsed={2 - hintsRemaining} withinTimeLimit newBest recordStatus={recordStatus} leaderboardRank={auth === "user" ? 1 : null} personalBestPower={auth === "user" ? 90 : null} difficultyLabel="DEV 4장" onRestart={startGame} onChangeDifficulty={() => { setPhase("lobby"); setPreview("game"); }} onViewLeaderboard={auth === "user" ? () => setPreview("ranking") : undefined} previewTheme={theme} />}
      </div>}
    </section>
    <p className={styles.safety}>DEV fixture only · API 호출 없음 · DB 저장 없음 · 실제 인증/테마 설정 변경 없음</p>
  </main>;
}

function Control({ label, values, active, onSelect }: { label: string; values: string[]; active: string; onSelect: (value: string) => void }) {
  return <div className={styles.controlGroup}><strong>{label}</strong><div>{values.map((value) => <button type="button" key={value} aria-pressed={active === value} onClick={() => onSelect(value)}>{value.replace("guest-time-over", "GUEST TIME-OVER").replace("user-time-over", "USER TIME-OVER").replace("guest-clear", "GUEST CLEAR").replace("user-clear", "USER CLEAR").replace("partial-result", "TIME OVER 결과").replace("mine-top", "내가 4위").replace("mine-below", "내가 14위").replace("empty", "기록 없음").replace("top", "Top 10").replace("normal", "일반 성공").replace("combo", "COMBO ").toUpperCase()}</button>)}</div></div>;
}
