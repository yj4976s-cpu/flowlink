"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deleteAllDaruGameHistory, deleteDaruGameHistoryRecord, deleteDaruGameHistorySelection, emptyDaruGameTrash, getDaruGameHistory, getDaruGameTrash, getDaruLeaderboard, permanentlyDeleteDaruGameHistoryRecord, restoreDaruGameHistoryRecord, type DaruHistoryItem, type DaruHistoryResponse, type DaruLeaderboardResponse } from "@/lib/daruGameApi";
import { DIFFICULTY_CONFIG } from "./game.config";
import type { GameDifficulty, LeaderboardEntry } from "./game.types";
import { formatElapsedTime, formatMemoryScore } from "./game.utils";
import { bulkDeleteIncludesBest, getBulkSelectedCount, getLeaderboardPageRequest, isLeaderboardDifficulty, isLeaderboardScoreTie } from "./leaderboard.utils";
import styles from "./DaruGame.module.css";

const PAGE_SIZE = 5;
const MEDALS = ["🥇", "🥈", "🥉"] as const;

interface LeaderboardPreview { entries: LeaderboardEntry[]; myEntry: LeaderboardEntry | null; }
type DeleteTarget = DaruHistoryItem | "selected" | "difficulty" | "all" | { kind: "permanent"; item: DaruHistoryItem } | { kind: "empty-trash" };
function isHistoryItem(target: DeleteTarget): target is DaruHistoryItem { return typeof target === "object" && !("kind" in target); }

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
function compactPaginationPages(current: number, total: number) { return Array.from({ length: total }, (_item, index) => index + 1).filter((number) => number === 1 || number === total || Math.abs(number - current) <= 1); }
function PawIcon() {
  return <svg className={styles.pawIcon} viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="6" r="2.2" /><circle cx="9.8" cy="3.9" r="2.2" /><circle cx="15.2" cy="6" r="2.2" /><path d="M10 8.1c-3.5 0-6.3 2.7-6.3 5.6 0 2 1.6 3.2 3.5 2.7.9-.3 1.7-.7 2.8-.7s1.9.4 2.8.7c1.9.5 3.5-.7 3.5-2.7 0-2.9-2.8-5.6-6.3-5.6Z" /></svg>;
}
function TrophyIcon() { return <svg className={styles.trophyIcon} viewBox="0 0 20 20" aria-hidden="true"><path d="M6 2.5h8v3.2c0 3-1.6 5.1-4 5.8-2.4-.7-4-2.8-4-5.8V2.5Zm0 1.8H3.5v1.2c0 2.2 1.3 3.8 3.5 4.2M14 4.3h2.5v1.2c0 2.2-1.3 3.8-3.5 4.2M10 11.5v3M7 17h6M8 14.5h4" /></svg>; }
function HistoryIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4.5v4h4M4 8.5a6.5 6.5 0 1 1 1.2 5.8M10 6v4l2.7 1.8" /></svg>; }
function CrownIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 6 4 3 3-5 3 5 4-3-1.3 8H4.3L3 6Zm1.5 10h11" /></svg>; }
function ClockIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.8 1.7" /></svg>; }
function TrashIcon() { return <svg className={styles.trashIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6m3 0-1 14H6L5 6m5 4v6m4-6v6" /></svg>; }
function RestoreIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.2 6.5H2.5v-4M3 6a7 7 0 1 1-.1 7.8" /><path d="m2.5 6.5 3.2-3.2" /></svg>; }
function ListChecksIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 5 1.5 1.5L7 3.8M9 5h8M3 11l1.5 1.5L7 9.8M9 11h8M3 17h4M9 17h8" /></svg>; }
function ChevronLeftIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5-5 5.5 5 5.5" /></svg>; }
function ChevronRightIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5 5.5-5 5.5" /></svg>; }

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
  const [recentHistory, setRecentHistory] = useState<DaruHistoryResponse | null>(null);
  const [recentHistoryLoading, setRecentHistoryLoading] = useState(!preview);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [historyView, setHistoryView] = useState<"active" | "trash">("active");
  const [trashPage, setTrashPage] = useState(1);
  const [trash, setTrash] = useState<DaruHistoryResponse | null>(null);
  const [trashLoading, setTrashLoading] = useState(!preview);
  const [managementMode, setManagementMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [selectedRecords, setSelectedRecords] = useState<Map<number, DaruHistoryItem>>(() => new Map());
  const [selectAllDifficulty, setSelectAllDifficulty] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<number>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState("");
  const [undoRecord, setUndoRecord] = useState<DaruHistoryItem | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState("");
  const [moveSuccess, setMoveSuccess] = useState("");
  const manageButtonRef = useRef<HTMLButtonElement>(null);
  const bulkMenuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const restoreTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current); }, []);
  useEffect(() => () => { if (restoreTimerRef.current !== null) window.clearTimeout(restoreTimerRef.current); }, []);
  useEffect(() => {
    if (!bulkMenuOpen) return;
    const close = (event: MouseEvent) => { if (!bulkMenuRef.current?.contains(event.target as Node)) setBulkMenuOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [bulkMenuOpen]);
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
    const requestDifficulty = DIFFICULTY_CONFIG[difficulty].key;
    void getDaruGameHistory(requestDifficulty, historyPage, controller.signal)
      .then((next) => {
        if (controller.signal.aborted || !isLeaderboardDifficulty(next.difficulty, requestDifficulty)) return;
        setHistory(next); if (next.page !== historyPage) setHistoryPage(next.page);
      })
      .catch((requestError: unknown) => { if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setHistory(null); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [difficulty, historyPage, preview, refreshKey, retryKey]);

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    const requestDifficulty = DIFFICULTY_CONFIG[difficulty].key;
    void getDaruGameHistory(requestDifficulty, 1, controller.signal, 3)
      .then((next) => {
        if (!controller.signal.aborted && isLeaderboardDifficulty(next.difficulty, requestDifficulty)) setRecentHistory(next);
      })
      .catch((requestError: unknown) => { if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setRecentHistory(null); })
      .finally(() => { if (!controller.signal.aborted) setRecentHistoryLoading(false); });
    return () => controller.abort();
  }, [difficulty, preview, refreshKey, retryKey]);

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    const requestDifficulty = DIFFICULTY_CONFIG[difficulty].key;
    void getDaruGameTrash(requestDifficulty, trashPage, controller.signal)
      .then((next) => {
        if (controller.signal.aborted || !isLeaderboardDifficulty(next.difficulty, requestDifficulty)) return;
        setTrash(next); if (next.page !== trashPage) setTrashPage(next.page);
      })
      .catch((requestError: unknown) => { if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setTrash(null); })
      .finally(() => { if (!controller.signal.aborted) setTrashLoading(false); });
    return () => controller.abort();
  }, [difficulty, preview, refreshKey, retryKey, trashPage]);

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
    setDifficulty(next); setPage(1); setHistoryPage(1); setHistory(null); setHistoryLoading(true); setRecentHistory(null); setRecentHistoryLoading(true); setHistoryExpanded(false);
    setTrash(null); setTrashPage(1); setTrashLoading(true); setHistoryView("active"); setManagementMode(false); setSelectedIds(new Set()); setSelectedRecords(new Map()); setSelectAllDifficulty(false); setExcludedIds(new Set()); setDeleteTarget(null); setBulkMenuOpen(false); setDeleteSuccess(""); setRestoreSuccess(""); setMoveSuccess("");
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null; setUndoRecord(null); setUndoError(false);
    if (!preview) { setResponse(null); setError(false); setLoading(true); }
  };
  const changePage = (direction: -1 | 1) => {
    const request = getLeaderboardPageRequest(currentPage, page, direction, totalPages);
    if (request.retry) setRetryKey((value) => value + 1);
    else setPage(request.page);
  };
  const goToMyRank = () => { if (myEntry && myEntry.rank > 3) setPage(Math.floor((myEntry.rank - 4) / PAGE_SIZE) + 1); };
  const selectedCount = selectAllDifficulty ? getBulkSelectedCount(history?.deletable_count ?? 0, excludedIds.size) : selectedIds.size;
  const itemSelected = (item: DaruHistoryItem) => selectAllDifficulty ? !excludedIds.has(item.id) : selectedIds.has(item.id);
  const resetSelection = () => { setSelectedIds(new Set()); setSelectedRecords(new Map()); setSelectAllDifficulty(false); setExcludedIds(new Set()); };
  const toggleItem = (item: DaruHistoryItem) => {
    if (item.is_ranking_record) return;
    setDeleteSuccess("");
    if (selectAllDifficulty) {
      setExcludedIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
      return;
    }
    setSelectedIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
    setSelectedRecords((current) => { const next = new Map(current); if (next.has(item.id)) next.delete(item.id); else next.set(item.id, item); return next; });
  };
  const toggleAll = () => {
    setDeleteSuccess("");
    if (selectAllDifficulty && excludedIds.size === 0) resetSelection();
    else { setSelectedIds(new Set()); setSelectedRecords(new Map()); setSelectAllDifficulty(true); setExcludedIds(new Set()); }
  };
  const enterManagementMode = () => { setHistoryView("active"); setManagementMode(true); resetSelection(); setDeleteSuccess(""); };
  const openTrash = () => { setManagementMode(false); resetSelection(); setHistoryView("trash"); setTrashPage(1); };
  const openHistoryManager = () => { setHistoryView("active"); setHistoryExpanded(true); setBulkMenuOpen(false); setDeleteSuccess(""); };
  const collapseHistoryManager = () => { if (deleting) return; setHistoryExpanded(false); setManagementMode(false); setBulkMenuOpen(false); resetSelection(); setRestoreSuccess(""); window.requestAnimationFrame(() => manageButtonRef.current?.focus()); };
  const leaveManagementMode = () => { if (deleting) return; setManagementMode(false); resetSelection(); setDeleteSuccess(""); };
  const openDeleteDialog = (target: DeleteTarget) => { dialogTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : manageButtonRef.current; setDeleteError(false); setDeleteTarget(target); };
  const closeDeleteDialog = () => { if (deleting) return; setDeleteError(false); setDeleteTarget(null); window.requestAnimationFrame(() => dialogTriggerRef.current?.focus()); };
  const showUndoToast = (item: DaruHistoryItem) => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    setUndoError(false); setUndoRecord(item);
    undoTimerRef.current = window.setTimeout(() => { setUndoRecord(null); undoTimerRef.current = null; }, 6000);
  };
  const showRestoreSuccess = () => {
    if (restoreTimerRef.current !== null) window.clearTimeout(restoreTimerRef.current);
    setMoveSuccess(""); setRestoreSuccess("플레이 기록을 복원했어요.");
    restoreTimerRef.current = window.setTimeout(() => { setRestoreSuccess(""); restoreTimerRef.current = null; }, 3000);
  };
  const showMoveSuccess = (message: string) => {
    if (restoreTimerRef.current !== null) window.clearTimeout(restoreTimerRef.current);
    setRestoreSuccess(""); setMoveSuccess(message);
    restoreTimerRef.current = window.setTimeout(() => { setMoveSuccess(""); restoreTimerRef.current = null; }, 3000);
  };
  const deleteSingleRecord = async (item: DaruHistoryItem) => {
    if (deleting) return;
    setDeleting(true); setDeleteSuccess(""); setUndoError(false);
    setHistory((current) => current ? {
      ...current,
      items: current.items.filter((entry) => entry.id !== item.id),
      total: Math.max(0, current.total - 1),
      total_pages: Math.max(1, Math.ceil(Math.max(0, current.total - 1) / current.page_size)),
    } : current);
    try {
      await deleteDaruGameHistoryRecord(item.id);
      showUndoToast(item);
      resetSelection();
      setRetryKey((value) => value + 1);
    } catch {
      setDeleteSuccess("플레이 기록을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setHistoryLoading(true); setRetryKey((value) => value + 1);
    } finally { setDeleting(false); }
  };
  const undoSingleDelete = async () => {
    const item = undoRecord;
    if (!item || undoing) return;
    setUndoing(true); setUndoError(false);
    try {
      await restoreDaruGameHistoryRecord(item.id);
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null; setUndoRecord(null);
      showRestoreSuccess();
      setHistoryLoading(true); setRetryKey((value) => value + 1);
    } catch { setUndoError(true); } finally { setUndoing(false); }
  };
  const restoreTrashRecord = async (item: DaruHistoryItem) => {
    if (deleting) return;
    setDeleting(true); setDeleteSuccess("");
    try {
      await restoreDaruGameHistoryRecord(item.id);
      showRestoreSuccess(); setTrashLoading(true); setRetryKey((value) => value + 1);
    } catch { setDeleteSuccess("플레이 기록을 복원하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setDeleting(false); }
  };
  useEffect(() => {
    if (!deleteTarget) return;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) { event.preventDefault(); setDeleteError(false); setDeleteTarget(null); window.requestAnimationFrame(() => dialogTriggerRef.current?.focus()); return; }
      if (event.key !== "Tab") return;
      const items = focusable(); if (items.length === 0) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget, deleting]);
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setDeleteError(false);
    const currentHistoryTotal = history?.total ?? 0;
    try {
      let deletedCount = 1;
      if (typeof deleteTarget === "object" && "kind" in deleteTarget && deleteTarget.kind === "permanent") await permanentlyDeleteDaruGameHistoryRecord(deleteTarget.item.id);
      else if (typeof deleteTarget === "object" && "kind" in deleteTarget && deleteTarget.kind === "empty-trash") {
        const result = await emptyDaruGameTrash(selectedDifficulty); deletedCount = result.deleted_count;
      } else if (deleteTarget === "all") {
        const result = await deleteAllDaruGameHistory(); deletedCount = result.deleted_count;
      }
      else if (deleteTarget === "difficulty") {
        const result = await deleteDaruGameHistorySelection({ difficulty: selectedDifficulty }); deletedCount = result.deleted_count;
      } else if (deleteTarget === "selected") {
        const result = selectAllDifficulty
          ? await deleteDaruGameHistorySelection({ difficulty: selectedDifficulty, exclude_record_ids: [...excludedIds] })
          : await deleteDaruGameHistorySelection({ record_ids: [...selectedIds] });
        deletedCount = result.deleted_count;
      } else if (isHistoryItem(deleteTarget)) await deleteDaruGameHistoryRecord(deleteTarget.id);
      setDeleteError(false); setDeleteTarget(null);
      if (deleteTarget === "all" || deleteTarget === "difficulty" || (deleteTarget === "selected" && deletedCount >= currentHistoryTotal)) setManagementMode(false);
      resetSelection();
      if (typeof deleteTarget === "object" && "kind" in deleteTarget) setDeleteSuccess(deleteTarget.kind === "empty-trash" ? `${DIFFICULTY_CONFIG[difficulty].label} 난이도 휴지통을 비웠습니다.` : "플레이 기록을 영구 삭제했습니다.");
      else if (isHistoryItem(deleteTarget)) showMoveSuccess(deleteTarget.is_best && deleteTarget.is_ranking_record ? "기록을 휴지통으로 이동했어요." : deleteTarget.is_best ? "최고 기록을 휴지통으로 이동했어요." : deleteTarget.is_ranking_record ? "랭킹 기록을 휴지통으로 이동했어요." : "휴지통으로 이동했어요.");
      else if (deleteTarget === "all" || deleteTarget === "difficulty") setDeleteSuccess(deletedCount === 0 ? "정리할 수 있는 기록이 없어요. 현재 랭킹 반영 기록은 유지됩니다." : `랭킹 반영 기록을 제외한 플레이 기록 ${deletedCount}개를 휴지통으로 이동했어요.`);
      else setDeleteSuccess(`플레이 기록 ${deletedCount}개를 휴지통으로 이동했습니다.`);
      setHistoryLoading(true); setTrashLoading(true); setRetryKey((value) => value + 1);
    } catch { setDeleteError(true); } finally { setDeleting(false); }
  };
  const selectedItems = [...selectedRecords.values()];
  const deletingBest = typeof deleteTarget === "string"
    ? bulkDeleteIncludesBest(deleteTarget, selectAllDifficulty, history?.has_deletable_best ?? false, history?.has_deletable_best_any_difficulty ?? false, selectedItems.some((item) => item.is_best))
    : Boolean(deleteTarget && isHistoryItem(deleteTarget) && deleteTarget.is_best);
  const deletingRanking = Boolean(deleteTarget && isHistoryItem(deleteTarget) && deleteTarget.is_ranking_record);
  const permanentTarget = deleteTarget && typeof deleteTarget === "object" && "kind" in deleteTarget && deleteTarget.kind === "permanent" ? deleteTarget.item : null;
  const emptyTrashTarget = Boolean(deleteTarget && typeof deleteTarget === "object" && "kind" in deleteTarget && deleteTarget.kind === "empty-trash");
  const dialogRecord = deleteTarget && isHistoryItem(deleteTarget) ? deleteTarget : permanentTarget;

  return <section id="daru-leaderboard" className={styles.leaderboard} aria-labelledby="leaderboard-title" aria-busy={loading}>
    <header className={styles.leaderboardHeader}>
      <div><h2 id="leaderboard-title">🏆 다루 메모리 랭킹</h2><p>기억력 · 속도 · 콤보 · 힌트로 결정돼요 · 가장 최근 정상 클리어가 랭킹에 반영돼요</p></div>
      <details className={styles.rankingInfo}><summary aria-label="메모리 점수 산정 방식 보기">i</summary><div role="note"><strong>메모리 점수</strong><span>기억력 정확도 50%</span><span>탐색 속도 25%</span><span>콤보 15%</span><span>힌트 절약 10%</span><small>제한시간을 초과해도 완주 기록은 등록되며, 속도 점수는 0점으로 계산됩니다.</small><small>동점은 시도 횟수, 플레이 시간, 기록 달성 시각 순으로 결정해요.</small></div></details>
    </header>

    <div className={styles.leaderboardTabs} role="group" aria-label="난이도별 랭킹">
      {(Object.keys(DIFFICULTY_CONFIG) as GameDifficulty[]).map((key) => <button type="button" key={key} aria-pressed={difficulty === key} disabled={deleting} onClick={() => selectDifficulty(key)}>{DIFFICULTY_CONFIG[key].label}</button>)}
    </div>

    <div className={styles.leaderboardGrid} data-loading={loading || undefined}>
      <div className={styles.rankingMain}>
        {error && !visible ? <div className={styles.rankingState} role="alert"><strong>랭킹을 불러오지 못했어요.</strong><span>잠시 후 다시 확인해 주세요.</span><button type="button" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></div> : topEntries.length === 0 && !loading ? <div className={styles.rankingState}><strong>아직 이 난이도의 기록이 없어요.</strong><span>첫 기록의 주인공이 되어보세요!</span></div> : <>
          <section className={styles.topSpotlight} aria-label="TOP 3"><h3>TOP 3</h3><ol>{topEntries.map((entry) => <li key={`${entry.rank}-${entry.nickname}`} data-rank={entry.rank} data-me={entry.is_me || undefined}>{entry.rank === 1 && <span className={styles.topLaurel} aria-hidden="true" />}<b className={styles.topMedal}><span aria-hidden="true">{entry.rank}</span><span className={styles.srOnly}>{entry.rank}위</span></b><span className={styles.rankAvatar} aria-hidden="true" /><strong title={entry.nickname}>{entry.nickname}</strong>{entry.is_me && <span className={styles.topMyBadge} aria-label="내 기록"><PawIcon /></span>}<em>{score(entry)}</em><small>{details(entry)}</small></li>)}</ol></section>
          {total > 3 && <section className={styles.generalRanking} aria-labelledby="general-ranking-title"><div className={styles.rankingSectionTitle}><h3 id="general-ranking-title">다음 순위</h3><span>총 {total}명</span></div><ol className={styles.rankingList}>{entries.map((entry) => <li key={`${entry.rank}-${entry.nickname}`} data-me={entry.is_me || undefined}><b>{entry.rank}</b><span className={styles.rankIdentity}><strong title={entry.nickname}>{entry.nickname}</strong><small>{details(entry)}</small></span>{entry.is_me && <span className={styles.myBadge} aria-label="내 기록"><PawIcon /></span>}<em>{score(entry)}</em></li>)}</ol>{totalPages > 1 && <nav className={styles.rankingPagination} aria-label="일반 랭킹 페이지"><button type="button" aria-label="이전 랭킹 페이지" disabled={currentPage <= 1 || loading} onClick={() => changePage(-1)}><ChevronLeftIcon /></button><span aria-live="polite">{String(currentPage).padStart(2, "0")} / {String(totalPages).padStart(2, "0")}</span><button type="button" aria-label="다음 랭킹 페이지" disabled={currentPage >= totalPages || loading} onClick={() => changePage(1)}><ChevronRightIcon /></button></nav>}</section>}
        </>}
        {error && visible && <p className={styles.inlineRankingError} role="alert">새 랭킹을 불러오지 못했어요. <button type="button" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></p>}
      </div>

      <aside className={styles.myRankCard} aria-labelledby="my-rank-title"><h3 id="my-rank-title">MY RANK</h3>{myEntry ? <><span className={styles.myRankLabel}><TrophyIcon /> 현재 랭킹</span><div className={styles.myRankScore}><strong>{myEntry.rank <= 3 ? <><span aria-hidden="true">{MEDALS[myEntry.rank - 1]}</span><span className={styles.srOnly}>{myEntry.rank}위</span></> : `${myEntry.rank}위`}</strong><em>{score(myEntry)}</em></div><p title={myEntry.nickname}>{myEntry.nickname}</p><small>{details(myEntry)}</small><div className={styles.rankGap}>{gapMessage}</div>{myEntry.rank <= 3 ? <div className={styles.myRankLocation}><PawIcon /> TOP 3에서 확인 중</div> : isMyRankVisible ? <div className={styles.myRankLocation}><PawIcon /> 현재 순위 확인 중</div> : <button type="button" onClick={goToMyRank}><PawIcon /> 내 순위로 이동 ›</button>}</> : <div className={styles.noMyRank}><strong>현재 랭킹 미등록</strong><span>게임을 한 번 완료하면 다시 랭킹에 등록돼요.</span></div>} {visible?.my_best?.best_attempts != null && <div className={styles.personalBest}><span><CrownIcon /> 개인 BEST</span><strong>{formatMemoryScore(visible.my_best.best_detection_power)}</strong></div>}</aside>
      {loading && <div className={styles.rankingLoading} role="status">랭킹을 불러오는 중이에요.</div>}
    </div>
    {!preview && <section className={`${styles.playHistory} ${styles.historySummary}`} data-expanded={historyExpanded || undefined} aria-labelledby="play-history-title" aria-busy={historyExpanded ? historyView === "trash" ? trashLoading : historyLoading : recentHistoryLoading}>
      <header><div><HistoryIcon /><span><h3 id="play-history-title">내 플레이 기록</h3><small>총 {recentHistory?.total ?? 0}회</small></span></div><button ref={manageButtonRef} type="button" className={styles.historyExpandAction} aria-expanded={historyExpanded} aria-controls="history-manager" onClick={historyExpanded ? collapseHistoryManager : openHistoryManager}>{historyExpanded ? "간단히 보기" : <>전체 기록 {recentHistory?.total ?? 0}개 <ChevronRightIcon /></>}</button></header>
      {!historyExpanded ? (recentHistoryLoading && !recentHistory ? <div className={styles.historySummarySkeleton} role="status" aria-label="최근 플레이 기록을 불러오는 중"><i /><i /><i /></div> : !recentHistory ? <div className={styles.historyInlineError} role="alert"><span>기록을 불러오지 못했어요.</span><button type="button" onClick={() => { setRecentHistoryLoading(true); setRetryKey((value) => value + 1); }}>다시 시도</button></div> : recentHistory.items.length === 0 ? <div className={styles.historyEmpty}><HistoryIcon /><strong>아직 플레이 기록이 없어요.</strong><span>게임을 완료하면 여기에 기록이 차곡차곡 쌓여요.</span></div> : <ul className={styles.historySummaryList}>{recentHistory.items.slice(0, 3).map((item) => <li key={item.id}><time dateTime={item.achieved_at}>{new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.achieved_at))}</time><strong>{formatMemoryScore(item.detection_power)}</strong><span>{item.attempts}회 · {formatElapsedTime(item.elapsed_seconds)} · 최고 콤보 {item.max_combo} · 힌트 {item.hints_used}회</span><div>{!item.completed && <em><ClockIcon /> 미완주</em>}{item.is_best && <em data-best><CrownIcon /> BEST</em>}{item.is_ranking_record && <em data-ranking><PawIcon /> 랭킹 반영</em>}</div></li>)}</ul>) : <div id="history-manager" className={styles.historyManager}>
      <div className={styles.historyManagerTabs} role="tablist" aria-label="플레이 기록 보기"><button type="button" role="tab" aria-selected={historyView === "active"} onClick={() => { setHistoryView("active"); setManagementMode(false); resetSelection(); }}>전체 기록 <strong>{history?.total ?? recentHistory?.total ?? 0}</strong></button><button type="button" role="tab" aria-selected={historyView === "trash"} onClick={openTrash}>휴지통 <strong>{trash?.total ?? 0}</strong></button></div>
      <div className={styles.historyManagerBody} data-view={historyView} aria-busy={historyView === "trash" ? trashLoading : historyLoading}>
        {historyView === "active" ? <>
          <div className={styles.historyManagerToolbar}>{managementMode ? <><span aria-live="polite">{selectedCount}개 선택</span><button type="button" onClick={leaveManagementMode} disabled={deleting}>완료</button></> : <><span>최근 기록부터 표시됩니다.</span><div className={styles.historyToolbarActions}><button type="button" onClick={enterManagementMode} disabled={(history?.total ?? 0) === 0}><ListChecksIcon /> 기록 관리</button><div ref={bulkMenuRef} className={styles.historyBulkMenu}><button type="button" aria-label="기록 관리 옵션" aria-haspopup="menu" aria-expanded={bulkMenuOpen} onClick={() => setBulkMenuOpen((open) => !open)}>⋯</button>{bulkMenuOpen && <div role="menu"><strong>기록 관리 옵션</strong><button type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); openDeleteDialog("difficulty"); }}>현재 난이도 기록 정리</button><button type="button" role="menuitem" onClick={() => { setBulkMenuOpen(false); openDeleteDialog("all"); }}>모든 난이도 기록 정리</button></div>}</div></div></>}</div>
          {deleteSuccess && <p className={styles.historySuccess} role="status">{deleteSuccess}</p>}
          <div className={styles.historyManagerListViewport}>{historyLoading && !history ? <div className={styles.historyManagerSkeleton} role="status" aria-label="전체 플레이 기록을 불러오는 중"><i /><i /><i /><i /><i /></div> : !history ? <div className={styles.historyInlineError} role="alert"><span>기록을 불러오지 못했어요.</span><button type="button" onClick={() => { setHistoryLoading(true); setRetryKey((value) => value + 1); }}>다시 시도</button></div> : history.items.length === 0 ? <div className={styles.historyEmpty}><HistoryIcon /><strong>아직 플레이 기록이 없어요.</strong></div> : <ul data-managing={managementMode || undefined}>{history.items.map((item) => <li key={item.id} data-selected={managementMode && itemSelected(item) || undefined}>{managementMode && !item.is_ranking_record && <label className={styles.historyCheckbox}><input type="checkbox" checked={itemSelected(item)} disabled={deleting} onChange={() => toggleItem(item)} aria-label={`${formatMemoryScore(item.detection_power)}점 기록 선택`} /><span aria-hidden="true" /></label>}<time dateTime={item.achieved_at}>{new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.achieved_at))}</time><strong>{formatMemoryScore(item.detection_power)}</strong><span>{item.attempts}회 · {formatElapsedTime(item.elapsed_seconds)} · 최고 콤보 {item.max_combo} · 힌트 {item.hints_used}회</span><div>{!item.completed && <em><ClockIcon /> 미완주</em>}{item.is_best && <em data-best><CrownIcon /> BEST</em>}{item.is_ranking_record && <em data-ranking><PawIcon /> 랭킹 반영</em>}</div>{!managementMode && <button type="button" aria-label="플레이 기록을 휴지통으로 이동" disabled={deleting} onClick={() => item.is_best || item.is_ranking_record ? openDeleteDialog(item) : void deleteSingleRecord(item)}><TrashIcon /></button>}</li>)}</ul>}</div>
          {(history?.total_pages ?? 1) > 1 && <nav className={styles.historyManagerPagination} aria-label="전체 기록 페이지"><button type="button" aria-label="이전 기록 페이지" disabled={(history?.page ?? 1) <= 1 || historyLoading} onClick={() => { setHistoryLoading(true); setHistoryPage((value) => Math.max(1, value - 1)); }}><ChevronLeftIcon /></button>{compactPaginationPages(history?.page ?? 1, history?.total_pages ?? 1).map((number) => <button type="button" key={number} aria-label={`전체 기록 ${number}페이지`} aria-current={(history?.page ?? 1) === number ? "page" : undefined} onClick={() => { setHistoryLoading(true); setHistoryPage(number); }}>{number}</button>)}<button type="button" aria-label="다음 기록 페이지" disabled={(history?.page ?? 1) >= (history?.total_pages ?? 1) || historyLoading} onClick={() => { setHistoryLoading(true); setHistoryPage((value) => value + 1); }}><ChevronRightIcon /></button></nav>}
          {managementMode && (history?.total ?? 0) > 0 && <div className={styles.historyManagement}><button type="button" onClick={toggleAll} disabled={deleting}>{selectAllDifficulty && excludedIds.size === 0 ? "선택 해제" : "전체 선택"}</button><span aria-hidden="true">{selectedCount}개 선택</span><button type="button" className={styles.selectedDelete} aria-label="선택한 플레이 기록을 휴지통으로 이동" disabled={selectedCount === 0 || deleting} onClick={() => { const only = selectedCount === 1 && !selectAllDifficulty ? selectedItems[0] : null; if (only) { if (only.is_best) openDeleteDialog(only); else void deleteSingleRecord(only); } else openDeleteDialog("selected"); }}><TrashIcon /> {selectedCount > 0 ? `${selectedCount}개 휴지통으로 이동` : "휴지통으로 이동"}</button></div>}
        </> : <>
          <div className={styles.trashIntro}><p>휴지통에 보관된 기록은 복원하거나 영구 삭제할 수 있어요.</p>{(trash?.total ?? 0) > 0 && <button type="button" onClick={() => openDeleteDialog({ kind: "empty-trash" })}><TrashIcon /> 휴지통 비우기</button>}</div>
          {deleteSuccess && <p className={styles.historySuccess} role="status">{deleteSuccess}</p>}
          <div className={styles.historyManagerListViewport}>{trashLoading && !trash ? <div className={styles.historyManagerSkeleton} role="status" aria-label="휴지통 기록을 불러오는 중"><i /><i /><i /><i /><i /></div> : !trash ? <div className={styles.historyInlineError} role="alert"><span>휴지통을 불러오지 못했어요.</span><button type="button" onClick={() => { setTrashLoading(true); setRetryKey((value) => value + 1); }}>다시 시도</button></div> : trash.items.length === 0 ? <div className={styles.historyEmpty}><strong>휴지통이 비어 있어요.</strong></div> : <ul className={styles.trashList}>{trash.items.map((item) => <li key={item.id}><time dateTime={item.achieved_at}>{new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.achieved_at))}</time><strong>{formatMemoryScore(item.detection_power)}</strong><span>{item.attempts}회 · {formatElapsedTime(item.elapsed_seconds)} · 최고 콤보 {item.max_combo}<small>삭제됨 {item.deleted_at ? new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.deleted_at)) : ""}</small></span><div className={styles.trashActions}><button type="button" onClick={() => void restoreTrashRecord(item)} disabled={deleting}><RestoreIcon /> 복원</button><button type="button" onClick={() => openDeleteDialog({ kind: "permanent", item })} disabled={deleting}><TrashIcon /> 영구 삭제</button></div></li>)}</ul>}</div>
          {(trash?.total_pages ?? 1) > 1 && <nav className={styles.historyManagerPagination} aria-label="휴지통 페이지"><button type="button" aria-label="이전 휴지통 페이지" disabled={(trash?.page ?? 1) <= 1 || trashLoading} onClick={() => { setTrashLoading(true); setTrashPage((value) => Math.max(1, value - 1)); }}><ChevronLeftIcon /></button>{compactPaginationPages(trash?.page ?? 1, trash?.total_pages ?? 1).map((number) => <button type="button" key={number} aria-label={`휴지통 ${number}페이지`} aria-current={(trash?.page ?? 1) === number ? "page" : undefined} onClick={() => { setTrashLoading(true); setTrashPage(number); }}>{number}</button>)}<button type="button" aria-label="다음 휴지통 페이지" disabled={(trash?.page ?? 1) >= (trash?.total_pages ?? 1) || trashLoading} onClick={() => { setTrashLoading(true); setTrashPage((value) => value + 1); }}><ChevronRightIcon /></button></nav>}
        </>}
      </div>
      </div>}
    </section>}
    {deleteTarget && <div className={styles.deleteBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) closeDeleteDialog(); }}><div ref={dialogRef} className={styles.deleteDialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">{permanentTarget || emptyTrashTarget ? <TrashIcon /> : deletingRanking ? <PawIcon /> : deletingBest ? <CrownIcon /> : <TrashIcon />}{deletingBest && dialogRecord && <strong className={styles.deleteEyebrow}>BEST RECORD</strong>}<h3 id="delete-title">{permanentTarget ? "이 플레이 기록을 영구 삭제할까요?" : emptyTrashTarget ? `${DIFFICULTY_CONFIG[difficulty].label} 난이도 휴지통을 비울까요?` : deleteTarget === "selected" ? `선택한 플레이 기록 ${selectedCount}개를 휴지통으로 이동할까요?` : deleteTarget === "difficulty" ? `현재 ‘${DIFFICULTY_CONFIG[difficulty].label}’ 기록을 휴지통으로 이동할까요?` : deleteTarget === "all" ? "모든 난이도의 기록을 정리할까요?" : deletingBest && deletingRanking ? "현재 BEST이자 랭킹 기록이에요." : deletingBest ? "최고 기록을 휴지통으로 이동할까요?" : deletingRanking ? "현재 랭킹 기록을 휴지통으로 이동할까요?" : "이 플레이 기록을 휴지통으로 이동할까요?"}</h3><p id="delete-description">{permanentTarget ? "영구 삭제한 기록은 다시 복구할 수 없어요." : emptyTrashTarget ? `휴지통의 ${trash?.total ?? 0}개 기록이 영구 삭제됩니다. 이 작업은 되돌릴 수 없어요.` : deleteTarget === "all" ? "각 난이도의 현재 랭킹 반영 기록은 보호되며, 그 외 쉬움 · 보통 · 어려움 기록이 휴지통으로 이동합니다. 휴지통에서는 다시 복원할 수 있어요." : deleteTarget === "difficulty" ? `현재 랭킹에 반영 중인 기록은 보호되며, 그 외 ${DIFFICULTY_CONFIG[difficulty].label} 난이도 기록이 휴지통으로 이동합니다. 휴지통에서는 다시 복원할 수 있어요.` : deletingBest && deletingRanking ? "휴지통으로 이동하면 개인 BEST가 다시 계산되고 현재 랭킹에서도 제외됩니다." : deletingBest ? "이 기록을 이동하면 남아 있는 정상 플레이 중 가장 높은 기록이 새로운 BEST가 됩니다." : deletingRanking ? "이 기록은 현재 랭킹에 사용 중이에요. 휴지통으로 이동하면 현재 랭킹에서 제외되며 이전 기록이 자동으로 등록되지는 않아요." : "선택한 기록은 휴지통에서 다시 복원할 수 있어요."}</p>{dialogRecord && deletingBest && <div className={styles.bestDeleteSummary}><span>{DIFFICULTY_CONFIG[difficulty].label}</span><strong>{formatMemoryScore(dialogRecord.detection_power)}점</strong><small>{dialogRecord.attempts}회 · {formatElapsedTime(dialogRecord.elapsed_seconds)}</small><em><CrownIcon /> BEST</em></div>}{deleteTarget === "selected" && !selectAllDifficulty && selectedItems.length > 0 && <ul className={styles.deleteSummary}>{selectedItems.slice(0, 3).map((item) => <li key={item.id}>{formatMemoryScore(item.detection_power)}{item.is_best && " · BEST"}</li>)}{selectedItems.length > 3 && <li>외 {selectedItems.length - 3}개</li>}</ul>}{deleteError && <p role="alert">요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}<div><button type="button" autoFocus onClick={closeDeleteDialog} disabled={deleting}>취소</button><button type="button" onClick={() => void confirmDelete()} disabled={deleting}>{deleting ? "처리 중..." : permanentTarget ? "영구 삭제" : emptyTrashTarget ? "휴지통 비우기" : deletingRanking ? "랭킹에서 제외하고 이동" : deleteTarget === "all" ? "기록 정리" : "휴지통으로 이동"}</button></div></div></div>}
    {undoRecord && <div className={styles.historyUndoToast} role="status"><TrashIcon /><span>{undoError ? "기록을 복원하지 못했어요. 다시 시도해 주세요." : "휴지통으로 이동했어요."}</span><button type="button" onClick={() => void undoSingleDelete()} disabled={undoing}>{undoing ? "복원 중..." : "되돌리기"}</button></div>}
    {restoreSuccess && !undoRecord && <div className={styles.historyRestoreToast} role="status"><RestoreIcon /><span>{restoreSuccess}</span></div>}
    {moveSuccess && !undoRecord && <div className={styles.historyMoveToast} role="status"><TrashIcon /><span>{moveSuccess}</span></div>}
  </section>;
}
