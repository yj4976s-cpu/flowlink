"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/common/Icon";
import { searchKakaoPlaces } from "@/lib/kakaoPlaces";
import { AdminKakaoOperationsMap, type OperationsBounds } from "./AdminKakaoOperationsMap";
import {
  getOperationsMapSnapshot,
  operationsMarkers,
  recentDetections,
  searchResults,
  type MapMarker,
  type MapMarkerKind,
  type SearchResult,
} from "./mockOperationsMapData";
import styles from "./AdminOperationsMap.module.css";

type StatusFilter = "all" | "review" | "waiting" | "detection" | "found" | "camera";
type Period = "today" | "24h" | "7d" | "custom";
type MapState = "loading" | "ready" | "error";
type Layers = Record<MapMarkerKind, boolean>;

const statusFilters: Array<{ value: StatusFilter; label: string; tone?: string }> = [
  { value: "all", label: "전체" }, { value: "review", label: "확인 필요", tone: "attention" },
  { value: "waiting", label: "처리 대기", tone: "waiting" }, { value: "detection", label: "AI 탐지" },
  { value: "found", label: "발견물" }, { value: "camera", label: "카메라" },
];
const periods: Array<{ value: Period; label: string }> = [
  { value: "today", label: "오늘" }, { value: "24h", label: "최근 24시간" }, { value: "7d", label: "7일" }, { value: "custom", label: "직접 설정" },
];
const layerLabels: Record<MapMarkerKind, string> = { detection: "AI 탐지", found: "발견물", camera: "카메라", citizen: "시민 제보" };

function insideBounds(marker: MapMarker, bounds: OperationsBounds | null) {
  return !bounds || (marker.latitude >= bounds.south && marker.latitude <= bounds.north && marker.longitude >= bounds.west && marker.longitude <= bounds.east);
}

function SearchBox({ onSelect }: { onSelect: (result: SearchResult) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [places, setPlaces] = useState<SearchResult[]>([]);
  const [placeState, setPlaceState] = useState<"idle" | "loading" | "error">("idle");
  const root = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const operationResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return searchResults.slice(0, 8);
    return searchResults.filter((result) => `${result.group} ${result.title} ${result.detail}`.toLowerCase().includes(normalized)).slice(0, 8);
  }, [query]);
  const results = useMemo(() => [...places, ...operationResults], [operationResults, places]);

  useEffect(() => {
    const normalized = query.trim();
    const requestId = ++sequence.current;
    if (normalized.length < 2) return;
    const timer = window.setTimeout(() => {
      setPlaceState("loading");
      void searchKakaoPlaces(normalized).then((items) => {
        if (sequence.current !== requestId) return;
        setPlaces(items.slice(0, 5).map((place) => ({
          id: `place-${place.id}`, group: "장소", title: place.place_name,
          detail: place.road_address_name || place.address_name,
          latitude: Number(place.y), longitude: Number(place.x),
        })));
        setPlaceState("idle");
      }).catch(() => { if (sequence.current === requestId) { setPlaces([]); setPlaceState("error"); } });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const choose = (result: SearchResult) => { onSelect(result); setQuery(result.title); setOpen(false); };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((value) => Math.min(value + 1, Math.max(0, results.length - 1))); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
    if (event.key === "Escape") setOpen(false);
    if (event.key === "Enter" && open && results[active]) { event.preventDefault(); choose(results[active]); }
  };

  return <div className={styles.search} ref={root}>
    <Icon name="search" size={18} />
    <input value={query} placeholder="지역 · 장소 · 카메라 · 발견물 검색" role="combobox" aria-expanded={open} aria-controls="admin-map-search-results" aria-activedescendant={open && results[active] ? `admin-map-result-${results[active].id}` : undefined} onFocus={() => setOpen(true)} onChange={(event) => { const value = event.target.value; setQuery(value); setOpen(true); setActive(0); if (value.trim().length < 2) { setPlaces([]); setPlaceState("idle"); } }} onKeyDown={keyDown} />
    {query && <button type="button" aria-label="검색어 지우기" onClick={() => { setQuery(""); setOpen(true); }}><Icon name="close" size={15} /></button>}
    {open && <div className={styles.searchResults} id="admin-map-search-results" role="listbox">
      {placeState === "loading" && <p>카카오 장소를 검색하고 있어요.</p>}
      {placeState === "error" && <p>장소 검색을 불러오지 못했어요. 운영 정보 검색은 계속 사용할 수 있습니다.</p>}
      {results.map((result, index) => <button id={`admin-map-result-${result.id}`} type="button" role="option" aria-selected={active === index} key={result.id} onMouseEnter={() => setActive(index)} onClick={() => choose(result)}><span>{result.group}</span><strong>{result.title}</strong><small>{result.detail}</small></button>)}
      {!results.length && placeState !== "loading" && <p>일치하는 장소나 운영 정보가 없습니다.</p>}
    </div>}
  </div>;
}

function StatusFilters({ value, onChange }: { value: StatusFilter; onChange: (value: StatusFilter) => void }) {
  return <div className={styles.filters} role="group" aria-label="운영 상태 필터">{statusFilters.map((filter) => <button type="button" data-tone={filter.tone} aria-pressed={value === filter.value} key={filter.value} onClick={() => onChange(filter.value)}>{filter.label}</button>)}</div>;
}

function PeriodFilters({ value, onChange }: { value: Period; onChange: (value: Period) => void }) {
  return <div className={styles.periods} role="group" aria-label="운영 지도 기간">{periods.map((period) => <button type="button" aria-pressed={value === period.value} key={period.value} onClick={() => onChange(period.value)}>{period.label}</button>)}</div>;
}

function LayerControl({ layers, onToggle, compact = false }: { layers: Layers; onToggle: (kind: MapMarkerKind) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const enabledCount = Object.values(layers).filter(Boolean).length;
  if (compact) return <div className={styles.layerPopover}><button type="button" aria-expanded={open} aria-controls="focus-layer-menu" onClick={() => setOpen((value) => !value)}><Icon name="layers" size={16} />레이어 {enabledCount}<Icon name="chevron" size={13} /></button>{open && <section id="focus-layer-menu" className={styles.layers} aria-label="지도 레이어">{(Object.keys(layerLabels) as MapMarkerKind[]).map((kind) => <button type="button" role="switch" aria-checked={layers[kind]} key={kind} onClick={() => onToggle(kind)}><span>{layerLabels[kind]}</span><i>{layers[kind] ? "ON" : "OFF"}</i></button>)}</section>}</div>;
  return <section className={styles.layers} aria-labelledby="admin-map-layer-title"><div><Icon name="layers" size={17} /><strong id="admin-map-layer-title">레이어</strong></div>{(Object.keys(layerLabels) as MapMarkerKind[]).map((kind) => <button type="button" role="switch" aria-checked={layers[kind]} key={kind} onClick={() => onToggle(kind)}><span>{layerLabels[kind]}</span><i>{layers[kind] ? "ON" : "OFF"}</i></button>)}</section>;
}

function OperationsPanel({ marker, detections, areaMarkers, onSelectDetection, spotlightCameraId, onSpotlight }: { marker: MapMarker | null; detections: MapMarker[]; areaMarkers: MapMarker[]; onSelectDetection: (marker: MapMarker) => void; spotlightCameraId: string | null; onSpotlight: (id: string | null) => void }) {
  if (!marker) {
    const summary = [
      { label: "AI 탐지", value: areaMarkers.filter((item) => item.kind === "detection").length, tone: "primary" },
      { label: "확인 필요", value: areaMarkers.filter((item) => item.status === "review").length, tone: "attention" },
      { label: "처리 대기", value: areaMarkers.filter((item) => item.status === "waiting").length, tone: "waiting" },
      { label: "발견물", value: areaMarkers.filter((item) => item.kind === "found").length, tone: "found" },
      { label: "카메라", value: areaMarkers.filter((item) => item.kind === "camera").length, tone: "camera" },
    ];
    return <aside className={styles.operationsPanel} aria-label="현재 영역 운영 정보"><div className={styles.panelHeading}><span>LIVE AREA</span><h2>현재 영역</h2><p>마지막으로 조회한 지도 영역의 운영 현황입니다.</p></div><div className={styles.summaryList}>{summary.map((item) => <div data-tone={item.tone} key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div><div className={styles.recent}><h3>최근 탐지</h3>{recentDetections.map((item) => <div key={`${item.item}-${item.time}`}><span><Icon name={item.item === "우산" ? "umbrella" : item.item === "백팩" ? "backpack" : "ball"} size={17} /></span><p><strong>{item.item}</strong><small>{item.camera} · {item.time}</small></p></div>)}</div></aside>;
  }

  if (marker.kind === "camera") {
    const cameraDetections = detections.filter((item) => item.camera === marker.id);
    const spotlighted = spotlightCameraId === marker.id;
    return <aside className={styles.operationsPanel} aria-label="선택한 카메라 정보"><div className={styles.panelHeading}><span>{spotlighted ? "SPOTLIGHT CAMERA" : "SELECTED CAMERA"}</span><h2>{marker.id}</h2><p>{marker.subtitle}</p></div><dl className={styles.details}><div><dt>운영 상태</dt><dd><i data-tone={marker.status} />{marker.status === "review" ? "확인 필요" : marker.status === "waiting" ? "처리 대기" : "정상"}</dd></div><div><dt>최근 탐지</dt><dd>{cameraDetections.length}건</dd></div><div><dt>확인 필요</dt><dd>{cameraDetections.filter((item) => item.status === "review").length}건</dd></div><div><dt>마지막 탐지</dt><dd>{cameraDetections[0]?.time?.replace("오늘 ", "") ?? "-"}</dd></div></dl><div className={styles.cameraDetections}><h3>최근 탐지</h3>{cameraDetections.slice(0, 4).map((item) => <button key={item.id} type="button" onClick={() => onSelectDetection(item)}><span>{item.id}</span><strong>{item.title} {item.confidence}%</strong><small>{item.time}</small></button>)}</div><button className={styles.panelAction} type="button" aria-pressed={spotlighted} onClick={() => onSpotlight(spotlighted ? null : marker.id)}>{spotlighted ? "집중 보기 종료" : `${marker.id} 집중 보기`}</button></aside>;
  }

  return <aside className={styles.operationsPanel} aria-label={`선택한 ${layerLabels[marker.kind]} 정보`}><div className={styles.panelHeading}><span>SELECTED {marker.kind === "detection" ? "DETECTION" : marker.kind === "citizen" ? "REPORT" : "ITEM"}</span><h2>{marker.title}</h2><p>{marker.id} · {marker.subtitle}</p></div><dl className={styles.details}>{marker.confidence && <div><dt>신뢰도</dt><dd>{marker.confidence}%</dd></div>}{marker.camera && <div><dt>카메라</dt><dd>{marker.camera}</dd></div>}{marker.time && <div><dt>탐지 시각</dt><dd>{marker.time}</dd></div>}<div><dt>현재 상태</dt><dd><i data-tone={marker.status} />{marker.status === "review" ? "확인 필요" : marker.status === "waiting" ? "처리 대기" : "정상"}</dd></div>{marker.linkedItem && <div><dt>연결된 발견물</dt><dd>{marker.linkedItem}</dd></div>}{marker.linkedReports !== undefined && <div><dt>연결 제보</dt><dd>{marker.linkedReports}건</dd></div>}</dl><div className={styles.panelActions}><button type="button" disabled>상세 확인</button><button type="button" disabled>처리하기</button></div><small className={styles.demoNotice}>데모 운영 데이터로 표시 중입니다.</small></aside>;
}

export function AdminOperationsMap() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [period, setPeriod] = useState<Period>("today");
  const [layers, setLayers] = useState<Layers>({ detection: true, found: true, camera: true, citizen: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchPoint, setSearchPoint] = useState<SearchResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [spotlightCameraId, setSpotlightCameraId] = useState<string | null>(null);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [mapRetryKey, setMapRetryKey] = useState(0);
  const [fitToken, setFitToken] = useState(1);
  const [queriedBounds, setQueriedBounds] = useState<OperationsBounds | null>(null);
  const expandTrigger = useRef<HTMLButtonElement>(null);
  const detections = useMemo(() => operationsMarkers.filter((marker) => marker.kind === "detection"), []);
  const spotlightActive = Boolean(spotlightCameraId);

  const filteredDetections = useMemo(() => detections.filter((marker) => {
    if (filter === "review" || filter === "waiting") return marker.status === filter;
    return filter === "all" || filter === "detection" || filter === "camera";
  }), [detections, filter]);

  const mapMarkers = useMemo(() => operationsMarkers.filter((marker) => {
    if (marker.kind === "detection") return false;
    if (!layers[marker.kind]) return false;
    if (spotlightActive && marker.kind === "camera") return true;
    if (filter === "found") return marker.kind === "found";
    if (filter === "camera") return marker.kind === "camera";
    if (filter === "detection") return marker.kind === "camera" && filteredDetections.some((item) => item.camera === marker.id);
    if (filter === "review" || filter === "waiting") {
      if (marker.kind === "camera") return marker.status === filter || filteredDetections.some((item) => item.camera === marker.id);
      return marker.status === filter;
    }
    return true;
  }), [filter, filteredDetections, layers, spotlightActive]);

  const detectionCounts = useMemo(() => {
    if (!layers.detection) return {};
    return filteredDetections.reduce<Record<string, number>>((counts, marker) => {
      if (marker.camera) counts[marker.camera] = (counts[marker.camera] ?? 0) + 1;
      return counts;
    }, {});
  }, [filteredDetections, layers.detection]);
  const selectedCandidate = operationsMarkers.find((marker) => marker.id === selectedId) ?? null;
  const selected = selectedCandidate && (selectedCandidate.kind === "detection" ? filteredDetections.some((marker) => marker.id === selectedCandidate.id) : mapMarkers.some((marker) => marker.id === selectedCandidate.id)) ? selectedCandidate : null;
  const selectedMapId = selected?.kind === "detection" ? selected.camera ?? null : selectedId;
  const areaMarkers = useMemo(() => operationsMarkers.filter((marker) => insideBounds(marker, queriedBounds)), [queriedBounds]);
  const spotlightCamera = operationsMarkers.find((marker) => marker.id === spotlightCameraId && marker.kind === "camera") ?? null;
  const spotlightDetections = spotlightCameraId ? detections.filter((marker) => marker.camera === spotlightCameraId) : [];

  useEffect(() => {
    if (!expanded) return;
    const trigger = expandTrigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", keyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", keyDown); window.setTimeout(() => trigger?.focus()); };
  }, [expanded]);

  const selectSearch = (result: SearchResult) => {
    setFilter("all");
    setSearchPoint(result);
    setSelectedId(result.markerId ?? null);
    const target = operationsMarkers.find((marker) => marker.id === result.markerId);
    if (spotlightCameraId && target?.kind === "camera") setSpotlightCameraId(target.id);
  };
  const selectDetection = (marker: MapMarker) => { setSelectedId(marker.id); setSearchPoint({ id: `focus-${marker.id}`, group: "AI 탐지", title: marker.title, detail: marker.subtitle, markerId: marker.id, latitude: marker.latitude, longitude: marker.longitude }); };
  const resetMap = () => { setSearchPoint(null); setSelectedId(null); setQueriedBounds(null); setFitToken((value) => value + 1); };
  const retry = () => { setMapState("loading"); void getOperationsMapSnapshot().then(() => setMapRetryKey((value) => value + 1)); };
  const changeFilter = (value: StatusFilter) => { setFilter(value); setSelectedId(spotlightCameraId); setSearchPoint(null); };
  const toggleLayer = (kind: MapMarkerKind) => {
    if (selected?.kind === kind && layers[kind]) { setSelectedId(null); setSearchPoint(null); }
    setLayers((current) => ({ ...current, [kind]: !current[kind] }));
  };
  const dockItems: Array<{ value: StatusFilter; label: string; count: number }> = [
    { value: "detection", label: "AI 탐지", count: detections.length },
    { value: "review", label: "확인 필요", count: operationsMarkers.filter((marker) => marker.status === "review").length },
    { value: "waiting", label: "처리 대기", count: operationsMarkers.filter((marker) => marker.status === "waiting").length },
    { value: "found", label: "발견물", count: operationsMarkers.filter((marker) => marker.kind === "found").length },
    { value: "camera", label: "카메라", count: operationsMarkers.filter((marker) => marker.kind === "camera").length },
  ];
  const spotlightDockItems = [
    { label: "AI 탐지", count: spotlightDetections.length },
    { label: "확인 필요", count: spotlightDetections.filter((marker) => marker.status === "review").length },
    { label: "처리 대기", count: spotlightDetections.filter((marker) => marker.status === "waiting").length },
  ];
  const selectMapMarker = (id: string | null) => {
    setSelectedId(id);
    if (!id) { setSearchPoint(null); return; }
    const marker = operationsMarkers.find((item) => item.id === id);
    if (spotlightCameraId && marker?.kind === "camera") setSpotlightCameraId(marker.id);
  };
  const changeSpotlight = (id: string | null) => {
    setSpotlightCameraId(id);
    if (id) { setSelectedId(id); setSearchPoint(null); }
  };
  const returnToDetectionList = () => {
    if (selected?.kind !== "detection") return;
    setSelectedId(selected.camera ?? null);
    setSearchPoint(null);
  };

  return <main className={styles.page}>
    <header className={styles.intro}><div><p>ADMIN · OPERATIONS MAP</p><h1>발견물 관리 · 지도</h1><span>카메라와 AI 탐지, 발견물, 시민 제보를 실제 공간에서 확인합니다.</span></div><nav className={styles.viewSwitch} aria-label="발견물 관리 보기 방식"><Link href="/admin/found-items"><Icon name="archive" size={15} />목록</Link><Link href="/admin/map" aria-current="page"><Icon name="location" size={15} />지도</Link></nav></header>
    <section className={styles.mapCard} data-expanded={expanded || undefined} aria-label="관리자 운영 지도">
      <div className={styles.cardHeading}><div><span>실시간 운영 현황</span><small>데모 운영 데이터 · 카메라 중심 집계</small></div><button ref={expandTrigger} type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><Icon name={expanded ? "close" : "maximize"} size={17} />{expanded ? "크게 보기 닫기" : "크게 보기"}</button></div>
      <div className={styles.toolbarTop}><SearchBox onSelect={selectSearch} /><PeriodFilters value={period} onChange={setPeriod} /></div>
      <div className={styles.toolbarBottom}><StatusFilters value={filter} onChange={changeFilter} />{!expanded && <LayerControl layers={layers} onToggle={toggleLayer} />}</div>
      <div className={styles.workspace}>
        <div className={styles.mapCanvas}>
          <AdminKakaoOperationsMap key={mapRetryKey} markers={mapMarkers} detectionCounts={detectionCounts} selectedId={selectedMapId} spotlightCameraId={spotlightCameraId} searchPoint={searchPoint} expanded={expanded} fitToken={fitToken} onSelect={selectMapMarker} onQueryArea={setQueriedBounds} onStateChange={setMapState} />
          {mapState !== "ready" && <div className={styles.mapState} data-state={mapState} role={mapState === "error" ? "alert" : "status"}><Icon name={mapState === "loading" ? "refresh" : "info"} size={28} /><strong>{mapState === "loading" ? "운영 지도를 불러오는 중이에요." : "운영 지도를 불러오지 못했어요."}</strong><span>{mapState === "loading" ? "Kakao Maps SDK와 운영 위치를 준비하고 있습니다." : "JavaScript 키와 등록 도메인을 확인한 뒤 다시 시도해 주세요."}</span>{mapState === "error" && <button type="button" onClick={retry}>다시 시도</button>}</div>}
          <button className={styles.fitMapButton} type="button" onClick={resetMap}><Icon name="locate" size={15} />전체 보기</button>
          {spotlightCamera && <div className={styles.spotlightIndicator} role="status"><span>◎ {spotlightCamera.id} 집중 보기 · {spotlightCamera.subtitle}</span><button type="button" aria-label={`${spotlightCamera.id} 집중 보기 종료`} onClick={() => changeSpotlight(null)}>종료 <Icon name="close" size={13} /></button></div>}
          {expanded && <><div className={styles.focusLayerControl}><LayerControl compact layers={layers} onToggle={toggleLayer} /></div><div className={styles.statusDock} data-spotlight={spotlightCameraId || undefined} aria-label={spotlightCamera ? `${spotlightCamera.id} 운영 현황` : "운영 현황 빠른 필터"}>{spotlightCamera ? spotlightDockItems.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.count}</strong></div>) : dockItems.map((item) => <button type="button" aria-pressed={filter === item.value} key={item.value} onClick={() => changeFilter(filter === item.value ? "all" : item.value)}><span>{item.label}</span><strong>{item.count}</strong></button>)}</div></>}
        </div>
        {!expanded && <OperationsPanel marker={selected} detections={detections} areaMarkers={areaMarkers} onSelectDetection={selectDetection} spotlightCameraId={spotlightCameraId} onSpotlight={changeSpotlight} />}
        {expanded && selected && <div className={styles.detailDrawer}><div className={styles.detailPanelTopbar}>{selected.kind === "detection" ? <button className={styles.detectionBack} type="button" aria-label="탐지 목록으로 돌아가기" onClick={returnToDetectionList}><Icon name="chevronLeft" size={15} />탐지 목록</button> : <span />}<button className={styles.drawerClose} type="button" aria-label="상세 패널 닫기" onClick={() => { setSelectedId(null); setSearchPoint(null); }}><Icon name="close" size={16} /></button></div><OperationsPanel marker={selected} detections={detections} areaMarkers={areaMarkers} onSelectDetection={selectDetection} spotlightCameraId={spotlightCameraId} onSpotlight={changeSpotlight} /></div>}
      </div>
    </section>
  </main>;
}
