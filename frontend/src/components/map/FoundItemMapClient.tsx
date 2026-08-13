"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { FoundItemMapItem, listMapFoundItems, resolveFoundItemImageUrl } from "@/lib/foundItemsApi";
import { loadKakaoMaps } from "@/lib/kakaoMapLoader";
import type { KakaoCustomOverlay, KakaoMap, KakaoMapsNamespace } from "@/types/kakao-maps";
import styles from "./FoundItemMapClient.module.css";

const DEFAULT_CENTER = { latitude: 37.5665, longitude: 126.978 };
const MAJOR_AREAS = [
  { name: "서울", latitude: 37.5665, longitude: 126.978, level: 7 },
  { name: "경기", latitude: 37.4138, longitude: 127.5183, level: 9 },
  { name: "인천", latitude: 37.4563, longitude: 126.7052, level: 7 },
  { name: "부산", latitude: 35.1796, longitude: 129.0756, level: 7 },
  { name: "대구", latitude: 35.8714, longitude: 128.6014, level: 7 },
  { name: "대전", latitude: 36.3504, longitude: 127.3845, level: 7 },
  { name: "광주", latitude: 35.1595, longitude: 126.8526, level: 7 },
  { name: "울산", latitude: 35.5384, longitude: 129.3114, level: 7 },
  { name: "세종", latitude: 36.4801, longitude: 127.289, level: 7 },
  { name: "강원", latitude: 37.8228, longitude: 128.1555, level: 9 },
  { name: "충북", latitude: 36.8, longitude: 127.7, level: 9 },
  { name: "충남", latitude: 36.5184, longitude: 126.8, level: 9 },
  { name: "전북", latitude: 35.7175, longitude: 127.153, level: 9 },
  { name: "전남", latitude: 34.8679, longitude: 126.991, level: 9 },
  { name: "경북", latitude: 36.4919, longitude: 128.8889, level: 9 },
  { name: "경남", latitude: 35.4606, longitude: 128.2132, level: 9 },
  { name: "제주", latitude: 33.4996, longitude: 126.5312, level: 8 },
] as const;
const MAJOR_AREA_NAMES: ReadonlySet<string> = new Set(MAJOR_AREAS.map((area) => area.name));
const categoryOptions = [
  { value: "", label: "전체" },
  { value: "BAG", label: "가방" },
  { value: "BACKPACK", label: "백팩" },
  { value: "UMBRELLA", label: "우산" },
  { value: "FOOTWEAR", label: "신발류" },
  { value: "SHOE", label: "신발" },
  { value: "BALL", label: "공" },
] as const;

const statusLabels: Record<string, string> = {
  RECOVERED: "확인된 발견물",
  AVAILABLE: "보관 중",
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type SelectionSource = "list" | "marker";

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function formatFoundAt(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "일시 확인 중" : dateFormatter.format(parsed);
}

function getCategoryInitial(item: FoundItemMapItem) {
  const name = item.item_category_name || item.item_category;
  return name.trim().slice(0, 1) || "F";
}

function getImageUrl(item: FoundItemMapItem) {
  try {
    return resolveFoundItemImageUrl(item.image_url);
  } catch {
    return null;
  }
}

function getAreaOptions(items: FoundItemMapItem[]) {
  const registeredAreas = items.map((item) => item.area_name).filter(Boolean).sort((a, b) => a.localeCompare(b, "ko"));
  return Array.from(new Set([...MAJOR_AREAS.map((area) => area.name), ...registeredAreas]));
}

function getMajorAreaTarget(area: string) {
  const keyword = normalize(area);
  return MAJOR_AREAS.find((item) => normalize(item.name) === keyword);
}

function createTextElement(tagName: keyof HTMLElementTagNameMap, className: string, text: string) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createMarkerElement(item: FoundItemMapItem, selected: boolean, onSelect: () => void) {
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = `${styles.marker} ${selected ? styles.markerSelected : ""}`;
  marker.dataset.category = item.item_category;
  marker.setAttribute("aria-label", `${item.item_category_name} 지도 마커 선택`);

  const body = document.createElement("span");
  body.className = styles.markerBody;
  const icon = createTextElement("span", styles.markerIcon, getCategoryInitial(item));
  const label = createTextElement("span", styles.markerLabel, item.item_category_name);
  const pointer = document.createElement("span");
  pointer.className = styles.markerPointer;
  body.append(icon, label);
  marker.append(body, pointer);
  marker.addEventListener("click", onSelect);

  return marker;
}

function createSelectedOverlayContent(item: FoundItemMapItem) {
  const container = document.createElement("article");
  container.className = styles.selectedOverlay;

  const imageUrl = getImageUrl(item);
  const visual = document.createElement("div");
  visual.className = styles.overlayThumb;
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = `${item.item_category_name} 발견물 이미지`;
    image.addEventListener("error", () => {
      visual.replaceChildren(createTextElement("span", styles.overlayFallback, getCategoryInitial(item)));
    }, { once: true });
    visual.appendChild(image);
  } else {
    visual.appendChild(createTextElement("span", styles.overlayFallback, getCategoryInitial(item)));
  }
  container.appendChild(visual);

  const body = document.createElement("div");
  const status = createTextElement("span", styles.overlayStatus, statusLabels[item.status] ?? item.status);
  const title = createTextElement("strong", "", `${item.color || "색상 미상"} ${item.item_category_name}`);
  const area = createTextElement("p", styles.overlayArea, item.area_name);
  const meta = createTextElement("small", "", formatFoundAt(item.found_at));
  const link = document.createElement("a");
  link.href = `/found-items/${item.id}`;
  link.className = styles.overlayLink;
  link.append(
    createTextElement("span", "", "발견물 자세히 보기"),
    createTextElement("span", styles.overlayChevron, "→"),
  );
  body.append(status, title, area, meta, link);
  container.appendChild(body);

  return container;
}

function AreaPicker({ value, options, onChange, onSelect }: { value: string; options: string[]; onChange: (value: string) => void; onSelect: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const visibleOptions = useMemo(() => {
    const keyword = normalize(value);
    const majorOptions = options.filter((option) => MAJOR_AREA_NAMES.has(option));
    const registeredOptions = options.filter((option) => !MAJOR_AREA_NAMES.has(option) && (!keyword || normalize(option).includes(keyword))).slice(0, 8);
    return [...majorOptions, ...registeredOptions];
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = (nextArea: string) => {
    onSelect(nextArea);
    setOpen(false);
  };

  return (
    <div className={styles.areaPicker} ref={rootRef}>
      <label className={styles.searchField}>
        <span>지역</span>
        <span className={styles.areaInputWrap}>
          <input
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="대략적인 발견 구역"
            aria-controls={listId}
          />
          <button type="button" onClick={() => setOpen((current) => !current)} aria-label="지역 목록 열기" aria-controls={listId} aria-expanded={open}>
            <Icon name="search" size={16} />
          </button>
        </span>
      </label>
      {open && (
        <div className={styles.areaSuggestions} id={listId}>
          <strong>주요 지역 / 등록 구역</strong>
          {visibleOptions.length ? visibleOptions.map((option) => (
            <button key={option} type="button" onClick={() => choose(option)}>
              <Icon name="location" size={15} />
              <span>{option}</span>
            </button>
          )) : <p>일치하는 지역이 없습니다.</p>}
        </div>
      )}
    </div>
  );
}

export function FoundItemMapClient() {
  const [items, setItems] = useState<FoundItemMapItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [area, setArea] = useState("");
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [itemsRetryKey, setItemsRetryKey] = useState(0);
  const [mapRetryKey, setMapRetryKey] = useState(0);
  const [mapExpanded, setMapExpanded] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const mapsRef = useRef<KakaoMapsNamespace | null>(null);
  const markerOverlaysRef = useRef<Map<number, KakaoCustomOverlay>>(new Map());
  const markerElementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const selectedOverlayRef = useRef<KakaoCustomOverlay | null>(null);
  const listItemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const selectionSourceRef = useRef<SelectionSource>("list");

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setApiError("");
      try {
        const result = await listMapFoundItems(controller.signal);
        if (controller.signal.aborted) return;
        setItems(result);
        setSelectedItemId((current) => (current && result.some((item) => item.id === current) ? current : result[0]?.id ?? null));
      } catch (error) {
        if (controller.signal.aborted) return;
        setApiError(error instanceof Error ? error.message : "지도 발견물을 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();

    return () => controller.abort();
  }, [itemsRetryKey]);

  useEffect(() => {
    let cancelled = false;

    void loadKakaoMaps()
      .then((maps) => {
        if (cancelled || !mapContainerRef.current) return;
        mapsRef.current = maps;
        if (!mapRef.current) {
          const center = new maps.LatLng(DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude);
          mapRef.current = new maps.Map(mapContainerRef.current, { center, level: 7 });
        }
        setMapReady(true);
      })
      .catch((error) => {
        if (!cancelled) setMapError(error instanceof Error ? error.message : "지도를 불러오지 못했습니다.");
      });

    return () => {
      cancelled = true;
    };
  }, [mapRetryKey]);

  const filteredItems = useMemo(() => {
    const keyword = normalize(query);
    const areaKeyword = normalize(area);
    return items.filter((item) => {
      const matchesCategory = !category || item.item_category === category || item.item_category_name.includes(category);
      if (!matchesCategory) return false;
      if (areaKeyword && !normalize(item.area_name).includes(areaKeyword)) return false;
      if (!keyword) return true;
      return [
        item.item_category,
        item.item_category_name,
        item.color,
        item.public_description,
        item.area_name,
      ].some((value) => normalize(value).includes(keyword));
    });
  }, [area, category, items, query]);

  const areaOptions = useMemo(() => getAreaOptions(items), [items]);

  const activeItemId = useMemo(() => {
    if (selectedItemId && filteredItems.some((item) => item.id === selectedItemId)) return selectedItemId;
    return filteredItems[0]?.id ?? null;
  }, [filteredItems, selectedItemId]);

  const selectedItem = filteredItems.find((item) => item.id === activeItemId) ?? null;

  const selectItem = useCallback((itemId: number, source: SelectionSource) => {
    selectionSourceRef.current = source;
    setSelectedItemId(itemId);
  }, []);

  const fitMapToItems = useCallback(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || filteredItems.length === 0) return;

    if (filteredItems.length === 1) {
      const item = filteredItems[0];
      map.setCenter(new maps.LatLng(item.latitude, item.longitude));
      map.setLevel(5);
      return;
    }

    const bounds = new maps.LatLngBounds();
    filteredItems.forEach((item) => bounds.extend(new maps.LatLng(item.latitude, item.longitude)));
    map.setBounds(bounds);
  }, [filteredItems]);

  const focusArea = useCallback((nextArea: string) => {
    setArea(nextArea);
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;

    const matched = items.filter((item) => normalize(item.area_name).includes(normalize(nextArea)));
    if (matched.length === 0) {
      const target = getMajorAreaTarget(nextArea);
      if (target) {
        setSelectedItemId(null);
        map.setCenter(new maps.LatLng(target.latitude, target.longitude));
        map.setLevel(target.level);
      }
      return;
    }

    setSelectedItemId(matched[0].id);
    if (matched.length === 1) {
      map.setCenter(new maps.LatLng(matched[0].latitude, matched[0].longitude));
      map.setLevel(5);
      return;
    }

    const bounds = new maps.LatLngBounds();
    matched.forEach((item) => bounds.extend(new maps.LatLng(item.latitude, item.longitude)));
    map.setBounds(bounds);
  }, [items]);

  const zoomMap = useCallback((direction: "in" | "out") => {
    const map = mapRef.current;
    if (!map) return;

    const nextLevel = direction === "in" ? Math.max(1, map.getLevel() - 1) : Math.min(14, map.getLevel() + 1);
    map.setLevel(nextLevel);
  }, []);

  useEffect(() => {
    if (!mapExpanded) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMapExpanded(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mapExpanded]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || !mapReady) return;
    const markerOverlays = markerOverlaysRef.current;
    const markerElements = markerElementsRef.current;

    markerOverlays.forEach((overlay) => overlay.setMap(null));
    markerOverlays.clear();
    markerElements.clear();

    if (filteredItems.length === 0) return;

    const bounds = new maps.LatLngBounds();
    filteredItems.forEach((item) => {
      const position = new maps.LatLng(item.latitude, item.longitude);
      bounds.extend(position);
      const marker = createMarkerElement(item, false, () => selectItem(item.id, "marker"));
      const overlay = new maps.CustomOverlay({ position, content: marker, yAnchor: 1.25, zIndex: 2 });
      overlay.setMap(map);
      markerOverlays.set(item.id, overlay);
      markerElements.set(item.id, marker);
    });

    if (filteredItems.length === 1) {
      const item = filteredItems[0];
      map.setCenter(new maps.LatLng(item.latitude, item.longitude));
      map.setLevel(5);
    } else {
      map.setBounds(bounds);
    }

    return () => {
      markerOverlays.forEach((overlay) => overlay.setMap(null));
      markerOverlays.clear();
      markerElements.clear();
    };
  }, [filteredItems, mapReady, selectItem]);

  useEffect(() => {
    markerElementsRef.current.forEach((element, itemId) => {
      element.classList.toggle(styles.markerSelected, itemId === activeItemId);
    });

    selectedOverlayRef.current?.setMap(null);
    selectedOverlayRef.current = null;

    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || !selectedItem) return;

    const position = new maps.LatLng(selectedItem.latitude, selectedItem.longitude);
    const overlayContent = createSelectedOverlayContent(selectedItem);
    selectedOverlayRef.current = new maps.CustomOverlay({
      position,
      content: overlayContent,
      yAnchor: 1.72,
      zIndex: 4,
    });
    selectedOverlayRef.current.setMap(map);
    map.panTo(position);

    if (selectionSourceRef.current === "marker") {
      listItemRefs.current.get(selectedItem.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeItemId, selectedItem]);

  useEffect(() => () => {
    selectedOverlayRef.current?.setMap(null);
  }, []);

  useEffect(() => {
    if (!mapReady) return;

    const timeoutId = window.setTimeout(() => {
      const map = mapRef.current;
      const maps = mapsRef.current;
      if (!map || !maps) return;

      map.relayout?.();

      if (selectedItem) {
        map.panTo(new maps.LatLng(selectedItem.latitude, selectedItem.longitude));
        return;
      }

      fitMapToItems();
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [fitMapToItems, mapExpanded, mapReady, selectedItem]);

  const resetFilters = () => {
    setQuery("");
    setCategory("");
    setArea("");
  };

  const hasActiveFilters = Boolean(query || category || area);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="eyebrow">FOUND ITEM MAP</span>
          <h1>
            <span>발견 위치를</span>
            <span>지도에서 확인하세요</span>
          </h1>
          <p>공개 가능한 발견 위치를 대략적인 구역 단위로 살펴보세요. 정확한 보관 장소나 비공개 확인 정보는 공개하지 않습니다.</p>
        </div>
      </section>

      <section className={styles.toolbar} aria-label="지도 발견물 필터">
        <label className={styles.searchField}>
          <span>검색어</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="설명, 색상, 발견 구역" />
        </label>
        <AreaPicker value={area} options={areaOptions} onChange={setArea} onSelect={focusArea} />
        <div className={styles.categoryChips} role="group" aria-label="물품 종류">
          {categoryOptions.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              aria-pressed={category === option.value}
              onClick={() => setCategory(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button className={styles.resetButton} type="button" onClick={resetFilters} disabled={!hasActiveFilters}>
          전체 보기
        </button>
      </section>

      <section className={styles.content} aria-label="발견물 지도와 목록">
        <aside className={styles.listPanel}>
          <div className={styles.panelHead}>
            <span>PUBLIC LIST</span>
            <strong>현재 표시 {filteredItems.length}개</strong>
          </div>

          {loading ? (
            <div className={styles.stateBox}>공개 발견물을 불러오는 중입니다.</div>
          ) : apiError ? (
            <div className={`${styles.stateBox} ${styles.errorBox}`}>
              <p>{apiError}</p>
              <button type="button" onClick={() => setItemsRetryKey((current) => current + 1)}>다시 시도</button>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.stateBox}>지도에 표시할 공개 발견물이 아직 없습니다.</div>
          ) : filteredItems.length === 0 ? (
            <div className={styles.stateBox}>
              <p>선택한 조건과 일치하는 발견물이 없습니다.</p>
              <button type="button" onClick={resetFilters}>필터 초기화</button>
            </div>
          ) : (
            <div className={styles.resultList}>
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  ref={(node) => {
                    if (node) listItemRefs.current.set(item.id, node);
                    else listItemRefs.current.delete(item.id);
                  }}
                  type="button"
                  className={styles.resultCard}
                  aria-pressed={item.id === activeItemId}
                  onClick={() => selectItem(item.id, "list")}
                >
                  <span>{statusLabels[item.status] ?? item.status}</span>
                  <strong>{item.public_description || item.item_category_name}</strong>
                  <em>{item.item_category_name} · {item.color || "색상 미상"}</em>
                  <small>{item.area_name} · {formatFoundAt(item.found_at)}</small>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div
          className={`${styles.mapPanel} ${mapExpanded ? styles.mapPanelExpanded : ""}`}
          role={mapExpanded ? "dialog" : undefined}
          aria-modal={mapExpanded ? "true" : undefined}
          aria-label={mapExpanded ? "확대된 발견물 지도" : undefined}
        >
          <div className={styles.mapTopBar}>
            <div className={styles.mapTitle}>
              <span>MAP VIEW</span>
              <strong>좌표 발견물 {filteredItems.length}개</strong>
            </div>
            <div className={styles.mapTopActions}>
              <button type="button" onClick={fitMapToItems} disabled={filteredItems.length === 0}>
                전체 보기
              </button>
              <button
                className={styles.mapExpandButton}
                type="button"
                onClick={() => setMapExpanded((current) => !current)}
                aria-label={mapExpanded ? "확대 지도 닫기" : "지도 크게 보기"}
              >
                {mapExpanded ? "닫기" : "크게 보기"}
              </button>
            </div>
          </div>
          <div ref={mapContainerRef} className={styles.mapCanvas} aria-label="공개 발견물 지도" />
          <div className={styles.mapTint} aria-hidden="true" />
          <div className={styles.mapZoomControls} aria-label="지도 확대 축소">
            <button type="button" onClick={() => zoomMap("in")} aria-label="지도 확대">+</button>
            <button type="button" onClick={() => zoomMap("out")} aria-label="지도 축소">−</button>
          </div>
          {!loading && !apiError && filteredItems.length === 0 && (
            <div className={styles.mapEmptyPill}>
              <span>현재 조건에 맞는 발견물이 없습니다.</span>
              {hasActiveFilters && <button type="button" onClick={resetFilters}>초기화</button>}
            </div>
          )}
          {!mapReady && !mapError && <div className={styles.mapState}>지도를 준비하는 중입니다.</div>}
          {mapError && (
            <div className={`${styles.mapState} ${styles.errorBox}`}>
              <Icon name="info" size={18} />
              <p>{mapError}</p>
              <button type="button" onClick={() => { setMapError(""); setMapRetryKey((current) => current + 1); }}>지도 다시 불러오기</button>
            </div>
          )}
          {selectedItem && (
            <div className={styles.mobileSelectedCard}>
              <span>{statusLabels[selectedItem.status] ?? selectedItem.status}</span>
              <strong>{selectedItem.public_description || selectedItem.item_category_name}</strong>
              <p>{selectedItem.area_name} · {formatFoundAt(selectedItem.found_at)}</p>
              <Link href={`/found-items/${selectedItem.id}`}>발견물 자세히 보기</Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
