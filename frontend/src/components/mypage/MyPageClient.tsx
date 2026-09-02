"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/common/Icon";
import { AuthApiError, AuthUser, changePassword, deleteAccount, getCurrentUser, updateNickname } from "@/lib/authApi";
import { getPasswordConditions, isValidNewPassword, PASSWORD_CONDITION_LABELS, PASSWORD_POLICY_MESSAGE, type PasswordConditions as PasswordConditionState } from "@/lib/passwordPolicy";
import { listMyLostReports, LostReportResponse } from "@/lib/lostReportsApi";
import { getMyDetectionSummary, type DetectionAnalysisSummary } from "@/lib/detectionApi";
import { listMyProgressMatches, MatchCandidate, resolveMatchImageUrl } from "@/lib/matchesApi";
import { listNotifications, NotificationResponse } from "@/lib/notificationsApi";
import { CitizenReportsApiError, deleteCitizenReport, listMyCitizenReports } from "@/lib/citizenReportsApi";
import { listMyOwnershipClaimActivity, listMyOwnershipClaimProgress, type OwnershipClaimResponse } from "@/lib/ownershipClaimsApi";
import type { CitizenReport } from "@/types/discoveryNetwork";
import { getItemTypeMeta } from "@/lib/itemTypeMeta";
import { deriveLostReportProgress, LostReportProgress, type LostReportProgressModel } from "./LostReportProgress";
import styles from "./MyPageClient.module.css";

type LoadState = { user: AuthUser; reports: LostReportResponse[]; matches: MatchCandidate[]; progressClaims: OwnershipClaimResponse[]; claimActivity: OwnershipClaimResponse[]; notifications: NotificationResponse[]; citizenReports: CitizenReport[]; analysisSummary: DetectionAnalysisSummary | null };
type ActivityTab = "reports" | "matches" | "claims" | "citizen";
type ActivitySort = "newest" | "oldest";
type FlowNav = "overview" | ActivityTab;
type ReportFilter = "all" | "active" | "returned";
type ReportSort = "newest" | "oldest";
type LostReportCardModel = {
  report: LostReportResponse;
  candidateCount: number;
  progress: LostReportProgressModel;
  imageUrl: string | null;
  imageSource: "report" | "match" | null;
};

const REPORTS_PER_PAGE = 5;
const ACTIVITY_ITEMS_PER_PAGE = 5;
const activityTabs: Array<{ key: ActivityTab; label: string }> = [
  { key: "reports", label: "분실 신고" },
  { key: "matches", label: "매칭 결과" },
  { key: "claims", label: "소유권 확인 요청" },
  { key: "citizen", label: "발견 제보" },
];
const reportFilters: Array<{ value: ReportFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "active", label: "진행 중" },
  { value: "returned", label: "반환 완료" },
];

function isActivityTab(value: string | null): value is ActivityTab {
  return activityTabs.some((tab) => tab.key === value);
}

function readPositivePage(value: string | null) {
  return value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : 1;
}

function sortByActivityDate<T>(items: T[], getDate: (item: T) => string, sort: ActivitySort) {
  return [...items].sort((left, right) => {
    const difference = new Date(getDate(left)).getTime() - new Date(getDate(right)).getTime();
    return sort === "newest" ? -difference : difference;
  });
}

const reportSortOptions: Array<{ value: ReportSort; label: string }> = [
  { value: "newest", label: "최신순" },
  { value: "oldest", label: "오래된순" },
];

function SortDropdown({ value, label, className, onChange }: { value: ReportSort; label: string; className?: string; onChange: (value: ReportSort) => void }) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, reportSortOptions.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("pointerdown", closeOutside); window.removeEventListener("keydown", closeOnEscape); };
  }, [open]);

  const choose = (index: number) => {
    onChange(reportSortOptions[index].value);
    setActiveIndex(index);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => event.key === "Home" ? 0 : event.key === "End" ? reportSortOptions.length - 1 : event.key === "ArrowDown" ? (current + 1) % reportSortOptions.length : (current - 1 + reportSortOptions.length) % reportSortOptions.length);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) { event.preventDefault(); choose(activeIndex); }
  };

  return <div className={`${styles.reportSort}${className ? ` ${className}` : ""}`} ref={rootRef}>
    <button ref={triggerRef} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} onClick={() => { setActiveIndex(selectedIndex); setOpen((current) => !current); }} onKeyDown={handleKeyDown}>
      <span>{reportSortOptions[selectedIndex].label}</span><Icon name="chevron" size={16} />
    </button>
    {open && <div className={styles.reportSortMenu} id={listboxId} role="listbox" aria-label={`${label} 옵션`}>
      {reportSortOptions.map((option, index) => <button type="button" role="option" aria-selected={option.value === value} data-active={activeIndex === index} id={`${listboxId}-option-${index}`} key={option.value} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(index)}>{option.label}</button>)}
    </div>}
  </div>;
}

const reportStatus: Record<string, string> = { OPEN: "진행 중", MATCHED: "매칭 확인 중", CLAIM_PENDING: "소유권 확인 중", RESOLVED: "반환 완료", CANCELLED: "취소" };
const claimStatus: Record<string, string> = { PENDING: "관리자 확인 중", APPROVED: "반환 준비", REJECTED: "요청 미승인", RETURNED: "반환 완료" };
const claimPriority: Record<string, number> = { REJECTED: 0, PENDING: 1, APPROVED: 2, RETURNED: 3 };

function selectRepresentativeClaim(claims: OwnershipClaimResponse[]) {
  return [...claims].sort((left, right) => {
    const priority = (claimPriority[right.status] ?? -1) - (claimPriority[left.status] ?? -1);
    if (priority) return priority;
    const created = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    return created || right.id - left.id;
  })[0] ?? null;
}

function buildLostReportCardModels(reports: LostReportResponse[], matches: MatchCandidate[], claims: OwnershipClaimResponse[]): LostReportCardModel[] {
  const matchesByReport = new Map<number, MatchCandidate[]>();
  const claimsByReport = new Map<number, OwnershipClaimResponse[]>();
  matches.forEach((match) => matchesByReport.set(match.lost_report.id, [...(matchesByReport.get(match.lost_report.id) ?? []), match]));
  claims.forEach((claim) => {
    if (claim.lost_report_id === null) return;
    claimsByReport.set(claim.lost_report_id, [...(claimsByReport.get(claim.lost_report_id) ?? []), claim]);
  });
  return reports.map((report) => {
    const reportMatches = matchesByReport.get(report.id) ?? [];
    const reportImage = resolveMatchImageUrl(report.image_url);
    const matchImage = reportMatches.map((match) => resolveMatchImageUrl(match.found_item.image_url)).find(Boolean) ?? null;
    const candidateCount = reportMatches.filter((match) => match.status !== "CLAIMED").length;
    const representativeClaim = selectRepresentativeClaim(claimsByReport.get(report.id) ?? []);
    return {
      report,
      candidateCount,
      progress: deriveLostReportProgress({ activeCandidateCount: candidateCount, representativeClaimStatus: representativeClaim?.status ?? null }),
      imageUrl: reportImage ?? matchImage,
      imageSource: reportImage ? "report" : matchImage ? "match" : null,
    };
  });
}

function LostReportCard({ model, selected }: { model: LostReportCardModel; selected: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const { report, progress } = model;
  const title = `${report.item_category_name} · ${report.color || "색상 정보 없음"}`;
  const hasCandidates = model.candidateCount > 0;
  const showCandidateAction = progress.step === 2;
  return <article id={`lost-report-card-${report.id}`} className={`${styles.reportCard}${selected ? ` ${styles.selectedReportCard}` : ""}`} aria-current={selected ? "true" : undefined}>
    <div className={styles.reportCardVisual}>
      {model.imageUrl && !imageFailed
        ? <>
          {/* Existing upload/storage URLs can be external. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={model.imageUrl} alt={`${title} 대표 이미지`} onError={() => setImageFailed(true)} />
        </>
        : <Icon name={getItemTypeMeta(report.item_category, report.item_category_name).icon} size={38} />}
      {model.imageSource === "match" && !imageFailed && <span>매칭 발견물 이미지</span>}
    </div>
    <div className={styles.reportCardBody}>
      <div className={styles.reportCardHeading}><div>{selected && <span className={styles.selectedLabel}>선택한 신고</span>}<h3>{title}</h3></div><span>{reportStatus[report.status] ?? report.status}</span></div>
      <dl className={styles.reportCardDetails}><div><dt>분실 일시</dt><dd>{new Date(report.lost_from).toLocaleString("ko-KR")}</dd></div><div><dt>분실 장소</dt><dd>{report.area_name || "장소 정보 없음"}</dd></div></dl>
      <div className={styles.reportCardSummary}><span>현재 확인 가능한 매칭 후보 <strong>{model.candidateCount}개</strong></span></div>
      <LostReportProgress progress={progress} />
      <div className={styles.reportCardActions}>
        {showCandidateAction && <Link className={`button button-primary ${styles.candidateButton}`} href={`/matches?reportId=${report.id}`}>{progress.exception?.type === "REJECTED" ? "다른 후보 보기" : "매칭 후보 보기"}</Link>}
        {progress.step === 3 && hasCandidates && <Link href={`/matches?reportId=${report.id}`}>매칭 후보 확인</Link>}
      </div>
    </div>
  </article>;
}

const passwordConditionKeys = Object.keys(PASSWORD_CONDITION_LABELS) as (keyof PasswordConditionState)[];

function PasswordInput({ name, label, value, onChange, children }: { name: string; label: string; value?: string; onChange?: (value: string) => void; children?: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  return <div className={styles.passwordField}><label htmlFor={`mypage-password-${name}`}>{label}</label><span className={styles.inputWithIcon}><input id={`mypage-password-${name}`} name={name} type={visible ? "text" : "password"} autoComplete={name === "current" ? "current-password" : "new-password"} required value={value} onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined} /><button type="button" aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setVisible((nextVisible) => !nextVisible)}><Icon name={visible ? "eyeOff" : "eye"} size={18} /></button></span>{children}</div>;
}

function PasswordPolicyGuide({ password, invalid }: { password: string; invalid: boolean }) {
  const conditions = getPasswordConditions(password);
  const metCount = passwordConditionKeys.filter((key) => conditions[key]).length;
  return <div className={`${styles.passwordGuide}${invalid ? ` ${styles.invalidPasswordGuide}` : ""}`} aria-label="새 비밀번호 조건 충족 상태"><div><span>비밀번호 조건</span><b>{metCount} / 5</b></div><ul>{passwordConditionKeys.map((key) => <li key={key} className={conditions[key] ? styles.metCondition : invalid ? styles.unmetCondition : undefined}><span aria-hidden="true">{conditions[key] ? "✓" : "○"}</span>{PASSWORD_CONDITION_LABELS[key]}<span className="sr-only"> {conditions[key] ? "충족" : "미충족"}</span></li>)}</ul></div>;
}

function ActivityVisual({ icon, imageUrl, label }: { icon: IconName; imageUrl?: string | null; label: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className={styles.activityVisual}>{imageUrl && failedUrl !== imageUrl ? <img src={imageUrl} alt={`${label} 제보 이미지`} onError={() => setFailedUrl(imageUrl)} /> : <Icon name={icon} size={21} />}</span>;
}

function ActivityRow({ icon, imageUrl, title, meta, status, detail, href, tone = "primary" }: { icon: IconName; imageUrl?: string | null; title: string; meta: string; status: string; detail: string; href: string; tone?: "primary" | "accent" | "support" | "secondary" }) {
  return <Link className={`${styles.activityRow} ${styles[`activity_${tone}`]}`} href={href}><ActivityVisual icon={icon} imageUrl={imageUrl} label={title} /><div><strong>{title}</strong><span>{meta}</span></div><div className={styles.activityMeta}><b>{status}</b><span>{detail}</span></div><Icon name="arrow" size={17} /></Link>;
}

function CitizenReportActivityRow({ deleting, onDelete, report }: { deleting: boolean; onDelete: (report: CitizenReport) => void; report: CitizenReport }) {
  const canDelete = report.statusCode === "PENDING" || report.statusCode === "UNDER_REVIEW";
  return <article className={`${styles.citizenActivityRow} ${styles.activity_secondary}`}>
    <Link className={styles.citizenActivityLink} href="/found-items#citizen"><ActivityVisual icon="location" imageUrl={report.imageUrl} label={report.title} /><div><strong>{report.title}</strong><span>{new Date(report.foundAt).toLocaleDateString("ko-KR")} · {report.areaName}</span></div><div className={styles.activityMeta}><b>{report.status}</b><span>추가 목격 {Math.max(0, report.history.length - 1)}건</span></div><Icon name="arrow" size={17} /></Link>
    {canDelete && <button type="button" className={styles.citizenDeleteButton} disabled={deleting} onClick={() => onDelete(report)}>{deleting ? "삭제 중..." : "제보 삭제"}</button>}
  </article>;
}

function ActivityEmpty({ text, href, action }: { text: string; href?: string; action?: string }) {
  return <div className={styles.empty}>{text}{href && action && <Link href={href}>{action}</Link>}</div>;
}

export function MyPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reportIdParam = searchParams.get("reportId");
  const requestedReportId = reportIdParam && /^\d+$/.test(reportIdParam) ? Number(reportIdParam) : null;
  const [claimSubmitted] = useState(() => searchParams.get("submitted") === "claim");
  const [data, setData] = useState<LoadState | null>(null);
  const [error, setError] = useState("");
  const [editingNickname, setEditingNickname] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSubmitted, setPasswordSubmitted] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [failedSections, setFailedSections] = useState<string[]>([]);
  const initialActivityTab = isActivityTab(searchParams.get("activity")) ? searchParams.get("activity") as ActivityTab : "reports";
  const initialActivitySort: ActivitySort = searchParams.get("activitySort") === "oldest" ? "oldest" : "newest";
  const [activityTab, setActivityTab] = useState<ActivityTab>(initialActivityTab);
  const [activityPages, setActivityPages] = useState<Record<ActivityTab, number>>(() => ({ reports: 1, matches: 1, claims: 1, citizen: 1, [initialActivityTab]: readPositivePage(searchParams.get("activityPage")) }));
  const [activitySorts, setActivitySorts] = useState<Record<ActivityTab, ActivitySort>>(() => ({ reports: "newest", matches: "newest", claims: "newest", citizen: "newest", [initialActivityTab]: initialActivitySort }));
  const [flowNav, setFlowNav] = useState<FlowNav>("overview");

  const closePasswordDialog = useCallback(() => {
    setPasswordOpen(false); setPasswordError(""); setNextPassword(""); setConfirmPassword(""); setPasswordSubmitted(false);
  }, []);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const [reportFilter, setReportFilter] = useState<ReportFilter>("all");
  const [reportSort, setReportSort] = useState<ReportSort>("newest");
  const [reportPage, setReportPage] = useState(1);
  const [deletingCitizenReportId, setDeletingCitizenReportId] = useState<string | null>(null);
  const [citizenDeleteMessage, setCitizenDeleteMessage] = useState("");
  const [citizenDeleteError, setCitizenDeleteError] = useState("");
  const flowMenuRef = useRef<HTMLDivElement>(null);
  const lastScrolledReportId = useRef<number | null>(null);

  useEffect(() => {
    if (searchParams.get("submitted") !== "claim") return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("submitted");
    router.replace(`/mypage${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    getCurrentUser().then(async (user) => {
      const [reportsResult, notificationsResult, citizenResult, analysisSummaryResult] = await Promise.allSettled([
        listMyLostReports(controller.signal), listNotifications("all", controller.signal), listMyCitizenReports(controller.signal), getMyDetectionSummary(30, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const visibleReportIds = reportsResult.status === "fulfilled" ? reportsResult.value.map((report) => report.id) : [];
      let matchesResult: PromiseSettledResult<MatchCandidate[]> = { status: "fulfilled", value: [] };
      let progressClaimsResult: PromiseSettledResult<OwnershipClaimResponse[]> = { status: "fulfilled", value: [] };
      let claimActivityResult: PromiseSettledResult<OwnershipClaimResponse[]> = { status: "fulfilled", value: [] };
      if (visibleReportIds.length) {
        [matchesResult, progressClaimsResult, claimActivityResult] = await Promise.allSettled([
          listMyProgressMatches(visibleReportIds, controller.signal),
          listMyOwnershipClaimProgress(visibleReportIds, controller.signal),
          listMyOwnershipClaimActivity(visibleReportIds, controller.signal),
        ]);
      }
      if (controller.signal.aborted) return;
      const failed: string[] = [];
      if (reportsResult.status === "rejected") failed.push("reports");
      if (matchesResult.status === "rejected") failed.push("matches");
      if (progressClaimsResult.status === "rejected") failed.push("claimProgress");
      if (claimActivityResult.status === "rejected") failed.push("claimActivity");
      if (notificationsResult.status === "rejected") failed.push("notifications");
      if (citizenResult.status === "rejected") failed.push("citizen");
      if (analysisSummaryResult.status === "rejected") failed.push("analysisSummary");
      const loadedReports = reportsResult.status === "fulfilled" ? reportsResult.value : [];
      if (requestedReportId !== null) {
        const requestedIndex = [...loadedReports]
          .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime() || right.id - left.id)
          .findIndex((report) => report.id === requestedReportId);
        if (requestedIndex >= 0) setReportPage(Math.floor(requestedIndex / REPORTS_PER_PAGE) + 1);
      }
      setFailedSections(failed);
      setData({
        user,
        reports: loadedReports,
        matches: matchesResult.status === "fulfilled" ? matchesResult.value : [],
        progressClaims: progressClaimsResult.status === "fulfilled" ? progressClaimsResult.value : [],
        claimActivity: claimActivityResult.status === "fulfilled" ? claimActivityResult.value : [],
        notifications: notificationsResult.status === "fulfilled" ? notificationsResult.value : [],
        citizenReports: citizenResult.status === "fulfilled" ? citizenResult.value : [],
        analysisSummary: analysisSummaryResult.status === "fulfilled" ? analysisSummaryResult.value : null,
      });
    }).catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof AuthApiError && reason.status === 401) router.replace("/login");
        else setError("마이페이지 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      });
    return () => controller.abort();
  }, [requestedReportId, router]);

  useEffect(() => {
    if (!accountOpen && !passwordOpen && !deleteOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setAccountOpen(false); if (passwordOpen) closePasswordDialog(); setDeleteOpen(false); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [accountOpen, closePasswordDialog, deleteOpen, passwordOpen]);

  useEffect(() => {
    if (!flowMenuOpen) return;
    const outside = (event: PointerEvent) => { if (!flowMenuRef.current?.contains(event.target as Node)) setFlowMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFlowMenuOpen(false); };
    window.addEventListener("pointerdown", outside); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [flowMenuOpen]);

  const activity = useMemo(() => data ? [
    { label: "등록한 신고", value: data.reports.length, href: "#my-activity", description: data.reports.length ? "신고 내역 확인" : "등록된 신고 없음", icon: "document" as const, tone: "primary" },
    { label: "매칭 결과", value: data.matches.length, href: "/matches", description: data.matches.length ? "유사 후보 확인" : "확인할 후보 없음", icon: "match" as const, tone: "accent" },
    { label: "소유권 확인 요청", value: data.claimActivity.length, href: "#my-activity", description: "요청 진행 상태", icon: "check" as const, tone: "support" },
    { label: "내 발견 제보", value: data.citizenReports.length, href: "/found-items#citizen", description: data.citizenReports.length ? "등록한 제보 확인" : "등록된 제보 없음", icon: "location" as const, tone: "secondary" },
    { label: "AI 분석 요약", value: data.analysisSummary?.total_analyses ?? 0, href: "/mypage/analysis-report", description: data.analysisSummary ? `최근 30일 · 객체 ${data.analysisSummary.total_detected_objects}개` : "차트 보고서 보기", icon: "scan" as const, tone: "primary" },
  ] : [], [data]);
  const reportCards = useMemo(() => data ? buildLostReportCardModels(data.reports, data.matches, data.progressClaims) : [], [data]);
  const filteredReportCards = useMemo(() => {
    const filtered = reportCards.filter((model) => {
      const returned = model.report.status === "RESOLVED";
      if (reportFilter === "returned") return returned;
      if (reportFilter === "active") return !returned;
      return true;
    });
    return filtered.sort((left, right) => {
      const dateDifference = new Date(left.report.created_at).getTime() - new Date(right.report.created_at).getTime();
      const stableDifference = dateDifference || left.report.id - right.report.id;
      return reportSort === "newest" ? -stableDifference : stableDifference;
    });
  }, [reportCards, reportFilter, reportSort]);
  const reportPageCount = Math.ceil(filteredReportCards.length / REPORTS_PER_PAGE);
  const effectiveReportPage = reportPageCount ? Math.min(reportPage, reportPageCount) : 1;
  const paginatedReportCards = useMemo(() => {
    const start = (effectiveReportPage - 1) * REPORTS_PER_PAGE;
    return filteredReportCards.slice(start, start + REPORTS_PER_PAGE);
  }, [effectiveReportPage, filteredReportCards]);
  const sortedActivityReports = useMemo(() => sortByActivityDate(data?.reports ?? [], (report) => report.created_at, activitySorts.reports), [activitySorts.reports, data?.reports]);
  const sortedActivityMatches = useMemo(() => sortByActivityDate(data?.matches ?? [], (match) => match.created_at, activitySorts.matches), [activitySorts.matches, data?.matches]);
  const sortedActivityClaims = useMemo(() => sortByActivityDate(data?.claimActivity ?? [], (claim) => claim.created_at, activitySorts.claims), [activitySorts.claims, data?.claimActivity]);
  const sortedCitizenReports = useMemo(() => sortByActivityDate(data?.citizenReports ?? [], (report) => report.foundAt, activitySorts.citizen), [activitySorts.citizen, data?.citizenReports]);
  const activityCounts: Record<ActivityTab, number> = {
    reports: sortedActivityReports.length,
    matches: sortedActivityMatches.length,
    claims: sortedActivityClaims.length,
    citizen: sortedCitizenReports.length,
  };
  const activityPageCount = Math.ceil(activityCounts[activityTab] / ACTIVITY_ITEMS_PER_PAGE);
  const effectiveActivityPage = activityPageCount ? Math.min(activityPages[activityTab], activityPageCount) : 1;
  const activitySliceStart = (effectiveActivityPage - 1) * ACTIVITY_ITEMS_PER_PAGE;
  const visibleActivityReports = sortedActivityReports.slice(activitySliceStart, activitySliceStart + ACTIVITY_ITEMS_PER_PAGE);
  const visibleActivityMatches = sortedActivityMatches.slice(activitySliceStart, activitySliceStart + ACTIVITY_ITEMS_PER_PAGE);
  const visibleActivityClaims = sortedActivityClaims.slice(activitySliceStart, activitySliceStart + ACTIVITY_ITEMS_PER_PAGE);
  const visibleCitizenReports = sortedCitizenReports.slice(activitySliceStart, activitySliceStart + ACTIVITY_ITEMS_PER_PAGE);

  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("activity", activityTab);
    params.set("activityPage", String(effectiveActivityPage));
    params.set("activitySort", activitySorts[activityTab]);
    const nextQuery = params.toString();
    if (nextQuery === searchParams.toString()) return;
    router.replace(`/mypage?${nextQuery}`, { scroll: false });
  }, [activitySorts, activityTab, data, effectiveActivityPage, router, searchParams]);

  useEffect(() => {
    if (!Number.isSafeInteger(requestedReportId) || lastScrolledReportId.current === requestedReportId) return;
    if (!filteredReportCards.some((card) => card.report.id === requestedReportId)) return;
    const target = document.getElementById(`lost-report-card-${requestedReportId}`);
    if (!target) return;
    lastScrolledReportId.current = requestedReportId;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  }, [effectiveReportPage, filteredReportCards, requestedReportId]);

  if (error) return <main className={styles.page}><section className={styles.errorPanel}><p>{error}</p><button className="button button-secondary" onClick={() => location.reload()}>다시 시도</button></section></main>;
  if (!data) return <main className={styles.page} aria-busy="true"><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></main>;

  const selectedReportId = Number.isSafeInteger(requestedReportId) && data.reports.some((report) => report.id === requestedReportId) ? requestedReportId : null;
  const flowItems: Array<{ key: FlowNav; label: string }> = [{ key: "overview", label: "개요" }, { key: "reports", label: "내 신고" }, { key: "matches", label: "매칭 결과" }, { key: "claims", label: "소유권 확인" }, { key: "citizen", label: "내 발견 제보" }];
  const selectFlow = (key: FlowNav) => {
    setFlowNav(key); setFlowMenuOpen(false);
    if (key === "overview") { document.getElementById("mypage-overview")?.scrollIntoView({ behavior: "smooth" }); return; }
    if (key === "matches") { router.push("/matches"); return; }
    if (key === "citizen") { router.push("/found-items#citizen"); return; }
    setActivityTab(key); document.getElementById("my-activity")?.scrollIntoView({ behavior: "smooth" });
  };

  const saveNickname = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nickname = String(new FormData(event.currentTarget).get("nickname") ?? "").trim();
    if (nickname.length < 2) return;
    const user = await updateNickname(nickname);
    setData((value) => value ? { ...value, user } : value);
    setEditingNickname(false);
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const current = String(form.get("current") ?? "");
    setPasswordSubmitted(true);
    if (!current) return setPasswordError("현재 비밀번호를 입력해주세요.");
    if (!isValidNewPassword(nextPassword)) return setPasswordError(PASSWORD_POLICY_MESSAGE);
    if (nextPassword !== confirmPassword) return setPasswordError("새 비밀번호 확인이 일치하지 않습니다.");
    try { await changePassword(current, nextPassword); closePasswordDialog(); }
    catch (reason) { setPasswordError(reason instanceof AuthApiError ? reason.message : "비밀번호를 변경하지 못했습니다."); }
  };

  const removeAccount = async () => { await deleteAccount(); router.replace("/"); router.refresh(); };
  const removeCitizenReport = async (report: CitizenReport) => {
    const confirmed = window.confirm("내 발견 제보를 삭제할까요?\n\n첨부한 사진과 제보 내용이 사용자·관리자 목록에서 사라집니다.\n이미 공식 발견물로 연결된 제보는 삭제할 수 없습니다.");
    if (!confirmed) return;
    setDeletingCitizenReportId(report.id);
    setCitizenDeleteMessage("");
    setCitizenDeleteError("");
    try {
      await deleteCitizenReport(report.id);
      setData((value) => value ? { ...value, citizenReports: value.citizenReports.filter((item) => item.id !== report.id) } : value);
      setCitizenDeleteMessage("발견 제보를 삭제했습니다.");
    } catch (reason) {
      if (reason instanceof CitizenReportsApiError && reason.status === 409) setCitizenDeleteError("이미 처리되었거나 공식 발견물로 연결되어 삭제할 수 없습니다.");
      else setCitizenDeleteError(reason instanceof Error ? reason.message : "발견 제보를 삭제하지 못했습니다.");
    } finally {
      setDeletingCitizenReportId(null);
    }
  };

  return <main className={styles.page} id="mypage-overview">
    <header className={styles.heading}><p>MY FLOW</p><h1>내 진행 상황</h1><span>내 신고와 발견물 연결 현황을 한눈에 확인하세요.</span></header>

    {claimSubmitted && <div className={styles.successNotice} role="status"><Icon name="check" size={20} /><div><strong>소유권 확인 요청이 접수됐어요.</strong><span>관리자가 확인하면 진행 상태가 업데이트돼요.</span></div></div>}

    <nav className={styles.flowNav} aria-label="MY FLOW 개인 영역"><span>MY FLOW</span><div className={styles.desktopFlowNav}>{flowItems.map((item, index) => <button type="button" key={item.key} aria-current={flowNav === item.key ? "page" : undefined} onClick={() => selectFlow(item.key)}><span>{item.label}</span><i style={{ "--flow-index": index } as React.CSSProperties} /></button>)}</div><div className={styles.mobileFlowNav} ref={flowMenuRef}><button type="button" aria-haspopup="menu" aria-expanded={flowMenuOpen} onClick={() => setFlowMenuOpen((value) => !value)}><span>{flowItems.find((item) => item.key === flowNav)?.label}</span><Icon name="chevron" size={17} /></button>{flowMenuOpen && <div role="menu">{flowItems.map((item) => <button type="button" role="menuitem" aria-current={flowNav === item.key ? "page" : undefined} key={item.key} onClick={() => selectFlow(item.key)}>{item.label}</button>)}</div>}</div></nav>

    <section className={`${styles.profile} ${styles.reveal}`}>
      <span className={styles.avatar}><Icon name="user" size={30} /></span>
      <div><strong>{data.user.nickname}님</strong><span>{data.user.email}</span><small>일반 사용자</small></div>
      <button className="button button-secondary" onClick={() => setAccountOpen(true)}>내 정보 관리</button>
    </section>

    <section className={`${styles.activityGrid} ${styles.reveal}`} aria-label="내 활동 요약">
      {activity.map((item) => <Link key={item.label} href={item.href} className={`${styles.activityCard} ${styles[`tone_${item.tone}`]}`} onClick={() => { if (item.label === "등록한 신고") { setActivityTab("reports"); setFlowNav("reports"); } else if (item.label === "소유권 확인 요청") { setActivityTab("claims"); setFlowNav("claims"); } }}><span><Icon name={item.icon} size={22} /></span><div><small>{item.label}</small><strong>{item.value}</strong><em>{item.description}</em></div></Link>)}
    </section>

    <section id="recent-flow" className={`${styles.section} ${styles.reveal}`}><div className={styles.sectionTitle}><div><p>MY LOST REPORTS</p><h2>신고별 진행 상황</h2></div></div>
      {failedSections.some((section) => section === "reports" || section === "matches" || section === "claimProgress") ? <div className={styles.empty}>신고별 진행 상황을 불러오지 못했습니다.<button onClick={() => location.reload()}>다시 시도</button></div> : reportCards.length ? <>
        <div className={styles.reportListControls}>
          <div className={styles.reportFilters} role="group" aria-label="신고 진행 상태 필터">
            {reportFilters.map((filter) => <button type="button" key={filter.value} aria-pressed={reportFilter === filter.value} onClick={() => { setReportFilter(filter.value); setReportPage(1); }}>{filter.label}</button>)}
          </div>
          <SortDropdown value={reportSort} label="신고 정렬" onChange={(nextSort) => { if (nextSort !== reportSort) { setReportSort(nextSort); setReportPage(1); } }} />
        </div>
        {paginatedReportCards.length ? <>
          <div className={styles.reportCardList}>{paginatedReportCards.map((model) => <LostReportCard key={model.report.id} model={model} selected={model.report.id === selectedReportId} />)}</div>
          <nav className={styles.reportPagination} aria-label="신고별 진행 상황 페이지">
            <button type="button" aria-label="이전 페이지" disabled={effectiveReportPage === 1} onClick={() => setReportPage(Math.max(1, effectiveReportPage - 1))}>‹</button>
            <span><strong>{String(effectiveReportPage).padStart(2, "0")}</strong><i>/</i>{String(reportPageCount).padStart(2, "0")}</span>
            <button type="button" aria-label="다음 페이지" disabled={effectiveReportPage === reportPageCount} onClick={() => setReportPage(Math.min(reportPageCount, effectiveReportPage + 1))}>›</button>
          </nav>
        </> : <div className={styles.empty}>{reportFilter === "active" ? "진행 중인 신고가 없습니다." : "반환 완료된 신고가 없습니다."}</div>}
      </> : <div className={styles.empty}>아직 등록한 분실 신고가 없어요. 물건을 잃어버렸다면 먼저 신고해 주세요.<Link href="/lost-reports/new">분실 신고하기</Link></div>}
    </section>

    <section className={`${styles.section} ${styles.reveal}`}><div className={styles.sectionTitle}><div><p>NOTIFICATIONS</p><h2>최근 알림</h2></div><Link href="/notifications">전체보기 <Icon name="arrow" size={16} /></Link></div>
      {failedSections.includes("notifications") ? <div className={styles.empty}>알림을 불러오지 못했습니다.<button onClick={() => location.reload()}>다시 시도</button></div> : data.notifications.length ? <div className={styles.notificationList}>{data.notifications.slice(0, 3).map((notification) => <Link href="/notifications" key={notification.id}><i className={!notification.read_at ? styles.unread : ""} /><div><strong>{notification.title}</strong><span>{notification.message}</span></div><time>{new Date(notification.created_at).toLocaleDateString("ko-KR")}</time></Link>)}</div> : <div className={styles.empty}>새로운 알림이 없습니다.</div>}
    </section>

    <section id="my-activity" className={`${styles.section} ${styles.reveal}`}><div className={styles.sectionTitle}><div><p>MY ACTIVITY</p><h2>내 활동</h2></div></div>
      <div className={styles.activityToolbar}>
        <div className={styles.activityTabs} role="tablist" aria-label="내 활동 종류">
          {activityTabs.map(({ key, label }) => <button className={styles[`tab_${key}`]} key={key} role="tab" aria-selected={activityTab === key} aria-controls="activity-panel" onClick={() => { setActivityTab(key); setFlowNav(key); }}>{label}<small>{activityCounts[key]}</small></button>)}
        </div>
        <SortDropdown className={styles.activitySort} value={activitySorts[activityTab]} label="내 활동 정렬" onChange={(nextSort) => { if (nextSort !== activitySorts[activityTab]) { setActivitySorts((sorts) => ({ ...sorts, [activityTab]: nextSort })); setActivityPages((pages) => ({ ...pages, [activityTab]: 1 })); } }} />
      </div>
      <div id="activity-panel" className={styles.activityList} role="tabpanel">
        {activityTab === "reports" && (failedSections.includes("reports") ? <ActivityEmpty text="분실 신고 내역을 불러오지 못했습니다." /> : sortedActivityReports.length ? visibleActivityReports.map((report) => <ActivityRow key={report.id} icon={getItemTypeMeta(report.item_category, report.item_category_name).icon} imageUrl={report.image_url} title={`${report.color ? `${report.color} ` : ""}${report.item_category_name}`} meta={`${new Date(report.lost_from).toLocaleDateString("ko-KR")} · ${report.area_name}`} status={reportStatus[report.status] ?? report.status} detail={`유사 발견물 ${data.matches.filter((match) => match.lost_report.id === report.id).length}건`} href={`/matches?reportId=${report.id}`} />) : <ActivityEmpty text="아직 등록한 분실 신고가 없습니다." href="/lost-reports/new" action="분실 신고 시작하기" />)}
        {activityTab === "matches" && (failedSections.includes("matches") ? <ActivityEmpty text="매칭 결과를 불러오지 못했습니다." /> : sortedActivityMatches.length ? visibleActivityMatches.map((match) => <ActivityRow key={match.id} icon="match" title={match.found_item.public_description || match.found_item.item_category_name} meta={`${new Date(match.found_item.found_at).toLocaleDateString("ko-KR")} · ${match.found_item.area_name}`} status={`${match.total_score}% 유사`} detail="AI 탐지" href="/matches" tone="accent" />) : <ActivityEmpty text="아직 비슷한 발견물을 찾지 못했어요." />)}
        {activityTab === "claims" && (failedSections.includes("claimActivity") ? <ActivityEmpty text="소유권 확인 요청을 불러오지 못했습니다." /> : sortedActivityClaims.length ? visibleActivityClaims.map((claim) => {
          const match = data.matches.find((candidate) => candidate.found_item.id === claim.found_item_id && candidate.lost_report.id === claim.lost_report_id);
          return <ActivityRow key={claim.id} icon="check" title={match?.found_item.public_description || match?.found_item.item_category_name || `발견물 #${claim.found_item_id}`} meta={`요청일 ${new Date(claim.created_at).toLocaleDateString("ko-KR")}`} status={claimStatus[claim.status] ?? claim.status} detail="관리자 확인 절차가 진행됩니다." href={claim.lost_report_id === null ? "/matches" : `/matches?reportId=${claim.lost_report_id}`} tone="support" />;
        }) : <ActivityEmpty text="소유권 확인 요청 내역이 없습니다." />)}
        {activityTab === "citizen" && <>
          {citizenDeleteMessage && <p className={styles.activityStatusMessage} role="status">{citizenDeleteMessage}</p>}
          {citizenDeleteError && <p className={styles.activityErrorMessage} role="alert">{citizenDeleteError}</p>}
          {failedSections.includes("citizen") ? <ActivityEmpty text="발견 제보를 불러오지 못했습니다." /> : sortedCitizenReports.length ? visibleCitizenReports.map((report) => <CitizenReportActivityRow key={report.id} report={report} deleting={deletingCitizenReportId === report.id} onDelete={removeCitizenReport} />) : <ActivityEmpty text="아직 작성한 발견 제보가 없습니다." href="/found-items#citizen" action="발견물 센터에서 물품 제보하기" />}
        </>}
      </div>
      {activityPageCount > 1 && <nav className={styles.activityPagination} aria-label={`${activityTabs.find((tab) => tab.key === activityTab)?.label} 페이지`}>
        <button type="button" aria-label="이전 페이지" disabled={effectiveActivityPage === 1} onClick={() => setActivityPages((pages) => ({ ...pages, [activityTab]: Math.max(1, effectiveActivityPage - 1) }))}>‹</button>
        <span><strong>{String(effectiveActivityPage).padStart(2, "0")}</strong><i>/</i>{String(activityPageCount).padStart(2, "0")}</span>
        <button type="button" aria-label="다음 페이지" disabled={effectiveActivityPage === activityPageCount} onClick={() => setActivityPages((pages) => ({ ...pages, [activityTab]: Math.min(activityPageCount, effectiveActivityPage + 1) }))}>›</button>
      </nav>}
    </section>

    {accountOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAccountOpen(false)}><section className={`${styles.modal} ${styles.accountModal}`} role="dialog" aria-modal="true" aria-labelledby="account-title"><button className={styles.modalClose} onClick={() => setAccountOpen(false)} aria-label="계정 정보 닫기"><Icon name="close" size={20} /></button><p className={styles.modalEyebrow}>ACCOUNT</p><h2 id="account-title">계정 정보</h2>
      <div className={styles.accountRow}><span>닉네임</span>{editingNickname ? <form onSubmit={saveNickname}><input name="nickname" defaultValue={data.user.nickname} minLength={2} maxLength={50} autoFocus /><button>저장</button><button type="button" onClick={() => setEditingNickname(false)}>취소</button></form> : <><strong>{data.user.nickname}</strong><button onClick={() => setEditingNickname(true)}>수정</button></>}</div>
      <div className={styles.accountRow}><span>이메일</span><strong>{data.user.email}</strong></div>
      <div className={styles.accountRow}><span>비밀번호</span><strong>••••••••</strong><button onClick={() => { setAccountOpen(false); setPasswordOpen(true); }}>변경</button></div>
      <div className={styles.danger}><div><strong>회원 탈퇴</strong><span>계정을 삭제하면 다시 복구할 수 없습니다.</span></div><button onClick={() => { setAccountOpen(false); setDeleteOpen(true); }}>회원 탈퇴</button></div>
    </section></div>}

    {passwordOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closePasswordDialog()}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="password-title"><button className={styles.modalClose} onClick={closePasswordDialog} aria-label="비밀번호 변경 닫기"><Icon name="close" size={20} /></button><h2 id="password-title">비밀번호 변경</h2><form noValidate onSubmit={submitPassword}><PasswordInput name="current" label="현재 비밀번호" /><PasswordInput name="next" label="새 비밀번호" value={nextPassword} onChange={(value) => { setNextPassword(value); setPasswordError(""); }}><PasswordPolicyGuide password={nextPassword} invalid={passwordSubmitted && !isValidNewPassword(nextPassword)} /></PasswordInput><PasswordInput name="confirm" label="새 비밀번호 확인" value={confirmPassword} onChange={(value) => { setConfirmPassword(value); setPasswordError(""); }}>{confirmPassword && <span className={confirmPassword === nextPassword ? styles.passwordMatch : styles.passwordMismatch} aria-live="polite">{confirmPassword === nextPassword ? "✓ 비밀번호와 일치해요" : "! 비밀번호가 일치하지 않아요"}</span>}</PasswordInput>{passwordError && <p className={styles.formError}>{passwordError}</p>}<div className={styles.modalActions}><button type="button" className="button button-secondary" onClick={closePasswordDialog}>취소</button><button className="button button-primary">비밀번호 변경</button></div></form></section></div>}
    {deleteOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeleteOpen(false)}><section className={styles.modal} role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">정말 탈퇴하시겠어요?</h2><p>계정과 서비스 이용 권한이 비활성화되며 되돌릴 수 없습니다.</p><div className={styles.modalActions}><button className="button button-secondary" onClick={() => setDeleteOpen(false)}>취소</button><button className={styles.deleteButton} onClick={removeAccount}>탈퇴하기</button></div></section></div>}
  </main>;
}
