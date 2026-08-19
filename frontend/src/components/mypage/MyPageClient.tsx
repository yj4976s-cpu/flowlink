"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/common/Icon";
import { AuthApiError, AuthUser, changePassword, deleteAccount, getCurrentUser, updateNickname } from "@/lib/authApi";
import { listMyLostReports, LostReportResponse } from "@/lib/lostReportsApi";
import { listMyProgressMatches, MatchCandidate, resolveMatchImageUrl } from "@/lib/matchesApi";
import { listNotifications, NotificationResponse } from "@/lib/notificationsApi";
import { listMyCitizenReports } from "@/lib/citizenReportsApi";
import { listMyOwnershipClaimProgress, type OwnershipClaimResponse } from "@/lib/ownershipClaimsApi";
import type { CitizenReport } from "@/types/discoveryNetwork";
import { getItemTypeMeta } from "@/lib/itemTypeMeta";
import { deriveLostReportProgress, LostReportProgress, type LostReportProgressModel } from "./LostReportProgress";
import styles from "./MyPageClient.module.css";

type LoadState = { user: AuthUser; reports: LostReportResponse[]; matches: MatchCandidate[]; ownershipClaims: OwnershipClaimResponse[]; notifications: NotificationResponse[]; citizenReports: CitizenReport[] };
type ActivityTab = "reports" | "matches" | "claims" | "citizen";
type FlowNav = "overview" | ActivityTab;
type LostReportCardModel = {
  report: LostReportResponse;
  candidateCount: number;
  progress: LostReportProgressModel;
  imageUrl: string | null;
  imageSource: "report" | "match" | null;
};

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
        {showCandidateAction && <Link className="button button-primary" href={`/matches?reportId=${report.id}`}>{progress.exception?.type === "REJECTED" ? "다른 후보 보기" : "매칭 후보 보기"}</Link>}
        {progress.step === 3 && hasCandidates && <Link href={`/matches?reportId=${report.id}`}>매칭 후보 확인</Link>}
      </div>
    </div>
  </article>;
}

function PasswordInput({ name, label }: { name: string; label: string }) {
  const [visible, setVisible] = useState(false);
  return <label className={styles.passwordField}><span>{label}</span><span className={styles.inputWithIcon}><input name={name} type={visible ? "text" : "password"} autoComplete={name === "current" ? "current-password" : "new-password"} required /><button type="button" aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setVisible((value) => !value)}><Icon name={visible ? "eyeOff" : "eye"} size={18} /></button></span></label>;
}

function ActivityVisual({ icon, imageUrl, label }: { icon: IconName; imageUrl?: string | null; label: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className={styles.activityVisual}>{imageUrl && failedUrl !== imageUrl ? <img src={imageUrl} alt={`${label} 제보 이미지`} onError={() => setFailedUrl(imageUrl)} /> : <Icon name={icon} size={21} />}</span>;
}

function ActivityRow({ icon, imageUrl, title, meta, status, detail, href, tone = "primary" }: { icon: IconName; imageUrl?: string | null; title: string; meta: string; status: string; detail: string; href: string; tone?: "primary" | "accent" | "support" | "secondary" }) {
  return <Link className={`${styles.activityRow} ${styles[`activity_${tone}`]}`} href={href}><ActivityVisual icon={icon} imageUrl={imageUrl} label={title} /><div><strong>{title}</strong><span>{meta}</span></div><div className={styles.activityMeta}><b>{status}</b><span>{detail}</span></div><Icon name="arrow" size={17} /></Link>;
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [failedSections, setFailedSections] = useState<string[]>([]);
  const [activityTab, setActivityTab] = useState<ActivityTab>("reports");
  const [flowNav, setFlowNav] = useState<FlowNav>("overview");
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
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
      const [reportsResult, notificationsResult, citizenResult] = await Promise.allSettled([
        listMyLostReports(controller.signal), listNotifications("all", controller.signal), listMyCitizenReports(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const visibleReportIds = reportsResult.status === "fulfilled" ? reportsResult.value.map((report) => report.id) : [];
      let matchesResult: PromiseSettledResult<MatchCandidate[]> = { status: "fulfilled", value: [] };
      let claimsResult: PromiseSettledResult<OwnershipClaimResponse[]> = { status: "fulfilled", value: [] };
      if (visibleReportIds.length) {
        [matchesResult, claimsResult] = await Promise.allSettled([
          listMyProgressMatches(visibleReportIds, controller.signal),
          listMyOwnershipClaimProgress(visibleReportIds, controller.signal),
        ]);
      }
      if (controller.signal.aborted) return;
      const failed: string[] = [];
      if (reportsResult.status === "rejected") failed.push("reports");
      if (matchesResult.status === "rejected") failed.push("matches");
      if (claimsResult.status === "rejected") failed.push("claims");
      if (notificationsResult.status === "rejected") failed.push("notifications");
      if (citizenResult.status === "rejected") failed.push("citizen");
      setFailedSections(failed);
      setData({
        user,
        reports: reportsResult.status === "fulfilled" ? reportsResult.value : [],
        matches: matchesResult.status === "fulfilled" ? matchesResult.value : [],
        ownershipClaims: claimsResult.status === "fulfilled" ? claimsResult.value : [],
        notifications: notificationsResult.status === "fulfilled" ? notificationsResult.value : [],
        citizenReports: citizenResult.status === "fulfilled" ? citizenResult.value : [],
      });
    }).catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof AuthApiError && reason.status === 401) router.replace("/login");
        else setError("마이페이지 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      });
    return () => controller.abort();
  }, [router]);

  useEffect(() => {
    if (!accountOpen && !passwordOpen && !deleteOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setAccountOpen(false); setPasswordOpen(false); setDeleteOpen(false); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [accountOpen, deleteOpen, passwordOpen]);

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
    { label: "소유권 확인 요청", value: data.ownershipClaims.length, href: "#my-activity", description: "요청 진행 상태", icon: "check" as const, tone: "support" },
    { label: "내 발견 제보", value: data.citizenReports.length, href: "/found-items#citizen", description: data.citizenReports.length ? "등록한 제보 확인" : "등록된 제보 없음", icon: "location" as const, tone: "secondary" },
  ] : [], [data]);
  const reportCards = useMemo(() => data ? buildLostReportCardModels(data.reports, data.matches, data.ownershipClaims) : [], [data]);

  useEffect(() => {
    if (!Number.isSafeInteger(requestedReportId) || lastScrolledReportId.current === requestedReportId) return;
    if (!reportCards.some((card) => card.report.id === requestedReportId)) return;
    const target = document.getElementById(`lost-report-card-${requestedReportId}`);
    if (!target) return;
    lastScrolledReportId.current = requestedReportId;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  }, [reportCards, requestedReportId]);

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
    const next = String(form.get("next") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (next.length < 8) return setPasswordError("새 비밀번호는 8자 이상 입력해주세요.");
    if (next !== confirm) return setPasswordError("새 비밀번호 확인이 일치하지 않습니다.");
    try { await changePassword(current, next); setPasswordOpen(false); setPasswordError(""); }
    catch (reason) { setPasswordError(reason instanceof AuthApiError ? reason.message : "비밀번호를 변경하지 못했습니다."); }
  };

  const removeAccount = async () => { await deleteAccount(); router.replace("/"); router.refresh(); };

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
      {failedSections.some((section) => section === "reports" || section === "matches" || section === "claims") ? <div className={styles.empty}>신고별 진행 상황을 불러오지 못했습니다.<button onClick={() => location.reload()}>다시 시도</button></div> : reportCards.length ? <div className={styles.reportCardList}>{reportCards.map((model) => <LostReportCard key={model.report.id} model={model} selected={model.report.id === selectedReportId} />)}</div> : <div className={styles.empty}>아직 등록한 분실 신고가 없어요. 물건을 잃어버렸다면 먼저 신고해 주세요.<Link href="/lost-reports/new">분실 신고하기</Link></div>}
    </section>

    <section className={`${styles.section} ${styles.reveal}`}><div className={styles.sectionTitle}><div><p>NOTIFICATIONS</p><h2>최근 알림</h2></div><Link href="/notifications">전체보기 <Icon name="arrow" size={16} /></Link></div>
      {failedSections.includes("notifications") ? <div className={styles.empty}>알림을 불러오지 못했습니다.<button onClick={() => location.reload()}>다시 시도</button></div> : data.notifications.length ? <div className={styles.notificationList}>{data.notifications.slice(0, 3).map((notification) => <Link href="/notifications" key={notification.id}><i className={!notification.read_at ? styles.unread : ""} /><div><strong>{notification.title}</strong><span>{notification.message}</span></div><time>{new Date(notification.created_at).toLocaleDateString("ko-KR")}</time></Link>)}</div> : <div className={styles.empty}>새로운 알림이 없습니다.</div>}
    </section>

    <section id="my-activity" className={`${styles.section} ${styles.reveal}`}><div className={styles.sectionTitle}><div><p>MY ACTIVITY</p><h2>내 활동</h2></div></div>
      <div className={styles.activityTabs} role="tablist" aria-label="내 활동 종류">
        {([['reports', '분실 신고'], ['matches', '매칭 결과'], ['claims', '소유권 확인 요청'], ['citizen', '발견 제보']] as const).map(([key, label]) => <button className={styles[`tab_${key}`]} key={key} role="tab" aria-selected={activityTab === key} aria-controls="activity-panel" onClick={() => { setActivityTab(key); setFlowNav(key); }}>{label}</button>)}
      </div>
      <div id="activity-panel" className={styles.activityList} role="tabpanel">
        {activityTab === "reports" && (failedSections.includes("reports") ? <ActivityEmpty text="분실 신고 내역을 불러오지 못했습니다." /> : data.reports.length ? data.reports.map((report) => <ActivityRow key={report.id} icon={getItemTypeMeta(report.item_category, report.item_category_name).icon} imageUrl={report.image_url} title={`${report.color ? `${report.color} ` : ""}${report.item_category_name}`} meta={`${new Date(report.lost_from).toLocaleDateString("ko-KR")} · ${report.area_name}`} status={reportStatus[report.status] ?? report.status} detail={`유사 발견물 ${data.matches.filter((match) => match.lost_report.id === report.id).length}건`} href={`/matches?reportId=${report.id}`} />) : <ActivityEmpty text="아직 등록한 분실 신고가 없습니다." href="/lost-reports/new" action="분실 신고 시작하기" />)}
        {activityTab === "matches" && (failedSections.includes("matches") ? <ActivityEmpty text="매칭 결과를 불러오지 못했습니다." /> : data.matches.length ? data.matches.map((match) => <ActivityRow key={match.id} icon="match" title={match.found_item.public_description || match.found_item.item_category_name} meta={`${new Date(match.found_item.found_at).toLocaleDateString("ko-KR")} · ${match.found_item.area_name}`} status={`${match.total_score}% 유사`} detail="AI 탐지" href="/matches" tone="accent" />) : <ActivityEmpty text="아직 비슷한 발견물을 찾지 못했어요." />)}
        {activityTab === "claims" && (failedSections.includes("claims") ? <ActivityEmpty text="소유권 확인 요청을 불러오지 못했습니다." /> : data.ownershipClaims.length ? data.ownershipClaims.map((claim) => {
          const match = data.matches.find((candidate) => candidate.found_item.id === claim.found_item_id && candidate.lost_report.id === claim.lost_report_id);
          return <ActivityRow key={claim.id} icon="check" title={match?.found_item.public_description || match?.found_item.item_category_name || `발견물 #${claim.found_item_id}`} meta={`요청일 ${new Date(claim.created_at).toLocaleDateString("ko-KR")}`} status={claimStatus[claim.status] ?? claim.status} detail="관리자 확인 절차가 진행됩니다." href="/matches" tone="support" />;
        }) : <ActivityEmpty text="소유권 확인 요청 내역이 없습니다." />)}
        {activityTab === "citizen" && (failedSections.includes("citizen") ? <ActivityEmpty text="발견 제보를 불러오지 못했습니다." /> : data.citizenReports.length ? data.citizenReports.map((report) => <ActivityRow key={report.id} icon="location" imageUrl={report.imageUrl} title={report.title} meta={`${new Date(report.foundAt).toLocaleDateString("ko-KR")} · ${report.areaName}`} status={report.status} detail={`추가 목격 ${Math.max(0, report.history.length - 1)}건`} href="/found-items#citizen" tone="secondary" />) : <ActivityEmpty text="아직 작성한 발견 제보가 없습니다." href="/found-items#citizen" action="발견물 센터에서 물품 제보하기" />)}
      </div>
    </section>

    {accountOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAccountOpen(false)}><section className={`${styles.modal} ${styles.accountModal}`} role="dialog" aria-modal="true" aria-labelledby="account-title"><button className={styles.modalClose} onClick={() => setAccountOpen(false)} aria-label="계정 정보 닫기"><Icon name="close" size={20} /></button><p className={styles.modalEyebrow}>ACCOUNT</p><h2 id="account-title">계정 정보</h2>
      <div className={styles.accountRow}><span>닉네임</span>{editingNickname ? <form onSubmit={saveNickname}><input name="nickname" defaultValue={data.user.nickname} minLength={2} maxLength={50} autoFocus /><button>저장</button><button type="button" onClick={() => setEditingNickname(false)}>취소</button></form> : <><strong>{data.user.nickname}</strong><button onClick={() => setEditingNickname(true)}>수정</button></>}</div>
      <div className={styles.accountRow}><span>이메일</span><strong>{data.user.email}</strong></div>
      <div className={styles.accountRow}><span>비밀번호</span><strong>••••••••</strong><button onClick={() => { setAccountOpen(false); setPasswordOpen(true); }}>변경</button></div>
      <div className={styles.danger}><div><strong>회원 탈퇴</strong><span>계정을 삭제하면 다시 복구할 수 없습니다.</span></div><button onClick={() => { setAccountOpen(false); setDeleteOpen(true); }}>회원 탈퇴</button></div>
    </section></div>}

    {passwordOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPasswordOpen(false)}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="password-title"><button className={styles.modalClose} onClick={() => setPasswordOpen(false)} aria-label="비밀번호 변경 닫기"><Icon name="close" size={20} /></button><h2 id="password-title">비밀번호 변경</h2><form onSubmit={submitPassword}><PasswordInput name="current" label="현재 비밀번호" /><PasswordInput name="next" label="새 비밀번호" /><PasswordInput name="confirm" label="새 비밀번호 확인" />{passwordError && <p className={styles.formError}>{passwordError}</p>}<div className={styles.modalActions}><button type="button" className="button button-secondary" onClick={() => setPasswordOpen(false)}>취소</button><button className="button button-primary">변경</button></div></form></section></div>}
    {deleteOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeleteOpen(false)}><section className={styles.modal} role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">정말 탈퇴하시겠어요?</h2><p>계정과 서비스 이용 권한이 비활성화되며 되돌릴 수 없습니다.</p><div className={styles.modalActions}><button className="button button-secondary" onClick={() => setDeleteOpen(false)}>취소</button><button className={styles.deleteButton} onClick={removeAccount}>탈퇴하기</button></div></section></div>}
  </main>;
}
