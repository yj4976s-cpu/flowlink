"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  adminImageUrl,
  createFoundItemFromCitizen,
  getAdminCitizenReport,
  linkCitizenReportToFoundItem,
  listAdminCitizenReports,
  markCitizenReportUnderReview,
  rejectCitizenReport,
  type AdminCitizenReport,
} from "@/lib/adminCitizenReportsApi";
import styles from "./AdminCitizenReportsClient.module.css";

type QueueFilter = "" | "PENDING" | "UNDER_REVIEW" | "LINKED";
type Confirmation = "CREATE" | "LINK" | "REJECT" | null;

const labels: Record<string, string> = {
  PENDING: "검토 대기",
  UNDER_REVIEW: "확인 필요",
  LINKED: "발견물 연결 완료",
  REJECTED: "반려",
  CANCELLED: "취소",
};
const foundItemStatusLabels: Record<string, string> = {
  DETECTED: "탐지됨", RECOVERED: "회수 확인", AVAILABLE: "보관 중",
  CLAIM_PENDING: "소유권 확인 중", RETURNED: "반환 완료", DISPOSED: "폐기 완료",
};
const queueFilters: Array<{ value: QueueFilter; label: string }> = [
  { value: "", label: "전체" },
  { value: "PENDING", label: "검토 대기" },
  { value: "UNDER_REVIEW", label: "확인 필요" },
  { value: "LINKED", label: "연결 완료" },
];
const date = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });

function format(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "일시 확인 중" : date.format(parsed);
}

function elapsed(value: string) {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return format(value);
  const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60000));
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1440)}일 전`;
}

function ReportImage({ url, label, compact = false }: { url: string | null; label: string; compact?: boolean }) {
  const source = adminImageUrl(url);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!source || failedUrl === source) return <span className={compact ? styles.thumb : styles.evidenceImage}><span className={styles.imagePlaceholder}><Icon name="fileSearch" size={compact ? 20 : 34} />{!compact && <strong>등록된 사진 없음</strong>}</span></span>;
  return (
    <span className={compact ? styles.thumb : styles.evidenceImage}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={source} alt={label} onError={() => setFailedUrl(source)} />
    </span>
  );
}

function QuietState({ children, icon }: { children: React.ReactNode; icon?: "document" | "info" | "fileSearch" }) {
  return <div className={styles.quietState}>{icon && <Icon name={icon} size={20} />}<div>{children}</div></div>;
}

export function AdminCitizenReportsClient() {
  const [reports, setReports] = useState<AdminCitizenReport[]>([]);
  const [selected, setSelected] = useState<AdminCitizenReport | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [memo, setMemo] = useState("");
  const [storage, setStorage] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [foundItemId, setFoundItemId] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [mobileDetail, setMobileDetail] = useState(false);

  const visible = useMemo(() => filter ? reports.filter((report) => report.status === filter) : reports, [filter, reports]);
  const count = (status: QueueFilter) => status ? reports.filter((report) => report.status === status).length : reports.length;
  const selectFilter = (next: QueueFilter) => {
    setFilter(next);
    if (selected && next && selected.status !== next) {
      setSelected(null);
      setMobileDetail(false);
    }
  };

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const data = await listAdminCitizenReports(undefined, signal);
      setReports(data);
      setSelected((current) => current ? data.find((report) => report.id === current.id) ?? null : null);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError("발견 제보를 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const loadInitial = async () => {
      try {
        setReports(await listAdminCitizenReports(undefined, controller.signal));
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError("발견 제보를 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void loadInitial();
    return () => controller.abort();
  }, []);

  const resetActionState = (report: AdminCitizenReport) => {
    setMemo(report.admin_memo ?? "");
    setStorage("");
    setRejectionReason("");
    setFoundItemId("");
    setMessage("");
    setActionError("");
    setConfirmation(null);
  };

  const open = async (report: AdminCitizenReport) => {
    setSelected(report);
    setMobileDetail(true);
    resetActionState(report);
    setDetailLoading(true);
    try {
      const fresh = await getAdminCitizenReport(report.id);
      setSelected((current) => current?.id === fresh.id ? fresh : current);
      setReports((current) => current.map((item) => item.id === fresh.id ? fresh : item));
      setMemo(fresh.admin_memo ?? "");
    } catch {
      setActionError("최신 상세 정보를 불러오지 못해 목록의 정보로 표시합니다.");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmation(null);
        setMobileDetail(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected]);

  const apply = (updated: AdminCitizenReport, success: string) => {
    setSelected(updated);
    setReports((current) => current.map((item) => item.id === updated.id ? updated : item));
    resetActionState(updated);
    setMessage(success);
  };

  const runAction = async (action: "REVIEW" | "CREATE" | "LINK" | "REJECT") => {
    if (!selected) return;
    setProcessing(true);
    setActionError("");
    try {
      if (action === "REVIEW") apply(await markCitizenReportUnderReview(selected.id, memo), "검토를 시작했습니다.");
      if (action === "CREATE") apply(await createFoundItemFromCitizen(selected, storage), "공식 발견물로 등록하고 연결했습니다.");
      if (action === "LINK") {
        const id = Number(foundItemId);
        if (!Number.isInteger(id) || id < 1) throw new Error("연결할 발견물 ID를 확인해 주세요.");
        apply(await linkCitizenReportToFoundItem(selected.id, id), `기존 발견물 #${id}에 연결했습니다.`);
      }
      if (action === "REJECT") {
        if (!rejectionReason.trim()) throw new Error("반려 사유를 입력해 주세요.");
        apply(await rejectCitizenReport(selected.id, rejectionReason, memo), "발견 제보를 반려했습니다.");
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "요청을 처리하지 못했습니다.");
    } finally {
      setProcessing(false);
      setConfirmation(null);
    }
  };

  return <main className={`${styles.page} ${mobileDetail ? styles.reviewing : ""}`}>
    <header className={styles.pageHeader}><div><h1>발견 제보</h1><p>시민이 접수한 발견 정보를 확인하고 필요한 경우 발견물로 연결합니다.</p></div><button type="button" onClick={() => void load()} disabled={loading} aria-label="발견 제보 새로고침"><Icon name="refresh" size={16} />새로고침</button></header>

    <nav className={styles.statusRail} aria-label="발견 제보 상태 필터">{queueFilters.map((item) => <button type="button" data-status={item.value || "ALL"} aria-current={filter === item.value ? "page" : undefined} key={item.value || "all"} onClick={() => selectFilter(item.value)}><span>{item.label}</span><b>{count(item.value)}</b></button>)}</nav>

    <section className={`${styles.workspace} ${mobileDetail ? styles.mobileDetail : ""}`} aria-busy={loading || detailLoading}>
      <aside className={styles.inbox} aria-labelledby="inbox-title">
        <div className={styles.inboxTitle}><div><h2 id="inbox-title">제보 목록</h2><span>{visible.length}건</span></div></div>
        <div className={styles.inboxDivider} />
        {loading ? <div className={styles.inboxSkeleton} role="status" aria-label="발견 제보를 불러오는 중입니다."><i /><i /><i /></div> : error ? <div className={styles.localError} role="alert"><Icon name="info" size={20} /><strong>제보를 불러오지 못했습니다.</strong><span>잠시 후 다시 시도해 주세요.</span><button type="button" onClick={() => void load()}><Icon name="refresh" size={14} />다시 시도</button></div> : visible.length ? <div className={styles.reportList}>{visible.map((report) => <button type="button" aria-pressed={selected?.id === report.id} key={report.id} onClick={() => void open(report)}><ReportImage compact url={report.image_url} label={`${report.item_category_name} 제보 이미지`} /><span><strong>{report.color ? `${report.color} ` : ""}{report.item_category_name}</strong><small><Icon name="location" size={12} />{report.area_name}</small><time dateTime={report.created_at}>{elapsed(report.created_at)}</time></span><b className={styles[report.status.toLowerCase()]}>{labels[report.status]}</b></button>)}</div> : <QuietState>{reports.length ? "이 상태에 해당하는 제보가 없습니다." : "접수된 제보 0건"}</QuietState>}
      </aside>

      <section className={styles.evidence} aria-labelledby="evidence-title">
        {selected ? <div className={styles.evidenceContent} key={selected.id}>
          <button className={styles.mobileBack} type="button" onClick={() => setMobileDetail(false)}><Icon name="arrow" size={15} />제보 목록</button>
          <div className={styles.evidenceTitle}><div><span>제보 #{selected.id} · {selected.area_name} · 접수 {format(selected.created_at)}</span><h2 id="evidence-title">{selected.color ? `${selected.color} ` : ""}{selected.item_category_name}</h2></div><b className={styles[selected.status.toLowerCase()]}>{labels[selected.status]}</b></div>
          <ReportImage url={selected.image_url} label={`${selected.item_category_name} 발견 제보 이미지`} />
          <div className={styles.summaryInfo}><div><Icon name="category" size={17} /><span>물품 종류<strong>{selected.item_category_name}</strong></span></div><div><Icon name="location" size={17} /><span>발견 위치<strong>{selected.area_name}</strong></span></div><div><Icon name="clock" size={17} /><span>발견 시각<strong>{format(selected.found_at)}</strong></span></div><div><Icon name="user" size={17} /><span>제보자<strong>{selected.user_nickname} · #{selected.user_id}</strong></span></div></div>
          <section className={styles.description}><h3>제보 내용</h3><p>{selected.description}</p></section>
          {selected.sightings.length > 0 && <section className={styles.sightings}><h3>추가 단서 <span>{selected.sighting_count}</span></h3>{selected.sightings.map((item) => <article key={item.id}><ReportImage compact url={item.image_url} label="추가 목격 이미지" /><div><time dateTime={item.sighted_at}>{format(item.sighted_at)}</time><strong>{item.location_name}</strong><p>{item.description}</p></div></article>)}</section>}
          {selected.linked_found_item && <section className={styles.linked}><Icon name="packageCheck" size={22} /><div><span>연결된 공식 발견물</span><strong>발견물 #{selected.linked_found_item.id}</strong><small>{foundItemStatusLabels[selected.linked_found_item.status] ?? selected.linked_found_item.status}</small></div><Link href={`/found-items/${selected.linked_found_item.id}`}>상세 확인<Icon name="arrow" size={14} /></Link></section>}
        </div> : <QuietState icon="fileSearch">{error ? "제보 목록을 불러오면 상세 내용을 확인할 수 있습니다." : reports.length ? <>검토할 제보를 선택해 주세요.<br />사진, 위치, 설명과 추가 단서를 한 화면에서 확인할 수 있습니다.</> : <>현재 검토할 제보가 없습니다.<br />새로운 발견 제보가 접수되면 이곳에서 바로 확인할 수 있습니다.<span className={styles.workflowHint}><b>제보 확인</b><i /><b>단서 검토</b><i /><b>발견물 연결</b></span></>}</QuietState>}
      </section>

      <aside className={styles.actionRail} aria-labelledby="action-title">
        {selected && <div className={styles.actionContent}>
          <div className={styles.actionTitle}><h2 id="action-title">처리</h2><span>현재 상태</span><b className={styles[selected.status.toLowerCase()]}>{labels[selected.status]}</b></div>
          <dl><div><dt>접수</dt><dd>{format(selected.created_at)}</dd></div>{selected.reviewed_at && <div><dt>최근 검토</dt><dd>{format(selected.reviewed_at)}</dd></div>}{selected.reviewed_by && <div><dt>검토자</dt><dd>관리자 #{selected.reviewed_by}</dd></div>}</dl>
          {(selected.status === "PENDING" || selected.status === "UNDER_REVIEW") && <label><span>관리자 메모 <i>선택</i></span><textarea value={memo} onChange={(event) => { setMemo(event.target.value); setActionError(""); }} maxLength={2000} disabled={processing} rows={3} placeholder="검토 과정에서 필요한 메모" /></label>}
          {selected.status === "PENDING" && <div className={styles.actions}><button className="button button-primary" type="button" disabled={processing} onClick={() => void runAction("REVIEW")}>검토 시작</button><button className={styles.rejectButton} type="button" disabled={processing} onClick={() => setConfirmation("REJECT")}>반려 검토</button></div>}
          {selected.status === "UNDER_REVIEW" && <>
            <div className={styles.actionGroup}><h3>신규 발견물 등록</h3><label><span>보관 위치 <i>선택</i></span><input value={storage} onChange={(event) => setStorage(event.target.value)} maxLength={255} disabled={processing} placeholder="예: 관리실 보관함 A-3" /></label><button className="button button-primary" type="button" disabled={processing} onClick={() => setConfirmation("CREATE")}><Icon name="packageCheck" size={16} />발견물로 등록</button></div>
            <div className={styles.actionGroup}><h3>기존 발견물 연결</h3><p>후보 검색 API가 없어 확인한 발견물 ID를 직접 입력합니다.</p><label><span>발견물 ID</span><input inputMode="numeric" value={foundItemId} onChange={(event) => setFoundItemId(event.target.value.replace(/\D/g, ""))} disabled={processing} placeholder="예: 241" /></label><button className="button button-secondary" type="button" disabled={processing || !foundItemId} onClick={() => setConfirmation("LINK")}>기존 발견물 연결</button></div>
            <button className={styles.rejectButton} type="button" disabled={processing} onClick={() => setConfirmation("REJECT")}>이 제보 반려</button>
          </>}
          {confirmation === "REJECT" && <div className={styles.confirmBox}><strong>발견 제보 반려</strong><p>제보자에게 전달할 반려 사유를 입력해 주세요.</p><label><span>반려 사유 <i>필수</i></span><textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} maxLength={1000} rows={3} disabled={processing} /></label><div><button type="button" className="button button-secondary" onClick={() => setConfirmation(null)}>취소</button><button type="button" className={styles.dangerAction} disabled={processing || !rejectionReason.trim()} onClick={() => void runAction("REJECT")}>{processing ? "처리 중..." : "반려 처리"}</button></div></div>}
          {(confirmation === "CREATE" || confirmation === "LINK") && <div className={styles.confirmBox}><strong>{confirmation === "CREATE" ? "공식 발견물로 등록할까요?" : `발견물 #${foundItemId}에 연결할까요?`}</strong><p>완료하면 제보 상태가 발견물 연결 완료로 변경됩니다.</p><div><button type="button" className="button button-secondary" onClick={() => setConfirmation(null)}>취소</button><button type="button" className="button button-primary" disabled={processing} onClick={() => void runAction(confirmation)}>{processing ? "처리 중..." : "처리 확인"}</button></div></div>}
          {selected.linked_found_item && <QuietState>공식 발견물 연결이 완료된 제보입니다.</QuietState>}
          {(selected.status === "REJECTED" || selected.status === "CANCELLED") && <QuietState>현재 상태에서 처리 가능한 관리자 작업이 없습니다.</QuietState>}
          {selected.rejection_reason && <div className={styles.rejection}><span>반려 사유</span><p>{selected.rejection_reason}</p></div>}
          {message && <p className={styles.success} role="status">{message}</p>}
          {actionError && <p className={styles.actionError} role="alert">{actionError}</p>}
        </div>}
      </aside>
    </section>
  </main>;
}
