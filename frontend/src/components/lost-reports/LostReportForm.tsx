"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  createLostReport,
  LostReportResponse,
  LostReportsApiError,
  type LostReportCreateRequest,
} from "@/lib/lostReportsApi";
import styles from "./LostReportForm.module.css";

type FormData = {
  item_category: string;
  color: string;
  description: string;
  lost_location: string;
  lost_at: string;
};

type FieldErrors = Partial<Record<keyof FormData, string>>;

const emptyFormData: FormData = {
  item_category: "",
  color: "",
  description: "",
  lost_location: "",
  lost_at: "",
};

const itemCategories = [
  { code: "BALL", label: "공" },
  { code: "BAG", label: "가방" },
  { code: "UMBRELLA", label: "우산" },
  { code: "FOOTWEAR", label: "신발·슬리퍼류" },
] as const;

const reportStatusLabel: Record<string, string> = {
  OPEN: "접수됨",
  MATCHED: "매칭 후보 확인 중",
  CLAIM_PENDING: "소유권 확인 중",
  RESOLVED: "처리 완료",
  CANCELLED: "취소됨",
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "일시 확인 중" : dateFormatter.format(date);
}

function getReportStatusLabel(status: string) {
  return reportStatusLabel[status] ?? status;
}

function parseLostAt(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateForm(formData: FormData) {
  const errors: FieldErrors = {};
  const lostAt = parseLostAt(formData.lost_at);

  if (!formData.item_category) errors.item_category = "분실 물품 종류를 선택해주세요.";
  if (!formData.description.trim()) errors.description = "물품 특징을 입력해주세요.";
  if (!formData.lost_location.trim()) errors.lost_location = "분실 위치를 입력해주세요.";
  if (formData.lost_location.trim().length > 100) errors.lost_location = "분실 위치는 100자 이내로 입력해주세요.";
  if (formData.color.trim().length > 50) errors.color = "색상은 50자 이내로 입력해주세요.";
  if (!formData.lost_at) {
    errors.lost_at = "분실 시각을 입력해주세요.";
  } else if (!lostAt) {
    errors.lost_at = "유효한 분실 시각을 입력해주세요.";
  } else if (lostAt.getTime() > Date.now()) {
    errors.lost_at = "분실 시각은 미래일 수 없습니다.";
  }

  return { errors, lostAt };
}

function createRequest(formData: FormData, lostAt: Date): LostReportCreateRequest {
  return {
    item_category: formData.item_category,
    color: formData.color.trim() || null,
    description: formData.description.trim(),
    lost_location: formData.lost_location.trim(),
    lost_at: lostAt.toISOString(),
  };
}

function SuccessPanel({ report, onReset }: { report: LostReportResponse; onReset: () => void }) {
  return (
    <section className={styles.successCard} aria-labelledby="lost-report-success-title">
      <span className={styles.successIcon}><Icon name="check" size={28} /></span>
      <p className={styles.eyebrow}>REPORT CREATED</p>
      <h2 id="lost-report-success-title">분실 신고가 등록되었습니다.</h2>
      <p>입력한 정보를 바탕으로 공개 발견물 후보와 비교됩니다. 동일 물품 여부는 이후 확인 절차를 거쳐 판단됩니다.</p>
      <dl className={styles.summaryList}>
        <div>
          <dt>신고 번호</dt>
          <dd>#{report.id}</dd>
        </div>
        <div>
          <dt>물품 종류</dt>
          <dd>{report.item_category_name}</dd>
        </div>
        <div>
          <dt>분실 위치</dt>
          <dd>{report.area_name}</dd>
        </div>
        <div>
          <dt>분실 시각</dt>
          <dd><time dateTime={report.lost_from}>{formatDateTime(report.lost_from)}</time></dd>
        </div>
        <div>
          <dt>현재 상태</dt>
          <dd>{getReportStatusLabel(report.status)}</dd>
        </div>
      </dl>
      <div className={styles.successActions}>
        <Link className="button button-primary" href="/found-items">발견물 둘러보기 <Icon name="arrow" size={17} /></Link>
        <button className="button button-secondary" type="button" onClick={onReset}>새 신고 작성</button>
      </div>
    </section>
  );
}

export function LostReportForm() {
  const [formData, setFormData] = useState<FormData>(emptyFormData);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitErrorStatus, setSubmitErrorStatus] = useState<number | null>(null);
  const [createdReport, setCreatedReport] = useState<LostReportResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError(null);
    setSubmitErrorStatus(null);
  };

  const resetForm = () => {
    setFormData(emptyFormData);
    setFieldErrors({});
    setSubmitError(null);
    setSubmitErrorStatus(null);
    setCreatedReport(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const { errors, lostAt } = validateForm(formData);
    setFieldErrors(errors);
    setSubmitError(null);
    setSubmitErrorStatus(null);
    setCreatedReport(null);
    if (Object.keys(errors).length > 0 || !lostAt) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const report = await createLostReport(createRequest(formData, lostAt));
      setCreatedReport(report);
    } catch (caught) {
      const isApiError = caught instanceof LostReportsApiError;
      const message = isApiError
        ? caught.message
        : "분실 신고를 등록하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.";
      setSubmitError(message);
      setSubmitErrorStatus(isApiError ? caught.status ?? null : null);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const getErrorId = (field: keyof FormData) => `lost-report-${field}-error`;

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="lost-report-title">
        <div>
          <p className={styles.eyebrow}>LOST REPORT</p>
          <h1 id="lost-report-title">분실 신고</h1>
          <p>잃어버린 물건의 특징과 마지막으로 확인한 위치를 알려주세요.</p>
        </div>
        <aside className={styles.heroNote} aria-label="분실 신고 안내">
          <span><Icon name="document" size={18} /> 특징은 자세할수록 좋아요</span>
          <span><Icon name="location" size={18} /> 위치는 기억나는 범위까지만</span>
          <span><Icon name="match" size={18} /> 공개 발견물 후보와 비교</span>
        </aside>
      </section>

      <div className={styles.layout}>
        <section className={styles.formCard} aria-labelledby="lost-report-form-title">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>REPORT FORM</p>
            <h2 id="lost-report-form-title">신고 정보 입력</h2>
          </div>

          {createdReport ? (
            <SuccessPanel report={createdReport} onReset={resetForm} />
          ) : (
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              {submitError && (
                <div className={styles.alert} role="alert">
                  <Icon name="spark" size={22} />
                  <div>
                    <strong>{submitError}</strong>
                    {submitErrorStatus === 401 && <Link href="/login?next=%2Flost-reports%2Fnew">로그인하러 가기</Link>}
                  </div>
                </div>
              )}

              <label className={styles.field} htmlFor="lost-report-item-category">
                <span>분실 물품 종류 <em>필수</em></span>
                <select
                  id="lost-report-item-category"
                  value={formData.item_category}
                  onChange={(event) => updateField("item_category", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.item_category)}
                  aria-describedby={fieldErrors.item_category ? getErrorId("item_category") : undefined}
                  required
                >
                  <option value="">물품 종류를 선택해주세요</option>
                  {itemCategories.map((item) => (
                    <option key={item.code} value={item.code}>{item.label}</option>
                  ))}
                </select>
                {fieldErrors.item_category && <small id={getErrorId("item_category")}>{fieldErrors.item_category}</small>}
              </label>

              <label className={styles.field} htmlFor="lost-report-color">
                <span>색상 <i>선택</i></span>
                <input
                  id="lost-report-color"
                  value={formData.color}
                  onChange={(event) => updateField("color", event.target.value)}
                  maxLength={50}
                  placeholder="예: 검정"
                  aria-invalid={Boolean(fieldErrors.color)}
                  aria-describedby={fieldErrors.color ? getErrorId("color") : undefined}
                />
                {fieldErrors.color && <small id={getErrorId("color")}>{fieldErrors.color}</small>}
              </label>

              <label className={`${styles.field} ${styles.fullField}`} htmlFor="lost-report-description">
                <span>물품 설명 <em>필수</em></span>
                <textarea
                  id="lost-report-description"
                  value={formData.description}
                  onChange={(event) => updateField("description", event.target.value)}
                  placeholder="예: 검정 백팩, 앞주머니에 키링이 있음"
                  rows={5}
                  aria-invalid={Boolean(fieldErrors.description)}
                  aria-describedby={fieldErrors.description ? getErrorId("description") : "lost-report-description-help"}
                  required
                />
                <b id="lost-report-description-help">관리자가 소유권 확인에 참고할 수 있는 특징을 적어주세요.</b>
                {fieldErrors.description && <small id={getErrorId("description")}>{fieldErrors.description}</small>}
              </label>

              <label className={styles.field} htmlFor="lost-report-location">
                <span>분실 위치 <em>필수</em></span>
                <input
                  id="lost-report-location"
                  value={formData.lost_location}
                  onChange={(event) => updateField("lost_location", event.target.value)}
                  maxLength={100}
                  placeholder="예: 잠실 한강공원 자전거도로 인근"
                  aria-invalid={Boolean(fieldErrors.lost_location)}
                  aria-describedby={fieldErrors.lost_location ? getErrorId("lost_location") : undefined}
                  required
                />
                {fieldErrors.lost_location && <small id={getErrorId("lost_location")}>{fieldErrors.lost_location}</small>}
              </label>

              <label className={styles.field} htmlFor="lost-report-lost-at">
                <span>분실 시각 <em>필수</em></span>
                <input
                  id="lost-report-lost-at"
                  type="datetime-local"
                  value={formData.lost_at}
                  onChange={(event) => updateField("lost_at", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.lost_at)}
                  aria-describedby={fieldErrors.lost_at ? getErrorId("lost_at") : "lost-report-lost-at-help"}
                  required
                />
                <b id="lost-report-lost-at-help">입력한 현지 시각을 서버가 인식할 수 있는 형식으로 변환해 전송합니다.</b>
                {fieldErrors.lost_at && <small id={getErrorId("lost_at")}>{fieldErrors.lost_at}</small>}
              </label>

              <div className={styles.actions}>
                <button className="button button-primary" type="submit" disabled={submitting}>
                  {submitting ? "등록 중..." : "분실 신고 등록"} <Icon name="arrow" size={18} />
                </button>
                <button className="button button-secondary" type="button" onClick={resetForm} disabled={submitting}>
                  입력 초기화
                </button>
              </div>
            </form>
          )}
        </section>

        <aside className={styles.guideCard} aria-labelledby="lost-report-guide-title">
          <span className={styles.guideIcon}><Icon name="scan" size={24} /></span>
          <p className={styles.eyebrow}>HOW IT WORKS</p>
          <h2 id="lost-report-guide-title">등록 후에는 이렇게 확인돼요</h2>
          <ul>
            <li>신고 내용은 공개 발견물 후보와 비교됩니다.</li>
            <li>자동 매칭은 참고 정보이며 동일 물품임을 확정하지 않습니다.</li>
            <li>정확한 특징과 시간·위치는 관리자 확인에 도움이 됩니다.</li>
          </ul>
        </aside>
      </div>
    </main>
  );
}
