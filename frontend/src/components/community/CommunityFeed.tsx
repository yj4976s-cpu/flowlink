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

type FeedItem =
  | { type: "USER_POST" | "NOTICE"; timestamp: string; post: CommunityPost }
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

export function CommunityFeed() {
  const [data, setData] = useState<FeedData | null>(null);
  const [category, setCategory] = useState("");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [placeText, setPlaceText] = useState("");
  const [place, setPlace] = useState<CommunityPlace | null>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [sort, setSort] = useState("latest");
  const [sortOpen, setSortOpen] = useState(false);
  const [view, setView] = useState<"feed" | "map">("feed");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [error, setError] = useState(false);
  const [skip, setSkip] = useState(0);
  const [reload, setReload] = useState(0);
  const sortRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<HTMLDivElement>(null);
  const paginationAbortRef = useRef<AbortController | null>(null);
  const requestKey = JSON.stringify({ category, query, place: place?.placeName ?? "", sort });
  const requestKeyRef = useRef(requestKey);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const controller = new AbortController();
    requestKeyRef.current = requestKey;
    paginationAbortRef.current?.abort();
    paginationAbortRef.current = null;
    void Promise.resolve()
      .then(() => {
        setLoadingMore(false);
        setMoreError("");
        setLoading(true);
        setError(false);
        return getCommunityFeed({ category: category || undefined, query: query || undefined, place: place?.placeName, sort, skip: 0, limit: 15 }, controller.signal);
      })
      .then((result) => {
        setData(result);
        setSkip(result.posts.length);
      })
      .catch(() => !controller.signal.aborted && setError(true))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [category, place?.placeName, query, reload, requestKey, sort]);

  useEffect(() => () => {
    paginationAbortRef.current?.abort();
    paginationAbortRef.current = null;
  }, []);

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

  const items = useMemo<FeedItem[]>(() => {
    if (!data) return [];
    return [
      ...data.posts.map((post): FeedItem => ({ type: post.is_notice ? "NOTICE" : "USER_POST", timestamp: post.created_at, post })),
      ...data.system_updates.map((update): FeedItem => ({ type: update.type, timestamp: update.timestamp, update })),
    ].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  }, [data]);

  const reset = () => {
    setCategory("");
    setInput("");
    setQuery("");
    setPlaceText("");
    setPlace(null);
    setSort("latest");
  };

  const selectAllPlaces = () => {
    setPlaceText("");
    setPlace(null);
    setPlaceOpen(false);
  };

  const more = async () => {
    if (!data || loadingMore || paginationAbortRef.current) return;
    const requestKeySnapshot = requestKey;
    const skipSnapshot = skip;
    const controller = new AbortController();
    paginationAbortRef.current = controller;
    setLoadingMore(true);
    setMoreError("");
    try {
      const next = await getCommunityFeed({ category: category || undefined, query: query || undefined, place: place?.placeName, sort, skip: skipSnapshot, limit: 15 }, controller.signal);
      if (controller.signal.aborted || requestKeySnapshot !== requestKeyRef.current) return;
      setData((current) => current ? { ...current, posts: [...current.posts, ...next.posts], has_more: next.has_more } : current);
      setSkip(skipSnapshot + next.posts.length);
    } catch {
      if (!controller.signal.aborted && requestKeySnapshot === requestKeyRef.current) setMoreError("추가 이야기를 불러오지 못했어요. 다시 시도해주세요.");
    } finally {
      if (paginationAbortRef.current === controller) {
        paginationAbortRef.current = null;
        setLoadingMore(false);
      }
    }
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
            <button type="button" key={label} aria-pressed={category === value} onClick={() => setCategory(value)}>{label}</button>
          ))}
        </div>
        <div className={styles.controlRow}>
          <label className={styles.storySearch}>
            <Icon name="search" size={18} />
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="물품이나 장소, 내용을 검색해보세요" />
          </label>
          <div className={styles.placeSelector} ref={placeRef}>
            <button type="button" aria-expanded={placeOpen} aria-controls="community-place-popover" onClick={() => setPlaceOpen((value) => !value)}><Icon name="location" size={18} /><span>{place?.placeName || "전체 지역"}</span><Icon name="chevron" size={15} /></button>
            {placeOpen && <div id="community-place-popover" className={styles.placePopover}><strong>지역 선택</strong><CommunityPlaceSearch value={placeText} onChange={setPlaceText} onSelect={(value) => { setPlace(value); if (value) setPlaceOpen(false); }} /><button type="button" className={styles.allPlaces} aria-pressed={!place} onClick={selectAllPlaces}><Icon name="location" size={16} /> 전체 지역</button></div>}
          </div>
          <div className={styles.customSelect} ref={sortRef}>
            <button type="button" aria-expanded={sortOpen} aria-controls="community-sort-menu" onClick={() => setSortOpen((value) => !value)}>
              {sort === "latest" ? "최신순" : "댓글 많은 순"}<Icon name="chevron" size={15} />
            </button>
            {sortOpen && (
              <div id="community-sort-menu" role="menu">
                <button type="button" aria-checked={sort === "latest"} role="menuitemradio" onClick={() => { setSort("latest"); setSortOpen(false); }}>최신순</button>
                <button type="button" aria-checked={sort === "comments"} role="menuitemradio" onClick={() => { setSort("comments"); setSortOpen(false); }}>댓글 많은 순</button>
              </div>
            )}
          </div>
          <div className={styles.viewSwitch} role="tablist" aria-label="보기 방식">
            <button id="community-feed-tab" role="tab" type="button" aria-selected={view === "feed"} aria-controls="community-view-panel" onClick={() => setView("feed")}><Icon name="document" size={16} />피드</button>
            <button id="community-map-tab" role="tab" type="button" aria-selected={view === "map"} aria-controls="community-view-panel" onClick={() => setView("map")}><Icon name="location" size={16} />지도</button>
          </div>
        </div>
      </section>

      {!loading && !error && data && data.posts.length > 0 && (
        <section className={styles.localSignals} aria-labelledby="local-signals-title">
          <div><span>LOCAL SIGNALS</span><h2 id="local-signals-title">지금 이 지역에서</h2></div>
          <div className={styles.signalGrid}>{data.posts.slice(0, 3).map((post) => <Link href={`/community/${post.id}`} key={`signal-${post.id}`}><em data-category={post.category}>{categoryLabel[post.category]}</em><strong>{post.title}</strong><span>{post.place_name || "지역 정보 없음"} · {elapsed(post.created_at)}</span></Link>)}</div>
        </section>
      )}

      <div className={styles.communityGrid}>
        <section id="community-view-panel" className={styles.feedColumn} role="tabpanel" aria-labelledby={view === "map" ? "community-map-tab" : "community-feed-tab"} aria-live="polite">
          {view === "feed" && !loading && !error && items.length > 0 && <div className={styles.flowHeading}><span>TODAY FLOW</span><strong>{place?.placeName || "전체 지역"}</strong></div>}
          {view === "map" ? (
            <CommunityMap posts={data?.posts ?? []} updates={data?.system_updates ?? []} center={place ? { latitude: place.latitude, longitude: place.longitude } : undefined} filtered={Boolean(query || category || place)} onShowAll={reset} />
          ) : loading && !data ? (
            <div className={styles.flowSkeleton} aria-label="이야기를 불러오는 중">{[1, 2, 3].map((item) => <div key={item}><i /><article><span /><b /><em /></article></div>)}</div>
          ) : error ? (
            <div className={styles.errorState} role="alert"><Icon name="info" size={22} /><div><h2>게시글을 불러오지 못했어요.</h2><p>잠시 후 다시 시도해주세요.</p></div><button type="button" onClick={() => setReload((value) => value + 1)}>다시 불러오기</button></div>
          ) : items.length ? (
            <div className={styles.flowStream}>
              {items.map((item) => {
                const isPost = "post" in item;
                const source = isPost ? categoryLabel[item.post.category] : item.type === "RETURN_UPDATE" ? "반환 소식" : "발견물 소식";
                const placeName = isPost ? item.post.place_name : item.update.place_name;
                const card = isPost ? (
                  <Link href={`/community/${item.post.id}`} className={styles.feedCard}>
                    <header><span>{source}</span>{placeName && <small><Icon name="location" size={14} />{placeName}</small>}</header>
                    <h2>{item.post.title}</h2>
                    <p>{item.post.content}</p>
                    {item.post.image_url && <div className={styles.feedImage}><img src={resolveCommunityImageUrl(item.post.image_url) || ""} alt="게시글 첨부 이미지" /></div>}
                    <footer><span>{item.post.nickname} · {elapsed(item.timestamp)}</span><b>댓글 {item.post.comment_count}</b></footer>
                  </Link>
                ) : (
                  <article className={styles.feedCard}>
                    <header><span>{source}</span><small><Icon name="location" size={14} />{placeName}</small></header>
                    <h2>{item.update.title}</h2>
                    <footer><span>{elapsed(item.timestamp)} · 발견물 센터</span>{item.update.href && <Link href={item.update.href}>발견물 확인하기 <Icon name="arrow" size={14} /></Link>}</footer>
                  </article>
                );
                return <div className={styles.flowItem} data-source={item.type} key={isPost ? `post-${item.post.id}` : `${item.type}-${item.update.id}`}><time>{clock(item.timestamp)}</time><i aria-hidden="true" />{card}</div>;
              })}
            </div>
          ) : (
            <div className={styles.emptyState}><Icon name="document" size={26} /><h2>아직 이 조건에 맞는 이야기가 없어요.</h2><p>{query || category || place ? "검색 조건을 바꾸거나 첫 번째 정보를 남겨보세요." : "첫 번째 정보를 남겨보세요."}</p>{query || category || place ? <button type="button" onClick={reset}>필터 초기화</button> : <Link href="/community/new">글 작성하기</Link>}</div>
          )}
          {moreError && view === "feed" && <p className={styles.moreError} role="alert">{moreError}</p>}
          {data?.has_more && view === "feed" && <button className={styles.more} type="button" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? "불러오는 중" : "이야기 더 보기"}</button>}
        </section>

      </div>
      <section className={styles.foundCenterCta}><div><strong>공식 등록된 발견물을 찾고 있나요?</strong><span>AI 탐지와 공식 등록 정보를 발견물 센터에서 비교해보세요.</span></div><Link href="/found-items">발견물 센터 보기 <Icon name="arrow" size={15} /></Link></section>
    </main>
  );
}
