"use client";

import { useCallback, useEffect, useState } from "react";
import { getDaruLeaderboard } from "@/lib/daruGameApi";
import { DIFFICULTY_CONFIG } from "./game.config";
import type { GameDifficulty, LeaderboardEntry } from "./game.types";
import { formatElapsedTime } from "./game.utils";
import styles from "./DaruGame.module.css";

interface LeaderboardPreview {
  entries: LeaderboardEntry[];
  myEntry: LeaderboardEntry | null;
}

export function DaruLeaderboard({ refreshKey = 0, preview }: { refreshKey?: number; preview?: LeaderboardPreview }) {
  const [difficulty, setDifficulty] = useState<GameDifficulty>("easy");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myEntry, setMyEntry] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getDaruLeaderboard(DIFFICULTY_CONFIG[difficulty].key);
      setEntries(response.entries); setMyEntry(response.my_entry);
    } catch { setEntries([]); setMyEntry(null); }
    finally { setLoading(false); }
  }, [difficulty]);
  useEffect(() => {
    if (preview) return;
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load, preview, refreshKey]);

  const visibleEntries = preview?.entries ?? entries;
  const visibleMyEntry = preview?.myEntry ?? myEntry;
  const visibleLoading = preview ? false : loading;
  const mineInTop = visibleMyEntry && visibleEntries.some((entry) => entry.is_me);
  return <section id="daru-leaderboard" className={styles.leaderboard} aria-labelledby="leaderboard-title">
    <h2 id="leaderboard-title">🏆 다루 메모리 랭킹</h2>
    <div className={styles.leaderboardTabs}>{(Object.keys(DIFFICULTY_CONFIG) as GameDifficulty[]).map((key) => <button type="button" key={key} aria-pressed={difficulty === key} onClick={() => setDifficulty(key)}>{DIFFICULTY_CONFIG[key].label}</button>)}</div>
    {visibleLoading ? <p className={styles.rankingNotice}>랭킹을 불러오는 중이에요.</p> : visibleEntries.length === 0 ? <p className={styles.rankingNotice}>아직 기록이 없어요.<br />첫 기록을 남겨보세요!</p> : <ol className={styles.rankingList}>{visibleEntries.map((entry) => <li key={`${entry.rank}-${entry.nickname}`} data-me={entry.is_me || undefined}><b className={entry.rank <= 3 ? styles.rankingMedal : undefined}>{entry.rank <= 3 ? ["🥇", "🥈", "🥉"][entry.rank - 1] : entry.rank}</b><span><strong>{entry.nickname}</strong><small>힌트 {entry.best_hints_used}회 · {entry.best_attempts}회 · {formatElapsedTime(entry.best_elapsed_seconds)}</small></span><em>{entry.best_detection_power}</em></li>)}</ol>}
    {!mineInTop && visibleMyEntry && <div className={styles.myRanking}><span>내 기록 · {visibleMyEntry.rank}위</span><strong>메모리 점수 {visibleMyEntry.best_detection_power} · 힌트 {visibleMyEntry.best_hints_used}회 · {visibleMyEntry.best_attempts}회 · {formatElapsedTime(visibleMyEntry.best_elapsed_seconds)}</strong></div>}
  </section>;
}
