"use client";

import { useEffect, useMemo, useState } from "react";
import { getDaruLeaderboard, type DaruLeaderboardResponse } from "@/lib/daruGameApi";
import { DIFFICULTY_CONFIG } from "./game.config";
import type { GameDifficulty, LeaderboardEntry } from "./game.types";
import { formatElapsedTime, formatMemoryScore } from "./game.utils";
import { getLeaderboardPageRequest, isLeaderboardDifficulty, isLeaderboardScoreTie } from "./leaderboard.utils";
import styles from "./DaruGame.module.css";

const PAGE_SIZE = 5;
const MEDALS = ["🥇", "🥈", "🥉"] as const;

interface LeaderboardPreview { entries: LeaderboardEntry[]; myEntry: LeaderboardEntry | null; }

function previewResponse(preview: LeaderboardPreview, page: number): DaruLeaderboardResponse {
  const general = preview.entries.filter((entry) => entry.rank > 3);
  const totalPages = Math.max(1, Math.ceil(general.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const myIndex = preview.myEntry ? preview.entries.findIndex((entry) => entry.rank === preview.myEntry?.rank) : -1;
  return {
    difficulty: "EASY",
    top_entries: preview.entries.filter((entry) => entry.rank <= 3),
    entries: general.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    my_entry: preview.myEntry,
    next_rank_score: myIndex > 0 ? preview.entries[myIndex - 1].best_detection_power : null,
    total: preview.entries.length, page: currentPage, page_size: PAGE_SIZE, total_pages: totalPages,
  };
}

function score(entry: LeaderboardEntry) { return formatMemoryScore(entry.best_detection_power); }
function details(entry: LeaderboardEntry) { return `힌트 ${entry.best_hints_used}회 · ${entry.best_attempts}회 · ${formatElapsedTime(entry.best_elapsed_seconds)}`; }
function PawIcon() {
  return <svg className={styles.pawIcon} viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="6" r="2.2" /><circle cx="9.8" cy="3.9" r="2.2" /><circle cx="15.2" cy="6" r="2.2" /><path d="M10 8.1c-3.5 0-6.3 2.7-6.3 5.6 0 2 1.6 3.2 3.5 2.7.9-.3 1.7-.7 2.8-.7s1.9.4 2.8.7c1.9.5 3.5-.7 3.5-2.7 0-2.9-2.8-5.6-6.3-5.6Z" /></svg>;
}

export function DaruLeaderboard({ refreshKey = 0, preview }: { refreshKey?: number; preview?: LeaderboardPreview }) {
  const [difficulty, setDifficulty] = useState<GameDifficulty>("easy");
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<DaruLeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      setLoading(true); setError(false);
      void getDaruLeaderboard(DIFFICULTY_CONFIG[difficulty].key, page, controller.signal)
        .then((next) => { setResponse(next); if (next.page !== page) setPage(next.page); })
        .catch((requestError: unknown) => {
          if (requestError instanceof DOMException && requestError.name === "AbortError") return;
          setError(true);
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    });
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [difficulty, page, preview, refreshKey, retryKey]);

  const selectedDifficulty = DIFFICULTY_CONFIG[difficulty].key;
  const visible = useMemo(() => preview ? previewResponse(preview, page) : response && isLeaderboardDifficulty(response.difficulty, selectedDifficulty) ? response : null, [page, preview, response, selectedDifficulty]);
  const topEntries = visible?.top_entries ?? [];
  const entries = visible?.entries ?? [];
  const myEntry = visible?.my_entry ?? null;
  const totalPages = visible?.total_pages ?? 1;
  const currentPage = visible?.page ?? page;
  const total = visible?.total ?? 0;
  const isMyRankVisible = Boolean(myEntry && entries.some((entry) => entry.is_me));
  const gap = myEntry && visible?.next_rank_score !== null && visible?.next_rank_score !== undefined ? Math.max(0, visible.next_rank_score - myEntry.best_detection_power) : null;
  const gapMessage = myEntry?.rank === 1 ? "🏆 현재 1위를 지키고 있어요!" : myEntry && isLeaderboardScoreTie(myEntry.rank, gap) ? "동점이에요. 시도 횟수와 플레이 시간으로 순위가 갈려요." : myEntry && gap !== null ? `${myEntry.rank === 4 ? "🥉 TOP 3" : `${myEntry.rank - 1}위`}까지 ${formatMemoryScore(gap)}점 남았어요!` : myEntry ? `현재 ${myEntry.rank}위예요.` : "";

  const selectDifficulty = (next: GameDifficulty) => {
    if (next === difficulty) return;
    setDifficulty(next); setPage(1);
    if (!preview) { setResponse(null); setError(false); setLoading(true); }
  };
  const changePage = (direction: -1 | 1) => {
    const request = getLeaderboardPageRequest(currentPage, page, direction, totalPages);
    if (request.retry) setRetryKey((value) => value + 1);
    else setPage(request.page);
  };
  const goToMyRank = () => { if (myEntry && myEntry.rank > 3) setPage(Math.floor((myEntry.rank - 4) / PAGE_SIZE) + 1); };

  return <section id="daru-leaderboard" className={styles.leaderboard} aria-labelledby="leaderboard-title" aria-busy={loading}>
    <header className={styles.leaderboardHeader}>
      <div><h2 id="leaderboard-title">🏆 다루 메모리 랭킹</h2><p>기억력 · 속도 · 콤보 · 힌트로 결정돼요</p></div>
      <details className={styles.rankingInfo}><summary aria-label="메모리 점수 산정 방식 보기">i</summary><div role="note"><strong>메모리 점수</strong><span>기억력 정확도 50%</span><span>탐색 속도 25%</span><span>콤보 15%</span><span>힌트 절약 10%</span><small>제한시간을 초과해도 완주 기록은 등록되며, 속도 점수는 0점으로 계산됩니다.</small><small>동점은 시도 횟수, 플레이 시간, 기록 달성 시각 순으로 결정해요.</small></div></details>
    </header>

    <div className={styles.leaderboardTabs} role="group" aria-label="난이도별 랭킹">
      {(Object.keys(DIFFICULTY_CONFIG) as GameDifficulty[]).map((key) => <button type="button" key={key} aria-pressed={difficulty === key} onClick={() => selectDifficulty(key)}>{DIFFICULTY_CONFIG[key].label}</button>)}
    </div>

    <div className={styles.leaderboardGrid} data-loading={loading || undefined}>
      <div className={styles.rankingMain}>
        {error && !visible ? <div className={styles.rankingState} role="alert"><strong>랭킹을 불러오지 못했어요.</strong><span>잠시 후 다시 확인해 주세요.</span><button type="button" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></div> : topEntries.length === 0 && !loading ? <div className={styles.rankingState}><strong>아직 이 난이도의 기록이 없어요.</strong><span>첫 기록의 주인공이 되어보세요!</span></div> : <>
          <section className={styles.topSpotlight} aria-label="TOP 3"><h3>TOP 3</h3><ol>{topEntries.map((entry) => <li key={`${entry.rank}-${entry.nickname}`} data-rank={entry.rank} data-me={entry.is_me || undefined}>{entry.rank === 1 && <span className={styles.topLaurel} aria-hidden="true" />}<b className={styles.topMedal}><span aria-hidden="true">{entry.rank}</span><span className={styles.srOnly}>{entry.rank}위</span></b><span className={styles.rankAvatar} aria-hidden="true" /><strong title={entry.nickname}>{entry.nickname}</strong>{entry.is_me && <span className={styles.topMyBadge} aria-label="내 기록"><PawIcon /></span>}<em>{score(entry)}</em><small>{details(entry)}</small></li>)}</ol></section>
          {total > 3 && <section className={styles.generalRanking} aria-labelledby="general-ranking-title"><div className={styles.rankingSectionTitle}><h3 id="general-ranking-title">다음 순위</h3><span>총 {total}명</span></div><ol className={styles.rankingList}>{entries.map((entry) => <li key={`${entry.rank}-${entry.nickname}`} data-me={entry.is_me || undefined}><b>{entry.rank}</b><span className={styles.rankIdentity}><strong title={entry.nickname}>{entry.nickname}</strong><small>{details(entry)}</small></span>{entry.is_me && <span className={styles.myBadge} aria-label="내 기록"><PawIcon /></span>}<em>{score(entry)}</em></li>)}</ol>{totalPages > 1 && <nav className={styles.rankingPagination} aria-label="일반 랭킹 페이지"><button type="button" aria-label="이전 랭킹 페이지" disabled={currentPage <= 1 || loading} onClick={() => changePage(-1)}>‹</button><span aria-live="polite">{String(currentPage).padStart(2, "0")} / {String(totalPages).padStart(2, "0")}</span><button type="button" aria-label="다음 랭킹 페이지" disabled={currentPage >= totalPages || loading} onClick={() => changePage(1)}>›</button></nav>}</section>}
        </>}
        {error && visible && <p className={styles.inlineRankingError} role="alert">새 랭킹을 불러오지 못했어요. <button type="button" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></p>}
      </div>

      <aside className={styles.myRankCard} aria-labelledby="my-rank-title"><h3 id="my-rank-title">MY RANK</h3>{myEntry ? <><div className={styles.myRankScore}><strong>{myEntry.rank <= 3 ? <><span aria-hidden="true">{MEDALS[myEntry.rank - 1]}</span><span className={styles.srOnly}>{myEntry.rank}위</span></> : `${myEntry.rank}위`}</strong><em>{score(myEntry)}</em></div><p title={myEntry.nickname}>{myEntry.nickname}</p><small>{details(myEntry)}</small><div className={styles.rankGap}>{gapMessage}</div>{myEntry.rank <= 3 ? <div className={styles.myRankLocation}><PawIcon /> TOP 3에서 확인 중</div> : isMyRankVisible ? <div className={styles.myRankLocation}><PawIcon /> 현재 순위 확인 중</div> : <button type="button" onClick={goToMyRank}><PawIcon /> 내 순위로 이동 ›</button>}</> : <div className={styles.noMyRank}><strong>아직 이 난이도의 기록이 없어요.</strong><span>게임을 플레이해 첫 기록을 만들어보세요.</span></div>}</aside>
      {loading && <div className={styles.rankingLoading} role="status">랭킹을 불러오는 중이에요.</div>}
    </div>
  </section>;
}
