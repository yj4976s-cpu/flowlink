"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  generateAdminOperationsBriefing,
  getAdminAiReport,
  getAdminOperationsBriefingStatus,
  type AdminAiReport,
  type AdminOperationsBriefing,
  type AdminOperationsBriefingStatus,
} from "@/lib/adminAiReportApi";
import { getAdminModelComparison, getAdminModelDeployment, type AdminModelComparison, type AdminModelDeploymentStatus } from "@/lib/adminModelComparisonApi";
import { modelComparisonStatusView } from "@/components/admin/model-comparison/modelComparisonViewState";
import { adminOperationsBriefingFallbackTasks, geminiBriefingLabel } from "./adminAiReportViewState";
import styles from "./AdminAiReportClient.module.css";

function isAbortError(reason: unknown) { return reason instanceof DOMException && reason.name === "AbortError"; }
function confidenceValue(value: string | null) { return value == null ? null : Number(value); }
function confidence(value: string | null) { const parsed = confidenceValue(value); return parsed == null || Number.isNaN(parsed) ? "–" : `${(parsed * 100).toFixed(1)}%`; }
function percent(value: number, max: number) { return `${Math.max(0, Math.min(100, max > 0 ? value / max * 100 : 0))}%`; }
function dateTime(value: string) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }

export function AdminAiReportClient() {
  const [report, setReport] = useState<AdminAiReport | null>(null);
  const [briefing, setBriefing] = useState<AdminOperationsBriefing | null>(null);
  const [briefingStatus, setBriefingStatus] = useState<AdminOperationsBriefingStatus | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState("");
  const [modelComparison, setModelComparison] = useState<AdminModelComparison | null>(null);
  const [modelDeployment, setModelDeployment] = useState<AdminModelDeploymentStatus | null>(null);
  const [modelComparisonLoading, setModelComparisonLoading] = useState(true);
  const [modelComparisonError, setModelComparisonError] = useState(false);
  const [modelDeploymentLoading, setModelDeploymentLoading] = useState(true);
  const [modelDeploymentError, setModelDeploymentError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const applyRequest = (signal?: AbortSignal) => getAdminAiReport(signal).then(setReport).catch((reason: unknown) => { if (!isAbortError(reason)) setError("AI 운영 분석 데이터를 불러오지 못했습니다."); }).finally(() => { if (!signal?.aborted) setLoading(false); });
  const retry = () => { setLoading(true); setError(""); void applyRequest(); };
  useEffect(() => { const controller = new AbortController(); void applyRequest(controller.signal); return () => controller.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    getAdminOperationsBriefingStatus(controller.signal).then(setBriefingStatus).catch((reason: unknown) => {
      if (!isAbortError(reason)) setBriefingStatus(null);
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    getAdminModelComparison(controller.signal)
      .then((comparisonPayload) => {
        setModelComparison(comparisonPayload);
        setModelComparisonError(false);
      })
      .catch((reason: unknown) => {
        if (!isAbortError(reason)) setModelComparisonError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setModelComparisonLoading(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    getAdminModelDeployment(controller.signal)
      .then((deploymentPayload) => {
        setModelDeployment(deploymentPayload);
        setModelDeploymentError(false);
      })
      .catch((reason: unknown) => {
        if (!isAbortError(reason)) setModelDeploymentError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setModelDeploymentLoading(false);
      });
    return () => controller.abort();
  }, []);
  const requestBriefing = () => {
    setBriefingLoading(true);
    setBriefingError("");
    generateAdminOperationsBriefing()
      .then((payload) => { setBriefing(payload); setBriefingStatus(payload); })
      .catch((reason: unknown) => setBriefingError(reason instanceof Error ? reason.message : "운영 AI 브리핑을 생성하지 못했습니다."))
      .finally(() => setBriefingLoading(false));
  };

  return <main className={styles.page}>
    <header className={styles.intro}>
      <div><p>ADMIN · AI OPERATIONS</p><h1>AI 운영 분석</h1><span>AI 탐지 신뢰도와 관리자 검토 데이터를 기반으로 운영 품질과 취약 클래스를 확인하세요.</span></div>
      <small>전체 운영 탐지 데이터 기준</small>
    </header>
    <OperationsBriefing briefing={briefing} status={briefingStatus} loading={briefingLoading} error={briefingError} onGenerate={requestBriefing} />
    {loading ? <ReportState loading /> : error ? <ReportState error={error} retry={retry} /> : !report || report.summary.total === 0 ? <EmptyReport /> : <Report report={report} modelComparison={modelComparison} modelDeployment={modelDeployment} modelComparisonLoading={modelComparisonLoading} modelComparisonError={modelComparisonError} modelDeploymentLoading={modelDeploymentLoading} modelDeploymentError={modelDeploymentError} />}
  </main>;
}

function OperationsBriefing({ briefing, status, loading, error, onGenerate }: { briefing: AdminOperationsBriefing | null; status: AdminOperationsBriefingStatus | null; loading: boolean; error: string; onGenerate: () => void }) {
  const metrics = briefing?.metrics;
  const tasks = briefing?.tasks ?? adminOperationsBriefingFallbackTasks;
  const geminiLabel = geminiBriefingLabel(status);
  return <section className={`${styles.panel} ${styles.briefing}`} aria-label="운영 AI 브리핑">
    <div className={styles.briefingHead}>
      <div className={styles.panelTitle}>
        <span>OPERATIONS BRIEFING</span>
        <h2>운영 AI 브리핑</h2>
        <p>관리자가 버튼을 누를 때만 요약을 생성합니다. Gemini가 불안정하면 같은 운영 지표로 안전한 규칙 기반 요약을 보여줘요.</p>
      </div>
      <div className={styles.briefingActions}>
        <small data-connected={status?.gemini_connected || undefined}>{geminiLabel}{status?.model ? ` · ${status.model}` : ""}</small>
        <button type="button" onClick={onGenerate} disabled={loading}>{loading ? "요약 생성 중" : briefing ? "다시 요약하기" : "AI 운영 요약 생성"}</button>
      </div>
    </div>
    {error && <p className={styles.briefingError} role="alert">{error}</p>}
    {briefing ? <>
      <p className={styles.briefingSummary}>{briefing.summary}</p>
      <div className={styles.briefingMetrics}>
        {tasks.map((task) => <Link key={task.key} href={task.href}><span>{task.label}</span><strong>{task.count}건</strong></Link>)}
        <article><span>평균 탐지 신뢰도</span><strong>{confidence(metrics?.average_confidence ?? null)}</strong></article>
      </div>
      <div className={styles.briefingFoot}>
        <span>우선 처리 작업: <b>{briefing.priority_task ? `${briefing.priority_task.label} ${briefing.priority_task.count}건` : "대기 작업 없음"}</b></span>
        <time dateTime={briefing.generated_at}>마지막 요약 시각: {dateTime(briefing.generated_at)}</time>
      </div>
      {briefing.fallback_used && <p className={styles.briefingNotice}>Gemini 응답 대신 운영 지표 기반 안전 요약을 표시 중입니다.</p>}
    </> : <div className={styles.briefingEmpty}>
      <Icon name="spark" size={24} />
      <strong>오늘 운영 브리핑을 아직 생성하지 않았어요.</strong>
      <span>버튼을 누르면 대기 작업과 평균 신뢰도를 기준으로 오늘 우선순위를 정리합니다.</span>
    </div>}
  </section>;
}

function Report({ report, modelComparison, modelDeployment, modelComparisonLoading, modelComparisonError, modelDeploymentLoading, modelDeploymentError }: { report: AdminAiReport; modelComparison: AdminModelComparison | null; modelDeployment: AdminModelDeploymentStatus | null; modelComparisonLoading: boolean; modelComparisonError: boolean; modelDeploymentLoading: boolean; modelDeploymentError: boolean }) {
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

    <ModelComparisonStatus comparison={modelComparison} deployment={modelDeployment} comparisonLoading={modelComparisonLoading} comparisonError={modelComparisonError} deploymentLoading={modelDeploymentLoading} deploymentError={modelDeploymentError} />
  </>;
}

function ModelComparisonStatus({ comparison, deployment, comparisonLoading, comparisonError, deploymentLoading, deploymentError }: { comparison: AdminModelComparison | null; deployment: AdminModelDeploymentStatus | null; comparisonLoading: boolean; comparisonError: boolean; deploymentLoading: boolean; deploymentError: boolean }) {
  const status = modelComparisonStatusView(comparison, { loading: comparisonLoading, error: comparisonError });
  const jsonRuntimeMismatch = Boolean(
    comparison?.current_deployed_model_id
    && deployment?.active_model_id
    && comparison.current_deployed_model_id !== deployment.active_model_id,
  );
  const runtimeTitle = deploymentLoading
    ? "Backend-AI runtime 상태를 확인하고 있습니다."
    : deployment?.active_display_name ? `${deployment.active_display_name} 운영 중` : status.title;
  const runtimeDescription = deployment
    ? `Backend-AI runtime 기준 활성 모델입니다. 활성 클래스: ${deployment.active_classes.join(", ") || "확인 중"}`
    : status.description;
  const warning = deployment?.audit_warning
    ?? (jsonRuntimeMismatch ? "실제 운영 모델과 평가 JSON의 배포 메모가 다릅니다. 운영 상태는 Backend-AI runtime을 기준으로 표시합니다." : "");
  return <section className={`${styles.panel} ${styles.modelEmpty}`} data-tone={status.tone} aria-label="모델 비교 상태">
    <Icon name="layers" size={30} />
    <div>
      <h2>{runtimeTitle}</h2>
      <p>{deploymentError ? "Backend-AI runtime 상태 확인에 실패했습니다. 특정 모델이 현재 운영 중이라고 단정하지 않습니다." : runtimeDescription}</p>
      {comparisonError && deployment && <p>평가 데이터만 불러오지 못했습니다. 현재 운영 모델 상태는 Backend-AI runtime 기준으로 표시합니다.</p>}
      {warning && <p role="alert">{warning}</p>}
      <Link href="/admin/model-comparison">{status.actionLabel}<Icon name="arrow" size={13} /></Link>
    </div>
  </section>;
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
