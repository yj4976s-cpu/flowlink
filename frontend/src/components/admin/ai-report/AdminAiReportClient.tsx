"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { getAdminAiReportModelStatusView } from "@/components/admin/model-comparison/modelComparisonViewState";
import {
  ADMIN_REPORT_PERIODS,
  adminOperationsBriefingFallbackTasks,
  buildSvgTrendPath,
  formatAdminReportDate,
  geminiBriefingLabel,
  getTrendChartMax,
  safePercent,
  shouldShowTrendLabel,
  type AdminReportPeriod,
} from "./adminAiReportViewState";
import styles from "./AdminAiReportClient.module.css";

function isAbortError(reason: unknown) { return reason instanceof DOMException && reason.name === "AbortError"; }
function confidenceValue(value: string | null) { return value == null ? null : Number(value); }
function confidence(value: string | null) { const parsed = confidenceValue(value); return parsed == null || Number.isNaN(parsed) ? "측정 전" : `${(parsed * 100).toFixed(1)}%`; }
function percent(value: number, max: number) { return `${safePercent(value, max)}%`; }
function dateTime(value: string) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function dateRange(report: AdminAiReport) { return `${dateTime(report.period_start)} ~ ${dateTime(report.period_end)}`; }

export function AdminAiReportClient() {
  const [period, setPeriod] = useState<AdminReportPeriod>(30);
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
  const [reloadCount, setReloadCount] = useState(0);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    Promise.resolve().then(() => {
      if (!controller.signal.aborted && requestSeqRef.current === requestId) {
        setLoading(true);
        setError("");
      }
    });
    getAdminAiReport(period, controller.signal)
      .then((payload) => {
        if (requestSeqRef.current === requestId) setReport(payload);
      })
      .catch((reason: unknown) => {
        if (!isAbortError(reason) && requestSeqRef.current === requestId) setError("AI 운영 분석 데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted && requestSeqRef.current === requestId) setLoading(false);
      });
    return () => controller.abort();
  }, [period, reloadCount]);

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
  const retry = () => setReloadCount((current) => current + 1);

  return <main className={styles.page} data-admin-ai-report="true">
    <header className={styles.intro}>
      <div>
        <p>ADMIN · OPERATIONS REPORT</p>
        <h1>관리자 AI·운영 보고서</h1>
        <span>실제 DB 집계로 운영 탐지, 검토, 발견물 등록, 매칭, 반환 흐름을 확인합니다. LLM은 숫자를 만드는 용도가 아니라 이미 집계된 운영 지표를 문장으로 요약할 때만 사용합니다.</span>
      </div>
      <div className={styles.headerActions} data-print-hidden="true">
        <Link href="/admin">관리자 대시보드 <Icon name="arrow" size={13} /></Link>
        <Link href="/admin/model-comparison">모델 비교 <Icon name="arrow" size={13} /></Link>
        <button type="button" onClick={() => window.print()}>PDF로 저장</button>
      </div>
    </header>

    <section className={styles.toolbar} aria-label="보고서 기간 선택" data-print-hidden="true">
      <div>
        {ADMIN_REPORT_PERIODS.map((value) => (
          <button key={value} type="button" onClick={() => setPeriod(value)} aria-pressed={period === value}>
            최근 {value}일
          </button>
        ))}
      </div>
      <p>기간 통계는 KST 달력일 기준이며, 현재 대기 업무는 기간 집계가 아닌 지금 남아 있는 backlog입니다.</p>
    </section>

    <OperationsBriefing briefing={briefing} status={briefingStatus} loading={briefingLoading} error={briefingError} onGenerate={requestBriefing} />

    {loading ? <ReportState loading /> : error ? <ReportState error={error} retry={retry} /> : report ? (
      <Report
        report={report}
        modelComparison={modelComparison}
        modelDeployment={modelDeployment}
        modelComparisonLoading={modelComparisonLoading}
        modelComparisonError={modelComparisonError}
        modelDeploymentLoading={modelDeploymentLoading}
        modelDeploymentError={modelDeploymentError}
      />
    ) : <ReportState error="표시할 보고서 데이터가 없습니다." retry={retry} />}
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
        <h2>오늘 운영 브리핑</h2>
        <p>관리자가 버튼을 누를 때만 요약합니다. Gemini가 불안정하면 같은 운영 지표를 사용한 규칙 기반 요약으로 안전하게 대체합니다.</p>
      </div>
      <div className={styles.briefingActions} data-print-hidden="true">
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
      <span>PDF 저장은 화면에 실제 생성된 브리핑만 포함합니다. 저장을 위해 자동으로 Gemini API를 호출하지 않습니다.</span>
    </div>}
  </section>;
}

function Report({ report, modelComparison, modelDeployment, modelComparisonLoading, modelComparisonError, modelDeploymentLoading, modelDeploymentError }: { report: AdminAiReport; modelComparison: AdminModelComparison | null; modelDeployment: AdminModelDeploymentStatus | null; modelComparisonLoading: boolean; modelComparisonError: boolean; modelDeploymentLoading: boolean; modelDeploymentError: boolean }) {
  const maxClassCount = Math.max(1, ...report.class_metrics.map((item) => item.count));
  const reviewedRate = safePercent(report.summary.reviewed, report.summary.total);
  const correctionRate = safePercent(report.summary.corrected, report.summary.reviewed);
  const hasData = report.operation_summary.operation_detection_events > 0 || report.operation_summary.detected_objects > 0 || report.operation_summary.official_found_items > 0;
  const insights = useMemo(() => {
    const measurable = report.class_metrics.filter((item) => item.average_confidence != null);
    return {
      lowest: [...measurable].sort((a, b) => Number(a.average_confidence) - Number(b.average_confidence))[0],
      strongest: [...measurable].sort((a, b) => Number(b.average_confidence) - Number(a.average_confidence))[0],
      corrected: [...report.class_metrics].filter((item) => item.corrected > 0).sort((a, b) => b.corrected - a.corrected)[0],
    };
  }, [report]);

  return <>
    <section className={styles.periodMeta} aria-label="보고서 조회 기준">
      <span>조회 기간</span>
      <strong>{dateRange(report)}</strong>
      <time dateTime={report.generated_at}>마지막 집계 시각 {dateTime(report.generated_at)}</time>
    </section>

    {!hasData && <section className={styles.emptyBanner} role="status">선택한 기간에 집계할 운영 데이터가 없습니다. 차트는 기간 전체를 0으로 채워 표시합니다.</section>}

    <section className={styles.heroGrid} aria-label="AI 운영 핵심 지표">
      <Metric tone="primary" label="운영 탐지 이벤트" value={`${report.operation_summary.operation_detection_events}건`} note="OPERATION 목적 탐지 이벤트" />
      <Metric tone="confidence" label="탐지 객체" value={`${report.operation_summary.detected_objects}개`} note="운영 탐지 객체 합계" />
      <Metric tone="review" label="관리자 검토율" value={`${reviewedRate.toFixed(0)}%`} note={`${report.summary.reviewed}건 검토 완료`} />
      <Metric tone="correction" label="검토 후 변경률" value={`${correctionRate.toFixed(0)}%`} note={`${report.summary.corrected}건 클래스 변경`} />
      <Metric tone="found" label="공식 발견물" value={`${report.operation_summary.official_found_items}건`} note="공개 가능한 개인 물품 기준" />
      <Metric tone="match" label="매칭 후보" value={`${report.operation_summary.match_candidates}건`} note="기간 내 생성된 후보" />
      <Metric tone="return" label="반환 완료" value={`${report.operation_summary.returned_items}건`} note="소유자 반환 완료" />
      <Metric tone="confidence" label="평균 신뢰도" value={confidence(report.operation_summary.average_confidence)} note="물품 일치 확률이 아닌 모델 분류 신뢰도" />
    </section>

    <section className={styles.queueGrid} aria-label="현재 처리 대기 업무">
      <div className={styles.panelTitle}><span>CURRENT BACKLOG</span><h2>현재 처리 대기 업무</h2><p>아래 수치는 선택 기간 발생량이 아니라 지금 남아 있는 관리자 처리 대기 상태입니다.</p></div>
      <div>
        {report.queue_tasks.map((task) => (
          <Link key={task.key} href={task.href} className={styles.queueCard}>
            <span>{task.label}</span>
            <strong>{task.count}건</strong>
            <em>{task.count > 0 ? "업무 화면으로 이동" : "현재 대기 없음"}</em>
          </Link>
        ))}
      </div>
    </section>

    <section className={styles.overview}>
      <article className={styles.spotlight}>
        <span>QUICK READ</span>
        <h2>운영 품질 신호</h2>
        <div>
          {insights.strongest && <p><b>가장 안정적인 클래스</b><strong>{insights.strongest.name}</strong><em>{confidence(insights.strongest.average_confidence)}</em></p>}
          {insights.lowest && <p><b>우선 점검할 클래스</b><strong>{insights.lowest.name}</strong><em>{confidence(insights.lowest.average_confidence)}</em></p>}
          {insights.corrected ? <p><b>수정이 많은 클래스</b><strong>{insights.corrected.name}</strong><em>{insights.corrected.corrected}건</em></p> : <p><b>수정 패턴</b><strong>클래스 변경 없음</strong><em>안정</em></p>}
        </div>
      </article>
      <DailyTrendChart report={report} />
    </section>

    <section className={styles.chartGrid}>
      <ClassDistribution data={report.class_metrics} maxCount={maxClassCount} />
      <Distribution data={report.confidence_distribution} />
    </section>

    <section className={styles.panel}>
      <div className={styles.panelTitle}><span>OPERATION FLOW</span><h2>운영 단계별 처리 건수</h2><p>시각 수치는 선택 기간 기록의 단계별 운영 건수이며, 동일 물건 집단의 정확한 전환율을 의미하지 않습니다.</p></div>
      <OperationFlow data={report.operation_flow} />
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div className={styles.panelTitle}><span>REVIEW PATTERN</span><h2>관리자 수정 패턴</h2><p>AI 예측과 관리자 최종 확정 클래스가 달랐던 운영 기록입니다.</p></div><Link href="/admin/detections">탐지 검토 <Icon name="arrow" size={13} /></Link></div>
      <CorrectionPatterns data={report.correction_patterns} />
    </section>

    <ModelComparisonStatus comparison={modelComparison} deployment={modelDeployment} comparisonLoading={modelComparisonLoading} comparisonError={modelComparisonError} deploymentLoading={modelDeploymentLoading} deploymentError={modelDeploymentError} />
  </>;
}

function ModelComparisonStatus({ comparison, deployment, comparisonLoading, comparisonError, deploymentLoading, deploymentError }: { comparison: AdminModelComparison | null; deployment: AdminModelDeploymentStatus | null; comparisonLoading: boolean; comparisonError: boolean; deploymentLoading: boolean; deploymentError: boolean }) {
  const status = getAdminAiReportModelStatusView({
    comparison,
    deployment,
    comparisonLoading,
    comparisonError,
    deploymentLoading,
    deploymentError,
  });
  return <section className={`${styles.panel} ${styles.modelEmpty}`} data-tone={status.tone} aria-label="모델 비교 상태">
    <Icon name="layers" size={30} />
    <div>
      <h2>{status.title}</h2>
      <p>{status.description}</p>
      {status.warning && <p role="alert">{status.warning}</p>}
      <Link href="/admin/model-comparison">{status.actionLabel}<Icon name="arrow" size={13} /></Link>
    </div>
  </section>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className={styles.metric} data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function DailyTrendChart({ report }: { report: AdminAiReport }) {
  const keys = ["detection_count", "detected_object_count", "found_item_count", "match_count", "returned_count"];
  const max = getTrendChartMax(report.daily_trend, keys);
  const series = [
    { key: "detection_count", label: "탐지 이벤트", className: styles.seriesDetection },
    { key: "detected_object_count", label: "탐지 객체", className: styles.seriesObject },
    { key: "found_item_count", label: "공식 발견물", className: styles.seriesFound },
    { key: "match_count", label: "매칭 후보", className: styles.seriesMatch },
    { key: "returned_count", label: "반환 완료", className: styles.seriesReturn },
  ];
  return <section className={`${styles.panel} ${styles.trendPanel}`}>
    <div className={styles.panelTitle}><span>DAILY TREND</span><h2>일별 운영 추이</h2><p>빠진 날짜는 0으로 채워 기간 흐름을 그대로 보여줍니다.</p></div>
    <div className={styles.trendLegend}>
      {series.map((item) => <span key={item.key} className={item.className}>{item.label}</span>)}
    </div>
    <svg className={styles.trendChart} viewBox="0 0 720 260" role="img" aria-label={`최근 ${report.period_days}일 운영 추이 차트, 최대값 ${max}`}>
      <g className={styles.gridLines} aria-hidden="true">
        {[0, 1, 2, 3].map((line) => <line key={line} x1="0" x2="720" y1={20 + line * 60} y2={20 + line * 60} />)}
      </g>
      {series.map((item) => <path key={item.key} className={item.className} d={buildSvgTrendPath(report.daily_trend, item.key, max, 720, 210)} fill="none" />)}
      {report.daily_trend.map((point, index) => {
        if (!shouldShowTrendLabel(index, report.daily_trend.length)) return null;
        const x = report.daily_trend.length > 1 ? index * (720 / (report.daily_trend.length - 1)) : 0;
        return <g key={point.date} transform={`translate(${x} 232)`}>
          <text aria-hidden="true">{formatAdminReportDate(point.date)}</text>
        </g>;
      })}
    </svg>
  </section>;
}

function ClassDistribution({ data, maxCount }: { data: AdminAiReport["class_metrics"]; maxCount: number }) {
  return <section className={styles.panel}>
    <div className={styles.panelTitle}><span>CLASS MIX</span><h2>클래스별 탐지 분포</h2><p>실제 탐지 건수, 비율, 평균 신뢰도를 함께 표시합니다.</p></div>
    {data.length ? <div className={styles.classGrid}>{data.map((item) => {
      const confidenceScore = confidenceValue(item.average_confidence) ?? 0;
      return <article key={item.code} className={styles.classCard}>
        <div><strong>{item.name}</strong><small>{item.code}</small><b>{item.count}건</b></div>
        <i aria-hidden="true"><span style={{ width: percent(item.count, maxCount) }} /></i>
        <dl>
          <div><dt>평균 신뢰도</dt><dd>{confidence(item.average_confidence)}</dd></div>
          <div><dt>검토</dt><dd>{item.reviewed}건</dd></div>
          <div><dt>변경</dt><dd>{item.corrected}건</dd></div>
        </dl>
        <meter min={0} max={1} value={confidenceScore} aria-label={`${item.name} 평균 신뢰도 ${confidence(item.average_confidence)}`} />
      </article>;
    })}</div> : <p className={styles.empty}>선택한 기간에 클래스별 탐지 데이터가 없습니다.</p>}
  </section>;
}

function Distribution({ data }: { data: AdminAiReport["confidence_distribution"] }) {
  const max = Math.max(1, ...data.map((item) => item.count));
  const total = data.reduce((sum, item) => sum + item.count, 0);
  return <section className={`${styles.panel} ${styles.histogramPanel}`}>
    <div className={styles.panelTitle}><span>CONFIDENCE HISTOGRAM</span><h2>신뢰도 분포</h2><p>신뢰도는 모델의 클래스 판단 confidence이며, 실제 물품 일치 확률이나 소유권 확률이 아닙니다.</p></div>
    <div className={styles.distribution} aria-label={`Confidence 분포 총 ${total}건`}>
      {data.map((item, index) => <article key={item.key} data-band={index}>
        <strong>{item.count}</strong>
        <i aria-hidden="true"><b style={{ height: percent(item.count, max) }} /></i>
        <span>{item.label}</span>
      </article>)}
    </div>
  </section>;
}

function OperationFlow({ data }: { data: AdminAiReport["operation_flow"] }) {
  const max = Math.max(1, ...data.map((item) => item.count));
  return <div className={styles.flowChart} role="list">
    {data.map((item) => <article key={item.key} role="listitem">
      <span>{item.label}</span>
      <strong>{item.count}건</strong>
      <i aria-hidden="true"><b style={{ width: percent(item.count, max) }} /></i>
    </article>)}
  </div>;
}

function CorrectionPatterns({ data }: { data: AdminAiReport["correction_patterns"] }) {
  if (!data.length) return <p className={styles.empty}>관리자가 클래스를 변경한 운영 탐지 기록이 없습니다.</p>;
  return <div className={styles.patterns}>{data.map((item) => <article key={`${item.predicted_code}-${item.final_code}`}><span><small>AI 예측</small><strong>{item.predicted_name}<em>{item.predicted_code}</em></strong></span><b aria-hidden="true">→</b><span><small>관리자 최종 확정</small><strong>{item.final_name}<em>{item.final_code}</em></strong></span><mark>{item.count}건</mark></article>)}</div>;
}

function ReportState({ loading = false, error, retry }: { loading?: boolean; error?: string; retry?: () => void }) {
  return <section className={styles.state} role={error ? "alert" : "status"}>{loading ? <><div><i /><i /><i /></div><strong>AI 운영 데이터를 집계하고 있습니다.</strong></> : <><Icon name="info" size={25} /><strong>{error}</strong><button type="button" onClick={retry}>다시 불러오기</button></>}</section>;
}
