"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  OwnershipClaimResponse,
  OwnershipClaimsApiError,
  createOwnershipClaim,
} from "@/lib/ownershipClaimsApi";
import styles from "./OwnershipClaimForm.module.css";

const MIN_VERIFICATION_LENGTH = 10;
const MAX_VERIFICATION_LENGTH = 1000;

const claimStatusLabels: Record<string, string> = {
  PENDING: "확인 대기",
  APPROVED: "승인됨",
  REJECTED: "거절됨",
  RETURNED: "반환 완료",
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "일시 확인 중" : dateFormatter.format(date);
}

function getClaimStatusLabel(status: string) {
  return claimStatusLabels[status] ?? status;
}

function validateVerificationDetails(value: string) {
  const trimmedLength = value.trim().length;
  if (trimmedLength < MIN_VERIFICATION_LENGTH) return "확인 내용은 10자 이상 입력해주세요.";
  if (trimmedLength > MAX_VERIFICATION_LENGTH) return "확인 내용은 1000자 이하로 입력해주세요.";
  return null;
}

export function OwnershipClaimForm({
  foundItemId,
  lostReportId,
  foundItemLabel,
  onCancel,
  onSubmitted,
  onClaimUnavailable,
  onRequestRefresh,
}: {
  foundItemId: number;
  lostReportId: number;
  foundItemLabel: string;
  onCancel: () => void;
  onSubmitted: () => void;
  onClaimUnavailable: () => void;
  onRequestRefresh: () => void;
}) {
  const [verificationDetails, setVerificationDetails] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitErrorStatus, setSubmitErrorStatus] = useState<number | null>(null);
  const [createdClaim, setCreatedClaim] = useState<OwnershipClaimResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const trimmedLength = verificationDetails.trim().length;
  const fieldErrorId = `ownership-claim-${foundItemId}-${lostReportId}-error`;
  const helpId = `ownership-claim-${foundItemId}-${lostReportId}-help`;
  const countId = `ownership-claim-${foundItemId}-${lostReportId}-count`;

  const updateVerificationDetails = (value: string) => {
    setVerificationDetails(value);
    setFieldError(null);
    setSubmitError(null);
    setSubmitErrorStatus(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const nextFieldError = validateVerificationDetails(verificationDetails);
    setFieldError(nextFieldError);
    setSubmitError(null);
    setSubmitErrorStatus(null);
    if (nextFieldError) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const claim = await createOwnershipClaim({
        found_item_id: foundItemId,
        lost_report_id: lostReportId,
        verification_details: verificationDetails,
      });
      setCreatedClaim(claim);
      setVerificationDetails("");
      onSubmitted();
    } catch (caught) {
      const isApiError = caught instanceof OwnershipClaimsApiError;
      setSubmitError(
        isApiError
          ? caught.message
          : "소유권 확인 요청을 보내지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.",
      );
      setSubmitErrorStatus(isApiError ? caught.status ?? null : null);
      if (isApiError && caught.status === 404) onClaimUnavailable();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (createdClaim) {
    return (
      <section className={styles.panel} aria-labelledby={`ownership-claim-success-${createdClaim.id}`}>
        <div className={styles.successIcon}>
          <Icon name="check" size={24} />
        </div>
        <p className={styles.eyebrow}>REQUEST SENT</p>
        <h3 id={`ownership-claim-success-${createdClaim.id}`}>소유권 확인 요청이 접수되었습니다.</h3>
        <p className={styles.description}>관리자 확인 절차에 사용할 검증 정보가 접수되었습니다. 승인이나 반환이 완료된 상태는 아닙니다.</p>
        <dl className={styles.summary}>
          <div>
            <dt>요청 번호</dt>
            <dd>#{createdClaim.id}</dd>
          </div>
          <div>
            <dt>현재 상태</dt>
            <dd>{getClaimStatusLabel(createdClaim.status)}</dd>
          </div>
          <div>
            <dt>접수 시각</dt>
            <dd><time dateTime={createdClaim.created_at}>{formatDateTime(createdClaim.created_at)}</time></dd>
          </div>
        </dl>
        <button className="button button-secondary" type="button" onClick={onCancel}>닫기</button>
      </section>
    );
  }

  return (
    <form className={styles.panel} onSubmit={handleSubmit} noValidate>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>OWNERSHIP CLAIM</p>
          <h3>소유권 확인 요청</h3>
        </div>
        <button type="button" onClick={onCancel} disabled={submitting} aria-label="소유권 확인 요청 입력 닫기">
          <Icon name="close" size={20} />
        </button>
      </div>

      <p className={styles.description}>
        <strong>{foundItemLabel}</strong>이 내 물건이라고 판단한 근거를 적어주세요.
        이 내용은 공개 발견물 설명이 아니라 관리자 확인 절차에 사용하는 검증 정보입니다.
      </p>

      {submitError && (
        <div className={styles.alert} role="alert">
          <Icon name="spark" size={20} />
          <div>
            <strong>{submitError}</strong>
            {submitErrorStatus === 401 && <Link href="/login">로그인하러 가기</Link>}
            {submitErrorStatus === 404 && (
              <button type="button" onClick={onRequestRefresh}>목록 새로고침</button>
            )}
          </div>
        </div>
      )}

      <label className={styles.field} htmlFor={`ownership-claim-${foundItemId}-${lostReportId}`}>
        <span>관리자 확인용 비공개 특징 <em>필수</em></span>
        <textarea
          id={`ownership-claim-${foundItemId}-${lostReportId}`}
          value={verificationDetails}
          onChange={(event) => updateVerificationDetails(event.target.value)}
          placeholder="예: 안쪽 라벨의 문구, 특정 포켓 위치, 부착된 스티커나 흠집처럼 본인만 설명할 수 있는 특징"
          rows={5}
          maxLength={MAX_VERIFICATION_LENGTH + 1}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={`${helpId} ${countId}${fieldError ? ` ${fieldErrorId}` : ""}`}
          required
        />
        <b id={helpId}>비밀번호, 주민등록번호, 금융정보 등 민감한 개인정보는 입력하지 마세요.</b>
        <small id={countId}>{trimmedLength} / {MAX_VERIFICATION_LENGTH}자</small>
        {fieldError && <small id={fieldErrorId} className={styles.fieldError}>{fieldError}</small>}
      </label>

      <div className={styles.actions}>
        <button className="button button-secondary" type="button" onClick={onCancel} disabled={submitting}>
          요청 취소
        </button>
        <button className="button button-primary" type="submit" disabled={submitting}>
          {submitting ? "요청 중..." : "확인 요청 보내기"} <Icon name="arrow" size={17} />
        </button>
      </div>
    </form>
  );
}
