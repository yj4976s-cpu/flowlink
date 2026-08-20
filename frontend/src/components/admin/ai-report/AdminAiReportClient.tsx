"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { getAdminAiReport, type AdminAiReport } from "@/lib/adminAiReportApi";
import styles from "./AdminAiReportClient.module.css";

function isAbortError(reason: unknown) { return reason instanceof DOMException && reason.name === "AbortError"; }
function confidenceValue(value: string | null) { return value == null ? null : Number(value); }
function confidence(value: string | null) { const parsed = confidenceValue(value); return parsed == null || Number.isNaN(parsed) ? "–" : `${(parsed * 100).toFixed(1)}%`; }
function percent(value: number, max: number) { return `${Math.max(0, Math.min(100, max > 0 ? value / max * 100 : 0))}%`; }

export function AdminAiReportClient() {
  const [report, setReport] = useState<AdminAiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const applyRequest = (signal?: AbortSignal) => getAdminAiReport(signal).then(setReport).catch((reason: unknown) => { if (!isAbortError(reason)) setError("AI 운영 분석 데이터를 불러오지 못했습니다."); }).finally(() => { if (!signal?.aborted) setLoading(false); });
  const retry = () => { setLoading(true); setError(""); void applyRequest(); };
  useEffect(() => { const controller = new AbortController(); void applyRequest(controller.signal); return () => controller.abort(); }, []);

  return <main className={styles.page}>
    <header className={styles.intro}>
      <div><p>ADMIN · AI OPERATIONS</p><h1>AI 운영 분석</h1><span>AI 탐지 신뢰도와 관리자 검토 데이터를 기반으로 운영 품질과 취약 클래스를 확인하세요.</span></div>
      <small>전체 운영 탐지 데이터 기준</small>
    </header>
    {loading ? <ReportState loading /> : error ? <ReportState error={error} retry={retry} /> : !report || report.summary.total === 0 ? <EmptyReport /> : <Report report={report} />}
  </main>;
}

function Report({ report }: { report: AdminAiReport }) {
  const maxClassCount = Math.max(1, ...report.class_metrics.map((item) => item.count));
  const reviewedRate = report.summary.total ? Math.round(report.summary.reviewed / report.summary.total * 100) : 0;
  const correctionRate = report.summary.reviewed ? Math.round(report.summary.corrected / report.summary.reviewed * 100) : 0;
  const insights = useMemo(() => {
    const measurable = report.class_metrics.filter((item) => item.average_confidence != null);
    return {
      lowest: [...measurable].sort((a, b) => Number(a.average_confidence) - Number(b.average_confidence))[0],
      strongest: [...measurable].sort((a, b) => Number(b.average_confidence) - Number(a.average_confidence))[0],
      corrected: [...report.class_metrics].filter((item) => item.corrected > 0).sort((a, b) => b.corrected - a.corrected)[0],
    };
  }, [report]);

  return <>
    <section className={styles.heroGrid} aria-label="AI 운영 핵심 지표">
      <Metric tone="primary" label="전체 운영 탐지" value={`${report.summary.total}건`} note="OPERATION 탐지 객체" />
      <Metric tone="confidence" label="평균 신뢰도" value={confidence(report.summary.average_confidence)} note="AI 분류 confidence 평균" />
      <Metric tone="review" label="관리자 검토율" value={`${reviewedRate}%`} note={`${report.summary.reviewed}건 검토 완료`} />
      <Metric tone="correction" label="검토 후 변경률" value={`${correctionRate}%`} note={`${report.summary.corrected}건 클래스 변경`} />
    </section>

    <section className={styles.overview}>
      <article className={styles.spotlight}>
        <span>QUICK READ</span>
        <h2>오늘 봐야 할 품질 신호</h2>
        <div>
          {insights.strongest && <p><b>가장 안정적인 클래스</b><strong>{insights.strongest.name}</strong><em>{confidence(insights.strongest.average_confidence)}</em></p>}
          {insights.lowest && <p><b>우선 점검할 클래스</b><strong>{insights.lowest.name}</strong><em>{confidence(insights.lowest.average_confidence)}</em></p>}
          {insights.corrected ? <p><b>수정이 많은 클래스</b><strong>{insights.corrected.name}</strong><em>{insights.corrected.corrected}건</em></p> : <p><b>수정 패턴</b><strong>클래스 변경 없음</strong><em>안정</em></p>}
        </div>
      </article>
      <section className={`${styles.panel} ${styles.histogramPanel}`}>
        <div className={styles.panelTitle}><span>CONFIDENCE HISTOGRAM</span><h2>신뢰도 분포</h2><p>낮은 신뢰도 구간은 tangerine, 안정 구간은 cobalt로 표시해 운영 품질을 빠르게 읽을 수 있게 했습니다.</p></div>
        <Distribution data={report.confidence_distribution} />
      </section>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelTitle}><span>CLASS QUALITY</span><h2>클래스별 탐지 품질</h2><p>탐지 건수와 평균 신뢰도, 관리자 검토/수정 흐름을 한 줄 카드로 비교합니다.</p></div>
      <ClassCards data={report.class_metrics} maxCount={maxClassCount} />
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div className={styles.panelTitle}><span>REVIEW PATTERN</span><h2>관리자 수정 패턴</h2><p>AI 예측이 관리자 검토 후 다른 클래스로 확정된 기록입니다.</p></div><Link href="/admin/detections">탐지 검토<Icon name="arrow" size={13} /></Link></div>
      <CorrectionPatterns data={report.correction_patterns} />
    </section>

    <section className={`${styles.panel} ${styles.modelEmpty}`}><Icon name="layers" size={30} /><div><h2>모델 평가 데이터는 아직 별도로 연결되지 않았어요.</h2><p>현재 저장소에는 ground truth 기반 Precision, Recall, F1, mAP 또는 혼동행렬 결과가 없습니다. 실제 평가 결과가 연결되면 운영 데이터와 구분해 보여줄 수 있습니다.</p></div></section>
  </>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className={styles.metric} data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function ClassCards({ data, maxCount }: { data: AdminAiReport["class_metrics"]; maxCount: number }) {
  return <div className={styles.classGrid}>{data.map((item) => {
    const confidenceScore = confidenceValue(item.average_confidence) ?? 0;
    return <article key={item.code} className={styles.classCard}>
      <div><strong>{item.name}</strong><small>{item.code}</small><b>{item.count}건</b></div>
      <i aria-hidden="true"><span style={{ width: percent(item.count, maxCount) }} /></i>
      <dl>
        <div><dt>평균 신뢰도</dt><dd>{confidence(item.average_confidence)}</dd></div>
        <div><dt>관리자 검토</dt><dd>{item.reviewed}건</dd></div>
        <div><dt>클래스 변경</dt><dd>{item.corrected}건</dd></div>
      </dl>
      <meter min={0} max={1} value={confidenceScore} aria-label={`${item.name} 평균 신뢰도 ${confidence(item.average_confidence)}`} />
    </article>;
  })}</div>;
}

function Distribution({ data }: { data: AdminAiReport["confidence_distribution"] }) {
  const max = Math.max(1, ...data.map((item) => item.count));
  const total = data.reduce((sum, item) => sum + item.count, 0);
  return <div className={styles.distribution} aria-label={`Confidence 분포 총 ${total}건`}>
    {data.map((item, index) => <article key={item.key} data-band={index}>
      <strong>{item.count}</strong>
      <i aria-hidden="true"><b style={{ height: percent(item.count, max) }} /></i>
      <span>{item.label}</span>
    </article>)}
  </div>;
}

function CorrectionPatterns({ data }: { data: AdminAiReport["correction_patterns"] }) {
  if (!data.length) return <p className={styles.empty}>관리자가 클래스를 변경한 운영 탐지 기록이 없습니다.</p>;
  return <div className={styles.patterns}>{data.map((item) => <article key={`${item.predicted_code}-${item.final_code}`}><span><small>AI 예측</small><strong>{item.predicted_name}<em>{item.predicted_code}</em></strong></span><b aria-hidden="true">→</b><span><small>관리자 최종 확정</small><strong>{item.final_name}<em>{item.final_code}</em></strong></span><mark>{item.count}건</mark></article>)}</div>;
}

function EmptyReport() {
  return <section className={styles.state} role="status"><Icon name="scanLine" size={28} /><strong>아직 분석할 운영 탐지 데이터가 없어요.</strong><span>운영 목적 탐지 결과가 쌓이면 클래스별 품질과 confidence 분포를 확인할 수 있습니다.</span></section>;
}

function ReportState({ loading = false, error, retry }: { loading?: boolean; error?: string; retry?: () => void }) {
  return <section className={styles.state} role={error ? "alert" : "status"}>{loading ? <><div><i /><i /><i /></div><strong>AI 운영 데이터를 집계하고 있습니다.</strong></> : <><Icon name="info" size={25} /><strong>{error}</strong><button type="button" onClick={retry}>다시 불러오기</button></>}</section>;
}
