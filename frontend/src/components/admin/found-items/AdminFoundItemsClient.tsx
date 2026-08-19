"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "@/components/common/Icon";
import { AdminFoundItemsApiError, listAdminFoundItems, updateAdminFoundItem, type AdminFoundItem, type AdminFoundItemUpdate } from "@/lib/adminFoundItemsApi";
import { resolveFoundItemImageUrl } from "@/lib/foundItemsApi";
import styles from "./AdminFoundItemsClient.module.css";

const lifecycleStatuses = [
  { value: "DETECTED", label: "탐지됨" },
  { value: "RECOVERED", label: "회수됨" },
  { value: "AVAILABLE", label: "보관 중" },
  { value: "CLAIM_PENDING", label: "소유권 확인 중" },
  { value: "RETURNED", label: "반환 완료" },
  { value: "DISPOSED", label: "폐기됨" },
] as const;

const editableStatuses = lifecycleStatuses.filter((item) => ["RECOVERED", "AVAILABLE", "DISPOSED"].includes(item.value));

const statusFilters = [
  { value: "", label: "전체" },
  ...lifecycleStatuses,
] as const;

const pageSizeOptions = [
  { value: "5", label: "5개" },
  { value: "10", label: "10개" },
] as const;

const categoryOptions = [
  { value: "", label: "모든 물품" },
  { value: "BALL", label: "공" },
  { value: "BAG", label: "가방" },
  { value: "UMBRELLA", label: "우산" },
  { value: "FOOTWEAR", label: "신발·슬리퍼류" },
] as const;

const statusLabels = Object.fromEntries(lifecycleStatuses.map((item) => [item.value, item.label]));
const sourceLabels: Record<AdminFoundItem["source_type"], string> = {
  AI: "AI 탐지",
  CITIZEN: "시민 신고",
  ADMIN: "관리자 등록",
};
const formatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });

type Option = { value: string; label: string };
type PendingNavigation = { type: "select"; item: AdminFoundItem } | { type: "close" } | null;

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "일시 확인 중" : formatter.format(parsed);
}

function ItemImage({ item, compact = false }: { item: AdminFoundItem; compact?: boolean }) {
  const originalUrl = resolveFoundItemImageUrl(item.image_url);
  const [failedUrl, setFailedImageUrl] = useState<string | null>(null);
  const resolved = originalUrl && failedUrl !== originalUrl ? originalUrl : null;
  return (
    <span className={compact ? styles.thumb : styles.image}>
      {resolved ? <img src={resolved} alt={`${item.item_category_name} 발견물 이미지`} onError={() => setFailedImageUrl(resolved)} /> : <span className={styles.imagePlaceholder}><Icon name="fileSearch" size={compact ? 23 : 38} /><small>등록된 사진 없음</small></span>}
    </span>
  );
}

function CustomSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [active, setActive] = useState(selectedIndex);
  const root = useRef<HTMLDivElement>(null);
  const current = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const choose = (index: number) => {
    onChange(options[index].value);
    setActive(index);
    setOpen(false);
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? (index + 1) % options.length : (index - 1 + options.length) % options.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active); else setOpen(true);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={styles.select} ref={root}>
      <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onKeyDown={keyDown} onClick={() => { setActive(selectedIndex); setOpen((state) => !state); }}>
        <span>{current.label}</span><Icon name="chevron" size={15} />
      </button>
      {open && (
        <div role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <button type="button" role="option" aria-selected={option.value === value} data-active={active === index} key={option.value || "all"} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>{option.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function DateFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = value ? new Date(`${value}T00:00:00`) : null;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => selected && !Number.isNaN(selected.getTime()) ? new Date(selected.getFullYear(), selected.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const root = useRef<HTMLDivElement>(null);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const leading = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Array.from({ length: leading + days }, (_, index) => index < leading ? null : index - leading + 1);
  const valueFor = (day: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [open]);

  return <div className={styles.datePicker} ref={root}>
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}><Icon name="clock" size={16} /><span>{value || "전체 날짜"}</span><Icon name="chevron" size={14} /></button>
    {open && <div className={styles.calendar} role="dialog" aria-label="발견일 선택">
      <div className={styles.calendarHead}><button type="button" aria-label="이전 달" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}><Icon name="chevron" size={15} /></button><strong>{year}년 {monthIndex + 1}월</strong><button type="button" aria-label="다음 달" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}><Icon name="chevron" size={15} /></button></div>
      <div className={styles.weekdays}>{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className={styles.calendarDays}>{cells.map((day, index) => day ? <button type="button" aria-label={`${year}년 ${monthIndex + 1}월 ${day}일`} aria-pressed={value === valueFor(day)} key={day} onClick={() => { onChange(valueFor(day)); setOpen(false); }}>{day}</button> : <i key={`empty-${index}`} />)}</div>
      <button type="button" className={styles.clearDate} disabled={!value} onClick={() => { onChange(""); setOpen(false); }}>날짜 선택 해제</button>
    </div>}
  </div>;
}

function ConfirmDialog({ onCancel, onDiscard }: { onCancel: () => void; onDiscard: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  return (
    <div className={styles.confirmBackdrop} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description">
        <Icon name="info" size={22} />
        <h2 id="discard-title">저장하지 않은 변경사항이 있습니다.</h2>
        <p id="discard-description">이동하면 입력한 내용이 사라집니다. 변경사항을 버리고 계속할까요?</p>
        <div><button ref={cancelRef} type="button" className="button button-secondary" onClick={onCancel}>계속 편집</button><button type="button" className="button button-primary" onClick={onDiscard}>변경사항 버리기</button></div>
      </section>
    </div>
  );
}

export function AdminFoundItemsClient() {
  const [items, setItems] = useState<AdminFoundItem[]>([]);
  const [selected, setSelected] = useState<AdminFoundItem | null>(null);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [area, setArea] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [storage, setStorage] = useState("");
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const filtersActive = Boolean(query || categoryFilter || statusFilter || dateFilter);
  const locationDirty = Boolean(
    selected && (area.trim() !== selected.area_name || latitude.trim() || longitude.trim()),
  );
  const dirty = Boolean(selected && (status !== selected.status || locationDirty || storage.trim() !== (selected.storage_location ?? "") || memo.trim()));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const lifecycleTotal = lifecycleStatuses.reduce((sum, item) => sum + (statusCounts[item.value] ?? 0), 0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const data = await listAdminFoundItems({
        skip: (page - 1) * pageSize,
        limit: pageSize,
        q: query,
        item_category: categoryFilter,
        status: statusFilter,
        found_date: dateFilter,
      }, signal);
      setItems(data.items);
      setTotal(data.total);
      setStatusCounts(Object.fromEntries(data.status_counts.map((item) => [item.status, item.count])));
      const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
      if (page > lastPage) setPage(lastPage);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError("발견물 목록을 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [categoryFilter, dateFilter, page, pageSize, query, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, query]);

  const applySelection = useCallback(async (item: AdminFoundItem) => {
    setDetailLoading(true);
    setMessage("");
    setSaveError("");
    setStorage(item.storage_location ?? "");
    setMemo("");
    setStatus(item.status);
    setArea(item.area_name);
    setLatitude("");
    setLongitude("");
    setSelected(item);
    setDetailLoading(false);
  }, []);

  const requestSelection = (item: AdminFoundItem) => {
    if (selected?.id === item.id) return;
    if (dirty) setPendingNavigation({ type: "select", item });
    else void applySelection(item);
  };
  const applyClose = useCallback(() => {
    setSelected(null);
    setStatus("");
    setArea("");
    setLatitude("");
    setLongitude("");
    setStorage("");
    setMemo("");
    setMessage("");
    setSaveError("");
  }, []);
  const requestClose = useCallback(() => {
    if (dirty) setPendingNavigation({ type: "close" });
    else applyClose();
  }, [applyClose, dirty]);

  useEffect(() => {
    if (!selected) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingNavigation) requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingNavigation, requestClose, selected]);

  const discardAndNavigate = () => {
    const pending = pendingNavigation;
    setPendingNavigation(null);
    if (pending?.type === "select") void applySelection(pending.item);
    else if (pending?.type === "close") applyClose();
  };

  const save = async () => {
    if (!selected || !dirty) return;
    setSaving(true);
    setMessage("");
    setSaveError("");
    try {
      const update: AdminFoundItemUpdate = {};
      if (status !== selected.status) update.status = status;
      if (area.trim() !== selected.area_name) update.area_name = area.trim();
      if (latitude.trim()) {
        const parsedLatitude = Number(latitude);
        if (!Number.isFinite(parsedLatitude)) throw new AdminFoundItemsApiError("위도는 숫자로 입력해 주세요.");
        update.latitude = parsedLatitude;
      }
      if (longitude.trim()) {
        const parsedLongitude = Number(longitude);
        if (!Number.isFinite(parsedLongitude)) throw new AdminFoundItemsApiError("경도는 숫자로 입력해 주세요.");
        update.longitude = parsedLongitude;
      }
      if (storage.trim()) update.storage_location = storage.trim();
      if (memo.trim()) update.admin_memo = memo.trim();
      await updateAdminFoundItem(selected.id, update);
      setPageMessage(`발견물 #${selected.id}의 관리 정보를 저장했습니다.`);
      setStorage(storage.trim());
      setMemo("");
      setLatitude("");
      setLongitude("");
      setMessage("변경사항을 저장했습니다.");
      const updatedStatus = status;
      const updatedArea = area.trim();
      setSelected((current) => current
        ? { ...current, status: updatedStatus, area_name: updatedArea || current.area_name, storage_location: storage.trim() || current.storage_location }
        : current);
      await load();
      if (statusFilter && updatedStatus !== statusFilter) applyClose();
    } catch (reason) {
      setSaveError(reason instanceof AdminFoundItemsApiError ? reason.message : "관리 정보를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const resetFilters = () => {
    setQuery("");
    setCategoryFilter("");
    setStatusFilter("");
    setDateFilter("");
    setPage(1);
  };

  const changePageSize = (value: string) => {
    setPageSize(Number(value));
    setPage(1);
  };

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p>ADMIN · FOUND ITEM REGISTER</p><h1>발견물 대장</h1><span>등록된 발견물의 현재 상태와 전체 처리 이력을 확인하세요.</span></div>
        <nav className={styles.viewSwitch} aria-label="발견물 대장 보기 방식"><Link href="/admin/found-items" aria-current="page"><Icon name="archive" size={15} />목록 보기</Link><Link href="/admin/map"><Icon name="location" size={15} />지도 보기</Link></nav>
      </header>

      <section className={styles.statusSummary} aria-label="발견물 상태별 전체 건수" aria-busy={loading}>
        <button type="button" aria-pressed={!statusFilter} onClick={() => { setStatusFilter(""); setPage(1); }}><span>전체</span><strong>{loading ? "–" : lifecycleTotal}</strong></button>
        {lifecycleStatuses.map((item) => <button type="button" aria-pressed={statusFilter === item.value} key={item.value} onClick={() => { setStatusFilter(item.value); setPage(1); }}><span>{item.label}</span><strong>{loading ? "–" : statusCounts[item.value] ?? 0}</strong></button>)}
      </section>

      <section className={styles.toolbar} aria-label="발견물 검색 및 필터">
        <label className={styles.searchField}><Icon name="search" size={18} /><span className="sr-only">발견물 검색</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="발견물 ID, 물품 종류, 장소, 보관 위치 검색" /></label>
        <CustomSelect label="물품 종류 필터" value={categoryFilter} options={categoryOptions} onChange={(value) => { setCategoryFilter(value); setPage(1); }} />
        <CustomSelect label="상태 필터" value={statusFilter} options={statusFilters} onChange={(value) => { setStatusFilter(value); setPage(1); }} />
        <DateFilter value={dateFilter} onChange={(value) => { setDateFilter(value); setPage(1); }} />
        <button type="button" className={styles.resetButton} disabled={!filtersActive} onClick={resetFilters}>초기화</button>
      </section>

      <div className={styles.businessFilters} role="group" aria-label="발견물 업무 상태">
        <span>업무 상태</span>
        {statusFilters.map((option) => <button type="button" key={option.value || "all"} aria-pressed={statusFilter === option.value} onClick={() => { setStatusFilter(option.value); setPage(1); }}>{option.label}</button>)}
      </div>

      {pageMessage && <p className={styles.pageFeedback} role="status">{pageMessage}</p>}

      <section className={styles.listSection} aria-labelledby="found-item-list-title" aria-busy={loading}>
        <div className={styles.listHeading}><div><p>OFFICIAL REGISTER</p><h2 id="found-item-list-title">전체 발견물 기록</h2><span>초기 탐지부터 반환·폐기까지 공식 발견물의 lifecycle을 확인합니다.</span></div>{!loading && !error && <strong>필터 결과 {total}건</strong>}</div>

        {loading ? (
          <div className={styles.state} role="status"><i /><i /><i /><span>발견물 목록을 불러오는 중입니다.</span></div>
        ) : error ? (
          <div className={`${styles.state} ${styles.error}`} role="alert"><Icon name="info" size={27} /><strong>발견물 목록을 불러오지 못했습니다.</strong><span>{error}</span><button type="button" onClick={() => void load()}>다시 불러오기</button></div>
        ) : !items.length ? (
          <div className={styles.state}><Icon name="archive" size={32} /><strong>{query ? "검색 조건에 맞는 발견물이 없어요" : statusFilter ? `${statusLabels[statusFilter]} 상태의 발견물이 없어요` : filtersActive ? "조건에 맞는 발견물이 없어요" : "등록된 발견물이 아직 없어요"}</strong><span>{filtersActive ? "검색어나 필터를 변경해보세요." : "AI 탐지 또는 시민 신고가 공식 발견물로 등록되면 이곳에서 관리할 수 있습니다."}</span>{filtersActive && <button type="button" onClick={resetFilters}>필터 초기화</button>}</div>
        ) : (
          <div className={styles.tableWrap}><table className={styles.itemTable}><thead><tr><th>발견물</th><th>발견 위치</th><th>발견 시각</th><th>현재 상태</th><th>출처</th><th>보관 위치</th><th>최근 업데이트</th><th>작업</th></tr></thead><tbody>{items.map((item) => (
            <tr key={item.id} data-selected={selected?.id === item.id || undefined}>
              <td data-label="발견물"><span className={styles.itemIdentity}><ItemImage item={item} compact /><span><b>{item.color ? `${item.color} ` : ""}{item.item_category_name}</b><small>발견물 #{item.id}</small></span></span></td>
              <td data-label="발견 위치" title={item.area_name}>{item.area_name || "위치 정보 없음"}</td>
              <td data-label="발견 시각"><time dateTime={item.found_at}>{formatDate(item.found_at)}</time></td>
              <td data-label="현재 상태"><span className={`${styles.statusBadge} ${styles[`status${item.status}`] ?? ""}`}>{statusLabels[item.status] ?? item.status}</span></td>
              <td data-label="출처"><span className={styles.source}>{sourceLabels[item.source_type]}</span></td>
              <td data-label="보관 위치" title={item.storage_location ?? undefined}>{item.storage_location || "미지정"}</td>
              <td data-label="최근 업데이트"><time dateTime={item.updated_at}>{formatDate(item.updated_at)}</time></td>
              <td data-label="작업"><button type="button" aria-label={`${item.item_category_name} 발견물 관리 열기`} onClick={() => requestSelection(item)}>관리</button></td>
            </tr>
          ))}</tbody></table></div>
        )}
        {!loading && !error && items.length > 0 && <footer className={styles.paginationFooter}>
          <div className={styles.pageSizeControl}><span>페이지당</span><CustomSelect label="페이지당 표시 개수" value={String(pageSize)} options={pageSizeOptions} onChange={changePageSize} /></div>
          <nav className={styles.pagination} aria-label="발견물 목록 페이지"><button type="button" aria-label="이전 페이지" disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))}><Icon name="chevronLeft" size={16} /></button><span aria-live="polite"><strong>{safePage}</strong><span> / {totalPages}</span></span><button type="button" aria-label="다음 페이지" disabled={safePage === totalPages} onClick={() => setPage(Math.min(totalPages, safePage + 1))}><Icon name="chevronRight" size={16} /></button></nav>
          <strong className={styles.totalCount}>총 {total}건</strong>
        </footer>}
      </section>

      {selected && (
        <div className={styles.drawerBackdrop} onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="admin-found-item-title" aria-busy={detailLoading}>
            <header className={styles.drawerHeader}>
              <div><p>FOUND ITEM #{selected.id}</p><h2 id="admin-found-item-title">{selected.color ? `${selected.color} ` : ""}{selected.item_category_name}</h2><span className={`${styles.statusBadge} ${styles[`status${selected.status}`] ?? ""}`}>{statusLabels[selected.status] ?? selected.status}</span></div>
              <button ref={closeButtonRef} type="button" onClick={requestClose} aria-label="발견물 관리 닫기"><Icon name="close" size={20} /></button>
            </header>

            <div className={styles.drawerBody}>
              <section className={styles.readSection} aria-labelledby="found-read-title">
                <div className={styles.sectionTitle}><span>A</span><div><h3 id="found-read-title">발견 정보</h3><p>원본 발견 정보 · 읽기 전용</p></div></div>
                <ItemImage item={selected} />
                <dl>
                  <div><dt>식별 번호</dt><dd>#{selected.id}</dd></div>
                  <div><dt>물품 종류</dt><dd>{selected.item_category_name}</dd></div>
                  <div><dt>발견 위치</dt><dd>{selected.area_name}</dd></div>
                  <div><dt>발견 시각</dt><dd>{formatDate(selected.found_at)}</dd></div>
                  <div><dt>출처</dt><dd>{sourceLabels[selected.source_type]}</dd></div>
                  <div><dt>등록 시각</dt><dd>{formatDate(selected.created_at)}</dd></div>
                  <div className={styles.wide}><dt>공개 특징</dt><dd>{selected.public_description || "등록된 공개 특징이 없습니다."}</dd></div>
                </dl>
                <p className={styles.contractNotice}><Icon name="info" size={17} />현재 API 응답에는 AI confidence가 포함되지 않아 표시하지 않습니다.</p>
              </section>

              <section className={styles.editSection} aria-labelledby="found-edit-title">
                <div className={styles.sectionTitle}><span>B</span><div><h3 id="found-edit-title">관리 정보</h3><p>회수 상태와 지도 표시 위치를 함께 보정합니다.</p></div></div>
                {editableStatuses.some((item) => item.value === selected.status) ? <label><span>상태</span><CustomSelect label="발견물 상태" value={status} options={editableStatuses} onChange={setStatus} disabled={saving} /></label> : <div className={styles.readonlyStatus}><span>상태</span><strong>{statusLabels[selected.status] ?? selected.status}</strong><small>이 상태는 담당 업무 처리 화면에서 변경합니다.</small>{selected.status === "CLAIM_PENDING" && <Link href="/admin/ownership-claims">소유권 요청 처리로 이동</Link>}</div>}
                <label><span>발견 지역</span><input value={area} onChange={(event) => { setArea(event.target.value); setSaveError(""); }} maxLength={100} disabled={saving} placeholder="예: 수원역 4번 출구" /></label>
                <div className={styles.coordinateGrid}>
                  <label><span>위도 <i>선택</i></span><input value={latitude} onChange={(event) => { setLatitude(event.target.value); setSaveError(""); }} inputMode="decimal" disabled={saving} placeholder="예: 37.2656" /></label>
                  <label><span>경도 <i>선택</i></span><input value={longitude} onChange={(event) => { setLongitude(event.target.value); setSaveError(""); }} inputMode="decimal" disabled={saving} placeholder="예: 127.0001" /></label>
                </div>
                <label><span>보관 위치 <i>변경할 때만 입력</i></span><input value={storage} onChange={(event) => { setStorage(event.target.value); setSaveError(""); }} maxLength={255} disabled={saving} placeholder="예: 관리실 보관함 A-3" /></label>
                <label><span>관리자 메모 <i>변경할 때만 입력</i></span><textarea value={memo} onChange={(event) => { setMemo(event.target.value); setSaveError(""); }} maxLength={2000} disabled={saving} placeholder="처리 과정에서 필요한 메모" rows={4} /></label>
                <p className={styles.contractNotice}><Icon name="info" size={17} />좌표를 직접 입력하면 Kakao 검색 없이 저장합니다. 좌표를 비우고 회수 확인으로 저장하면 발견 지역으로 지도 좌표를 검색합니다.</p>
                {message && <p className={styles.success} role="status">{message}</p>}
                {saveError && <p className={styles.saveError} role="alert">{saveError}</p>}
              </section>
            </div>

            <footer className={styles.drawerFooter}><span>{dirty ? "저장하지 않은 변경사항이 있습니다." : "변경사항이 없습니다."}</span><button type="button" className="button button-secondary" disabled={saving} onClick={requestClose}>닫기</button><button type="button" className="button button-primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "저장 중..." : "변경사항 저장"}</button></footer>
          </aside>
        </div>
      )}

      {pendingNavigation && <ConfirmDialog onCancel={() => setPendingNavigation(null)} onDiscard={discardAndNavigate} />}
    </main>
  );
}
