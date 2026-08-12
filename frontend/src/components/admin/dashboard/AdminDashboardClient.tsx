"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/common/Icon";
import { getAdminDashboard, resolveAdminDashboardImageUrl, type AdminDashboardData } from "@/lib/adminDashboardApi";
import { listAdminOwnershipClaims, type AdminOwnershipClaim } from "@/lib/adminOwnershipClaimsApi";
import styles from "./AdminDashboardClient.module.css";

type Period = "today" | "7d" | "all";

const dateTime = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const timeOnly = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });
const statusLabel: Record<string, string> = {
  DETECTED: "탐지됨", RECOVERED: "회수 확인", AVAILABLE: "보관 중", CLAIM_PENDING: "소유권 확인 중",
  RETURNED: "반환 완료", APPROVED: "승인", REJECTED: "거절", PENDING: "검토 대기",
  CONFIRMED: "검토 완료",
};
const actionLabel: Record<string, string> = {
  OWNERSHIP_CLAIM_CREATED: "소유권 확인 요청",
  OWNERSHIP_CLAIM_REVIEWED: "소유권 요청 검토",
  DETECTED_OBJECT_REVIEWED: "AI 탐지 객체 검토",
  FOUND_ITEM_UPDATED: "공식 발견물 수정",
  CITIZEN_REPORT_REVIEWED: "발견 제보 검토",
  CITIZEN_REPORT_LINKED: "발견 제보 연결",
};
const entityLabel: Record<string, string> = {
  OWNERSHIP_CLAIM: "소유권 요청", DETECTED_OBJECT: "탐지 객체", FOUND_ITEM: "발견물",
  CITIZEN_REPORT: "발견 제보", DETECTION_EVENT: "탐지 이벤트",
};
const periodLabel: Record<Period, string> = { today: "오늘", "7d": "최근 7일", all: "전체" };

function elapsed(value?: string | null) {
  if (!value) return "처리 대기";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}일 대기`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}시간 대기`;
  return `${minutes}분 대기`;
}

function SectionHeading({ title, href, action }: { title: string; href?: string; action?: string }) {
  return <div className={styles.sectionHeading}><h2>{title}</h2>{href && <Link href={href}>{action}<Icon name="arrow" size={14} /></Link>}</div>;
}

function State({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`${styles.state} ${error ? styles.stateError : ""}`} role={error ? "alert" : "status"}>{error && <Icon name="info" size={18} />}<span>{children}</span></div>;
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className={styles.skeleton} role="status" aria-label="운영 정보를 불러오는 중입니다.">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>;
}

function DetectionThumbnail({ imageUrl, label, icon = "scan" }: { imageUrl?: string | null; label: string; icon?: "scan" | "archive" }) {
  const resolved = resolveAdminDashboardImageUrl(imageUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className={styles.thumb}>{resolved && failedUrl !== resolved ? <Image src={resolved} alt={label} width={52} height={52} unoptimized onError={() => setFailedUrl(resolved)} /> : <Icon name={icon} size={20} />}</span>;
}

function PeriodControl({ period, pending, onChange }: { period: Period; pending: boolean; onChange: (period: Period) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return <div className={styles.periodControl} ref={root}><button type="button" aria-haspopup="listbox" aria-expanded={open} disabled={pending} onClick={() => setOpen((value) => !value)}><Icon name="clock" size={15} /><span>{periodLabel[period]}</span><Icon name="chevron" size={14} /></button>{open && <div role="listbox" aria-label="운영 인사이트 조회 기간">{(["today", "7d", "all"] as Period[]).map((value) => <button type="button" role="option" aria-selected={period === value} key={value} onClick={() => { onChange(value); setOpen(false); }}>{periodLabel[value]}</button>)}</div>}</div>;
}

export function AdminDashboardClient() {
  const [current, setCurrent] = useState<AdminDashboardData | null>(null);
  const [insights, setInsights] = useState<AdminDashboardData | null>(null);
  const [claims, setClaims] = useState<AdminOwnershipClaim[]>([]);
  const [period, setPeriod] = useState<Period>("today");
  const [currentError, setCurrentError] = useState(false);
  const [claimsError, setClaimsError] = useState(false);
  const [insightsError, setInsightsError] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      getAdminDashboard("today", controller.signal),
      listAdminOwnershipClaims(controller.signal),
    ]).then(([dashboardResult, claimResult]) => {
      if (controller.signal.aborted) return;
      if (dashboardResult.status === "fulfilled") {
        setCurrent(dashboardResult.value);
        setInsights(dashboardResult.value);
      } else {
        setCurrentError(true);
        setInsightsError(true);
      }
      if (claimResult.status === "fulfilled") setClaims(claimResult.value);
      else setClaimsError(true);
    });
    return () => controller.abort();
  }, []);

  const changePeriod = async (next: Period) => {
    if (next === period) return;
    setPeriod(next);
    setInsightsLoading(true);
    setInsightsError(false);
    try { setInsights(await getAdminDashboard(next)); }
    catch { setInsightsError(true); }
    finally { setInsightsLoading(false); }
  };

  const pendingClaims = useMemo(() => claims.filter((claim) => claim.status === "PENDING"), [claims]);
  const returnClaims = useMemo(() => claims.filter((claim) => claim.status === "APPROVED"), [claims]);
  const citizenPending = current?.metrics.citizen_pending ?? 0;
  const waiting = pendingClaims.length + returnClaims.length + citizenPending;
  const priorities = [
    ...pendingClaims.slice(0, 3).map((claim) => ({
      key: `claim-${claim.id}`, tone: "attention", label: "소유권 검토 대기", title: `${claim.found_item.color ?? ""} ${claim.found_item.item_category_name}`.trim(),
      detail: claim.found_item.area_name, meta: elapsed(claim.created_at), href: "/admin/ownership-claims", action: "검토하기",
    })),
    ...returnClaims.slice(0, 2).map((claim) => ({
      key: `return-${claim.id}`, tone: "return", label: "반환 처리 대기", title: claim.found_item.public_description || claim.found_item.item_category_name,
      detail: "소유권 승인 완료", meta: elapsed(claim.updated_at), href: "/admin/ownership-claims", action: "처리하기",
    })),
    ...(citizenPending ? [{ key: "citizen", tone: "citizen", label: "발견 제보 검토", title: `${citizenPending}건의 제보가 검토를 기다리고 있습니다.`, detail: "발견 제보 관리", meta: "현재 대기", href: "/admin/citizen-reports", action: "검토하기" }] : []),
  ].slice(0, 6);

  return <main className={styles.page}>
    <header className={styles.intro}><p>ADMIN CONTROL</p><h1>관리자 대시보드</h1><span>발견부터 검토·매칭·반환까지 현재 운영 흐름을 확인합니다.</span>{waiting > 0 && <b><i />확인 필요 업무 {waiting}건</b>}</header>

    <section className={styles.kpi} aria-label="현재 운영 요약">
      <div data-tone="primary"><span>발견</span><strong>{currentError ? "–" : current?.metrics.discovered ?? 0}</strong><small>오늘 기준</small></div>
      <div data-tone="secondary"><span>발견물 등록</span><strong>{currentError ? "–" : current?.metrics.official_found_items ?? 0}</strong><small>오늘 기준</small></div>
      <div data-tone="match"><span>자동 매칭</span><strong>{currentError ? "–" : current?.metrics.matched ?? 0}</strong><small>오늘 기준</small></div>
      <div data-tone="attention"><span>검토 대기</span><strong>{claimsError ? "–" : pendingClaims.length}</strong><small>조회된 소유권 요청</small></div>
      <div data-tone="claim"><span>소유권 요청</span><strong>{currentError ? "–" : current?.metrics.claims ?? 0}</strong><small>오늘 기준</small></div>
      <div data-tone="success"><span>반환 완료</span><strong>{currentError ? "–" : current?.metrics.returned ?? 0}</strong><small>오늘 기준</small></div>
    </section>

    <div className={styles.primaryGrid}>
      <section className={styles.priorityPanel} aria-labelledby="priority-title"><SectionHeading title="지금 확인할 업무" />
        {claimsError && currentError ? <State error>현재 업무 목록을 불러오지 못했습니다.</State> : priorities.length ? <div className={styles.priorityList}>{priorities.map((item) => <div className={styles.priority} data-tone={item.tone} key={item.key}><i /><div><span>{item.label}</span><strong>{item.title}</strong><small>{item.detail} · {item.meta}</small></div><Link href={item.href}>{item.action}<Icon name="arrow" size={14} /></Link></div>)}</div> : <State>현재 확인이 필요한 업무가 없습니다.<br />새로운 요청이나 처리 항목이 발생하면 이곳에 표시됩니다.</State>}
      </section>

      <section className={styles.recentPanel} aria-labelledby="recent-title"><SectionHeading title="최근 발견" href="/admin/found-items" action="발견물 관리" />
        {!current ? currentError ? <State error>최근 발견물을 불러오지 못했습니다.</State> : <Skeleton /> : current.recent_items.length ? <div className={styles.recentList}>{current.recent_items.slice(0, 4).map((item) => <Link href="/admin/found-items" key={item.id}><DetectionThumbnail imageUrl={item.image_url} label={`${item.item_category_name} 발견물 이미지`} icon="archive" /><div><strong>{item.public_description || `${item.color ?? ""} ${item.item_category_name}`}</strong><span>{dateTime.format(new Date(item.found_at))} · {item.area_name}</span></div><b>{statusLabel[item.status] ?? item.status}</b></Link>)}</div> : <State>최근 등록된 발견물이 없습니다.</State>}
      </section>
    </div>

    <section className={styles.flowSection} aria-labelledby="flow-title"><SectionHeading title="서비스 흐름 검증" />
      {!current ? currentError ? <State error>운영 흐름을 불러오지 못했습니다.</State> : <Skeleton rows={1} /> : <><OperationalFlow metrics={current.metrics} /><LatestFlow flow={current.latest_flow} /></>}
    </section>

    <section className={styles.activitySection} aria-labelledby="activity-title"><SectionHeading title="서비스 활동" />
      {!current ? currentError ? <State error>서비스 활동을 불러오지 못했습니다.</State> : <Skeleton /> : current.recent_activity.length ? <div className={styles.activityList}>{current.recent_activity.map((item) => <div key={`${item.kind}-${item.entity_id}-${item.occurred_at}`}><time>{dateTime.format(new Date(item.occurred_at))}</time><strong>{item.kind === "LOGIN" ? `최근 로그인 · ${item.label}` : item.label}</strong><span>#{item.entity_id}</span></div>)}</div> : <State>최근 확인 가능한 서비스 활동이 없습니다.</State>}
    </section>

    <section className={styles.insights} aria-labelledby="insights-title">
      <div className={styles.insightsHead}><div><h2 id="insights-title">운영 인사이트</h2><p>선택한 기간에 발생한 발견·매칭·반환과 처리 분포를 확인합니다.</p></div><PeriodControl period={period} pending={insightsLoading} onChange={(value) => void changePeriod(value)} /></div>
      {insightsError ? <State error>선택한 기간의 운영 데이터를 불러오지 못했습니다.</State> : insightsLoading || !insights ? <Skeleton rows={4} /> : <div className={styles.analyticsGrid}>
        <section className={`${styles.analyticsPanel} ${styles.trendPanel}`}><h3>운영 추이</h3><LineChart data={insights.trend} /></section>
        <section className={`${styles.analyticsPanel} ${styles.claimPanel}`}><h3>소유권 확인 상태</h3><ClaimSummary data={insights.claim_status_counts} /></section>
        <section className={`${styles.analyticsPanel} ${styles.detectionPanel}`}><h3>AI 탐지 상태</h3><CategorySummary data={insights.category_counts} average={insights.average_confidence} /></section>
        <section className={`${styles.analyticsPanel} ${styles.recentDetectionPanel}`}><div className={styles.analyticsTitle}><h3>최근 AI 탐지</h3><Link href="/admin/detections">전체 검토<Icon name="arrow" size={13} /></Link></div>
          {insights.recent_detections.length ? <div className={styles.aiList}>{insights.recent_detections.slice(0, 4).map((item) => <Link href={`/admin/detections?detection=${item.detection_event_id}`} key={item.id}><DetectionThumbnail imageUrl={item.image_url} label={`${item.item_category_name} 탐지 이미지`} /><div><strong>{item.item_category_name}</strong><span>{Math.round(item.confidence * 100)}% · {dateTime.format(new Date(item.detected_at))}</span></div><b>{statusLabel[item.processing_status] ?? item.processing_status}</b><Icon name="arrow" size={14} /></Link>)}</div> : <State>선택한 기간의 AI 탐지 기록이 없습니다.</State>}
        </section>
      </div>}
    </section>

    <section className={styles.citizenSection} aria-labelledby="citizen-summary-title"><SectionHeading title="발견 제보 현황" href="/admin/citizen-reports" action="제보 관리" />
      {!current ? currentError ? <State error>발견 제보 현황을 불러오지 못했습니다.</State> : <Skeleton rows={1} /> : <CitizenSummary metrics={current.metrics} />}
    </section>

    <section className={styles.history} aria-labelledby="history-title"><SectionHeading title="최근 운영 기록" />
      {!current ? <Skeleton /> : current.recent_history.length ? <div>{current.recent_history.map((record) => <div key={record.id}><time>{timeOnly.format(new Date(record.created_at))}</time><span><strong>{actionLabel[record.action_type] ?? record.action_type}</strong><small>{entityLabel[record.entity_type] ?? record.entity_type} #{record.entity_id}</small></span><b>{record.new_status ? statusLabel[record.new_status] ?? record.new_status : "처리 기록"}</b></div>)}</div> : <State>아직 기록된 운영 활동이 없습니다.</State>}
    </section>
  </main>;
}

function OperationalFlow({ metrics }: { metrics: AdminDashboardData["metrics"] }) {
  const steps = [
    { label: "AI 탐지", value: metrics.ai_detections, tone: "primary" },
    { label: "발견물 등록", value: metrics.official_found_items, tone: "secondary" },
    { label: "분실 신고", value: metrics.lost_reports, tone: "primary" },
    { label: "자동 매칭", value: metrics.matched, tone: "match" },
    { label: "MATCH_FOUND 알림", value: metrics.match_notifications, tone: "match" },
    { label: "소유권 확인", value: metrics.claims, tone: "attention" },
    { label: "반환 완료", value: metrics.returned, tone: "success" },
  ];
  return <ol className={styles.flow}>{steps.map((step) => <li key={step.label} data-tone={step.tone}><i /><span>{step.label}</span><strong>{step.value}</strong></li>)}</ol>;
}

function LatestFlow({ flow }: { flow: AdminDashboardData["latest_flow"] }) {
  if (!flow) return <div className={styles.flowEmpty}>아직 자동 매칭까지 연결된 흐름이 없습니다. 탐지 검토와 공식 발견물 등록 상태를 확인해 주세요.</div>;
  const steps = [
    ["Detection", flow.detection_id], ["Detected Object", flow.detected_object_id], ["Found Item", flow.found_item_id],
    ["Lost Report", flow.lost_report_id], ["Match", flow.match_candidate_id], ["Notification", flow.notification_id],
    ["Claim", flow.ownership_claim_id], ["Return", flow.returned ? "완료" : null],
  ] as const;
  return <div className={styles.latestFlow}><small>최근 End-to-End 연결</small><div>{steps.map(([label, value]) => <span key={label} data-complete={value != null}><b>{label}</b><em>{value == null ? "대기" : typeof value === "number" ? `#${value}` : value}</em></span>)}</div></div>;
}

function LineChart({ data }: { data: AdminDashboardData["trend"] }) {
  const keys = ["discovered", "matched", "returned"] as const;
  const labels = { discovered: "발견", matched: "자동 매칭", returned: "반환 완료" };
  const max = Math.max(1, ...data.flatMap((point) => keys.map((key) => point[key])));
  if (!data.length || !data.some((point) => keys.some((key) => point[key]))) return <State>선택한 기간에 집계된 운영 데이터가 없습니다.</State>;
  const x = (index: number) => data.length === 1 ? 50 : index / (data.length - 1) * 100;
  const y = (value: number) => 92 - value / max * 78;
  return <div className={styles.lineChart}><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="발견, 자동 매칭, 반환 완료 운영 추이">{keys.map((key) => <g key={key}><polyline data-line={key} points={data.map((point, index) => `${x(index)},${y(point[key])}`).join(" ")} />{data.map((point, index) => <circle key={`${point.label}-${key}`} cx={x(index)} cy={y(point[key])} r="1.4"><title>{point.label} · {labels[key]} {point[key]}건</title></circle>)}</g>)}</svg><div className={styles.axis}>{data.map((point) => <span key={point.label}>{point.label}</span>)}</div><div className={styles.legend}><span data-tone="primary"><i />발견</span><span data-tone="attention"><i />자동 매칭</span><span data-tone="success"><i />반환 완료</span></div></div>;
}

function ClaimSummary({ data }: { data: AdminDashboardData["claim_status_counts"] }) {
  const ordered = ["PENDING", "APPROVED", "REJECTED", "RETURNED"].map((status) => ({ status, count: data.find((item) => item.status === status)?.count ?? 0 }));
  const total = ordered.reduce((sum, item) => sum + item.count, 0);
  if (!total) return <div className={styles.quietEmpty}>해당 기간에 소유권 요청이 없습니다.</div>;
  let offset = 0;
  const stops = ordered.map((item, index) => { const start = offset; offset += item.count / total * 100; return `var(--claim-${index}) ${start}% ${offset}%`; }).join(", ");
  return <div className={styles.claimSummary}><div className={styles.donut} style={{ background: `conic-gradient(${stops})` } as CSSProperties}><span><small>소유권 요청</small><strong>{total}</strong></span></div><div>{ordered.map((item, index) => <span key={item.status}><i data-tone={index} />{statusLabel[item.status]}<b>{item.count}</b></span>)}</div></div>;
}

function CitizenSummary({ metrics }: { metrics: AdminDashboardData["metrics"] }) {
  return <div className={styles.citizenStats}><span>오늘 접수 <b>{metrics.citizen_reports}</b><small>발견 제보</small></span><span>검토 대기 <b>{metrics.citizen_pending}</b><small>현재 처리 필요</small></span><span>오늘 발견물 등록 <b>{metrics.citizen_linked}</b><small>공식 발견물 연결</small></span><span>오늘 추가 목격 <b>{metrics.citizen_sightings}</b><small>제보 보완 정보</small></span></div>;
}

function CategorySummary({ data, average }: { data: AdminDashboardData["category_counts"]; average: number | null }) {
  if (!data.length) return <div className={styles.quietEmpty}>해당 기간에 AI 탐지 데이터가 없습니다.</div>;
  const max = Math.max(1, ...data.map((item) => item.count));
  return <div className={styles.categorySummary}><div>{data.slice(0, 4).map((item) => <span key={item.code}><small>{item.name}</small><i><b style={{ width: `${item.count / max * 100}%` }} /></i><strong>{item.count}</strong></span>)}</div>{average != null && <p>평균 confidence {Math.round(average * 100)}%</p>}</div>;
}
