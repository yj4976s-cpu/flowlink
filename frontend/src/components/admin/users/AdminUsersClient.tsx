"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { getAdminUsers, type AdminUserListItem, type AdminUsersResponse } from "@/lib/adminUsersApi";
import styles from "./AdminUsersClient.module.css";

const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" });
const PAGE_SIZE = 10;

const roleLabels: Record<string, string> = { ADMIN: "관리자", USER: "사용자" };
const statusLabels: Record<string, string> = { ACTIVE: "활성", INACTIVE: "비활성", DELETED: "탈퇴" };

function formatDate(value: string | null) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "기록 없음" : dateTime.format(date);
}

function KpiCard({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return <article className={styles.kpiCard} data-tone={tone}><span>{label}</span><strong>{value.toLocaleString("ko-KR")}</strong><small>{note}</small></article>;
}

function RatioBar({ items, total, kind }: { items: Array<{ key: string; label: string; count: number }>; total: number; kind: "role" | "status" }) {
  const safeTotal = Math.max(1, total);
  return (
    <div className={styles.ratioBar} data-kind={kind} aria-label={items.map((item) => `${item.label} ${item.count}명`).join(", ")}>
      <div>
        {items.map((item) => <i key={item.key} data-key={item.key} style={{ width: `${item.count / safeTotal * 100}%` }} />)}
      </div>
      <ul>
        {items.map((item) => <li key={item.key}><span data-key={item.key} />{item.label}<b>{item.count.toLocaleString("ko-KR")}</b></li>)}
      </ul>
    </div>
  );
}

function SignupTrend({ data }: { data: AdminUsersResponse["signup_trend"] }) {
  const max = Math.max(1, ...data.map((item) => item.count));
  return (
    <div className={styles.trend} aria-label={`최근 7일 가입 추이: ${data.map((item) => `${item.date} ${item.count}명`).join(", ")}`}>
      {data.map((item) => {
        const height = Math.max(8, item.count / max * 72);
        return (
          <span key={item.date}>
            <i style={{ height: `${height}px` }} />
            <b>{item.count}</b>
            <small>{dateOnly.format(new Date(`${item.date}T00:00:00`))}</small>
          </span>
        );
      })}
    </div>
  );
}

function UserStatus({ user }: { user: AdminUserListItem }) {
  const status = user.deleted_at ? "DELETED" : user.active ? "ACTIVE" : "INACTIVE";
  return <span className={styles.statusPill} data-status={status}>{statusLabels[status]}</span>;
}

function UsersState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  return <section className={styles.state} role={error ? "alert" : "status"}>{loading ? <><i /><i /><i /><strong>사용자 현황을 불러오는 중입니다.</strong></> : <><Icon name="info" size={28} /><strong>{error}</strong><button type="button" onClick={retry}>다시 불러오기</button></>}</section>;
}

export function AdminUsersClient() {
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [active, setActive] = useState("");
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
      const response = await getAdminUsers({
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
        q: query,
        role,
        active,
        include_deleted: includeDeleted,
      }, signal);
      setData(response);
      const lastPage = Math.max(1, Math.ceil(response.total / PAGE_SIZE));
      if (page > lastPage) setPage(lastPage);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "사용자 현황을 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [active, includeDeleted, page, query, role]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, query]);

  const roleItems = useMemo(() => [
    { key: "ADMIN", label: "관리자", count: data?.role_breakdown.find((item) => item.role === "ADMIN")?.count ?? 0 },
    { key: "USER", label: "사용자", count: data?.role_breakdown.find((item) => item.role === "USER")?.count ?? 0 },
  ], [data]);
  const statusItems = useMemo(() => ["ACTIVE", "INACTIVE", "DELETED"].map((key) => ({
    key,
    label: statusLabels[key],
    count: data?.status_breakdown.find((item) => item.status === key)?.count ?? 0,
  })), [data]);
  const resetFilters = () => {
    setQuery("");
    setRole("");
    setActive("");
    setIncludeDeleted(false);
    setPage(1);
  };

  if (!data && (loading || error)) return <main className={styles.page}><UsersState loading={loading} error={error} retry={() => void load()} /></main>;

  return (
    <main className={styles.page}>
      <header className={styles.intro}>
        <div><p>ADMIN · USER MANAGEMENT</p><h1>사용자 관리</h1><span>개인정보를 과하게 노출하지 않고 가입·활성 현황을 확인합니다.</span></div>
        <button type="button" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={16} />새로고침</button>
      </header>

      <section className={styles.kpiGrid} aria-label="사용자 핵심 지표">
        <KpiCard label="전체 사용자" value={data?.summary.total ?? 0} note="탈퇴 계정 포함" tone="primary" />
        <KpiCard label="활성 사용자" value={data?.summary.active ?? 0} note="현재 이용 가능" tone="success" />
        <KpiCard label="오늘 신규 가입" value={data?.summary.new_today ?? 0} note="Asia/Seoul 기준" tone="sky" />
        <KpiCard label="최근 7일 가입" value={data?.summary.new_last_7_days ?? 0} note="오늘 포함 7일" tone="tangerine" />
        <KpiCard label="관리자 수" value={data?.summary.admins ?? 0} note="ADMIN 권한" tone="cobalt" />
      </section>

      <section className={styles.insights} aria-label="사용자 시각 통계">
        <article><h2>역할 분포</h2><RatioBar items={roleItems} total={(data?.summary.admins ?? 0) + (data?.summary.users ?? 0)} kind="role" /></article>
        <article><h2>상태 분포</h2><RatioBar items={statusItems} total={data?.summary.total ?? 0} kind="status" /></article>
        <article><h2>최근 7일 가입 추이</h2><SignupTrend data={data?.signup_trend ?? []} /></article>
      </section>

      <section className={styles.listPanel} aria-labelledby="admin-users-title" aria-busy={loading}>
        <div className={styles.listHead}>
          <div><p>READ ONLY DIRECTORY</p><h2 id="admin-users-title">사용자 목록</h2><span>비밀번호 해시, 토큰, 세션 정보는 표시하지 않습니다.</span></div>
          <strong>필터 결과 {data?.total ?? 0}명</strong>
        </div>
        <div className={styles.filters}>
          <label><span className="sr-only">사용자 검색</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="email 또는 nickname 검색" /></label>
          <select value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }} aria-label="역할 필터">
            <option value="">모든 역할</option><option value="USER">사용자</option><option value="ADMIN">관리자</option>
          </select>
          <select value={active} onChange={(event) => { setActive(event.target.value); setPage(1); }} aria-label="활성 상태 필터">
            <option value="">모든 상태</option><option value="true">활성</option><option value="false">비활성</option>
          </select>
          <label className={styles.checkbox}><input type="checkbox" checked={includeDeleted} onChange={(event) => { setIncludeDeleted(event.target.checked); setPage(1); }} />탈퇴 계정 포함</label>
          <button type="button" onClick={resetFilters}>초기화</button>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.tableWrap}>
          <table className={styles.userTable}>
            <thead><tr><th>ID</th><th>계정</th><th>역할</th><th>상태</th><th>가입 시각</th><th>최근 로그인</th><th>탈퇴 여부</th></tr></thead>
            <tbody>
              {(data?.users ?? []).map((user) => (
                <tr key={user.id}>
                  <td>#{user.id}</td>
                  <td><strong>{user.nickname}</strong><span>{user.email}</span></td>
                  <td><span className={styles.rolePill} data-role={user.role}>{roleLabels[user.role] ?? user.role}</span></td>
                  <td><UserStatus user={user} /></td>
                  <td>{formatDate(user.created_at)}</td>
                  <td>{formatDate(user.last_login_at)}</td>
                  <td>{user.deleted_at ? formatDate(user.deleted_at) : "아니오"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && data?.users.length === 0 && <div className={styles.empty}><Icon name="user" size={28} /><strong>조건에 맞는 사용자가 없습니다.</strong><span>검색어 또는 필터를 변경해보세요.</span></div>}
        </div>
        <footer className={styles.pagination}>
          <button type="button" disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))}>이전</button>
          <span><strong>{safePage}</strong> / {totalPages}</span>
          <button type="button" disabled={safePage === totalPages} onClick={() => setPage(Math.min(totalPages, safePage + 1))}>다음</button>
        </footer>
      </section>
    </main>
  );
}
