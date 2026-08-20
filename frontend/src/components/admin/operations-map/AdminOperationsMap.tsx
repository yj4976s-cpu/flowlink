"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/common/Icon";
import {
  getOperationsMapSnapshot,
  operationsMarkers,
  operationsSummary,
  recentDetections,
  searchResults,
  type MapMarker,
  type MapMarkerKind,
  type SearchResult,
} from "./mockOperationsMapData";
import styles from "./AdminOperationsMap.module.css";

type StatusFilter = "all" | "review" | "waiting" | "detection" | "found" | "camera";
type Period = "today" | "24h" | "7d" | "custom";
type ViewState = "ready" | "loading" | "empty" | "error";
type Layers = Record<MapMarkerKind, boolean>;

const statusFilters: Array<{ value: StatusFilter; label: string; tone?: string }> = [
  { value: "all", label: "전체" }, { value: "review", label: "확인 필요", tone: "attention" },
  { value: "waiting", label: "처리 대기", tone: "waiting" }, { value: "detection", label: "AI 탐지" },
  { value: "found", label: "발견물" }, { value: "camera", label: "카메라" },
];
const periods: Array<{ value: Period; label: string }> = [
  { value: "today", label: "오늘" }, { value: "24h", label: "최근 24시간" },
  { value: "7d", label: "7일" }, { value: "custom", label: "직접 설정" },
];
const layerLabels: Record<MapMarkerKind, string> = { detection: "AI 탐지", found: "발견물", camera: "카메라", citizen: "시민 제보" };

function SearchBox({ idPrefix, onSelect }: { idPrefix: string; onSelect: (result: SearchResult) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return searchResults;
    return searchResults.filter((result) => `${result.group} ${result.title} ${result.detail}`.toLowerCase().includes(normalized));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((value) => Math.min(value + 1, results.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
    if (event.key === "Escape") setOpen(false);
    if (event.key === "Enter" && open && results[active]) { event.preventDefault(); onSelect(results[active]); setQuery(results[active].title); setOpen(false); }
  };

  return <div className={styles.search} ref={root}>
    <Icon name="search" size={18} />
    <input value={query} placeholder="지역 · 장소 · 카메라 · 발견물 검색" role="combobox" aria-expanded={open} aria-controls={`${idPrefix}-search-results`} aria-activedescendant={open && results[active] ? `${idPrefix}-result-${results[active].id}` : undefined} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }} onKeyDown={keyDown} />
    {query && <button type="button" aria-label="검색어 지우기" onClick={() => { setQuery(""); setOpen(true); }}><Icon name="close" size={15} /></button>}
    {open && <div className={styles.searchResults} id={`${idPrefix}-search-results`} role="listbox">
      {results.length ? results.map((result, index) => <button id={`${idPrefix}-result-${result.id}`} type="button" role="option" aria-selected={active === index} key={result.id} onMouseEnter={() => setActive(index)} onClick={() => { onSelect(result); setQuery(result.title); setOpen(false); }}><span>{result.group}</span><strong>{result.title}</strong><small>{result.detail}</small></button>) : <p>일치하는 Mock 검색 결과가 없습니다.</p>}
    </div>}
  </div>;
}

function StatusFilters({ value, onChange }: { value: StatusFilter; onChange: (value: StatusFilter) => void }) {
  return <div className={styles.filters} role="group" aria-label="운영 상태 필터">{statusFilters.map((filter) => <button type="button" data-tone={filter.tone} aria-pressed={value === filter.value} key={filter.value} onClick={() => onChange(filter.value)}>{filter.label}</button>)}</div>;
}

function PeriodFilters({ value, onChange }: { value: Period; onChange: (value: Period) => void }) {
  return <div className={styles.periods} role="group" aria-label="운영 지도 기간">{periods.map((period) => <button type="button" aria-pressed={value === period.value} key={period.value} onClick={() => onChange(period.value)}>{period.label}</button>)}</div>;
}

function LayerControl({ idPrefix, layers, onToggle }: { idPrefix: string; layers: Layers; onToggle: (kind: MapMarkerKind) => void }) {
  return <section className={styles.layers} aria-labelledby={`${idPrefix}-layer-title`}><div><Icon name="layers" size={17} /><strong id={`${idPrefix}-layer-title`}>레이어</strong></div>{(Object.keys(layerLabels) as MapMarkerKind[]).map((kind) => <button type="button" role="switch" aria-checked={layers[kind]} key={kind} onClick={() => onToggle(kind)}><span>{layerLabels[kind]}</span><i>{layers[kind] ? "ON" : "OFF"}</i></button>)}</section>;
}

function MarkerButton({ marker, selected, onSelect }: { marker: MapMarker; selected: boolean; onSelect: () => void }) {
  const style = { "--x": `${marker.x}%`, "--y": `${marker.y}%` } as CSSProperties;
  return <button className={styles.marker} data-kind={marker.kind} data-status={marker.status} data-selected={selected || undefined} style={style} type="button" aria-label={`${layerLabels[marker.kind]} ${marker.id}, ${marker.title}`} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); onSelect(); }}><span><Icon name={marker.icon} size={18} /></span><b>{marker.id}</b></button>;
}

function MapState({ state, onRetry }: { state: Exclude<ViewState, "ready">; onRetry: () => void }) {
  const content = state === "loading" ? { icon: "refresh" as const, title: "운영 지도를 불러오는 중이에요.", detail: "카메라와 운영 정보를 확인하고 있습니다." } : state === "empty" ? { icon: "location" as const, title: "현재 조건에 표시할 운영 정보가 없어요.", detail: "필터나 기간을 변경해 다시 확인해보세요." } : { icon: "info" as const, title: "운영 지도 정보를 불러오지 못했어요.", detail: "잠시 후 다시 시도해주세요." };
  return <div className={styles.mapState} data-state={state} role={state === "error" ? "alert" : "status"} aria-live="polite"><Icon name={content.icon} size={28} /><strong>{content.title}</strong><span>{content.detail}</span>{state === "error" && <button type="button" onClick={onRetry}>다시 시도</button>}</div>;
}

function OperationsPanel({ marker, onCameraOnly }: { marker: MapMarker | null; onCameraOnly: (id: string) => void }) {
  if (!marker) return <aside className={styles.operationsPanel} aria-label="현재 영역 운영 정보">
    <div className={styles.panelHeading}><span>LIVE AREA</span><h2>현재 영역</h2><p>표시 중인 운영 정보 요약입니다.</p></div>
    <div className={styles.summaryList}>{operationsSummary.map((item) => <div data-tone={item.tone} key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
    <div className={styles.recent}><h3>최근 탐지</h3>{recentDetections.map((item) => <div key={`${item.item}-${item.time}`}><span><Icon name={item.item === "우산" ? "umbrella" : item.item === "백팩" ? "backpack" : "ball"} size={17} /></span><p><strong>{item.item}</strong><small>{item.camera} · {item.time}</small></p></div>)}</div>
  </aside>;

  if (marker.kind === "camera") return <aside className={styles.operationsPanel} aria-label="선택한 카메라 정보">
    <div className={styles.panelHeading}><span>SELECTED CAMERA</span><h2>{marker.id}</h2><p>{marker.subtitle}</p></div>
    <dl className={styles.details}><div><dt>운영 상태</dt><dd><i data-tone="normal" />정상</dd></div><div><dt>최근 탐지</dt><dd>4건</dd></div><div><dt>마지막 탐지</dt><dd>10:42</dd></div></dl>
    <button className={styles.panelAction} type="button" onClick={() => onCameraOnly(marker.id)}>이 카메라의 탐지만 보기</button>
  </aside>;

  return <aside className={styles.operationsPanel} aria-label={`선택한 ${layerLabels[marker.kind]} 정보`}>
    <div className={styles.panelHeading}><span>SELECTED {marker.kind === "detection" ? "DETECTION" : "ITEM"}</span><h2>{marker.title}</h2><p>{marker.id} · {marker.subtitle}</p></div>
    <dl className={styles.details}>
      {marker.confidence && <div><dt>신뢰도</dt><dd>{marker.confidence}%</dd></div>}
      {marker.camera && <div><dt>카메라</dt><dd>{marker.camera}</dd></div>}
      {marker.time && <div><dt>탐지 시각</dt><dd>{marker.time}</dd></div>}
      <div><dt>현재 상태</dt><dd><i data-tone={marker.status} />{marker.status === "review" ? "확인 필요" : marker.status === "waiting" ? "처리 대기" : "정상"}</dd></div>
      {marker.linkedItem && <div><dt>연결된 발견물</dt><dd>{marker.linkedItem}</dd></div>}
      {marker.linkedReports !== undefined && <div><dt>연결 신고</dt><dd>{marker.linkedReports}건</dd></div>}
    </dl>
    <div className={styles.panelActions}><button type="button" disabled>상세 확인</button><button type="button" disabled>처리하기</button></div><small className={styles.demoNotice}>화면 구현 단계에서는 처리 기능을 사용할 수 없습니다.</small>
  </aside>;
}

type WorkspaceProps = {
  markers: MapMarker[]; selectedId: string | null; searchPoint: SearchResult | null; zoom: number; dirty: boolean; viewState: ViewState;
  onSelect: (id: string | null) => void; onZoom: (value: number) => void; onReset: () => void; onQueryArea: () => void; onRetry: () => void;
};

function MapCanvas({ markers, selectedId, searchPoint, zoom, dirty, viewState, onSelect, onZoom, onReset, onQueryArea, onRetry }: WorkspaceProps) {
  const clustered = zoom <= 2 && markers.filter((marker) => marker.x > 45 && marker.x < 65).length > 2;
  const clusterCount = markers.filter((marker) => marker.x > 45 && marker.x < 65).length;
  return <div className={styles.mapCanvas} data-zoom={zoom} onClick={() => onSelect(null)}>
    <div className={styles.mapGrid} aria-hidden="true"><span>여의도</span><span>한강 A구역</span><span>잠실</span><i /></div>
    {viewState === "ready" ? <>
      {dirty && <button className={styles.queryArea} type="button" onClick={(event) => { event.stopPropagation(); onQueryArea(); }}><Icon name="refresh" size={15} />이 구역 조회</button>}
      <div className={styles.mapLegend} aria-label="지도 범례"><span data-kind="detection">AI 탐지</span><span data-kind="found">발견물</span><span data-kind="camera">카메라</span></div>
      {markers.filter((marker) => !(clustered && marker.x > 45 && marker.x < 65)).map((marker) => <MarkerButton marker={marker} selected={selectedId === marker.id} onSelect={() => onSelect(marker.id)} key={marker.id} />)}
      {clustered && <button className={styles.cluster} style={{ "--x": "55%", "--y": "45%" } as CSSProperties} type="button" aria-label={`${clusterCount}개 운영 정보 묶음 확대`} onClick={(event) => { event.stopPropagation(); onZoom(3); }}>{clusterCount}</button>}
      {searchPoint && <span className={styles.searchPoint} style={{ "--x": `${searchPoint.x}%`, "--y": `${searchPoint.y}%` } as CSSProperties}><Icon name="location" size={20} /><b>{searchPoint.title}</b></span>}
      <div className={styles.mapControls} aria-label="지도 확대 및 축소"><button type="button" aria-label="지도 확대" disabled={zoom >= 4} onClick={(event) => { event.stopPropagation(); onZoom(Math.min(4, zoom + 1)); }}>＋</button><button type="button" aria-label="지도 축소" disabled={zoom <= 1} onClick={(event) => { event.stopPropagation(); onZoom(Math.max(1, zoom - 1)); }}>−</button><button type="button" onClick={(event) => { event.stopPropagation(); onReset(); }}><Icon name="locate" size={15} />전체 보기</button></div>
      <span className={styles.mockLabel}>운영 위치 Mock view · 확대 {zoom}</span>
    </> : <MapState state={viewState} onRetry={onRetry} />}
  </div>;
}

function FocusModal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []);
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", keyDown); };
  }, [onClose]);
  return <div className={styles.modalBackdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialog} className={styles.focusModal} role="dialog" aria-modal="true" aria-labelledby="focus-map-title"><div className={styles.focusHeading}><div><span>ADMIN · FOCUS MODE</span><h2 id="focus-map-title">운영 지도 크게 보기</h2></div><button ref={closeButton} type="button" aria-label="운영 지도 크게 보기 닫기" onClick={onClose}><Icon name="close" size={20} /></button></div>{children}</section></div>;
}

export function AdminOperationsMap() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [period, setPeriod] = useState<Period>("today");
  const [layers, setLayers] = useState<Layers>({ detection: true, found: true, camera: true, citizen: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchPoint, setSearchPoint] = useState<SearchResult | null>(null);
  const [zoom, setZoom] = useState(2);
  const [dirty, setDirty] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [cameraOnly, setCameraOnly] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>("ready");
  const focusTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const hashState = window.location.hash.replace("#", "");
    if (!["loading", "empty", "error"].includes(hashState)) return;
    const timer = window.setTimeout(() => setViewState(hashState as ViewState));
    return () => window.clearTimeout(timer);
  }, []);

  const visibleMarkers = useMemo(() => operationsMarkers.filter((marker) => {
    if (!layers[marker.kind]) return false;
    if (cameraOnly && marker.camera !== cameraOnly && marker.id !== cameraOnly) return false;
    if (filter === "review") return marker.status === "review";
    if (filter === "waiting") return marker.status === "waiting";
    if (filter === "detection") return marker.kind === "detection";
    if (filter === "found") return marker.kind === "found";
    if (filter === "camera") return marker.kind === "camera";
    return true;
  }), [cameraOnly, filter, layers]);
  const selected = operationsMarkers.find((marker) => marker.id === selectedId) ?? null;

  const selectSearch = (result: SearchResult) => { setSearchPoint(result); setSelectedId(result.markerId ?? null); setZoom(3); setDirty(false); };
  const changeZoom = (value: number) => { setZoom(value); setDirty(true); };
  const resetMap = () => { setZoom(2); setDirty(false); setSearchPoint(null); setSelectedId(null); setCameraOnly(null); };
  const closeFocus = () => { setFocusOpen(false); window.setTimeout(() => focusTrigger.current?.focus()); };
  const retry = () => { setViewState("loading"); void getOperationsMapSnapshot().then(() => window.setTimeout(() => setViewState("ready"), 350)); };
  const workspaceProps: WorkspaceProps = { markers: viewState === "empty" ? [] : visibleMarkers, selectedId, searchPoint, zoom, dirty, viewState, onSelect: setSelectedId, onZoom: changeZoom, onReset: resetMap, onQueryArea: () => setDirty(false), onRetry: retry };

  const toolbar = (idPrefix: string) => <><div className={styles.toolbarTop}><SearchBox idPrefix={idPrefix} onSelect={selectSearch} /><PeriodFilters value={period} onChange={setPeriod} /></div><div className={styles.toolbarBottom}><StatusFilters value={filter} onChange={(value) => { setFilter(value); setCameraOnly(null); setSelectedId(null); }} /><LayerControl idPrefix={idPrefix} layers={layers} onToggle={(kind) => setLayers((current) => ({ ...current, [kind]: !current[kind] }))} /></div></>;
  const workspace = <div className={styles.workspace}><MapCanvas {...workspaceProps} /><OperationsPanel marker={selected} onCameraOnly={(id) => { setCameraOnly(id); setFilter("detection"); setSelectedId(null); }} /></div>;

  return <main className={styles.page}>
    <header className={styles.intro}><div><p>ADMIN · FOUND ITEM MAP</p><h1>발견물 관리 · 지도</h1><span>발견물과 관련 운영 정보의 위치를 공간 기준으로 확인합니다.</span></div><nav className={styles.viewSwitch} aria-label="발견물 관리 보기 방식"><Link href="/admin/found-items"><Icon name="archive" size={15} />목록</Link><Link href="/admin/map" aria-current="page"><Icon name="location" size={15} />지도</Link></nav></header>
    <section className={styles.mapCard} aria-label="관리자 운영 지도" aria-hidden={focusOpen || undefined}><div className={styles.cardHeading}><div><span>실시간 운영 현황</span><small>Mock data · 마지막 갱신 10:48</small></div><button ref={focusTrigger} type="button" onClick={() => setFocusOpen(true)}><Icon name="maximize" size={17} />크게 보기</button></div>{toolbar("base-map")}{workspace}</section>
    {focusOpen && <FocusModal onClose={closeFocus}><div className={styles.focusContent}>{toolbar("focus-map")}{workspace}</div></FocusModal>}
  </main>;
}
