"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteAllDaruGameHistory, deleteDaruGameHistoryRecord, getDaruGameHistory, getDaruLeaderboard, type DaruHistoryItem, type DaruHistoryResponse, type DaruLeaderboardResponse } from "@/lib/daruGameApi";
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
    my_best: null,
    next_rank_score: myIndex > 0 ? preview.entries[myIndex - 1].detection_power : null,
    total: preview.entries.length, page: currentPage, page_size: PAGE_SIZE, total_pages: totalPages,
  };
}

function score(entry: LeaderboardEntry) { return formatMemoryScore(entry.detection_power); }
function details(entry: LeaderboardEntry) { return `힌트 ${entry.hints_used}회 · ${entry.attempts}회 · ${formatElapsedTime(entry.elapsed_seconds)}`; }
function PawIcon() {
  return <svg className={styles.pawIcon} viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="6" r="2.2" /><circle cx="9.8" cy="3.9" r="2.2" /><circle cx="15.2" cy="6" r="2.2" /><path d="M10 8.1c-3.5 0-6.3 2.7-6.3 5.6 0 2 1.6 3.2 3.5 2.7.9-.3 1.7-.7 2.8-.7s1.9.4 2.8.7c1.9.5 3.5-.7 3.5-2.7 0-2.9-2.8-5.6-6.3-5.6Z" /></svg>;
}
function TrophyIcon() { return <svg className={styles.trophyIcon} viewBox="0 0 20 20" aria-hidden="true"><path d="M6 2.5h8v3.2c0 3-1.6 5.1-4 5.8-2.4-.7-4-2.8-4-5.8V2.5Zm0 1.8H3.5v1.2c0 2.2 1.3 3.8 3.5 4.2M14 4.3h2.5v1.2c0 2.2-1.3 3.8-3.5 4.2M10 11.5v3M7 17h6M8 14.5h4" /></svg>; }
function HistoryIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4.5v4h4M4 8.5a6.5 6.5 0 1 1 1.2 5.8M10 6v4l2.7 1.8" /></svg>; }
function CrownIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 6 4 3 3-5 3 5 4-3-1.3 8H4.3L3 6Zm1.5 10h11" /></svg>; }
function ClockIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.8 1.7" /></svg>; }
function TrashIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 3h4l1 3H7l1-3Zm-2 3 1 11h6l1-11M9 9v5m2-5v5" /></svg>; }

export function DaruLeaderboard({ refreshKey = 0, preview }: { refreshKey?: number; preview?: LeaderboardPreview }) {
  const [difficulty, setDifficulty] = useState<GameDifficulty>("easy");
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<DaruLeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [history, setHistory] = useState<DaruHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(!preview);
  const [deleteTarget, setDeleteTarget] = useState<DaruHistoryItem | "all" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
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

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    void getDaruGameHistory(DIFFICULTY_CONFIG[difficulty].key, historyPage, controller.signal)
      .then((next) => { setHistory(next); if (next.page !== historyPage) setHistoryPage(next.page); })
      .catch((requestError: unknown) => { if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setHistory(null); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [difficulty, historyPage, preview, refreshKey, retryKey]);

  const selectedDifficulty = DIFFICULTY_CONFIG[difficulty].key;
  const visible = useMemo(() => preview ? previewResponse(preview, page) : response && isLeaderboardDifficulty(response.difficulty, selectedDifficulty) ? response : null, [page, preview, response, selectedDifficulty]);
  const topEntries = visible?.top_entries ?? [];
  const entries = visible?.entries ?? [];
  const myEntry = visible?.my_entry ?? null;
  const totalPages = visible?.total_pages ?? 1;
  const currentPage = visible?.page ?? page;
  const total = visible?.total ?? 0;
  const isMyRankVisible = Boolean(myEntry && entries.some((entry) => entry.is_me));
  const gap = myEntry && visible?.next_rank_score !== null && visible?.next_rank_score !== undefined ? Math.max(0, visible.next_rank_score - myEntry.detection_power) : null;
  const gapMessage = myEntry?.rank === 1 ? "🏆 현재 1위를 지키고 있어요!" : myEntry && isLeaderboardScoreTie(myEntry.rank, gap) ? "동점이에요. 시도 횟수와 플레이 시간으로 순위가 갈려요." : myEntry && gap !== null ? `${myEntry.rank === 4 ? "🥉 TOP 3" : `${myEntry.rank - 1}위`}까지 ${formatMemoryScore(gap)}점 남았어요!` : myEntry ? `현재 ${myEntry.rank}위예요.` : "";

  const selectDifficulty = (next: GameDifficulty) => {
    if (next === difficulty) return;
    setDifficulty(next); setPage(1); setHistoryPage(1); setHistory(null); setHistoryLoading(true);
    if (!preview) { setResponse(null); setError(false); setLoading(true); }
  };
  const changePage = (direction: -1 | 1) => {
    const request = getLeaderboardPageRequest(currentPage, page, direction, totalPages);
    if (request.retry) setRetryKey((value) => value + 1);
    else setPage(request.page);
  };
  const goToMyRank = () => { if (myEntry && myEntry.rank > 3) setPage(Math.floor((myEntry.rank - 4) / PAGE_SIZE) + 1); };
  const openDeleteDialog = (target: DaruHistoryItem | "all") => { setDeleteError(false); setDeleteTarget(target); };
  const closeDeleteDialog = () => { if (deleting) return; setDeleteError(false); setDeleteTarget(null); };
  useEffect(() => {
    if (!deleteTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !deleting) { setDeleteError(false); setDeleteTarget(null); } };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteTarget, deleting]);
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setDeleteError(false);
    try {
      if (deleteTarget === "all") await deleteAllDaruGameHistory();
      else await deleteDaruGameHistoryRecord(deleteTarget.id);
      setDeleteError(false); setDeleteTarget(null);
      setHistoryLoading(true); setRetryKey((value) => value + 1);
    } catch { setDeleteError(true); } finally { setDeleting(false); }
  };

  return <section id="daru-leaderboard" className={styles.leaderboard} aria-labelledby="leaderboard-title" aria-busy={loading}>
    <header className={styles.leaderboardHeader}>
      <div><h2 id="leaderboard-title">🏆 다루 메모리 랭킹</h2><p>기억력 · 속도 · 콤보 · 힌트로 결정돼요 · 가장 최근 정상 클리어가 랭킹에 반영돼요</p></div>
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

      <aside className={styles.myRankCard} aria-labelledby="my-rank-title"><h3 id="my-rank-title">MY RANK</h3>{myEntry ? <><span className={styles.myRankLabel}><TrophyIcon /> 현재 랭킹</span><div className={styles.myRankScore}><strong>{myEntry.rank <= 3 ? <><span aria-hidden="true">{MEDALS[myEntry.rank - 1]}</span><span className={styles.srOnly}>{myEntry.rank}위</span></> : `${myEntry.rank}위`}</strong><em>{score(myEntry)}</em></div><p title={myEntry.nickname}>{myEntry.nickname}</p><small>{details(myEntry)}</small><div className={styles.rankGap}>{gapMessage}</div>{myEntry.rank <= 3 ? <div className={styles.myRankLocation}><PawIcon /> TOP 3에서 확인 중</div> : isMyRankVisible ? <div className={styles.myRankLocation}><PawIcon /> 현재 순위 확인 중</div> : <button type="button" onClick={goToMyRank}><PawIcon /> 내 순위로 이동 ›</button>}</> : <div className={styles.noMyRank}><strong>현재 랭킹 미등록</strong><span>게임을 한 번 완료하면 다시 랭킹에 등록돼요.</span></div>} {visible?.my_best?.best_attempts != null && <div className={styles.personalBest}><span><CrownIcon /> 개인 BEST</span><strong>{formatMemoryScore(visible.my_best.best_detection_power)}</strong></div>}</aside>
      {loading && <div className={styles.rankingLoading} role="status">랭킹을 불러오는 중이에요.</div>}
    </div>
    {!preview && <section className={styles.playHistory} aria-labelledby="play-history-title" aria-busy={historyLoading}>
      <header><div><HistoryIcon /><span><h3 id="play-history-title">내 플레이 기록</h3><small>총 {history?.total ?? 0}회</small></span></div>{(history?.total ?? 0) > 0 && <button type="button" onClick={() => openDeleteDialog("all")}><TrashIcon /> 기록 관리</button>}</header>
      {!historyLoading && (history?.items.length ?? 0) === 0 ? <div className={styles.historyEmpty}><HistoryIcon /><strong>아직 플레이 기록이 없어요.</strong><span>게임을 완료하면 여기에 기록이 차곡차곡 쌓여요.</span></div> : <ul>{history?.items.map((item) => <li key={item.id}><time dateTime={item.achieved_at}>{new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.achieved_at))}</time><strong>{formatMemoryScore(item.detection_power)}</strong><span>{item.attempts}회 · {formatElapsedTime(item.elapsed_seconds)} · 최고 콤보 {item.max_combo} · 힌트 {item.hints_used}회</span><div>{!item.completed && <em><ClockIcon /> 미완주</em>}{item.is_best && <em data-best><CrownIcon /> BEST</em>}{item.is_ranking_record && <em data-ranking><PawIcon /> 랭킹 반영</em>}</div><button type="button" aria-label="플레이 기록 삭제" onClick={() => openDeleteDialog(item)}><TrashIcon /></button></li>)}</ul>}
      {(history?.total_pages ?? 1) > 1 && <nav className={styles.rankingPagination} aria-label="플레이 기록 페이지"><button type="button" aria-label="이전 기록 페이지" disabled={(history?.page ?? 1) <= 1 || historyLoading} onClick={() => { setHistoryLoading(true); setHistoryPage((value) => Math.max(1, value - 1)); }}>‹</button><span>{String(history?.page ?? 1).padStart(2, "0")} / {String(history?.total_pages ?? 1).padStart(2, "0")}</span><button type="button" aria-label="다음 기록 페이지" disabled={(history?.page ?? 1) >= (history?.total_pages ?? 1) || historyLoading} onClick={() => { setHistoryLoading(true); setHistoryPage((value) => value + 1); }}>›</button></nav>}
    </section>}
    {deleteTarget && <div className={styles.deleteBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) closeDeleteDialog(); }}><div className={styles.deleteDialog} role="dialog" aria-modal="true" aria-labelledby="delete-title"><TrashIcon /><h3 id="delete-title">{deleteTarget === "all" ? "모든 플레이 기록을 삭제할까요?" : deleteTarget.is_best && deleteTarget.is_ranking_record ? "이 기록은 현재 BEST이자 랭킹 기록입니다." : deleteTarget.is_best ? "최고 기록을 삭제할까요?" : deleteTarget.is_ranking_record ? "현재 랭킹 기록을 삭제할까요?" : "이 플레이 기록을 삭제할까요?"}</h3><p>{deleteTarget === "all" ? "개인 BEST와 현재 랭킹 기록이 초기화됩니다. 획득한 다루 포인트와 누적 플레이 횟수는 유지됩니다." : deleteTarget.is_best && deleteTarget.is_ranking_record ? "삭제하면 개인 BEST가 다시 계산되고, 현재 랭킹에서는 빠집니다." : deleteTarget.is_best ? "삭제하면 남아 있는 정상 플레이 중 가장 높은 기록이 새로운 BEST가 됩니다." : deleteTarget.is_ranking_record ? "삭제하면 현재 랭킹에서 빠집니다. 다음 게임을 정상 완료하면 다시 랭킹에 등록돼요." : "삭제한 기록은 내 플레이 기록에서 다시 복구할 수 없어요."}</p>{deleteError && <p role="alert">기록을 삭제하지 못했어요. 다시 시도해 주세요.</p>}<div><button type="button" autoFocus onClick={closeDeleteDialog} disabled={deleting}>취소</button><button type="button" onClick={() => void confirmDelete()} disabled={deleting}>{deleteTarget === "all" ? "전체 삭제" : "삭제"}</button></div></div></div>}
  </section>;
}
