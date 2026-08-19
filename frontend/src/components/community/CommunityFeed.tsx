"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  getCommunityFeed,
  resolveCommunityImageUrl,
  type CommunityCategory,
  type CommunityFeed as FeedData,
  type CommunityPost,
  type CommunitySystemUpdate,
} from "@/lib/communityApi";
import { CommunityMap } from "./CommunityMap";
import { CommunityPlaceSearch, type CommunityPlace } from "./CommunityPlaceSearch";
import styles from "./Community.module.css";

const PAGE_SIZE = 10;
const MAP_LIMIT = 30;

type FeedItem =
  | { type: "USER_POST"; timestamp: string; post: CommunityPost }
  | { type: "FOUND_ITEM_UPDATE" | "RETURN_UPDATE"; timestamp: string; update: CommunitySystemUpdate };

const categoryLabel: Record<CommunityCategory, string> = {
  FIELD_STORY: "목격 제보",
  QUESTION: "도움 요청",
  EXPERIENCE: "반환·이용 경험",
  OPINION: "자유 이야기",
};

const elapsed = (value: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  return new Date(value).toLocaleDateString("ko-KR");
};

const clock = (value: string) => new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

const defaultUrlState = () => ({
  category: "",
  query: "",
  placeName: "",
  latitude: null as number | null,
  longitude: null as number | null,
  sort: "latest",
  view: "feed" as "feed" | "map",
  page: 1,
});

const readUrlState = () => {
  if (typeof window === "undefined") return defaultUrlState();
  const params = new URLSearchParams(window.location.search);
  const latitudeParam = params.get("lat");
  const longitudeParam = params.get("lng");
  const latitude = latitudeParam == null ? Number.NaN : Number(latitudeParam);
  const longitude = longitudeParam == null ? Number.NaN : Number(longitudeParam);
  return {
    category: params.get("category") || "",
    query: params.get("query") || "",
    placeName: params.get("place") || "",
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    sort: params.get("sort") === "comments" ? "comments" : "latest",
    view: params.get("view") === "map" ? ("map" as const) : ("feed" as const),
    page: Math.max(1, Number(params.get("page")) || 1),
  };
};

const placeFromUrlState = (state: ReturnType<typeof readUrlState>): CommunityPlace | null => {
  if (!state.placeName) return null;
  return { placeName: state.placeName, address: state.placeName, latitude: state.latitude ?? Number.NaN, longitude: state.longitude ?? Number.NaN };
};

const buildSearch = (values: { category: string; query: string; place: CommunityPlace | null; sort: string; view: "feed" | "map"; page: number }) => {
  const params = new URLSearchParams();
  if (values.category) params.set("category", values.category);
  if (values.query) params.set("query", values.query);
  if (values.place?.placeName) {
    params.set("place", values.place.placeName);
    if (Number.isFinite(values.place.latitude)) params.set("lat", String(values.place.latitude));
    if (Number.isFinite(values.place.longitude)) params.set("lng", String(values.place.longitude));
  }
  if (values.sort !== "latest") params.set("sort", values.sort);
  if (values.view !== "feed") params.set("view", values.view);
  if (values.page > 1) params.set("page", String(values.page));
  return params.toString();
};

function FeedThumbnail({ imageUrl, fallback }: { imageUrl: string | null; fallback: "post" | "question" | "found" | "return" }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imageSrc = resolveCommunityImageUrl(imageUrl);
  const src = imageSrc && failedSrc !== imageSrc ? imageSrc : null;
  const iconName = fallback === "question" ? "info" : fallback === "found" || fallback === "return" ? "location" : "document";

  return (
    <div className={styles.feedImage} data-fallback={!src}>
      {src ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} />
      ) : (
        <span aria-hidden="true"><Icon name={iconName} size={22} /></span>
      )}
    </div>
  );
}

export function CommunityFeed() {
  const initial = defaultUrlState();
  const [data, setData] = useState<FeedData | null>(null);
  const [mapData, setMapData] = useState<FeedData | null>(null);
  const [category, setCategory] = useState(initial.category);
  const [input, setInput] = useState(initial.query);
  const [query, setQuery] = useState(initial.query);
  const [placeText, setPlaceText] = useState(initial.placeName);
  const [place, setPlace] = useState<CommunityPlace | null>(placeFromUrlState(initial));
  const [placeOpen, setPlaceOpen] = useState(false);
  const [sort, setSort] = useState(initial.sort);
  const [sortOpen, setSortOpen] = useState(false);
  const [view, setView] = useState<"feed" | "map">(initial.view);
  const [page, setPage] = useState(initial.page);
  const [urlReady, setUrlReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const sortRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<HTMLDivElement>(null);
  const feedHeadingRef = useRef<HTMLDivElement>(null);
  const skipNextInputSyncRef = useRef(false);

  useEffect(() => {
    if (!urlReady) return;
    if (skipNextInputSyncRef.current) {
      skipNextInputSyncRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      setPage(1);
      setQuery(input.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [input, urlReady]);

  useEffect(() => {
    const apply = () => {
      const next = readUrlState();
      skipNextInputSyncRef.current = true;
      setCategory(next.category);
      setInput(next.query);
      setQuery(next.query);
      setPlaceText(next.placeName);
      setPlace(placeFromUrlState(next));
      setSort(next.sort);
      setView(next.view);
      setPage(next.page);
      setUrlReady(true);
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => {
      window.removeEventListener("popstate", apply);
    };
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const search = buildSearch({ category, query, place, sort, view, page });
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
  }, [category, page, place, query, sort, urlReady, view]);

  useEffect(() => {
    if (!urlReady) return;
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => {
        setLoading(true);
        setError(false);
        return getCommunityFeed({ category: category || undefined, query: query || undefined, place: place?.placeName, sort, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }, controller.signal);
      })
      .then((result) => {
        setData(result);
        const nextTotalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
        if (page > nextTotalPages) setPage(nextTotalPages);
      })
      .catch(() => !controller.signal.aborted && setError(true))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [category, page, place?.placeName, query, reload, sort, urlReady]);

  useEffect(() => {
    if (!urlReady || view !== "map") return;
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => {
        setMapLoading(true);
        return getCommunityFeed({ category: category || undefined, query: query || undefined, place: place?.placeName, sort, skip: 0, limit: MAP_LIMIT }, controller.signal);
      })
      .then((result) => setMapData(result))
      .catch(() => !controller.signal.aborted && setMapData(null))
      .finally(() => !controller.signal.aborted && setMapLoading(false));
    return () => controller.abort();
  }, [category, place?.placeName, query, reload, sort, urlReady, view]);

  useEffect(() => {
    if (!sortOpen && !placeOpen) return;
    const close = (event: PointerEvent) => {
      if (sortOpen && !sortRef.current?.contains(event.target as Node)) setSortOpen(false);
      if (placeOpen && !placeRef.current?.contains(event.target as Node)) setPlaceOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSortOpen(false);
        setPlaceOpen(false);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [placeOpen, sortOpen]);

  const notices = data?.notices ?? [];
  const items = useMemo<FeedItem[]>(() => {
    if (!data) return [];
    const mixedItems = [
      ...data.posts.map((post): FeedItem => ({ type: "USER_POST", timestamp: post.created_at, post })),
      ...data.system_updates.map((update): FeedItem => ({ type: update.type, timestamp: update.timestamp, update })),
    ];
    if (sort === "comments") return mixedItems;
    return mixedItems.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  }, [data, sort]);
  const mapPosts = [...(mapData?.notices ?? []), ...(mapData?.posts ?? [])];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const mapCenter = place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude) ? { latitude: place.latitude, longitude: place.longitude } : undefined;
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
    const start = Math.min(Math.max(1, currentPage - 2), Math.max(1, totalPages - 4));
    return start + index;
  });

  const syncPage = (nextPage: number) => {
    const safePage = Math.min(Math.max(1, nextPage), totalPages);
    setPage(safePage);
    const search = buildSearch({ category, query, place, sort, view, page: safePage });
    window.history.pushState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
    window.setTimeout(() => feedHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const reset = () => {
    setCategory("");
    setInput("");
    setQuery("");
    setPlaceText("");
    setPlace(null);
    setSort("latest");
    setPage(1);
  };

  const selectAllPlaces = () => {
    setPlaceText("");
    setPlace(null);
    setPlaceOpen(false);
    setPage(1);
  };

  const choosePlace = (value: CommunityPlace | null) => {
    setPlace(value);
    setPage(1);
    if (value) setPlaceOpen(false);
  };

  const chooseCategory = (value: string) => {
    setCategory(value);
    setPage(1);
  };

  const chooseSort = (value: string) => {
    setSort(value);
    setSortOpen(false);
    setPage(1);
  };

  return (
    <main className={styles.communityPage}>
      <section className={styles.hero}>
        <div>
          <p>COMMUNITY</p>
          <h1>커뮤니티</h1>
          <span>잃어버린 물건을 찾는 사람과 현장의 작은 단서를 연결합니다.<br />목격 정보, 발견 위치, 이용 경험을 편하게 남겨주세요.</span>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.heroActionCard}>
            <span>함께 찾는 단서</span>
            <strong>목격했거나 발견한 정보가 있나요?</strong>
            <p>사진이나 정확한 위치가 없어도 괜찮아요. 기억나는 특징만 남겨도 누군가에게 도움이 됩니다.</p>
            <Link className="button button-primary" href="/community/new">글 작성하기 <Icon name="arrow" size={15} /></Link>
          </div>
        </div>
      </section>

      <section className={styles.toolbar} aria-label="커뮤니티 필터와 보기 설정">
        <div className={styles.boardHeading}><span>COMMUNITY BOARD</span><h2>지금 올라온 정보</h2></div>
        <div className={styles.categories} aria-label="이야기 카테고리">
          {[["", "전체"], ["FIELD_STORY", "목격 제보"], ["QUESTION", "도움 요청"], ["EXPERIENCE", "반환·이용 경험"], ["OPINION", "자유 이야기"]].map(([value, label]) => (
            <button type="button" key={label} aria-pressed={category === value} onClick={() => chooseCategory(value)}>{label}</button>
          ))}
        </div>
        <div className={styles.controlRow}>
          <label className={styles.storySearch}>
            <Icon name="search" size={18} />
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="물품이나 장소, 내용을 검색해보세요" />
          </label>
          <div className={styles.placeSelector} ref={placeRef}>
            <button type="button" aria-expanded={placeOpen} aria-controls="community-place-popover" onClick={() => setPlaceOpen((value) => !value)}><Icon name="location" size={18} /><span>{place?.placeName || "전체 지역"}</span><Icon name="chevron" size={15} /></button>
            {placeOpen && <div id="community-place-popover" className={styles.placePopover}><strong>지역 선택</strong><CommunityPlaceSearch value={placeText} onChange={setPlaceText} onSelect={choosePlace} /><button type="button" className={styles.allPlaces} aria-pressed={!place} onClick={selectAllPlaces}><Icon name="location" size={16} /> 전체 지역</button></div>}
          </div>
          <div className={styles.customSelect} ref={sortRef}>
            <button type="button" aria-expanded={sortOpen} aria-controls="community-sort-menu" onClick={() => setSortOpen((value) => !value)}>
              {sort === "latest" ? "최신순" : "댓글 많은 순"}<Icon name="chevron" size={15} />
            </button>
            {sortOpen && (
              <div id="community-sort-menu" role="menu">
                <button type="button" aria-checked={sort === "latest"} role="menuitemradio" onClick={() => chooseSort("latest")}>최신순</button>
                <button type="button" aria-checked={sort === "comments"} role="menuitemradio" onClick={() => chooseSort("comments")}>댓글 많은 순</button>
              </div>
            )}
          </div>
          <div className={styles.viewSwitch} role="tablist" aria-label="보기 방식">
            <button id="community-feed-tab" role="tab" type="button" aria-selected={view === "feed"} aria-controls="community-view-panel" onClick={() => setView("feed")}><Icon name="document" size={16} />피드</button>
            <button id="community-map-tab" role="tab" type="button" aria-selected={view === "map"} aria-controls="community-view-panel" onClick={() => setView("map")}><Icon name="location" size={16} />지도</button>
          </div>
        </div>
      </section>

      <div className={styles.communityGrid}>
        <section id="community-view-panel" className={styles.feedColumn} role="tabpanel" aria-labelledby={view === "map" ? "community-map-tab" : "community-feed-tab"} aria-live="polite">
          {view === "feed" && !loading && !error && (notices.length > 0 || items.length > 0) && <div ref={feedHeadingRef} className={styles.flowHeading}><span>COMMUNITY FLOW</span><strong>{place?.placeName || "전체 지역"} · {data?.total ?? 0}개 흐름</strong></div>}
          {view === "map" ? (
            <>
              {mapLoading && <div className={styles.mapDataLoading}><Icon name="refresh" size={18} /><span>지도 데이터를 불러오고 있어요.</span></div>}
              <CommunityMap posts={mapPosts} updates={mapData?.system_updates ?? data?.system_updates ?? []} center={mapCenter} filtered={Boolean(query || category || place)} onShowAll={reset} />
            </>
          ) : loading && !data ? (
            <div className={styles.flowSkeleton} aria-label="이야기를 불러오는 중">{[1, 2, 3].map((item) => <div key={item}><i /><article><span /><b /><em /></article></div>)}</div>
          ) : error ? (
            <div className={styles.errorState} role="alert"><Icon name="info" size={22} /><div><h2>게시글을 불러오지 못했어요.</h2><p>잠시 후 다시 시도해주세요.</p></div><button type="button" onClick={() => setReload((value) => value + 1)}>다시 불러오기</button></div>
          ) : notices.length > 0 || items.length > 0 ? (
            <>
              {notices.length > 0 && (
                <section className={styles.noticeStack} aria-label="커뮤니티 공지">
                  {notices.map((notice) => (
                    <Link href={`/community/${notice.id}`} className={styles.noticeCard} key={`notice-${notice.id}`}>
                      <span>공지</span>
                      <b>{notice.title}</b>
                      <small>{notice.nickname} · {elapsed(notice.created_at)}</small>
                    </Link>
                  ))}
                </section>
              )}
              <div className={styles.flowStream}>
                {items.map((item) => {
                  const isPost = "post" in item;
                  const source = isPost ? categoryLabel[item.post.category] : item.type === "RETURN_UPDATE" ? "반환 소식" : "발견물 소식";
                  const placeName = isPost ? item.post.place_name : item.update.place_name;
                  const timestamp = item.timestamp;
                  const thumbnail = isPost ? (
                    <FeedThumbnail imageUrl={item.post.image_url} fallback={item.post.category === "QUESTION" ? "question" : "post"} />
                  ) : (
                    <FeedThumbnail imageUrl={item.update.image_url} fallback={item.type === "RETURN_UPDATE" ? "return" : "found"} />
                  );
                  const content = isPost ? (
                    <Link href={`/community/${item.post.id}`} className={styles.feedCard}>
                      <div className={styles.feedText}>
                        <header><span>{source}</span>{placeName && <small><Icon name="location" size={14} />{placeName}</small>}</header>
                        <h2>{item.post.title}</h2>
                        <p>{item.post.content}</p>
                        <footer><span>{item.post.nickname} · {elapsed(timestamp)}</span><b>댓글 {item.post.comment_count}</b></footer>
                      </div>
                      {thumbnail}
                    </Link>
                  ) : (
                    <article className={styles.feedCard}>
                      <div className={styles.feedText}>
                        <header><span>{source}</span><small><Icon name="location" size={14} />{placeName}</small></header>
                        <h2>{item.update.title}</h2>
                        <footer><span>{elapsed(timestamp)} · 발견물 센터</span>{item.update.href && <Link href={item.update.href}>발견물 확인하기 <Icon name="arrow" size={14} /></Link>}</footer>
                      </div>
                      {thumbnail}
                    </article>
                  );
                  return <div className={styles.flowItem} data-source={item.type} key={isPost ? `post-${item.post.id}` : `${item.type}-${item.update.id}`}><time>{clock(timestamp)}</time><i aria-hidden="true" />{content}</div>;
                })}
              </div>
              {totalPages > 1 && (
                <nav className={styles.pagination} aria-label="커뮤니티 페이지">
                  <button type="button" disabled={currentPage <= 1} onClick={() => syncPage(currentPage - 1)}>이전</button>
                  <div className={styles.paginationPages}>
                    {pages.map((value) => <button type="button" key={value} aria-current={value === currentPage ? "page" : undefined} onClick={() => syncPage(value)}>{value}</button>)}
                  </div>
                  <span>{currentPage} / {totalPages}</span>
                  <button type="button" disabled={currentPage >= totalPages} onClick={() => syncPage(currentPage + 1)}>다음</button>
                </nav>
              )}
            </>
          ) : (
            <div className={styles.emptyState}><Icon name="document" size={26} /><h2>아직 이 조건에 맞는 이야기가 없어요.</h2><p>{query || category || place ? "검색 조건을 바꾸거나 첫 번째 정보를 남겨보세요." : "첫 번째 정보를 남겨보세요."}</p>{query || category || place ? <button type="button" onClick={reset}>필터 초기화</button> : <Link href="/community/new">글 작성하기</Link>}</div>
          )}
        </section>
      </div>
      <section className={styles.foundCenterCta}><div><strong>공식 등록된 발견물을 찾고 있나요?</strong><span>AI 탐지와 공식 등록 정보를 발견물 센터에서 비교해보세요.</span></div><Link href="/found-items">발견물 센터 보기 <Icon name="arrow" size={15} /></Link></section>
    </main>
  );
}
