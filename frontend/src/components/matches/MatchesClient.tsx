"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Icon } from "@/components/common/Icon";
import { useDaru } from "@/components/mascot";
import type { IconName } from "@/components/common/Icon";
import { OwnershipClaimForm } from "@/components/ownership-claims/OwnershipClaimForm";
import { listMyLostReports } from "@/lib/lostReportsApi";
import type { LostReportResponse } from "@/lib/lostReportsApi";
import { MatchesApiError, listMyMatches, listMyMatchesForReport, resolveMatchImageUrl } from "@/lib/matchesApi";
import type { MatchCandidate } from "@/lib/matchesApi";
import { getItemTypeMeta } from "@/lib/itemTypeMeta";
import styles from "./MatchesClient.module.css";

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
const matchStatusLabels: Record<string, string> = { SUGGESTED: "후보 생성", NOTIFIED: "새 후보", VIEWED: "확인함", DISMISSED: "제외됨", CLAIMED: "확인 요청됨" };
const publicFoundItemDetailStatuses = new Set(["AVAILABLE", "RECOVERED"]);
const claimableLostReportStatuses = new Set(["OPEN", "MATCHED"]);
const scoreParts = [
  { key: "type_score", label: "물품 종류", max: 40 },
  { key: "area_score", label: "발견 구역", max: 25 },
  { key: "time_score", label: "시간 범위", max: 20 },
  { key: "keyword_score", label: "색상·특징", max: 15 },
] as const;

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "일시 확인 중" : dateTimeFormatter.format(date);
}

function categoryIcon(code: string): IconName {
  return getItemTypeMeta(code).icon;
}

function scoreBarStyle(score: number, max: number): CSSProperties {
  return { width: `${Math.min(Math.max(score / max, 0), 1) * 100}%` };
}

function scoreLabel(score: number) {
  if (score >= 85) return "일치 가능성 높음";
  if (score >= 65) return "확인 권장";
  if (score >= 40) return "일부 조건 일치";
  return "낮은 일치 가능성";
}

function CandidateVisual({ match }: { match: MatchCandidate }) {
  const imageUrl = resolveMatchImageUrl(match.found_item.image_url);
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.candidateVisual}>
      {imageUrl && !failed ? (
        // Existing storage URLs can be external and are not constrained to Next Image host patterns.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={`${match.found_item.item_category_name} 발견물`} onError={() => setFailed(true)} />
      ) : (
        <Icon name={categoryIcon(match.found_item.item_category)} size={52} />
      )}
      <span>공개 발견물</span>
    </div>
  );
}

function LostReportVisual({ report }: { report: LostReportResponse }) {
  const imageUrl = resolveMatchImageUrl(report.image_url);
  const [failed, setFailed] = useState(false);
  return <span className={styles.objectIcon}>{imageUrl && !failed
    ? <>
      {/* Upload URLs may be external and are not constrained to Next Image host patterns. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={`${report.item_category_name} 분실 신고 이미지`} onError={() => setFailed(true)} />
    </>
    : <Icon name={categoryIcon(report.item_category)} size={27} />}</span>;
}

function MatchState({ icon, title, description, action, error = false }: { icon: IconName; title: string; description: string; action?: ReactNode; error?: boolean }) {
  return (
    <div className={`${styles.state} ${error ? styles.errorState : ""}`} role={error ? "alert" : "status"}>
      <span className={styles.stateIcon}><Icon name={icon} size={30} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

function CriteriaPopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.criteria} ref={rootRef}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="match-criteria-popover">
        <Icon name="info" size={18} /> 어떤 기준으로 매칭하나요?
      </button>
      {open && (
        <div className={styles.popover} id="match-criteria-popover" role="dialog" aria-label="매칭 기준">
          <strong>매칭 기준</strong>
          <dl>{scoreParts.map((part) => <div key={part.key}><dt>{part.label}</dt><dd>{part.max}점</dd></div>)}</dl>
          <div className={styles.popoverTotal}><span>합계</span><b>100점</b></div>
          <p>매칭 결과는 참고 정보이며, 동일한 물품이나 소유자를 확정하는 결과가 아닙니다.</p>
        </div>
      )}
    </div>
  );
}

function ReportSelect({ reports, selected, onSelect }: { reports: LostReportResponse[]; selected: LostReportResponse; onSelect: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, reports.findIndex((report) => report.id === selected.id)));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const choose = (index: number) => { onSelect(reports[index].id); setActive(index); setOpen(false); };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault(); setOpen(true);
      setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? reports.length - 1 : event.key === "ArrowDown" ? (current + 1) % reports.length : (current - 1 + reports.length) % reports.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); if (open) choose(active); else setOpen(true);
    } else if (event.key === "Escape") { setOpen(false); }
  };
  return <label className={styles.reportSelect}>비교할 분실 신고<div className={styles.reportSelectControl} ref={root}><button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setActive(Math.max(0, reports.findIndex((report) => report.id === selected.id))); setOpen((value) => !value); }} onKeyDown={onKeyDown}>{selected.item_category_name} · {selected.area_name}<Icon name="chevron" size={15} /></button>{open && <div role="listbox" aria-label="비교할 분실 신고">{reports.map((report, index) => <button type="button" role="option" aria-selected={report.id === selected.id} data-active={active === index} key={report.id} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>{report.item_category_name} · {report.area_name}</button>)}</div>}</div></label>;
}

function ReportWorkspace({ reports, selectedId, onSelect, count }: { reports: LostReportResponse[]; selectedId: number | null; onSelect: (id: number) => void; count: number }) {
  const selected = reports.find((report) => report.id === selectedId) ?? reports[0];
  if (!selected) return null;
  return (
    <section className={styles.workspace} aria-labelledby="workspace-title">
      <div className={styles.workspaceHeading}>
        <div><p className={styles.eyebrow}>CURRENT REPORT</p><h2 id="workspace-title">비교 중인 신고</h2></div>
        <span className={styles.countBadge}>후보 {count}건</span>
      </div>
      {reports.length > 1 && (
        <ReportSelect reports={reports} selected={selected} onSelect={onSelect} />
      )}
      <div className={styles.reportSummary}>
        <LostReportVisual report={selected} />
        <div><strong>{selected.item_category_name}</strong><span>{selected.color || "색상 미상"} · {selected.area_name} · {formatDateTime(selected.lost_from)}</span></div>
        <Link className={styles.reportLink} href={`/mypage?reportId=${selected.id}`}><Icon name="fileSearch" size={19} /> 신고 내용 확인</Link>
      </div>
    </section>
  );
}

function MatchCard({ match, isClaimFormOpen, onOpenClaimForm, onCloseClaimForm, onClaimSubmitted, onClaimBlocked, onMatchesRefresh, hasSubmittedClaim, isClaimBlocked }: {
  match: MatchCandidate; isClaimFormOpen: boolean; onOpenClaimForm: () => void; onCloseClaimForm: () => void; onClaimSubmitted: () => void; onClaimBlocked: () => void; onMatchesRefresh: () => void; hasSubmittedClaim: boolean; isClaimBlocked: boolean;
}) {
  const canView = publicFoundItemDetailStatuses.has(match.found_item.status);
  const canClaim = match.found_item.status === "AVAILABLE" && claimableLostReportStatuses.has(match.lost_report.status) && !hasSubmittedClaim && !isClaimBlocked;
  return (
    <article className={styles.matchCard} aria-labelledby={`match-${match.id}`}>
      <CandidateVisual match={match} />
      <div className={styles.candidateBody}>
        <div className={styles.candidateTitle}>
          <div><span className={styles.statusBadge}>{matchStatusLabels[match.status] ?? match.status}</span><h3 id={`match-${match.id}`}>{match.found_item.item_category_name}</h3><p>{match.found_item.public_description || "공개된 특징 정보가 없습니다."}</p></div>
          <div className={styles.score}><strong>{match.total_score}점</strong><span>{scoreLabel(match.total_score)}</span></div>
        </div>
        <div className={styles.facts}>
          <span><Icon name="location" size={17} />{match.found_item.area_name}</span>
          <span><Icon name="clock" size={17} />{formatDateTime(match.found_item.found_at)}</span>
        </div>
        <div className={styles.comparison}>
          <span className={match.type_score > 0 ? styles.isMatched : ""}>종류 {match.type_score}/{40}</span>
          <span className={match.area_score > 0 ? styles.isMatched : ""}>위치 {match.area_score}/{25}</span>
          <span className={match.time_score > 0 ? styles.isMatched : ""}>시간 {match.time_score}/{20}</span>
          <span className={match.keyword_score > 0 ? styles.isMatched : ""}>특징 {match.keyword_score}/{15}</span>
        </div>
        <div className={styles.scoreBars} aria-label="매칭 점수 세부 항목">
          {scoreParts.map((part) => <div key={part.key}><span>{part.label}</span><i><b style={scoreBarStyle(match[part.key], part.max)} /></i></div>)}
        </div>
        <div className={styles.cardActions}>
          {canView ? <Link className="button button-secondary" href={`/found-items/${match.found_item.id}`}><Icon name="fileSearch" size={18} /> 발견물 상세 확인</Link> : <span className={styles.unavailable}>공개 상세 조회가 종료된 발견물입니다.</span>}
          {canClaim && <button className="button button-primary" type="button" onClick={onOpenClaimForm} aria-expanded={isClaimFormOpen}>내 물건 같아요</button>}
          {!canClaim && (hasSubmittedClaim || match.found_item.status === "CLAIM_PENDING") && <span className={styles.unavailable}>소유권 확인 진행 중</span>}
        </div>
        {isClaimFormOpen && (canClaim || hasSubmittedClaim) && <OwnershipClaimForm foundItemId={match.found_item.id} lostReportId={match.lost_report.id} foundItemLabel={match.found_item.public_description || match.found_item.item_category_name} onCancel={onCloseClaimForm} onSubmitted={onClaimSubmitted} onClaimUnavailable={onClaimBlocked} onRequestRefresh={onMatchesRefresh} />}
      </div>
    </article>
  );
}

export function MatchesClient() {
  const { cue: cueDaru } = useDaru();
  const router = useRouter();
  const searchParams = useSearchParams();
  const reportIdParam = searchParams.get("reportId");
  const requestedReportId = reportIdParam && /^\d+$/.test(reportIdParam) ? Number(reportIdParam) : null;
  const matchIdParam = searchParams.get("matchId");
  const requestedMatchId = matchIdParam && /^\d+$/.test(matchIdParam) ? Number(matchIdParam) : null;
  const [matches, setMatches] = useState<MatchCandidate[]>([]);
  const [reports, setReports] = useState<LostReportResponse[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [activeClaimMatchId, setActiveClaimMatchId] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState<Set<number>>(() => new Set());
  const [blocked, setBlocked] = useState<Set<number>>(() => new Set());
  const requestGeneration = useRef(0);
  const matchRequest = useRef<AbortController | null>(null);
  const cuedReports = useRef(new Set<number>());

  const updateReportUrl = useCallback((reportId: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("reportId", String(reportId));
    router.replace(`/matches?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      const reportData = await listMyLostReports(signal);
      setReports(reportData);
      let selected = Number.isSafeInteger(requestedReportId) && reportData.some((report) => report.id === requestedReportId)
        ? requestedReportId
        : null;
      if (!selected && Number.isSafeInteger(requestedMatchId)) {
        const legacyMatches = await listMyMatches(signal);
        selected = legacyMatches.find((match) => match.id === requestedMatchId)?.lost_report.id ?? null;
      }
      selected ??= reportData[0]?.id ?? null;
      setSelectedReportId(selected);
      if (selected && selected !== requestedReportId) updateReportUrl(selected);
      if (!selected && !signal?.aborted) setLoading(false);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setErrorStatus(caught instanceof MatchesApiError ? (caught.status ?? null) : null);
      setError(caught instanceof MatchesApiError ? caught.message : "잠시 후 다시 시도해 주세요.");
      setLoading(false);
    }
  }, [requestedMatchId, requestedReportId, updateReportUrl]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = window.setTimeout(() => void loadData(controller.signal), 0);
    return () => { window.clearTimeout(requestId); controller.abort(); };
  }, [loadData]);
  const loadMatches = useCallback(async (reportId: number) => {
    matchRequest.current?.abort();
    const controller = new AbortController();
    matchRequest.current = controller;
    const generation = ++requestGeneration.current;
    setMatches([]);
    setActiveClaimMatchId(null);
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    try {
      const matchData = await listMyMatchesForReport(reportId, controller.signal);
      if (generation !== requestGeneration.current) return;
      setMatches(matchData);
      if (matchData.length && !cuedReports.current.has(reportId)) {
        cuedReports.current.add(reportId);
        cueDaru("match", { source: "service" });
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (generation !== requestGeneration.current) return;
      setErrorStatus(caught instanceof MatchesApiError ? (caught.status ?? null) : null);
      setError(caught instanceof MatchesApiError ? caught.message : "매칭 후보를 불러오지 못했습니다.");
    } finally {
      if (generation === requestGeneration.current && !controller.signal.aborted) setLoading(false);
    }
  }, [cueDaru]);

  useEffect(() => {
    const requestId = window.setTimeout(() => {
      if (selectedReportId) void loadMatches(selectedReportId);
    }, 0);
    return () => {
      window.clearTimeout(requestId);
      matchRequest.current?.abort();
    };
  }, [loadMatches, selectedReportId]);

  const selectReport = useCallback((reportId: number) => {
    setSelectedReportId(reportId);
    updateReportUrl(reportId);
  }, [updateReportUrl]);
  const refresh = useCallback(() => {
    if (selectedReportId) void loadMatches(selectedReportId);
  }, [loadMatches, selectedReportId]);

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>MATCH CANDIDATES</p>
        <h1>내 신고와 일치 가능성이 높은 발견물</h1>
        <p>발견 위치·시간·물품 특징을 비교해 내 신고와 조건이 가까운 발견물을 보여드립니다.</p>
      </header>

      {!error && reports.length > 0 && <ReportWorkspace reports={reports} selectedId={selectedReportId} onSelect={selectReport} count={matches.length} />}

      <section className={styles.results} aria-labelledby="matches-list-title" aria-busy={loading}>
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>MY MATCHES</p><h2 id="matches-list-title">내 매칭 후보</h2></div>
          {!loading && !error && <span>{matches.length}건</span>}
        </div>
        <CriteriaPopover />

        {loading && <div className={styles.skeleton} aria-label="매칭 후보를 불러오는 중"><i /><i /><i /></div>}
        {!loading && error && <MatchState icon="search" title={errorStatus === 401 ? "로그인이 필요해요" : "매칭 정보를 불러오지 못했어요"} description={error} error action={<div className={styles.stateActions}>{errorStatus === 401 ? <Link className="button button-primary" href="/login">로그인하러 가기</Link> : <button className="button button-secondary" type="button" onClick={() => { setLoading(true); setError(null); refresh(); }}>다시 불러오기</button>}</div>} />}
        {!loading && !error && reports.length === 0 && <MatchState icon="fileSearch" title="아직 비교할 신고가 없어요" description="분실 신고를 등록하면 발견된 물품과 자동으로 비교해 드립니다." action={<div className={styles.stateActions}><Link className="button button-primary" href="/lost-reports/new">분실 신고하기</Link><Link className="button button-secondary" href="/found-items">발견물 센터 둘러보기</Link></div>} />}
        {!loading && !error && reports.length > 0 && matches.length === 0 && <MatchState icon="scan" title="신고가 접수됐어요. 아직 비슷한 발견물이 없어요" description="새로운 발견물이 등록되면 선택한 신고와 자동으로 다시 비교해 알려드릴게요." action={<div className={styles.stateActions}><Link className="button button-primary" href="/found-items">발견물 센터 둘러보기</Link>{selectedReportId && <Link className={styles.inlineAction} href={`/mypage?reportId=${selectedReportId}`}><Icon name="fileSearch" size={18} /> 신고 내용 확인</Link>}</div>} />}
        {!loading && !error && matches.length > 0 && <div className={styles.matchList}>{matches.map((match) => <MatchCard key={match.id} match={match} isClaimFormOpen={activeClaimMatchId === match.id} onOpenClaimForm={() => setActiveClaimMatchId(match.id)} onCloseClaimForm={() => setActiveClaimMatchId(null)} onClaimSubmitted={() => { setSubmitted((current) => new Set(current).add(match.id)); refresh(); }} onClaimBlocked={() => { setBlocked((current) => new Set(current).add(match.id)); refresh(); }} onMatchesRefresh={refresh} hasSubmittedClaim={submitted.has(match.id)} isClaimBlocked={blocked.has(match.id)} />)}</div>}
      </section>
    </main>
  );
}
