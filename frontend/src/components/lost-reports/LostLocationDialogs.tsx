"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Icon } from "@/components/common/Icon";
import { createFlowLinkMap, loadKakaoMaps, reverseGeocodeKakao, searchKakaoPlacesPage, type KakaoCircleInstance, type KakaoMapInstance, type KakaoMarkerInstance, type KakaoPlace } from "@/lib/kakaoPlaces";
import { LOST_LOCATION_REGIONS, type RegionNode } from "./lostLocationRegions";
import type { SelectedLostLocation } from "./KakaoPlaceSearch";
import styles from "./LostReportForm.module.css";

function useDialog(open: boolean, containerRef: RefObject<HTMLElement | null>, triggerRef: RefObject<HTMLButtonElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => containerRef.current?.querySelector<HTMLElement>("button, input")?.focus());
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !containerRef.current) return;
      const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => { window.clearTimeout(timer); document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", keydown); trigger?.focus(); };
  }, [containerRef, onClose, open, triggerRef]);
}

function DialogFrame({ open, title, description, triggerRef, onClose, children, wide = false }: { open: boolean; title: string; description: string; triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useDialog(open, ref, triggerRef, onClose);
  if (!open) return null;
  return <div className={styles.locationDialogBackdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={ref} className={`${styles.locationDialog} ${wide ? styles.mapDialog : ""}`} role="dialog" aria-modal="true" aria-labelledby="location-dialog-title" aria-describedby="location-dialog-description">
      <header><div><h2 id="location-dialog-title">{title}</h2><p id="location-dialog-description">{description}</p></div><button type="button" aria-label={`${title} 닫기`} onClick={onClose}><Icon name="close" size={20} /></button></header>
      {children}
    </section>
  </div>;
}

export function RegionPickerDialog({ open, triggerRef, onClose, onConfirm }: { open: boolean; triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void; onConfirm: (location: SelectedLostLocation) => void }) {
  const [path, setPath] = useState<RegionNode[]>([]);
  const [depth, setDepth] = useState(0);
  const [query, setQuery] = useState("");
  const close = useCallback(() => { setPath([]); setDepth(0); setQuery(""); onClose(); }, [onClose]);
  const options = depth === 0 ? LOST_LOCATION_REGIONS : path[depth - 1]?.children ?? [];
  const visibleOptions = query.trim() ? options.filter((item) => item.name.includes(query.trim())) : options;
  const precision = path.length === 1 ? "REGION_1" : path.length === 2 ? "REGION_2" : "REGION_3";
  const select = (item: RegionNode) => {
    const sameSelection = path[depth]?.name === item.name;
    const nextPath = sameSelection ? path : [...path.slice(0, depth), item];
    setPath(nextPath);
    setQuery("");
    if (item.children?.length) setDepth(depth + 1);
  };
  const goToDepth = (nextDepth: number) => { setDepth(nextDepth); setQuery(""); };
  const confirm = () => {
    if (!path.length) return;
    const displayName = path.map((item) => item.name).join(" ");
    setPath([]);
    setDepth(0);
    setQuery("");
    const middle = path.length > 2 ? path.slice(1, -1).map((item) => item.name).join(" ") : path[1]?.name;
    onConfirm({ displayName, address: displayName, region1: path[0]?.name, region2: middle, region3: path.length > 2 ? path.at(-1)?.name : undefined, source: "REGION", precision });
  };
  return <DialogFrame open={open} triggerRef={triggerRef} title="지역에서 선택" description="분실한 지역을 기억하는 범위까지만 선택해 주세요." onClose={close}>
    <div className={styles.regionPicker}>
      <ol aria-label="지역 선택 단계">
        {[{ label: "01 시·도", target: 0 }, { label: "02 시·군·구", target: 1 }, { label: "03 읍·면·동", target: 2 }].map((step) => {
          const stage = Math.min(depth, 2);
          const enabled = step.target === 0 || Boolean(path[step.target - 1]);
          return <li key={step.label}><button type="button" disabled={!enabled} data-state={step.target === stage ? "current" : step.target < stage ? "complete" : "future"} aria-current={step.target === stage ? "step" : undefined} onClick={() => goToDepth(step.target)}>{step.label}</button></li>;
        })}
      </ol>
      <div className={styles.regionContext}>
        {depth > 0 && <button className={styles.regionBack} type="button" onClick={() => goToDepth(depth - 1)}><Icon name="chevronLeft" size={16} /><span>{path[depth - 1]?.name}</span></button>}
        <h3>{depth === 0 ? "시·도를 선택해 주세요." : depth === 1 ? "시·군·구를 선택해 주세요." : "읍·면·동을 선택해 주세요."}</h3>
        {path.length > 0 && <nav className={styles.regionBreadcrumb} aria-label="현재 선택 지역">{path.map((item, index) => <button type="button" key={`${item.name}-${index}`} onClick={() => goToDepth(index)}>{item.name}</button>)}</nav>}
        {depth > 0 && <label className={styles.regionSearch}><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={depth === 1 ? "시·군·구 검색" : "읍·면·동 검색"} aria-label={depth === 1 ? "시·군·구 검색" : "읍·면·동 검색"} /></label>}
      </div>
      <div className={styles.regionOptionsScroll}>
        {visibleOptions.length > 0 ? <div className={styles.regionOptions} data-depth={depth}>{visibleOptions.map((item) => <button type="button" aria-pressed={path[depth]?.name === item.name} key={item.name} onClick={() => select(item)}><span>{item.name}</span>{item.children?.length ? <Icon name="chevron" size={14} /> : null}</button>)}</div> : <p className={styles.regionEnd}>{query ? "일치하는 지역이 없어요." : "선택한 지역까지 위치를 저장할 수 있어요."}</p>}
      </div>
      <footer><button type="button" className="button button-secondary" onClick={close}>취소</button><button type="button" className="button button-primary" disabled={!path.length} onClick={confirm}>이 지역으로 선택</button></footer>
    </div>
  </DialogFrame>;
}

type Draft = SelectedLostLocation & { latitude: number; longitude: number };

export function MapPickerDialog({ open, triggerRef, initialLocation, onClose, onConfirm }: { open: boolean; triggerRef: RefObject<HTMLButtonElement | null>; initialLocation: SelectedLostLocation | null; onClose: () => void; onConfirm: (location: SelectedLostLocation) => void }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const markerRef = useRef<KakaoMarkerInstance | null>(null);
  const circleRef = useRef<KakaoCircleInstance | null>(null);
  const positionRequestSeqRef = useRef(0);
  const searchRequestSeqRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KakaoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const close = useCallback(() => {
    positionRequestSeqRef.current += 1;
    searchRequestSeqRef.current += 1;
    loadMoreInFlightRef.current = false;
    onClose();
  }, [onClose]);

  const applyPosition = async (latitude: number, longitude: number, place?: KakaoPlace) => {
    const requestSeq = ++positionRequestSeqRef.current;
    setDraft(null);
    setMessage("주소를 확인하고 있어요.");
    const kakao = await loadKakaoMaps();
    if (requestSeq !== positionRequestSeqRef.current) return;
    const position = new kakao.maps.LatLng(latitude, longitude);
    mapRef.current?.setCenter(position);
    if (mapRef.current && !markerRef.current) markerRef.current = new kakao.maps.Marker({ map: mapRef.current, position });
    else markerRef.current?.setPosition(position);
    if (mapRef.current && !circleRef.current) {
      const primary = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() || "#f26f50";
      circleRef.current = new kakao.maps.Circle({ map: mapRef.current, center: position, radius: 90, strokeWeight: 2, strokeColor: primary, strokeOpacity: .72, fillColor: primary, fillOpacity: .12 });
    } else circleRef.current?.setPosition(position);
    try {
      const resolved = await reverseGeocodeKakao(latitude, longitude);
      if (requestSeq !== positionRequestSeqRef.current) return;
      const address = place?.road_address_name || resolved?.road_address?.address_name || place?.address_name || resolved?.address?.address_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      const region = resolved?.address;
      setDraft({ displayName: place?.place_name || address, placeName: place?.place_name, address, roadAddress: place?.road_address_name || resolved?.road_address?.address_name || undefined, region1: region?.region_1depth_name, region2: region?.region_2depth_name, region3: region?.region_3depth_name, latitude, longitude, source: "MAP", precision: place ? "PLACE" : "MAP_AREA" });
      setMessage("");
    } catch {
      if (requestSeq !== positionRequestSeqRef.current) return;
      setMessage("주소를 찾지 못했지만 선택한 좌표는 저장할 수 있어요.");
      setDraft({ displayName: "지도에서 선택한 위치", address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, latitude, longitude, source: "MAP", precision: "MAP_AREA" });
    }
  };

  useEffect(() => {
    if (!open || !mapContainer.current) return;
    let disposed = false;
    let removeMapClick: (() => void) | undefined;
    let destroyMap: (() => void) | undefined;
    setStatus("loading"); setDraft(initialLocation?.latitude != null && initialLocation.longitude != null ? initialLocation as Draft : null);
    const latitude = initialLocation?.latitude ?? 37.5665;
    const longitude = initialLocation?.longitude ?? 126.9780;
    void createFlowLinkMap(mapContainer.current, { latitude, longitude, level: 5 }).then(({ kakao, map, destroy }) => {
      destroyMap = destroy;
      if (disposed || !mapContainer.current) { destroy(); return; }
      mapRef.current = map;
      const click = (event: { latLng: { getLat: () => number; getLng: () => number } }) => void applyPosition(event.latLng.getLat(), event.latLng.getLng());
      kakao.maps.event.addListener(map, "click", click);
      removeMapClick = () => kakao.maps.event.removeListener(map, "click", click);
      setStatus("ready");
      if (initialLocation?.latitude != null && initialLocation.longitude != null) void applyPosition(latitude, longitude);
    }).catch(() => !disposed && setStatus("error"));
    return () => { disposed = true; positionRequestSeqRef.current += 1; searchRequestSeqRef.current += 1; loadMoreInFlightRef.current = false; removeMapClick?.(); destroyMap?.(); markerRef.current?.setMap(null); circleRef.current?.setMap(null); markerRef.current = null; circleRef.current = null; mapRef.current = null; };
  // applyPosition intentionally reads current refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const requestSeq = ++searchRequestSeqRef.current;
    loadMoreInFlightRef.current = false;
    const querySnapshot = query.trim();
    if (!open || querySnapshot.length < 2) return;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchKakaoPlacesPage(querySnapshot).then(({ places, hasNextPage }) => {
        if (requestSeq !== searchRequestSeqRef.current) return;
        setResults(places); setSearchPage(1); setHasMoreResults(hasNextPage);
      }).catch(() => {
        if (requestSeq === searchRequestSeqRef.current) setResults([]);
      }).finally(() => {
        if (requestSeq === searchRequestSeqRef.current) setSearching(false);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const choose = (place: KakaoPlace) => { searchRequestSeqRef.current += 1; loadMoreInFlightRef.current = false; setSearching(false); setQuery(place.place_name); setResults([]); mapRef.current?.setLevel(4); void applyPosition(Number(place.y), Number(place.x), place); };
  const changeSearchQuery = (value: string) => {
    searchRequestSeqRef.current += 1;
    loadMoreInFlightRef.current = false;
    setQuery(value);
    if (value.trim().length < 2) { setResults([]); setSearching(false); }
  };
  const loadMoreResults = () => {
    if (searching || loadMoreInFlightRef.current || !hasMoreResults) return;
    const requestSeq = searchRequestSeqRef.current;
    const querySnapshot = query.trim();
    const nextPage = searchPage + 1;
    loadMoreInFlightRef.current = true;
    setSearching(true);
    void searchKakaoPlacesPage(querySnapshot, nextPage).then(({ places, hasNextPage }) => {
      if (requestSeq !== searchRequestSeqRef.current || querySnapshot !== query.trim()) return;
      setResults((current) => [...current, ...places.filter((place) => !current.some((item) => item.id === place.id))]);
      setSearchPage(nextPage);
      setHasMoreResults(hasNextPage);
    }).finally(() => {
      if (requestSeq !== searchRequestSeqRef.current) return;
      loadMoreInFlightRef.current = false;
      setSearching(false);
    });
  };
  const searchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Escape") setResults([]); if (event.key === "Enter" && results[0]) { event.preventDefault(); choose(results[0]); } };
  const zoom = (amount: number) => mapRef.current?.setLevel(Math.max(1, Math.min(14, mapRef.current.getLevel() + amount)));

  return <DialogFrame open={open} triggerRef={triggerRef} title="지도에서 위치 선택" description="장소를 검색하거나 지도를 움직인 뒤 클릭해 기억나는 위치를 선택해 주세요." onClose={close} wide>
    <div className={styles.mapPicker}>
      <div className={styles.mapSearch}><Icon name="search" size={18} /><input value={query} onChange={(event) => changeSearchQuery(event.target.value)} onKeyDown={searchKeyDown} placeholder="장소·주소 검색" aria-label="지도 장소 또는 주소 검색" />{searching && <Icon name="refresh" size={16} />}{results.length > 0 && <div role="listbox">{results.map((place) => <button type="button" role="option" aria-selected="false" key={place.id} onClick={() => choose(place)}><strong>{place.place_name}</strong><small>{place.road_address_name || place.address_name}</small></button>)}{hasMoreResults && <button className={styles.mapSearchMore} type="button" onClick={loadMoreResults} disabled={searching}>더 보기 · 다음 15개</button>}</div>}</div>
      <div className={styles.actualMap}><div ref={mapContainer} className={styles.kakaoMap} aria-label="카카오 지도" />{status === "loading" && <div className={styles.mapStatus}><Icon name="refresh" size={22} />실제 Kakao 지도를 불러오고 있어요.</div>}{status === "error" && <div className={`${styles.mapStatus} ${styles.mapError}`} role="alert"><Icon name="info" size={22} />Kakao 지도를 불러오지 못했어요. JavaScript 키와 허용 도메인을 확인해 주세요.</div>}<div className={styles.zoomControls} aria-label="지도 확대 및 축소"><button type="button" aria-label="지도 확대" onClick={() => zoom(-1)}>+</button><button type="button" aria-label="지도 축소" onClick={() => zoom(1)}>−</button></div></div>
      <div className={styles.mapSelection}><Icon name="location" size={20} /><span><strong>{draft?.displayName || "지도를 클릭해 위치를 선택해 주세요."}</strong><small>{draft?.address || "정확한 위치가 아니어도 괜찮아요."}</small>{message && <em>{message}</em>}</span></div>
      <footer><button type="button" className="button button-secondary" onClick={close}>취소</button><button type="button" className="button button-primary" disabled={!draft} onClick={() => draft && onConfirm(draft)}>이 위치 선택</button></footer>
    </div>
  </DialogFrame>;
}
