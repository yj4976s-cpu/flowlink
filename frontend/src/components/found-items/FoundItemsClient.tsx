"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { FoundItemsApiError, FoundItemListItem, listFoundItems, type FoundItemFilters } from "@/lib/foundItemsApi";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusLabel: Record<string, string> = {
  AVAILABLE: "공개 중",
  RECOVERED: "회수됨",
};

const emptyFilters = {
  q: "",
  item_category: "",
  color: "",
  area_name: "",
};

const quickFilters = [
  { label: "공", patch: { item_category: "공" } },
  { label: "가방", patch: { item_category: "가방" } },
  { label: "우산", patch: { item_category: "우산" } },
  { label: "신발·슬리퍼류", patch: { item_category: "신발·슬리퍼류" } },
  { label: "검정", patch: { color: "검정" } },
] as const;

const categoryOptions = ["공", "가방", "우산", "신발·슬리퍼류"];
const colorOptions = ["검정"];
const regionSuggestions = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];

type OpenFilter = "item_category" | "color" | "area_name" | null;

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "일시 확인 중" : dateFormatter.format(date);
}

function getStatusLabel(status: string) {
  return statusLabel[status] ?? status;
}

function normalizeFilters(filters: typeof emptyFilters): FoundItemFilters {
  return {
    q: filters.q.trim() || undefined,
    item_category: filters.item_category.trim() || undefined,
    color: filters.color.trim() || undefined,
    area_name: filters.area_name.trim() || undefined,
  };
}

function mergeAreaOptions(current: string[], items: FoundItemListItem[]) {
  const names = new Set(current);
  items.forEach((item) => {
    const areaName = item.area_name.trim();
    if (areaName) names.add(areaName);
  });
  return [...names].sort((first, second) => first.localeCompare(second, "ko-KR")).slice(0, 12);
}

function FoundItemCard({ item }: { item: FoundItemListItem }) {
  return (
    <article className="found-search-card">
      <div className="found-search-card-head">
        <span className="category-chip">{item.item_category_name}</span>
        <span className="found-status-chip">{getStatusLabel(item.status)}</span>
      </div>
      <h2>{item.public_description || `${item.item_category_name} 발견물`}</h2>
      <dl className="found-card-meta">
        <div>
          <dt><Icon name="location" size={15} /> 발견 구역</dt>
          <dd>{item.area_name}</dd>
        </div>
        <div>
          <dt><Icon name="clock" size={15} /> 발견 시각</dt>
          <dd><time dateTime={item.found_at}>{formatDateTime(item.found_at)}</time></dd>
        </div>
        <div>
          <dt>색상</dt>
          <dd>{item.color || "미상"}</dd>
        </div>
      </dl>
      <Link className="found-card-link" href={`/found-items/${item.id}`} aria-label={`${item.item_category_name} 발견물 상세 보기`}>
        상세 보기 <Icon name="arrow" size={16} />
      </Link>
    </article>
  );
}

export function FoundItemsClient() {
  const [filters, setFilters] = useState(emptyFilters);
  const [openFilter, setOpenFilter] = useState<OpenFilter>(null);
  const [areaSearch, setAreaSearch] = useState("");
  const [items, setItems] = useState<FoundItemListItem[]>([]);
  const [areaOptions, setAreaOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const resultLabel = useMemo(() => {
    if (loading && !hasLoaded) return "발견물 목록을 불러오는 중입니다.";
    if (error) return error;
    return `공개 발견물 ${items.length}건`;
  }, [error, hasLoaded, items.length, loading]);

  const filteredAreaOptions = useMemo(() => {
    const keyword = areaSearch.trim().toLowerCase();
    if (!keyword) return areaOptions;
    return areaOptions.filter((areaName) => areaName.toLowerCase().includes(keyword));
  }, [areaOptions, areaSearch]);
  const showTypedAreaOption = areaSearch.trim() && !filteredAreaOptions.includes(areaSearch.trim());
  const visibleRegionSuggestions = useMemo(() => {
    const keyword = areaSearch.trim().toLowerCase();
    return regionSuggestions.filter((region) => {
      const isAlreadyLoaded = filteredAreaOptions.includes(region);
      const matchesKeyword = !keyword || region.toLowerCase().includes(keyword);
      return !isAlreadyLoaded && matchesKeyword;
    });
  }, [areaSearch, filteredAreaOptions]);

  const loadItems = useCallback(async (nextFilters: typeof emptyFilters, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listFoundItems(normalizeFilters(nextFilters), signal);
      setItems(data);
      setAreaOptions((current) => mergeAreaOptions(current, data));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      const message = caught instanceof FoundItemsApiError ? caught.message : "발견물 정보를 불러오지 못했습니다.";
      setError(message);
      setItems([]);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setHasLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadInitialItems = async () => {
      try {
        const data = await listFoundItems(normalizeFilters(emptyFilters), controller.signal);
        setItems(data);
        setAreaOptions((current) => mergeAreaOptions(current, data));
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        const message = caught instanceof FoundItemsApiError ? caught.message : "발견물 정보를 불러오지 못했습니다.";
        setError(message);
        setItems([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setHasLoaded(true);
        }
      }
    };

    void loadInitialItems();
    return () => controller.abort();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadItems(filters);
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    void loadItems(emptyFilters);
  };

  const applyQuickFilter = (patch: Partial<typeof emptyFilters>) => {
    const nextFilters = { ...filters, ...patch };
    setFilters(nextFilters);
    setOpenFilter(null);
    void loadItems(nextFilters);
  };

  const searchAreaAsKeyword = () => {
    const areaKeyword = areaSearch.trim() || filters.area_name.trim();
    if (!areaKeyword) return;
    const nextFilters = { ...filters, q: areaKeyword, area_name: "" };
    setFilters(nextFilters);
    setOpenFilter(null);
    void loadItems(nextFilters);
  };

  const searchAreaExactly = () => {
    const areaName = areaSearch.trim() || filters.area_name.trim();
    if (!areaName) return;
    const nextFilters = { ...filters, area_name: areaName };
    setFilters(nextFilters);
    setOpenFilter(null);
    void loadItems(nextFilters);
  };

  const searchRegionSuggestion = (region: string) => {
    const nextFilters = { ...filters, area_name: region };
    setFilters(nextFilters);
    setAreaSearch(region);
    setOpenFilter(null);
    void loadItems(nextFilters);
  };

  const toggleFilter = (filter: OpenFilter) => {
    setOpenFilter((current) => (current === filter ? null : filter));
  };

  const openAreaPicker = () => {
    setAreaSearch(filters.area_name);
    setOpenFilter("area_name");
  };

  return (
    <main className="found-items-page">
      <section className="found-items-hero" aria-labelledby="found-items-title">
        <div>
          <p className="placeholder-eyebrow">FOUND ITEMS</p>
          <h1 id="found-items-title">발견물 찾기</h1>
          <p>공개된 발견물의 종류, 색상, 대략적인 발견 구역을 확인하고 내 물건과 관련 있는 후보를 살펴보세요.</p>
        </div>
        <div className="found-hero-notes" aria-label="발견물 조회 안내">
          <span><Icon name="location" size={18} /> 대략 구역만 공개</span>
          <span><Icon name="clock" size={18} /> 발견 시각 확인</span>
          <span><Icon name="check" size={18} /> 공개 상태 표시</span>
        </div>
      </section>

      <section className="found-filter-panel" aria-labelledby="found-filter-title">
        <div className="found-filter-heading">
          <div>
            <p className="placeholder-eyebrow">SEARCH</p>
            <h2 id="found-filter-title">검색 조건</h2>
          </div>
          <p className={error ? "is-error" : undefined} aria-live="polite">{resultLabel}</p>
        </div>
        <form className="found-filter-form" onSubmit={handleSubmit}>
          <label>
            <span>검색어</span>
            <input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} name="q" placeholder="설명, 구역, 색상" />
          </label>
          <label>
            <span>물품 종류</span>
            <div className="found-input-menu">
              <input value={filters.item_category} onChange={(event) => setFilters((current) => ({ ...current, item_category: event.target.value }))} name="item_category" placeholder="가방 또는 BAG" />
              <button type="button" aria-label="물품 종류 추천 목록 열기" aria-expanded={openFilter === "item_category"} onClick={() => toggleFilter("item_category")}>
                <Icon name="arrow" size={15} />
              </button>
              {openFilter === "item_category" && (
                <div className="found-filter-menu" role="list" aria-label="물품 종류 추천">
                  {categoryOptions.map((option) => (
                    <button key={option} type="button" role="listitem" onClick={() => applyQuickFilter({ item_category: option })}>{option}</button>
                  ))}
                </div>
              )}
            </div>
          </label>
          <label>
            <span>색상</span>
            <div className="found-input-menu">
              <input value={filters.color} onChange={(event) => setFilters((current) => ({ ...current, color: event.target.value }))} name="color" placeholder="검정, 파랑 등" />
              <button type="button" aria-label="색상 추천 목록 열기" aria-expanded={openFilter === "color"} onClick={() => toggleFilter("color")}>
                <Icon name="arrow" size={15} />
              </button>
              {openFilter === "color" && (
                <div className="found-filter-menu" role="list" aria-label="색상 추천">
                  {colorOptions.map((option) => (
                    <button key={option} type="button" role="listitem" onClick={() => applyQuickFilter({ color: option })}>{option}</button>
                  ))}
                </div>
              )}
            </div>
          </label>
          <label>
            <span>발견 구역</span>
            <div className="found-input-menu">
              <input value={filters.area_name} onChange={(event) => setFilters((current) => ({ ...current, area_name: event.target.value }))} name="area_name" placeholder="예: 한강공원 A구역" />
              <button type="button" aria-label="발견 구역 선택 팝업 열기" aria-expanded={openFilter === "area_name"} onClick={openAreaPicker}>
                <Icon name="arrow" size={15} />
              </button>
            </div>
          </label>
          <div className="found-filter-actions">
            <button className="button button-primary" type="submit" disabled={loading}>검색 <Icon name="arrow" size={18} /></button>
            <button className="button button-secondary" type="button" onClick={resetFilters} disabled={loading}>초기화</button>
          </div>
        </form>
        <div className="found-quick-filters" aria-label="빠른 검색 조건">
          <span>빠른 검색</span>
          {quickFilters.map((filter) => (
            <button key={filter.label} type="button" onClick={() => applyQuickFilter(filter.patch)} disabled={loading}>
              {filter.label}
            </button>
          ))}
        </div>
      </section>

      {openFilter === "area_name" && (
        <div className="area-picker-backdrop" role="presentation">
          <section className="area-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="area-picker-title">
            <div className="area-picker-heading">
              <div>
                <h2 id="area-picker-title">지역 선택</h2>
                <p>공개 발견물에 등록된 발견 구역을 선택해주세요.</p>
              </div>
              <button type="button" aria-label="지역 선택 닫기" onClick={() => setOpenFilter(null)}>
                <Icon name="close" size={24} />
              </button>
            </div>
            <label className="area-picker-search">
              <span className="sr-only">지역 검색</span>
              <Icon name="scan" size={20} />
              <input value={areaSearch} onChange={(event) => setAreaSearch(event.target.value)} placeholder="지역 검색" autoFocus />
            </label>
            {filteredAreaOptions.length > 0 ? (
              <div className="area-picker-grid" role="list" aria-label="등록된 발견 구역">
                {filteredAreaOptions.map((areaName) => (
                  <button key={areaName} type="button" role="listitem" onClick={() => applyQuickFilter({ area_name: areaName })}>{areaName}</button>
                ))}
                {showTypedAreaOption && (
                  <button type="button" role="listitem" onClick={() => applyQuickFilter({ area_name: areaSearch.trim() })}>
                    {areaSearch.trim()}
                  </button>
                )}
              </div>
            ) : areaSearch.trim() ? (
              <div className="area-picker-grid" role="list" aria-label="입력한 발견 구역">
                <button type="button" role="listitem" onClick={() => applyQuickFilter({ area_name: areaSearch.trim() })}>
                  {areaSearch.trim()}
                </button>
              </div>
            ) : (
              <div className="area-picker-empty">
                <strong>선택할 구역이 없습니다.</strong>
                <p>공개 발견물에서 불러온 구역이 없거나 검색어와 일치하는 구역이 없습니다.</p>
              </div>
            )}
            {visibleRegionSuggestions.length > 0 && (
              <div className="area-picker-section">
                <h3>주요 지역</h3>
                <div className="area-picker-grid" role="list" aria-label="주요 지역">
                  {visibleRegionSuggestions.map((region) => (
                    <button key={region} type="button" role="listitem" onClick={() => searchRegionSuggestion(region)}>{region}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="area-picker-actions">
              <button type="button" onClick={searchAreaExactly} disabled={!areaSearch.trim()}>입력한 구역명으로 검색</button>
              <button type="button" onClick={searchAreaAsKeyword} disabled={!areaSearch.trim()}>전체 키워드로 검색</button>
            </div>
          </section>
        </div>
      )}

      <section className="found-results-section" aria-labelledby="found-results-title" aria-busy={loading}>
        <div className="recent-heading">
          <div><p>PUBLIC LIST</p><h2 id="found-results-title">공개 발견물</h2></div>
        </div>

        {loading && <div className="found-state-card" role="status"><Icon name="scan" size={24} /><span>발견물 목록을 불러오고 있습니다.</span></div>}
        {!loading && error && (
          <div className="found-state-card found-state-error" role="alert">
            <Icon name="spark" size={24} />
            <div><strong>목록을 불러오지 못했습니다.</strong><p>{error}</p></div>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="found-state-card">
            <Icon name="document" size={24} />
            <div><strong>조건에 맞는 발견물이 없습니다.</strong><p>검색어를 줄이거나 색상, 구역 조건을 비워 다시 찾아보세요.</p></div>
          </div>
        )}
        {!loading && !error && items.length > 0 && (
          <div className="found-search-grid" role="list">
            {items.map((item) => <div role="listitem" key={item.id}><FoundItemCard item={item} /></div>)}
          </div>
        )}
      </section>
    </main>
  );
}
