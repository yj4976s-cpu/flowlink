"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/common/Icon";
import { searchKakaoPlacesPage, type KakaoPlace } from "@/lib/kakaoPlaces";
import styles from "./LostReportForm.module.css";

export type SelectedLostLocation = {
  displayName: string;
  placeName?: string;
  address: string;
  roadAddress?: string;
  region1?: string;
  region2?: string;
  region3?: string;
  latitude?: number;
  longitude?: number;
  source: "SEARCH" | "REGION" | "MAP";
  precision: "REGION_1" | "REGION_2" | "REGION_3" | "PLACE" | "MAP_AREA";
};

type SearchState = "idle" | "loading" | "ready" | "empty" | "error";

export function KakaoPlaceSearch({ value, selectedLocation, invalid, describedBy, mapButtonRef, regionButtonRef, onValueChange, onSelect, onOpenMap, onOpenRegion }: {
  value: string;
  selectedLocation: SelectedLostLocation | null;
  invalid: boolean;
  describedBy: string;
  mapButtonRef: React.RefObject<HTMLButtonElement | null>;
  regionButtonRef: React.RefObject<HTMLButtonElement | null>;
  onValueChange: (value: string) => void;
  onSelect: (location: SelectedLostLocation) => void;
  onOpenMap: () => void;
  onOpenRegion: () => void;
}) {
  const [results, setResults] = useState<KakaoPlace[]>([]);
  const [state, setState] = useState<SearchState>("idle");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  const normalizedQuery = value.trim();

  useEffect(() => {
    if (selectedLocation || normalizedQuery.length < 2) return;
    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(() => {
      setState("loading");
      setOpen(true);
      void searchKakaoPlacesPage(normalizedQuery).then(({ places, hasNextPage }) => {
        if (requestSequence.current !== sequence) return;
        setResults(places);
        setPage(1);
        setHasMore(hasNextPage);
        setState(places.length ? "ready" : "empty");
        setActiveIndex(places.length ? 0 : -1);
      }).catch(() => {
        if (requestSequence.current !== sequence) return;
        setResults([]);
        setState("error");
        setActiveIndex(-1);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [normalizedQuery, selectedLocation]);

  useEffect(() => {
    if (normalizedQuery.length >= 2 && !selectedLocation) return;
    requestSequence.current += 1;
    const timer = window.setTimeout(() => {
      setResults([]);
      setState("idle");
      setActiveIndex(-1);
      if (normalizedQuery.length < 2) setOpen(false);
    });
    return () => window.clearTimeout(timer);
  }, [normalizedQuery, selectedLocation]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const choose = (place: KakaoPlace) => {
    requestSequence.current += 1;
    const address = place.road_address_name || place.address_name;
    const [region1, region2, region3] = place.address_name.split(" ");
    onSelect({ displayName: place.place_name, placeName: place.place_name, address, roadAddress: place.road_address_name || undefined, region1, region2, region3, latitude: Number(place.y), longitude: Number(place.x), source: "SEARCH", precision: "PLACE" });
    setOpen(false);
    setResults([]);
    setState("idle");
    setActiveIndex(-1);
  };

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    const sequence = requestSequence.current;
    const nextPage = page + 1;
    setLoadingMore(true);
    void searchKakaoPlacesPage(normalizedQuery, nextPage).then(({ places, hasNextPage }) => {
      if (requestSequence.current !== sequence) return;
      setResults((current) => [...current, ...places.filter((place) => !current.some((item) => item.id === place.id))]);
      setPage(nextPage);
      setHasMore(hasNextPage);
    }).finally(() => { if (requestSequence.current === sequence) setLoadingMore(false); });
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
    if (!open || state !== "ready" || !results.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, results.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
    if (event.key === "Enter" && activeIndex >= 0) { event.preventDefault(); choose(results[activeIndex]); }
  };

  return <div className={styles.locationCombobox} data-selected={Boolean(selectedLocation) || undefined} ref={rootRef}>
    <div className={styles.controlWithIcon}>
      <input id="lost-report-location" role="combobox" aria-autocomplete="list" aria-controls="lost-report-location-options" aria-expanded={open} aria-activedescendant={open && activeIndex >= 0 ? `lost-location-option-${results[activeIndex]?.id}` : undefined} value={value} onFocus={() => { if (!selectedLocation && normalizedQuery.length >= 2) setOpen(true); }} onChange={(event) => { onValueChange(event.target.value); setOpen(event.target.value.trim().length >= 2); }} onKeyDown={keyDown} maxLength={100} placeholder="장소명이나 지역명을 입력해 주세요" aria-invalid={invalid} aria-describedby={describedBy} required />
      <Icon name="search" size={18} />
      <button ref={mapButtonRef} className={styles.mapOpenButton} type="button" title="지도에서 위치 선택" aria-label="지도에서 위치 선택" onClick={onOpenMap}><Icon name="location" size={18} /></button>
    </div>
    {selectedLocation && <div className={styles.selectedLocationCard} role="status"><Icon name="check" size={16} /><span><strong>{selectedLocation.displayName}</strong><small>{selectedLocation.address}</small></span><button type="button" onClick={() => onValueChange("")}>변경</button></div>}
    <button ref={regionButtonRef} className={styles.regionOpenButton} type="button" onClick={onOpenRegion}><Icon name="layers" size={15} />지역에서 선택</button>
    <p className={styles.locationHint}>정확하지 않아도 괜찮아요. 기억나는 범위까지만 선택해 주세요.</p>
    {open && <div className={styles.locationResults} id="lost-report-location-options" role="listbox" aria-label="카카오 장소 검색 결과">
      {state === "loading" && <div className={styles.locationState} role="status"><Icon name="refresh" size={16} /><span><b>위치를 찾고 있어요.</b><small>카카오 장소 검색 결과를 확인하고 있습니다.</small></span></div>}
      {state === "empty" && <div className={styles.locationState}><Icon name="search" size={16} /><span><b>검색 결과가 없어요.</b><small>다른 장소명이나 지역명으로 검색해 주세요.</small></span></div>}
      {state === "error" && <div className={`${styles.locationState} ${styles.locationError}`} role="alert"><Icon name="info" size={16} /><span><b>위치를 불러오지 못했어요.</b><small>잠시 후 다시 시도해 주세요.</small></span></div>}
      {state === "ready" && <><div className={styles.locationResultSummary}><strong>관련 장소 {results.length}곳</strong><span>목록을 내려 더 확인할 수 있어요.</span></div>{results.map((place, index) => <button id={`lost-location-option-${place.id}`} type="button" role="option" aria-selected={activeIndex === index} key={place.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(place)}><Icon name="location" size={16} /><span><b>{place.place_name}</b><small>{place.road_address_name || place.address_name}</small></span></button>)}{hasMore && <button className={styles.locationMoreButton} type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? <><Icon name="refresh" size={15} />불러오는 중</> : `더 보기 · 다음 15개`}</button>}</>}
    </div>}
  </div>;
}
