"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/common/Icon";
import { AuthApiError, AuthUser, changePassword, deleteAccount, getCurrentUser, updateNickname } from "@/lib/authApi";
import { listMyLostReports, LostReportResponse } from "@/lib/lostReportsApi";
import { listMyMatches, MatchCandidate } from "@/lib/matchesApi";
import { listNotifications, NotificationResponse } from "@/lib/notificationsApi";
import { listMyCitizenReports } from "@/lib/citizenReportsApi";
import type { CitizenReport } from "@/types/discoveryNetwork";
import { getItemTypeMeta } from "@/lib/itemTypeMeta";
import styles from "./MyPageClient.module.css";

type LoadState = { user: AuthUser; reports: LostReportResponse[]; matches: MatchCandidate[]; notifications: NotificationResponse[]; citizenReports: CitizenReport[] };
type ActivityTab = "reports" | "matches" | "claims" | "citizen";
type FlowNav = "overview" | ActivityTab;

const steps = ["분실 신고 접수", "유사 발견물 매칭", "소유권 확인", "반환 준비", "반환 완료"];
const reportStatus: Record<string, string> = { OPEN: "진행 중", MATCHED: "매칭 확인 중", CLAIM_PENDING: "소유권 확인 중", RESOLVED: "반환 완료", CANCELLED: "취소" };
const claimStatus: Record<string, string> = { CLAIMED: "확인 대기", PENDING: "검토 중", APPROVED: "승인", REJECTED: "거절", RETURNED: "반환 완료" };

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

  useEffect(() => {
    const controller = new AbortController();
    getCurrentUser().then(async (user) => {
      const [reportsResult, matchesResult, notificationsResult, citizenResult] = await Promise.allSettled([
        listMyLostReports(controller.signal), listMyMatches(controller.signal), listNotifications("all", controller.signal), listMyCitizenReports(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const failed: string[] = [];
      if (reportsResult.status === "rejected") failed.push("reports");
      if (matchesResult.status === "rejected") failed.push("matches");
      if (notificationsResult.status === "rejected") failed.push("notifications");
      if (citizenResult.status === "rejected") failed.push("citizen");
      setFailedSections(failed);
      setData({
        user,
        reports: reportsResult.status === "fulfilled" ? reportsResult.value : [],
        matches: matchesResult.status === "fulfilled" ? matchesResult.value : [],
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
    { label: "소유권 확인 요청", value: data.matches.filter((match) => match.status === "CLAIMED").length, href: "/matches", description: "요청 진행 상태", icon: "check" as const, tone: "support" },
    { label: "내 발견 제보", value: data.citizenReports.length, href: "/found-items#citizen", description: data.citizenReports.length ? "등록한 제보 확인" : "등록된 제보 없음", icon: "location" as const, tone: "secondary" },
  ] : [], [data]);

  if (error) return <main className={styles.page}><section className={styles.errorPanel}><p>{error}</p><button className="button button-secondary" onClick={() => location.reload()}>다시 시도</button></section></main>;
  if (!data) return <main className={styles.page} aria-busy="true"><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></main>;

  const currentItem = data.matches[0]?.lost_report ?? data.reports[0] ?? null;
  const currentStep = currentItem?.status === "RESOLVED" ? 4 : currentItem?.status === "CLAIM_PENDING" ? 2 : data.matches.length > 0 ? 1 : data.reports.length > 0 ? 0 : -1;
  const activeReports = data.reports.filter((report) => !["RESOLVED", "CANCELLED"].includes(report.status));
  const claimMatches = data.matches.filter((match) => match.status === "CLAIMED" || match.lost_report.status === "CLAIM_PENDING");
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
    <header className={styles.heading}><p>MY FLOW</p><h1>마이페이지</h1><span>내 신고와 발견물 연결 현황을 한눈에 확인하세요.</span></header>

    <nav className={styles.flowNav} aria-label="MY FLOW 개인 영역"><span>MY FLOW</span><div className={styles.desktopFlowNav}>{flowItems.map((item, index) => <button type="button" key={item.key} aria-current={flowNav === item.key ? "page" : undefined} onClick={() => selectFlow(item.key)}><span>{item.label}</span><i style={{ "--flow-index": index } as React.CSSProperties} /></button>)}</div><div className={styles.mobileFlowNav} ref={flowMenuRef}><button type="button" aria-haspopup="menu" aria-expanded={flowMenuOpen} onClick={() => setFlowMenuOpen((value) => !value)}><span>{flowItems.find((item) => item.key === flowNav)?.label}</span><Icon name="chevron" size={17} /></button>{flowMenuOpen && <div role="menu">{flowItems.map((item) => <button type="button" role="menuitem" aria-current={flowNav === item.key ? "page" : undefined} key={item.key} onClick={() => selectFlow(item.key)}>{item.label}</button>)}</div>}</div></nav>

    <section className={`${styles.profile} ${styles.reveal}`}>
      <span className={styles.avatar}><Icon name="user" size={30} /></span>
      <div><strong>{data.user.nickname}님</strong><span>{data.user.email}</span><small>일반 사용자</small></div>
      <button className="button button-secondary" onClick={() => setAccountOpen(true)}>내 정보 관리</button>
    </section>

    <section className={`${styles.activityGrid} ${styles.reveal}`} aria-label="내 활동 요약">
      {activity.map((item) => <Link key={item.label} href={item.href} className={`${styles.activityCard} ${styles[`tone_${item.tone}`]}`} onClick={() => { if (item.label === "등록한 신고") { setActivityTab("reports"); setFlowNav("reports"); } }}><span><Icon name={item.icon} size={22} /></span><div><small>{item.label}</small><strong>{item.value}</strong><em>{item.description}</em></div></Link>)}
    </section>

    <section id="recent-flow" className={`${styles.section} ${styles.reveal}`}><div className={styles.sectionTitle}><div><p>CURRENT FLOW</p><h2>최근 진행 상황</h2></div>{currentItem && <Link href="/matches">상세 보기</Link>}</div>
      {failedSections.some((section) => section === "reports" || section === "matches") ? <div className={styles.empty}>진행 상황을 불러오지 못했습니다.<button onClick={() => location.reload()}>다시 시도</button></div> : currentItem ? <div className={styles.progressCard}><div className={styles.currentFlowHeading}><div><small>진행 중인 물건 찾기</small><strong>{currentItem.color ? `${currentItem.color} ` : ""}{currentItem.item_category_name}</strong><span>{currentItem.area_name} · {new Date(currentItem.lost_from).toLocaleDateString("ko-KR")} 분실</span></div>{activeReports.length > 1 && <Link href="#my-activity">진행 중 {activeReports.length}건</Link>}</div><div className={styles.flowSteps}>{steps.map((step, index) => <div key={step} className={index < currentStep ? styles.completedStep : index === currentStep ? styles.currentStep : ""}><i>{index < currentStep ? "✓" : index + 1}</i><strong>{step}</strong><small>{index < currentStep ? "완료" : index === currentStep ? "현재 단계" : "대기"}</small></div>)}</div><div className={styles.itemSummary}><div><strong>유사 발견물 {data.matches.length}건</strong>{data.matches.length > 0 && <div className={styles.matchThumbs}>{data.matches.slice(0, 3).map((match) => <span key={match.id} title={match.found_item.item_category_name}><Icon name="match" size={17} /></span>)}</div>}<p>{data.matches.length ? "신고 내용과 조건이 유사한 발견물이 확인되었습니다." : "분실 신고가 접수되어 새로운 발견물을 기다리고 있습니다."}</p></div><Link className="button button-primary" href={data.matches.length ? "/matches" : "/lost-reports/new"}>{data.matches.length ? "매칭 결과 보기" : "신고 내용 확인"}</Link></div></div> : <div className={styles.empty}>아직 등록한 분실 신고가 없습니다.<Link href="/lost-reports/new">분실 신고 시작하기</Link></div>}
    </section>

    <section className={`${styles.section} ${styles.reveal}`}><div className={styles.sectionTitle}><div><p>NOTIFICATIONS</p><h2>최근 알림</h2></div><Link href="/notifications">전체보기 <Icon name="arrow" size={16} /></Link></div>
      {failedSections.includes("notifications") ? <div className={styles.empty}>알림을 불러오지 못했습니다.<button onClick={() => location.reload()}>다시 시도</button></div> : data.notifications.length ? <div className={styles.notificationList}>{data.notifications.slice(0, 3).map((notification) => <Link href="/notifications" key={notification.id}><i className={!notification.read_at ? styles.unread : ""} /><div><strong>{notification.title}</strong><span>{notification.message}</span></div><time>{new Date(notification.created_at).toLocaleDateString("ko-KR")}</time></Link>)}</div> : <div className={styles.empty}>새로운 알림이 없습니다.</div>}
    </section>

    <section id="my-activity" className={`${styles.section} ${styles.reveal}`}><div className={styles.sectionTitle}><div><p>MY ACTIVITY</p><h2>내 활동</h2></div></div>
      <div className={styles.activityTabs} role="tablist" aria-label="내 활동 종류">
        {([['reports', '분실 신고'], ['matches', '매칭 결과'], ['claims', '소유권 확인 요청'], ['citizen', '발견 제보']] as const).map(([key, label]) => <button className={styles[`tab_${key}`]} key={key} role="tab" aria-selected={activityTab === key} aria-controls="activity-panel" onClick={() => { setActivityTab(key); setFlowNav(key); }}>{label}</button>)}
      </div>
      <div id="activity-panel" className={styles.activityList} role="tabpanel">
        {activityTab === "reports" && (failedSections.includes("reports") ? <ActivityEmpty text="분실 신고 내역을 불러오지 못했습니다." /> : data.reports.length ? data.reports.map((report) => <ActivityRow key={report.id} icon={getItemTypeMeta(report.item_category, report.item_category_name).icon} imageUrl={report.image_url} title={`${report.color ? `${report.color} ` : ""}${report.item_category_name}`} meta={`${new Date(report.lost_from).toLocaleDateString("ko-KR")} · ${report.area_name}`} status={reportStatus[report.status] ?? report.status} detail={`유사 발견물 ${data.matches.filter((match) => match.lost_report.id === report.id).length}건`} href="/matches" />) : <ActivityEmpty text="아직 등록한 분실 신고가 없습니다." href="/lost-reports/new" action="분실 신고 시작하기" />)}
        {activityTab === "matches" && (failedSections.includes("matches") ? <ActivityEmpty text="매칭 결과를 불러오지 못했습니다." /> : data.matches.length ? data.matches.map((match) => <ActivityRow key={match.id} icon="match" title={match.found_item.public_description || match.found_item.item_category_name} meta={`${new Date(match.found_item.found_at).toLocaleDateString("ko-KR")} · ${match.found_item.area_name}`} status={`${match.total_score}% 유사`} detail="AI 탐지" href="/matches" tone="accent" />) : <ActivityEmpty text="아직 비슷한 발견물을 찾지 못했어요." />)}
        {activityTab === "claims" && (claimMatches.length ? claimMatches.map((match) => <ActivityRow key={match.id} icon="check" title={match.found_item.public_description || match.found_item.item_category_name} meta={`요청일 ${new Date(match.created_at).toLocaleDateString("ko-KR")}`} status={claimStatus[match.status] ?? "검토 중"} detail="관리자 확인 절차가 진행됩니다." href="/matches" tone="support" />) : <ActivityEmpty text="진행 중인 소유권 확인 요청이 없습니다." />)}
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
