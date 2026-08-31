"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/components/common/Icon";
import { chooseOwnershipClaimId, parseOwnershipClaimStatusParam } from "@/components/admin/adminQueryState";
import {
  AdminOwnershipClaim,
  AdminOwnershipClaimsApiError,
  listAdminOwnershipClaims,
  updateAdminOwnershipClaim,
} from "@/lib/adminOwnershipClaimsApi";
import styles from "./AdminOwnershipClaimsClient.module.css";

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const claimStatusLabels: Record<string, string> = {
  PENDING: "검토 대기",
  APPROVED: "승인 · 반환 대기",
  REJECTED: "거절됨",
  RETURNED: "반환 완료",
};

const foundItemStatusLabels: Record<string, string> = {
  AVAILABLE: "공개 중",
  CLAIM_PENDING: "소유권 확인 중",
  RETURNED: "반환 완료",
  RECOVERED: "회수됨",
  DISPOSED: "처분됨",
};

const lostReportStatusLabels: Record<string, string> = {
  OPEN: "신고 접수",
  MATCHED: "후보 확인 중",
  CLAIM_PENDING: "소유권 확인 중",
  RESOLVED: "처리 완료",
  CANCELLED: "취소됨",
};

const actionLabels: Record<string, string> = {
  APPROVED: "승인",
  REJECTED: "거절",
  RETURNED: "반환 완료",
};

const actionDescriptions: Record<string, string> = {
  APPROVED: "이 요청을 승인하시겠습니까? 승인은 반환 완료와 다르며, 실제 반환 후 별도 처리가 필요합니다.",
  REJECTED: "이 요청을 거절하시겠습니까? 발견물은 다시 공개 가능한 상태로 돌아갈 수 있습니다.",
  RETURNED: "실제 물품 반환이 끝난 경우에만 처리해 주세요. 발견물과 분실 신고 상태가 함께 변경됩니다.",
};

const successMessages: Record<string, string> = {
  APPROVED: "요청을 승인했습니다. 실제 반환 후 반환 완료로 처리해 주세요.",
  REJECTED: "요청을 거절했습니다.",
  RETURNED: "반환 완료 상태로 처리했습니다.",
};

const statusToneClasses: Record<string, string> = {
  PENDING: styles.statusPending,
  APPROVED: styles.statusApproved,
  REJECTED: styles.statusRejected,
  RETURNED: styles.statusReturned,
};

type ConfirmingAction = { claimId: number; status: string } | null;

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "일시 확인 중" : dateTimeFormatter.format(date);
}

function getLabel(labels: Record<string, string>, status: string) {
  return labels[status] ?? status;
}

function getAvailableActions(status: string) {
  if (status === "PENDING") return ["APPROVED", "REJECTED"];
  if (status === "APPROVED") return ["RETURNED"];
  return [];
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function StateCard({
  icon,
  title,
  description,
  action,
  tone = "default",
}: {
  icon: "scan" | "document" | "spark";
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <div className={`${styles.stateCard} ${tone === "error" ? styles.stateError : ""}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} size={24} />
      <div><strong>{title}</strong><p>{description}</p>{action}</div>
    </div>
  );
}

export function AdminOwnershipClaimsClient() {
  const searchParams = useSearchParams();
  const initialFocusStatusRef = useRef(parseOwnershipClaimStatusParam(searchParams.get("status")));
  const [claims, setClaims] = useState<AdminOwnershipClaim[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [adminMemos, setAdminMemos] = useState<Record<number, string>>({});
  const [processingClaimIds, setProcessingClaimIds] = useState<Set<number>>(() => new Set());
  const [confirmingAction, setConfirmingAction] = useState<ConfirmingAction>(null);
  const [actionMessages, setActionMessages] = useState<Record<number, string>>({});
  const [actionErrors, setActionErrors] = useState<Record<number, string>>({});
  const processingClaimIdsRef = useRef<Set<number>>(new Set());

  const applyClaims = (data: AdminOwnershipClaim[]) => {
    setClaims(data);
    setSelectedClaimId((current) => chooseOwnershipClaimId(data, current, initialFocusStatusRef.current));
  };

  const refreshClaims = async () => {
    try {
      const data = await listAdminOwnershipClaims();
      applyClaims(data);
      setError(null);
      setErrorStatus(null);
      return true;
    } catch (caught) {
      if (caught instanceof AdminOwnershipClaimsApiError) {
        setError(caught.message);
        setErrorStatus(caught.status ?? null);
      } else {
        setError("소유권 요청 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        setErrorStatus(null);
      }
      return false;
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const loadInitialClaims = async () => {
      try {
        const data = await listAdminOwnershipClaims(controller.signal);
        applyClaims(data);
        setError(null);
        setErrorStatus(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (caught instanceof AdminOwnershipClaimsApiError) {
          setError(caught.message);
          setErrorStatus(caught.status ?? null);
        } else {
          setError("소유권 요청 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
          setErrorStatus(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void loadInitialClaims();
    return () => controller.abort();
  }, []);

  const selectedClaim = claims.find((claim) => claim.id === selectedClaimId) ?? null;
  const summary = useMemo(() => ({
    pending: claims.filter((claim) => claim.status === "PENDING").length,
    reviewed: claims.filter((claim) => claim.status === "REJECTED" || claim.status === "RETURNED").length,
    returnPending: claims.filter((claim) => claim.status === "APPROVED").length,
  }), [claims]);

  const updateMemo = (claimId: number, value: string) => {
    setAdminMemos((current) => ({ ...current, [claimId]: value }));
    setActionErrors((current) => ({ ...current, [claimId]: "" }));
  };

  const clearMemoDraft = (claimId: number) => {
    setAdminMemos((current) => {
      const next = { ...current };
      delete next[claimId];
      return next;
    });
  };

  const updateClaimStatus = async (claimId: number, status: string) => {
    if (processingClaimIdsRef.current.has(claimId)) return;
    const nextProcessing = new Set(processingClaimIdsRef.current).add(claimId);
    processingClaimIdsRef.current = nextProcessing;
    setProcessingClaimIds(nextProcessing);
    setActionMessages((current) => ({ ...current, [claimId]: "" }));
    setActionErrors((current) => ({ ...current, [claimId]: "" }));

    try {
      const updatedClaim = await updateAdminOwnershipClaim(claimId, {
        status,
        admin_memo: adminMemos[claimId]?.trim() || null,
      });
      setClaims((current) => current.map((claim) => claim.id === claimId ? updatedClaim : claim));
      clearMemoDraft(claimId);
      setActionMessages((current) => ({ ...current, [claimId]: successMessages[status] }));
      setConfirmingAction(null);
    } catch (caught) {
      if (caught instanceof AdminOwnershipClaimsApiError && (caught.status === 404 || caught.status === 409)) {
        setConfirmingAction(null);
        const refreshed = await refreshClaims();
        if (refreshed) clearMemoDraft(claimId);
        setActionErrors((current) => ({
          ...current,
          [claimId]: caught.status === 404
            ? "해당 요청을 찾을 수 없습니다. 최신 목록을 다시 불러왔습니다."
            : "요청 상태가 이미 변경되었습니다. 최신 정보를 다시 불러왔습니다.",
        }));
      } else {
        setActionErrors((current) => ({
          ...current,
          [claimId]: caught instanceof AdminOwnershipClaimsApiError
            ? caught.message
            : "요청 상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        }));
      }
    } finally {
      const next = new Set(processingClaimIdsRef.current);
      next.delete(claimId);
      processingClaimIdsRef.current = next;
      setProcessingClaimIds(next);
    }
  };

  const renderDetail = (claim: AdminOwnershipClaim) => {
    const actions = getAvailableActions(claim.status);
    const processing = processingClaimIds.has(claim.id);
    const activeConfirmStatus = confirmingAction?.claimId === claim.id && actions.includes(confirmingAction.status)
      ? confirmingAction.status
      : null;

    return (
      <article className={styles.detail} aria-labelledby={`claim-detail-${claim.id}`}>
        <header className={styles.detailHeader}>
          <div><p className={styles.eyebrow}>REQUEST #{claim.id}</p><h2 id={`claim-detail-${claim.id}`}>요청 상세 검토</h2></div>
          <span className={`${styles.statusChip} ${statusToneClasses[claim.status] ?? ""}`}>{getLabel(claimStatusLabels, claim.status)}</span>
        </header>

        <section className={styles.detailSection} aria-labelledby={`requester-${claim.id}`}>
          <h3 id={`requester-${claim.id}`}>요청자 정보</h3>
          <dl className={styles.infoGrid}>
            <InfoRow label="닉네임" value={claim.claimant.nickname} />
            <InfoRow label="사용자 ID" value={`#${claim.claimant.id}`} />
            <InfoRow label="요청 일시" value={<time dateTime={claim.created_at}>{formatDateTime(claim.created_at)}</time>} />
            <InfoRow label="검토자" value={claim.reviewed_by ? `관리자 #${claim.reviewed_by}` : "검토 전"} />
          </dl>
        </section>

        <section className={`${styles.detailSection} ${styles.evidenceSection}`} aria-labelledby={`evidence-${claim.id}`}>
          <h3 id={`evidence-${claim.id}`}>소유권 검증 정보</h3>
          <div className={styles.evidenceGrid}>
            <div><span>요청자가 제출한 특징</span><blockquote>{claim.verification_details}</blockquote></div>
            <div><span>발견물 비공개 특징</span><blockquote>{claim.found_item.private_features || "등록된 비공개 특징이 없습니다."}</blockquote></div>
            <div><span>연결된 분실 신고 설명</span><blockquote>{claim.lost_report?.description || "연결된 분실 신고가 없습니다."}</blockquote></div>
          </div>
        </section>

        <div className={styles.objectColumns}>
          <section className={styles.detailSection} aria-labelledby={`found-${claim.id}`}>
            <h3 id={`found-${claim.id}`}>발견물 정보</h3>
            <dl className={styles.infoList}>
              <InfoRow label="종류" value={claim.found_item.item_category_name} />
              <InfoRow label="색상" value={claim.found_item.color || "미상"} />
              <InfoRow label="발견 지역" value={claim.found_item.area_name} />
              <InfoRow label="발견 시각" value={<time dateTime={claim.found_item.found_at}>{formatDateTime(claim.found_item.found_at)}</time>} />
              <InfoRow label="공개 설명" value={claim.found_item.public_description || "공개 설명 없음"} />
              <InfoRow label="현재 상태" value={getLabel(foundItemStatusLabels, claim.found_item.status)} />
            </dl>
          </section>
          <section className={styles.detailSection} aria-labelledby={`report-${claim.id}`}>
            <h3 id={`report-${claim.id}`}>분실 신고 정보</h3>
            {claim.lost_report ? (
              <dl className={styles.infoList}>
                <InfoRow label="종류" value={claim.lost_report.item_category_name} />
                <InfoRow label="색상" value={claim.lost_report.color || "미상"} />
                <InfoRow label="분실 지역" value={claim.lost_report.area_name} />
                <InfoRow label="분실 시각" value={<time dateTime={claim.lost_report.lost_from}>{formatDateTime(claim.lost_report.lost_from)}</time>} />
                <InfoRow label="현재 상태" value={getLabel(lostReportStatusLabels, claim.lost_report.status)} />
              </dl>
            ) : <p className={styles.emptyNote}>연결된 분실 신고가 없습니다.</p>}
          </section>
        </div>

        <section className={`${styles.detailSection} ${styles.actionSection}`} aria-labelledby={`action-${claim.id}`}>
          <div className={styles.actionHeading}>
            <div><p className={styles.eyebrow}>ADMIN ACTION</p><h3 id={`action-${claim.id}`}>검토 처리</h3></div>
            <p>승인과 반환 완료는 별도 단계입니다. 실제 상태에 맞는 작업만 선택해 주세요.</p>
          </div>
          <label htmlFor={`admin-memo-${claim.id}`}>
            <span>관리자 메모 <i>선택</i></span>
            <textarea
              id={`admin-memo-${claim.id}`}
              value={adminMemos[claim.id] ?? claim.admin_memo ?? ""}
              onChange={(event) => updateMemo(claim.id, event.target.value)}
              placeholder="검토 근거나 전달 사항을 남길 수 있습니다."
              rows={3}
              disabled={processing || actions.length === 0}
            />
          </label>
          {actionMessages[claim.id] && <p className={styles.successMessage} aria-live="polite">{actionMessages[claim.id]}</p>}
          {actionErrors[claim.id] && <p className={styles.errorMessage} role="alert">{actionErrors[claim.id]}</p>}
          {actions.length > 0 ? (
            <div className={styles.actionButtons}>
              {actions.map((status) => (
                <button key={status} className={status === "REJECTED" ? "button button-secondary" : "button button-primary"} type="button" onClick={() => setConfirmingAction({ claimId: claim.id, status })} disabled={processing}>
                  {actionLabels[status]}
                </button>
              ))}
            </div>
          ) : <p className={styles.emptyNote}>이 요청에서 더 처리할 관리자 작업이 없습니다.</p>}
          {activeConfirmStatus && (
            <div className={styles.confirmBox} role="alert">
              <strong>{actionLabels[activeConfirmStatus]} 처리 확인</strong>
              <p>{actionDescriptions[activeConfirmStatus]}</p>
              <div>
                <button className="button button-secondary" type="button" onClick={() => setConfirmingAction(null)} disabled={processing}>취소</button>
                <button className="button button-primary" type="button" onClick={() => void updateClaimStatus(claim.id, activeConfirmStatus)} disabled={processing}>
                  {processing ? "처리 중..." : `${actionLabels[activeConfirmStatus]} 처리`}
                </button>
              </div>
            </div>
          )}
        </section>
      </article>
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>ADMIN · OWNERSHIP REVIEW</p>
        <h1>소유권 요청 검토</h1>
        <p>요청자가 제출한 정보와 발견물의 비공개 특징, 연결된 분실 신고를 대조해 검토합니다.</p>
      </header>

      <div className={styles.process} aria-label="소유권 요청 처리 절차">
        {[
          ["01", "요청 접수"], ["02", "정보 대조"], ["03", "검토 결과"], ["04", "반환 처리"],
        ].map(([number, label], index) => (
          <div key={number} className={styles.processStep}><span>{number}</span><strong>{label}</strong>{index < 3 && <i aria-hidden="true" />}</div>
        ))}
      </div>

      <section className={styles.summaryGrid} aria-label="소유권 요청 현황">
        <div><span>검토 대기</span><strong>{summary.pending}</strong><small>PENDING</small></div>
        <div><span>확인 완료</span><strong>{summary.reviewed}</strong><small>REVIEWED</small></div>
        <div><span>반환 대기</span><strong>{summary.returnPending}</strong><small>APPROVED</small></div>
      </section>

      <section className={styles.workspace} aria-busy={loading}>
        <div className={styles.queuePanel}>
          <div className={styles.queueHeader}>
            <div><p className={styles.eyebrow}>REVIEW QUEUE</p><h2>검토 대기 요청 <span>{claims.length}</span></h2><p>요청을 선택하면 오른쪽에서 제출 정보와 발견물 정보를 대조할 수 있습니다.</p></div>
            {!loading && <button className={styles.refreshButton} type="button" onClick={() => void refreshClaims()} aria-label="요청 목록 새로고침"><Icon name="return" size={17} />새로고침</button>}
          </div>

          {loading && <StateCard icon="scan" title="요청을 불러오고 있습니다." description="관리자 검토에 필요한 정보를 확인하는 중입니다." />}
          {!loading && error && (
            <StateCard icon="spark" title={errorStatus === 403 ? "관리자 권한이 필요합니다." : "요청 목록을 불러오지 못했습니다."} description={error} tone="error" action={
              <div className={styles.stateActions}>
                {errorStatus === 401 && <Link className="button button-primary" href="/login">로그인하기</Link>}
                {errorStatus === 403 && <Link className="button button-secondary" href="/">홈으로 이동</Link>}
                {errorStatus !== 401 && errorStatus !== 403 && <button className="button button-secondary" type="button" onClick={() => void refreshClaims()}>다시 시도</button>}
              </div>
            } />
          )}
          {!loading && !error && claims.length === 0 && <StateCard icon="document" title="현재 검토 대기 중인 소유권 요청이 없습니다." description="새 요청이 접수되면 이 목록에 표시됩니다." />}
          {!loading && !error && claims.length > 0 && (
            <div className={styles.claimList}>
              {claims.map((claim) => (
                <button key={claim.id} type="button" className={`${styles.claimRow} ${claim.id === selectedClaimId ? styles.claimRowSelected : ""}`} onClick={() => { setSelectedClaimId(claim.id); setConfirmingAction(null); }} aria-pressed={claim.id === selectedClaimId}>
                  <span className={styles.claimRowTop}><strong>요청 #{claim.id}</strong><span className={`${styles.statusChip} ${statusToneClasses[claim.status] ?? ""}`}>{getLabel(claimStatusLabels, claim.status)}</span></span>
                  <span className={styles.claimItem}>{claim.found_item.item_category_name} · {claim.found_item.color || "색상 미상"}</span>
                  <span className={styles.claimMeta}><span><Icon name="user" size={14} />{claim.claimant.nickname}</span><span><Icon name="location" size={14} />{claim.found_item.area_name}</span></span>
                  <time dateTime={claim.created_at}>{formatDateTime(claim.created_at)}</time>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.detailPanel}>
          {selectedClaim ? renderDetail(selectedClaim) : (
            <div className={styles.noSelection}><Icon name="fileSearch" size={34} /><strong>검토할 요청을 선택해 주세요.</strong><p>왼쪽 목록에서 요청을 선택하면 제출 정보와 발견물 상세가 표시됩니다.</p></div>
          )}
        </div>
      </section>
    </main>
  );
}
