"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/common/Icon";
import { getAdminCommunityPosts, type AdminCommunityPost, type AdminCommunityPostsResponse } from "@/lib/adminCommunityPostsApi";
import styles from "@/components/admin/users/AdminUsersClient.module.css";

const PAGE_SIZE = 10;
const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
const categoryLabels: Record<string, string> = {
  FIELD_STORY: "목격 제보",
  QUESTION: "도움 요청",
  EXPERIENCE: "반환·이용 경험",
  OPINION: "자유 이야기",
};

function formatDate(value: string | null) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "기록 없음" : dateTime.format(date);
}

function KpiCard({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return <article className={styles.kpiCard} data-tone={tone}><span>{label}</span><strong>{value.toLocaleString("ko-KR")}</strong><small>{note}</small></article>;
}

function CategoryBreakdown({ data }: { data: AdminCommunityPostsResponse["category_breakdown"] }) {
  const items = useMemo(() => ["FIELD_STORY", "QUESTION", "EXPERIENCE", "OPINION"].map((category) => ({
    category,
    label: categoryLabels[category],
    count: data.find((item) => item.category === category)?.count ?? 0,
  })), [data]);
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className={styles.categorySummary} aria-label={items.map((item) => `${item.label} ${item.count}건`).join(", ")}>
      <div>{items.map((item) => <span key={item.category}><small>{item.label}</small><i><b style={{ width: `${item.count / max * 100}%` }} /></i><strong>{item.count}</strong></span>)}</div>
    </div>
  );
}

function PostState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  return <section className={styles.state} role={error ? "alert" : "status"}>{loading ? <><i /><i /><i /><strong>게시글 현황을 불러오는 중입니다.</strong></> : <><Icon name="info" size={28} /><strong>{error}</strong><button type="button" onClick={retry}>다시 불러오기</button></>}</section>;
}

function PostStatus({ post }: { post: AdminCommunityPost }) {
  if (post.deleted_at) return <span className={styles.statusPill} data-status="DELETED">삭제됨</span>;
  if (post.is_notice) return <span className={styles.rolePill} data-role="ADMIN">공지</span>;
  return <span className={styles.statusPill} data-status="ACTIVE">공개</span>;
}

export function AdminCommunityPostsClient() {
  const [data, setData] = useState<AdminCommunityPostsResponse | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [notice, setNotice] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await getAdminCommunityPosts({
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
        q: query,
        category,
        notice,
        include_deleted: includeDeleted,
      }, signal);
      setData(response);
      const lastPage = Math.max(1, Math.ceil(response.total / PAGE_SIZE));
      if (page > lastPage) setPage(lastPage);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "게시글 현황을 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [category, includeDeleted, notice, page, query]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, query]);

  const resetFilters = () => {
    setQuery("");
    setCategory("");
    setNotice("");
    setIncludeDeleted(false);
    setPage(1);
  };

  if (!data && (loading || error)) return <main className={styles.page}><PostState loading={loading} error={error} retry={() => void load()} /></main>;

  return (
    <main className={styles.page}>
      <header className={styles.intro}>
        <div><p>ADMIN · COMMUNITY MANAGEMENT</p><h1>게시글 관리</h1><span>커뮤니티 게시글 흐름과 댓글 규모를 개인정보 노출 없이 확인합니다.</span></div>
        <button type="button" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={16} />새로고침</button>
      </header>

      <section className={styles.kpiGrid} aria-label="커뮤니티 핵심 지표">
        <KpiCard label="전체 게시글" value={data?.summary.total ?? 0} note="삭제 게시글 포함" tone="primary" />
        <KpiCard label="공개 게시글" value={data?.summary.visible ?? 0} note="현재 노출 가능" tone="success" />
        <KpiCard label="오늘 작성" value={data?.summary.new_today ?? 0} note="Asia/Seoul 기준" tone="sky" />
        <KpiCard label="최근 7일 작성" value={data?.summary.new_last_7_days ?? 0} note="오늘 포함 7일" tone="tangerine" />
        <KpiCard label="댓글" value={data?.summary.comments ?? 0} note="삭제 댓글 제외" tone="cobalt" />
      </section>

      <section className={styles.insights} aria-label="게시글 시각 통계">
        <article><h2>카테고리 분포</h2><CategoryBreakdown data={data?.category_breakdown ?? []} /></article>
        <article><h2>운영 상태</h2><div className={styles.ratioBar} aria-label={`공개 ${data?.summary.visible ?? 0}건, 삭제 ${data?.summary.deleted ?? 0}건, 공지 ${data?.summary.notices ?? 0}건`}><ul><li><span data-key="ACTIVE" />공개<b>{data?.summary.visible ?? 0}</b></li><li><span data-key="DELETED" />삭제<b>{data?.summary.deleted ?? 0}</b></li><li><span data-key="ADMIN" />공지<b>{data?.summary.notices ?? 0}</b></li></ul></div></article>
        <article><h2>관리 안내</h2><div className={styles.empty}><Icon name="info" size={25} /><strong>읽기 전용 관리 패널</strong><span>작성자 이메일, 토큰, 비공개 인증 정보는 표시하지 않습니다. 게시글 상세 수정·삭제는 기존 커뮤니티 권한 흐름을 유지합니다.</span></div></article>
      </section>

      <section className={styles.listPanel} aria-labelledby="admin-community-title" aria-busy={loading}>
        <div className={styles.listHead}>
          <div><p>COMMUNITY DIRECTORY</p><h2 id="admin-community-title">게시글 목록</h2><span>게시글 제목, 카테고리, 작성자 닉네임과 댓글 수만 확인합니다.</span></div>
          <strong>필터 결과 {data?.total ?? 0}건</strong>
        </div>
        <div className={styles.filters}>
          <label><span className="sr-only">게시글 검색</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="제목, 내용, 장소, 작성자 검색" /></label>
          <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} aria-label="카테고리 필터">
            <option value="">모든 카테고리</option>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
          <select value={notice} onChange={(event) => { setNotice(event.target.value); setPage(1); }} aria-label="공지 필터">
            <option value="">전체 글</option><option value="true">공지</option><option value="false">일반 글</option>
          </select>
          <label className={styles.checkbox}><input type="checkbox" checked={includeDeleted} onChange={(event) => { setIncludeDeleted(event.target.checked); setPage(1); }} />삭제 글 포함</label>
          <button type="button" onClick={resetFilters}>초기화</button>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.tableWrap}>
          <table className={styles.userTable}>
            <thead><tr><th>ID</th><th>게시글</th><th>카테고리</th><th>상태</th><th>댓글</th><th>장소</th><th>작성 시각</th><th>수정 시각</th></tr></thead>
            <tbody>
              {(data?.posts ?? []).map((post) => (
                <tr key={post.id}>
                  <td>#{post.id}</td>
                  <td><strong>{post.title}</strong><span>{post.author_nickname}</span></td>
                  <td><span className={styles.rolePill} data-role="USER">{categoryLabels[post.category] ?? post.category}</span></td>
                  <td><PostStatus post={post} /></td>
                  <td>{post.comment_count.toLocaleString("ko-KR")}개</td>
                  <td>{post.place_name ?? "장소 없음"}</td>
                  <td>{formatDate(post.created_at)}</td>
                  <td>{formatDate(post.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && data?.posts.length === 0 && <div className={styles.empty}><Icon name="document" size={28} /><strong>조건에 맞는 게시글이 없습니다.</strong><span>검색어 또는 필터를 변경해보세요.</span></div>}
        </div>
        <footer className={styles.pagination}>
          <button type="button" disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))}>이전</button>
          <span><strong>{safePage}</strong> / {totalPages}</span>
          <button type="button" disabled={safePage === totalPages} onClick={() => setPage(Math.min(totalPages, safePage + 1))}>다음</button>
        </footer>
      </section>

      <p className={styles.error}><Link href="/community">공개 커뮤니티 화면 확인하기</Link></p>
    </main>
  );
}
