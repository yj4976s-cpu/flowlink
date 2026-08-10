"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/components/common/Icon";
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
  APPROVED: "승인됨 · 반환 대기",
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
  APPROVED: "이 요청을 승인하시겠습니까? 승인은 반환 완료가 아닙니다.",
  REJECTED: "이 요청을 거절하시겠습니까? 발견물이 다시 공개 가능 상태로 돌아갈 수 있습니다.",
  RETURNED: "실제 물품 반환이 완료된 경우에만 처리해주세요. 완료 후 발견물과 분실 신고 상태가 함께 변경됩니다.",
};

const successMessages: Record<string, string> = {
  APPROVED: "소유권 확인 요청을 승인했습니다. 실제 반환 완료 후 반환 완료 처리를 진행해주세요.",
  REJECTED: "소유권 확인 요청을 거절했습니다.",
  RETURNED: "반환 완료 상태로 처리했습니다.",
};

const statusToneClasses: Record<string, string> = {
  PENDING: styles.statusPending,
  APPROVED: styles.statusApproved,
  REJECTED: styles.statusRejected,
  RETURNED: styles.statusReturned,
};

type ConfirmingAction = {
  claimId: number;
  status: string;
} | null;

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "일시 확인 중" : dateTimeFormatter.format(date);
}

function getLabel(labels: Record<string, string>, status: string) {
  return labels[status] ?? status;
}

function getStatusToneClass(status: string) {
  return statusToneClasses[status] ?? "";
}

function getAvailableActions(status: string) {
  if (status === "PENDING") return ["APPROVED", "REJECTED"];
  if (status === "APPROVED") return ["RETURNED"];
  return [];
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
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
      <Icon name={icon} size={26} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {action}
      </div>
    </div>
  );
}

function ClaimReviewCard({
  claim,
  adminMemo,
  processing,
  confirmingAction,
  actionMessage,
  actionError,
  onMemoChange,
  onConfirmAction,
  onCancelConfirm,
  onRequestAction,
}: {
  claim: AdminOwnershipClaim;
  adminMemo: string;
  processing: boolean;
  confirmingAction: ConfirmingAction;
  actionMessage: string | null;
  actionError: string | null;
  onMemoChange: (value: string) => void;
  onConfirmAction: (status: string) => void;
  onCancelConfirm: () => void;
  onRequestAction: (status: string) => void;
}) {
  const actions = getAvailableActions(claim.status);
  const activeConfirmStatus =
    confirmingAction?.claimId === claim.id && actions.includes(confirmingAction.status)
      ? confirmingAction.status
      : null;

  return (
    <article className={styles.card} aria-labelledby={`admin-claim-${claim.id}-title`}>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.eyebrow}>REQUEST #{claim.id}</p>
          <h2 id={`admin-claim-${claim.id}-title`}>소유권 확인 요청 검토</h2>
          <div className={styles.headerMeta}>
            <span>신청자 {claim.claimant.nickname}</span>
            <span>ID {claim.claimant.id}</span>
            <span><time dateTime={claim.created_at}>{formatDateTime(claim.created_at)}</time></span>
          </div>
        </div>
        <span className={`${styles.statusChip} ${getStatusToneClass(claim.status)}`}>{getLabel(claimStatusLabels, claim.status)}</span>
      </div>

      <dl className={styles.metaList}>
        <InfoRow label="요청 번호" value={`#${claim.id}`} />
        <InfoRow label="검토자" value={claim.reviewed_by ? `관리자 #${claim.reviewed_by}` : "아직 검토 전"} />
        <InfoRow label="검토 시각" value={claim.reviewed_at ? <time dateTime={claim.reviewed_at}>{formatDateTime(claim.reviewed_at)}</time> : "아직 검토 전"} />
      </dl>

      <div className={styles.compareGrid}>
        <section className={`${styles.reviewPanel} ${styles.claimantPanel}`} aria-label="시민 제출 소유권 검증 정보">
          <div className={styles.reviewPanelHead}>
            <span><Icon name="document" size={18} /></span>
            <div>
              <p>시민 제출 검증 정보</p>
              <h3>신고자가 말한 특징</h3>
            </div>
          </div>
          <blockquote>{claim.verification_details}</blockquote>
        </section>

        <section className={`${styles.reviewPanel} ${styles.privatePanel}`} aria-label="발견물 관리자 내부 특징">
          <div className={styles.reviewPanelHead}>
            <span><Icon name="scan" size={18} /></span>
            <div>
              <p>발견물 비공개 확인 정보</p>
              <h3>실제 발견물 내부 특징</h3>
            </div>
          </div>
          <blockquote>{claim.found_item.private_features || "등록된 비공개 특징이 없습니다."}</blockquote>
        </section>

        <section className={`${styles.reviewPanel} ${styles.reportPanel}`} aria-label="분실 신고 내용">
          <div className={styles.reviewPanelHead}>
            <span><Icon name="match" size={18} /></span>
            <div>
              <p>연결 분실 신고</p>
              <h3>분실 신고자가 작성한 설명</h3>
            </div>
          </div>
          <blockquote>{claim.lost_report?.description || "연결된 분실 신고 없음"}</blockquote>
        </section>
      </div>

      <div className={styles.detailGrid}>
        <section className={styles.detailPanel} aria-labelledby={`found-item-${claim.id}`}>
          <h3 id={`found-item-${claim.id}`}>발견물</h3>
          <dl>
            <InfoRow label="종류" value={claim.found_item.item_category_name} />
            <InfoRow label="색상" value={claim.found_item.color || "미상"} />
            <InfoRow label="발견 구역" value={claim.found_item.area_name} />
            <InfoRow label="발견 시각" value={<time dateTime={claim.found_item.found_at}>{formatDateTime(claim.found_item.found_at)}</time>} />
            <InfoRow label="공개 설명" value={claim.found_item.public_description || "공개 설명 없음"} />
            <InfoRow label="공개 여부" value={claim.found_item.is_public ? "공개" : "비공개"} />
            <InfoRow label="현재 상태" value={<span className={styles.inlineStatus}>{getLabel(foundItemStatusLabels, claim.found_item.status)}</span>} />
          </dl>
        </section>

        <section className={styles.detailPanel} aria-labelledby={`lost-report-${claim.id}`}>
          <h3 id={`lost-report-${claim.id}`}>분실 신고</h3>
          {claim.lost_report ? (
            <dl>
              <InfoRow label="종류" value={claim.lost_report.item_category_name} />
              <InfoRow label="색상" value={claim.lost_report.color || "미상"} />
              <InfoRow label="분실 구역" value={claim.lost_report.area_name} />
              <InfoRow label="분실 시각" value={<time dateTime={claim.lost_report.lost_from}>{formatDateTime(claim.lost_report.lost_from)}</time>} />
              <InfoRow label="현재 상태" value={<span className={styles.inlineStatus}>{getLabel(lostReportStatusLabels, claim.lost_report.status)}</span>} />
            </dl>
          ) : (
            <p className={styles.emptyNote}>연결된 분실 신고 없음</p>
          )}
        </section>
      </div>

      <section className={styles.actionPanel} aria-labelledby={`admin-action-${claim.id}`}>
        <div className={styles.actionHeading}>
          <div>
            <p className={styles.eyebrow}>ADMIN ACTION</p>
            <h3 id={`admin-action-${claim.id}`}>검토 처리</h3>
          </div>
          <p>상태 변경은 서버 전이 규칙에 따라 처리되며, 승인과 반환 완료는 별도 단계입니다.</p>
        </div>
        <label htmlFor={`admin-memo-${claim.id}`}>
          <span>관리자 메모 <i>선택</i></span>
          <textarea
            id={`admin-memo-${claim.id}`}
            value={adminMemo}
            onChange={(event) => onMemoChange(event.target.value)}
            placeholder="검토 근거나 전달 사항을 남길 수 있습니다."
            rows={3}
            disabled={processing || actions.length === 0}
          />
        </label>

        {actionMessage && <p className={styles.successMessage} aria-live="polite">{actionMessage}</p>}
        {actionError && <p className={styles.errorMessage} role="alert">{actionError}</p>}

        {actions.length > 0 ? (
          <div className={styles.actionButtons}>
            {actions.map((status) => (
              <button
                key={status}
                className={status === "REJECTED" ? "button button-secondary" : "button button-primary"}
                type="button"
                onClick={() => onRequestAction(status)}
                disabled={processing}
              >
                {processing && activeConfirmStatus === status ? "처리 중..." : actionLabels[status]}
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.emptyNote}>이 요청은 더 이상 처리할 수 있는 관리자 작업이 없습니다.</p>
        )}

        {activeConfirmStatus && (
          <div className={styles.confirmBox} role="alert">
            <strong>{actionLabels[activeConfirmStatus]} 처리 확인</strong>
            <p>{actionDescriptions[activeConfirmStatus]}</p>
            <div>
              <button className="button button-secondary" type="button" onClick={onCancelConfirm} disabled={processing}>취소</button>
              <button className="button button-primary" type="button" onClick={() => onConfirmAction(activeConfirmStatus)} disabled={processing}>
                {processing ? "처리 중..." : `${actionLabels[activeConfirmStatus]} 처리`}
              </button>
            </div>
          </div>
        )}
      </section>
    </article>
  );
}

export function AdminOwnershipClaimsClient() {
  const [claims, setClaims] = useState<AdminOwnershipClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [adminMemos, setAdminMemos] = useState<Record<number, string>>({});
  const [processingClaimIds, setProcessingClaimIds] = useState<Set<number>>(() => new Set());
  const [confirmingAction, setConfirmingAction] = useState<ConfirmingAction>(null);
  const [actionMessages, setActionMessages] = useState<Record<number, string>>({});
  const [actionErrors, setActionErrors] = useState<Record<number, string>>({});
  const processingClaimIdsRef = useRef<Set<number>>(new Set());

  const refreshClaims = async () => {
    try {
      const data = await listAdminOwnershipClaims();
      setClaims(data);
      setError(null);
      setErrorStatus(null);
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const loadInitialClaims = async () => {
      try {
        const data = await listAdminOwnershipClaims(controller.signal);
        setClaims(data);
        setError(null);
        setErrorStatus(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (caught instanceof AdminOwnershipClaimsApiError) {
          setError(caught.message);
          setErrorStatus(caught.status ?? null);
          return;
        }
        setError("소유권 확인 요청 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
        setErrorStatus(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadInitialClaims();
    return () => controller.abort();
  }, []);

  const summaryText = useMemo(() => {
    if (loading) return "관리자 검토 요청을 불러오고 있습니다.";
    if (error) return error;
    return `현재 표시된 요청 ${claims.length}개`;
  }, [claims.length, error, loading]);

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
    const nextProcessingClaimIds = new Set(processingClaimIdsRef.current);
    nextProcessingClaimIds.add(claimId);
    processingClaimIdsRef.current = nextProcessingClaimIds;
    setProcessingClaimIds(nextProcessingClaimIds);
    setActionMessages((current) => ({ ...current, [claimId]: "" }));
    setActionErrors((current) => ({ ...current, [claimId]: "" }));

    try {
      const updatedClaim = await updateAdminOwnershipClaim(claimId, {
        status,
        admin_memo: adminMemos[claimId]?.trim() || null,
      });
      setClaims((current) => current.map((claim) => (claim.id === claimId ? updatedClaim : claim)));
      setActionMessages((current) => ({ ...current, [claimId]: successMessages[status] }));
      setConfirmingAction(null);
    } catch (caught) {
      if (caught instanceof AdminOwnershipClaimsApiError && (caught.status === 404 || caught.status === 409)) {
        setConfirmingAction(null);
        const refreshed = await refreshClaims();
        if (refreshed) clearMemoDraft(claimId);
        const message = refreshed
          ? caught.status === 404
            ? "해당 요청을 찾을 수 없습니다. 최신 목록을 다시 불러왔습니다."
            : "요청 상태가 이미 변경되었습니다. 최신 정보를 다시 불러왔습니다."
          : caught.status === 404
            ? "해당 요청을 찾을 수 없습니다. 최신 목록을 다시 불러오지 못했습니다. 다시 새로고침해주세요."
            : "요청 상태가 이미 변경되었습니다. 최신 정보를 다시 불러오지 못했습니다. 다시 새로고침해주세요.";
        setActionErrors((current) => ({ ...current, [claimId]: message }));
        return;
      }
      const message = caught instanceof AdminOwnershipClaimsApiError
        ? caught.message
        : "요청 상태를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.";
      setActionErrors((current) => ({ ...current, [claimId]: message }));
    } finally {
      const nextProcessingClaimIds = new Set(processingClaimIdsRef.current);
      nextProcessingClaimIds.delete(claimId);
      processingClaimIdsRef.current = nextProcessingClaimIds;
      setProcessingClaimIds(nextProcessingClaimIds);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="admin-ownership-title">
        <div>
          <p className={styles.eyebrow}>ADMIN</p>
          <h1 id="admin-ownership-title">소유권 확인 요청</h1>
          <p>시민이 제출한 확인 정보와 발견물의 비공개 특징, 분실 신고 정보를 비교해 요청을 검토합니다.</p>
          <div className={styles.heroSteps} aria-label="관리자 검토 흐름">
            <span>검토 대기</span>
            <Icon name="arrow" size={16} />
            <span>승인 또는 거절</span>
            <Icon name="arrow" size={16} />
            <span>반환 완료</span>
          </div>
        </div>
        <aside className={styles.heroCard} aria-label="소유권 확인 요청 요약">
          <Icon name="return" size={34} />
          <strong>{summaryText}</strong>
          <span>승인은 반환 완료가 아니며, 실제 반환 후 별도로 반환 완료 처리합니다.</span>
        </aside>
      </section>

      <section className={styles.results} aria-labelledby="admin-ownership-list-title" aria-busy={loading}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>REVIEW QUEUE</p>
            <h2 id="admin-ownership-list-title">검토 목록</h2>
          </div>
          <div className={styles.headingActions}>
            {!loading && !error && <span>표시 중 {claims.length}개</span>}
            {!loading && (
              <button className="button button-secondary" type="button" onClick={() => void refreshClaims()}>
                새로고침
              </button>
            )}
          </div>
        </div>

        {loading && (
          <StateCard
            icon="scan"
            title="소유권 확인 요청을 불러오고 있습니다."
            description="관리자 검토에 필요한 요청 목록을 확인하는 중입니다."
          />
        )}

        {!loading && error && (
          <StateCard
            icon="spark"
            title={errorStatus === 403 ? "관리자 권한이 필요합니다." : "요청 목록을 불러오지 못했습니다."}
            description={error}
            tone="error"
            action={
              <div className={styles.stateActions}>
                {errorStatus === 401 && <Link className="button button-primary" href="/login">로그인하러 가기</Link>}
                {errorStatus === 403 && <Link className="button button-secondary" href="/">홈으로 이동</Link>}
                {errorStatus !== 401 && errorStatus !== 403 && (
                  <button className="button button-secondary" type="button" onClick={() => void refreshClaims()}>다시 시도</button>
                )}
              </div>
            }
          />
        )}

        {!loading && !error && claims.length === 0 && (
          <StateCard
            icon="document"
            title="현재 표시할 소유권 확인 요청이 없습니다."
            description="새 요청이 접수되면 이 목록에 표시됩니다."
          />
        )}

        {!loading && !error && claims.length > 0 && (
          <div className={styles.claimList} role="list">
            {claims.map((claim) => (
              <div key={claim.id} role="listitem">
                <ClaimReviewCard
                  claim={claim}
                  adminMemo={adminMemos[claim.id] ?? claim.admin_memo ?? ""}
                  processing={processingClaimIds.has(claim.id)}
                  confirmingAction={confirmingAction}
                  actionMessage={actionMessages[claim.id] || null}
                  actionError={actionErrors[claim.id] || null}
                  onMemoChange={(value) => updateMemo(claim.id, value)}
                  onConfirmAction={(status) => void updateClaimStatus(claim.id, status)}
                  onCancelConfirm={() => setConfirmingAction(null)}
                  onRequestAction={(status) => setConfirmingAction({ claimId: claim.id, status })}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
