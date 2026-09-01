"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { normalizeBBox, getOverlayPercentageStyle } from "@/components/detection/detectionOverlayGeometry";
import {
  DetectionAnalysisSummary,
  DetectionApiError,
  DetectionEvent,
  DetectionSummaryPeriod,
  VideoProcessingStatus,
  getMyDetection,
  getMyDetectionSummary,
  getVideoProcessingStatus,
  resolveDetectionMediaUrl,
} from "@/lib/detectionApi";
import {
  ANALYSIS_PERIODS,
  buildClassDonutGradient,
  formatCompletionRate,
  formatMilliseconds,
  formatPercentValue,
  getCountRatioPercent,
  getDetectionReportState,
  getPrimaryClass,
  getProcessingFrameProgress,
  getRatioPercent,
  getTrackTimelineView,
  getVideoDurationMs,
  hasSummaryChartData,
  parseAnalysisPeriod,
  parseReportEventQuery,
  shouldPollVideoProcessing,
  summarizeEventObjects,
} from "./analysisReportViewState";
import styles from "./AnalysisReportClient.module.css";

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
const dateFormatter = new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" });

const statusLabel: Record<string, string> = {
  PENDING: "처리 대기",
  PROCESSING: "분석 중",
  COMPLETED: "완료",
  FAILED: "실패",
};

const sourceLabel: Record<string, string> = {
  IMAGE: "이미지",
  VIDEO: "영상",
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "기록 없음" : dateTimeFormatter.format(date);
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function MetricCard({ label, value, hint, tone = "primary" }: { label: string; value: string; hint: string; tone?: "primary" | "accent" | "success" | "muted" }) {
  return <article className={styles.metricCard} data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

type MetricCardTone = NonNullable<Parameters<typeof MetricCard>[0]["tone"]>;

function ClassDonut({ summary }: { summary: DetectionAnalysisSummary }) {
  const hasData = hasSummaryChartData(summary);
  const donutBackground = buildClassDonutGradient(summary);
  return <section className={styles.chartPanel} aria-labelledby="class-chart-title">
    <div className={styles.panelTitle}><p>CLASS MIX</p><h2 id="class-chart-title">클래스 분포</h2><span>AI가 탐지한 객체 종류와 비율입니다.</span></div>
    {hasData ? <div className={styles.donutLayout}>
      <div className={styles.donut} style={{ background: donutBackground }} aria-label={`총 ${summary.total_detected_objects}개 객체 클래스 분포`} />
      <ul className={styles.legend}>
        {summary.class_distribution.map((item) => <li key={item.class_code}><i data-class={item.class_code} /><span>{item.class_name_ko}</span><strong>{item.count}개</strong><em>{getRatioPercent(item.ratio)}%</em></li>)}
      </ul>
    </div> : <EmptyChart message="탐지된 객체가 없어 클래스 차트를 표시하지 않습니다." />}
  </section>;
}

function TrendChart({ summary }: { summary: DetectionAnalysisSummary }) {
  const maxValue = Math.max(1, ...summary.daily_trend.map((item) => Math.max(item.analysis_count, item.object_count)));
  const width = 720;
  const height = 220;
  const padding = 28;
  const points = summary.daily_trend.map((item, index) => {
    const x = padding + (summary.daily_trend.length <= 1 ? 0 : index * ((width - padding * 2) / (summary.daily_trend.length - 1)));
    const y = height - padding - (item.object_count / maxValue) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");
  return <section className={styles.chartPanel} aria-labelledby="trend-chart-title">
    <div className={styles.panelTitle}><p>DAILY TREND</p><h2 id="trend-chart-title">일별 분석 추이</h2><span>막대는 분석 건수, 선은 탐지 객체 수입니다.</span></div>
    {summary.total_analyses ? <div className={styles.trendWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${summary.period_days}일간 일별 분석 건수와 객체 수 추이`}>
        <g>
          {summary.daily_trend.map((item, index) => {
            const x = padding + index * ((width - padding * 2) / Math.max(1, summary.daily_trend.length));
            const barHeight = (item.analysis_count / maxValue) * (height - padding * 2);
            return <rect key={item.date} x={x} y={height - padding - barHeight} width={Math.max(5, (width - padding * 2) / summary.daily_trend.length - 6)} height={barHeight} rx="6" />;
          })}
        </g>
        <polyline points={points} />
        {summary.daily_trend.map((item, index) => {
          const x = padding + (summary.daily_trend.length <= 1 ? 0 : index * ((width - padding * 2) / (summary.daily_trend.length - 1)));
          const y = height - padding - (item.object_count / maxValue) * (height - padding * 2);
          return <circle key={`${item.date}-point`} cx={x} cy={y} r="4" />;
        })}
      </svg>
      <div className={styles.trendLabels} aria-hidden="true"><span>{formatDate(summary.daily_trend[0]?.date ?? "")}</span><span>{formatDate(summary.daily_trend.at(-1)?.date ?? "")}</span></div>
      <details className={styles.srData}><summary>일별 수치 목록</summary><ul>{summary.daily_trend.map((item) => <li key={item.date}>{item.date}: 분석 {item.analysis_count}건, 객체 {item.object_count}개</li>)}</ul></details>
    </div> : <EmptyChart message="선택한 기간에 분석 기록이 없습니다." />}
  </section>;
}

function ConfidenceChart({ summary }: { summary: DetectionAnalysisSummary }) {
  return <section className={styles.chartPanel} aria-labelledby="confidence-chart-title">
    <div className={styles.panelTitle}><p>CONFIDENCE</p><h2 id="confidence-chart-title">신뢰도 분포</h2><span>신뢰도는 소유권 확률이 아니라 AI 분류 판단 정도입니다.</span></div>
    {summary.total_detected_objects ? <div className={styles.confidenceBars}>
      {summary.confidence_distribution.map((item) => <div key={item.code} className={styles.confidenceRow}>
        <span>{item.label}</span>
        <div role="meter" aria-label={`${item.label} ${item.count}개, ${getRatioPercent(item.ratio)}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={getRatioPercent(item.ratio)}><i style={{ width: `${getRatioPercent(item.ratio)}%` }} /></div>
        <strong>{item.count}개</strong>
      </div>)}
    </div> : <EmptyChart message="신뢰도 차트를 만들 탐지 객체가 없습니다." />}
  </section>;
}

function MediaRatioChart({ summary }: { summary: DetectionAnalysisSummary }) {
  const imagePercent = getCountRatioPercent(summary.image_count, summary.total_analyses);
  const videoPercent = getCountRatioPercent(summary.video_count, summary.total_analyses);
  return <section className={styles.chartPanel} aria-labelledby="media-chart-title">
    <div className={styles.panelTitle}><p>MEDIA TYPE</p><h2 id="media-chart-title">이미지·영상 분석 비율</h2><span>웹캠은 저장형 분석이 아니므로 제외됩니다.</span></div>
    {summary.total_analyses ? <div className={styles.mediaSplit} aria-label={`이미지 ${summary.image_count}건, 영상 ${summary.video_count}건`}>
      <div><span>이미지</span><strong>{summary.image_count}건</strong><i style={{ width: `${imagePercent}%` }} /></div>
      <div><span>영상</span><strong>{summary.video_count}건</strong><i style={{ width: `${videoPercent}%` }} /></div>
    </div> : <EmptyChart message="분석 기록이 없어 매체 비율을 표시하지 않습니다." />}
  </section>;
}

function EmptyChart({ message }: { message: string }) {
  return <div className={styles.emptyChart}><Icon name="info" size={22} /><span>{message}</span></div>;
}

function ImageReport({ event }: { event: DetectionEvent }) {
  const mediaUrl = resolveDetectionMediaUrl(event.original_media_url);
  return <section className={styles.detailPanel} aria-labelledby="image-report-title">
    <div className={styles.panelTitle}><p>IMAGE REPORT</p><h2 id="image-report-title">이미지 분석 상세</h2><span>원본 이미지 위에 실제 탐지 bbox를 표시합니다.</span></div>
    <div className={styles.imageStage}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl} alt="분석한 원본 이미지" />
      {event.detected_objects.map((object) => {
        const box = normalizeBBox(object.bbox, event.media_width, event.media_height);
        if (!box) return null;
        return <span className={styles.bbox} key={object.id} style={getOverlayPercentageStyle(box)}><b>{object.class_name_ko} {formatPercentValue(object.confidence, "")}</b></span>;
      })}
    </div>
  </section>;
}

function VideoProcessingPanel({ status, error }: { status: VideoProcessingStatus | null; error: string }) {
  const progress = getProcessingFrameProgress(status);
  return <section className={styles.processingPanel} aria-labelledby="video-processing-title">
    <div className={styles.panelTitle}><p>PROCESSING</p><h2 id="video-processing-title">영상 처리 진행 상황</h2><span>분석 중인 영상은 저장된 작업 상태를 기준으로 표시합니다.</span></div>
    {error && <p className={styles.processingError} role="alert">{error}</p>}
    <div className={styles.processingSteps} aria-label="영상 처리 단계">
      {["QUEUED", "NORMALIZING", "ANALYZING", "RENDERING", "SAVING"].map((stage) => <span key={stage} data-active={status?.stage === stage || undefined}>{stage}</span>)}
    </div>
    <div className={styles.processingProgress}>
      <span>프레임 진행률</span>
      <strong>{progress === null ? "프레임 수 확인 중" : `${Math.round(progress)}%`}</strong>
      <div role="progressbar" aria-label="영상 프레임 분석 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined}>
        {progress !== null && <i style={{ width: `${progress}%` }} />}
      </div>
      <small>{status?.total_frames ? `${status.processed_frames} / ${status.total_frames} 프레임` : "전체 프레임 수가 확인되면 퍼센트를 표시합니다."}</small>
    </div>
  </section>;
}

function VideoReport({ event }: { event: DetectionEvent }) {
  const resultUrl = event.result_media_url ? resolveDetectionMediaUrl(event.result_media_url) : "";
  const summary = summarizeEventObjects(event);
  const durationMs = getVideoDurationMs(event);
  return <section className={styles.detailPanel} aria-labelledby="video-report-title">
    <div className={styles.panelTitle}><p>VIDEO REPORT</p><h2 id="video-report-title">영상 분석 상세</h2><span>동일 객체는 ByteTrack 기준의 추적 객체로 집계합니다.</span></div>
    {resultUrl ? <video className={styles.resultVideo} src={resultUrl} controls playsInline preload="metadata" /> : <EmptyChart message="결과 영상이 아직 없거나 생성되지 않았습니다. 원본 영상을 탐지 결과처럼 표시하지 않습니다." />}
    <div className={styles.trackGrid}>
      <MetricCard label="추적 알고리즘" value="ByteTrack" hint="영상 객체 추적 기준" />
      <MetricCard label="탐지·추적 객체" value={`${summary.total}개`} hint="프레임별 중복 합산 제외" tone="accent" />
      <MetricCard label="평균 신뢰도" value={formatPercentValue(summary.averageConfidence)} hint="객체 기준 평균" tone="success" />
    </div>
    {event.detected_objects.length ? <div className={styles.trackList}>
      {event.detected_objects.map((object) => <article key={object.id}>
        <strong>{object.track_id === null ? "추적 정보 없음" : `Track #${object.track_id}`}</strong>
        <span>{object.class_name_ko} · {formatPercentValue(object.confidence, "")}</span>
        <small>{object.first_seen_ms ?? "-"}ms ~ {object.last_seen_ms ?? "-"}ms · {object.appearance_count}프레임</small>
      </article>)}
    </div> : <EmptyChart message="영상에서 추적된 객체가 없습니다." />}
    {event.detected_objects.length ? <div className={styles.timelinePanel} aria-labelledby="track-timeline-title">
      <div className={styles.panelTitle}><p>BYTE TRACK</p><h2 id="track-timeline-title">객체 등장 타임라인</h2><span>Track ID가 같은 항목은 영상 안에서 같은 객체로 이어진 추적 결과입니다.</span></div>
      {durationMs ? <div className={styles.timelineList}>
        {event.detected_objects.map((object) => {
          const timeline = getTrackTimelineView(object, durationMs);
          return <article key={`timeline-${object.id}`}>
            <div><strong>{object.track_id === null ? "Track 미지정" : `Track #${object.track_id}`}</strong><span>{object.class_name_ko} · {object.appearance_count}프레임</span></div>
            <div className={styles.timelineBar} role="meter" aria-label={`${object.class_name_ko} ${formatMilliseconds(object.first_seen_ms)}부터 ${formatMilliseconds(object.last_seen_ms)}까지 등장`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={timeline ? Math.round(timeline.left) : 0}>
              {timeline && <i style={{ left: `${timeline.left}%`, width: `${timeline.width}%` }} />}
            </div>
            <small>{formatMilliseconds(object.first_seen_ms)} → {formatMilliseconds(object.last_seen_ms)}</small>
          </article>;
        })}
      </div> : <EmptyChart message="영상 전체 길이가 없어 타임라인 막대는 계산하지 않고 Track 텍스트 정보만 표시합니다." />}
    </div> : null}
  </section>;
}

function EventDetail({ event, requestedId, invalidEventId, processingStatus, processingError }: { event: DetectionEvent | null; requestedId: number | null; invalidEventId: boolean; processingStatus: VideoProcessingStatus | null; processingError: string }) {
  const state = getDetectionReportState(event, requestedId, invalidEventId);
  const objectSummary = summarizeEventObjects(event);
  const primary = getPrimaryClass(event);
  if (state === "not-found") return <section className={styles.statePanel} role="alert"><Icon name="fileSearch" size={26} /><strong>보고서를 찾을 수 없습니다.</strong><p>존재하지 않거나 본인 소유가 아닌 분석 기록입니다.</p></section>;
  if (!event) return null;
  if (state === "failed") return <section className={styles.statePanel} role="alert"><Icon name="info" size={26} /><strong>분석을 완료하지 못했습니다.</strong><p>내부 오류나 모델 경로는 표시하지 않습니다. 파일 조건을 확인한 뒤 다시 분석해 주세요.</p><Link className="button button-secondary" href="/detect">다시 분석하기</Link></section>;
  if (state === "processing") return <>
    <section className={styles.statePanel} role="status"><Icon name="clock" size={26} /><strong>아직 분석 중입니다.</strong><p>처리 단계가 끝나면 완료 통계와 결과 미디어가 표시됩니다.</p></section>
    {event.source_type === "VIDEO" && <VideoProcessingPanel status={processingStatus} error={processingError} />}
  </>;
  return <>
    <section className={styles.detailSummary} aria-label="개별 분석 핵심 지표">
      <MetricCard label="분석 상태" value={statusLabel[event.status] ?? event.status} hint={formatDateTime(event.processing_completed_at)} />
      <MetricCard label="탐지 객체" value={`${objectSummary.total}개`} hint={primary ? `대표 클래스 ${primary.class_name_ko}` : "탐지 객체 없음"} tone="accent" />
      <MetricCard label="평균 신뢰도" value={formatPercentValue(objectSummary.averageConfidence)} hint={`최고 ${formatPercentValue(objectSummary.maxConfidence)}`} tone="success" />
      <MetricCard label="사용 모델" value={event.ai_model_id ?? "기록 없음"} hint="모델 ID가 있을 때만 표시" tone="muted" />
    </section>
    {event.source_type === "VIDEO" ? <VideoReport event={event} /> : <ImageReport event={event} />}
  </>;
}

export function AnalysisReportClient() {
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState<DetectionSummaryPeriod>(() => parseAnalysisPeriod(searchParams.get("days")));
  const eventQuery = parseReportEventQuery(searchParams);
  const eventId = eventQuery.kind === "detail" ? eventQuery.eventId : null;
  const invalidEventId = eventQuery.kind === "invalid";
  const [summary, setSummary] = useState<DetectionAnalysisSummary | null>(null);
  const [event, setEvent] = useState<DetectionEvent | null>(null);
  const [processingStatus, setProcessingStatus] = useState<VideoProcessingStatus | null>(null);
  const [processingError, setProcessingError] = useState("");
  const [loading, setLoading] = useState(true);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);
  const processingSeq = useRef(0);
  const hasLoadedSummaryRef = useRef(false);

  useEffect(() => {
    if (invalidEventId) {
      const seq = ++requestSeq.current;
      void Promise.resolve().then(() => {
        if (seq !== requestSeq.current) return;
        hasLoadedSummaryRef.current = false;
        setSummary(null);
        setEvent(null);
        setError("");
        setLoading(false);
        setPeriodLoading(false);
      });
      return;
    }
    const controller = new AbortController();
    const seq = ++requestSeq.current;

    async function loadReport() {
      await Promise.resolve();
      if (controller.signal.aborted || seq !== requestSeq.current) return;
      setError("");
      setPeriodLoading(hasLoadedSummaryRef.current);
      setLoading(!hasLoadedSummaryRef.current);
      try {
        const [nextSummary, nextEvent] = await Promise.all([
          getMyDetectionSummary(period, controller.signal),
          eventId === null ? Promise.resolve(null) : getMyDetection(eventId, controller.signal).catch((caught) => {
            if (caught instanceof DetectionApiError && caught.status === 404) return null;
            throw caught;
          }),
        ]);
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        hasLoadedSummaryRef.current = true;
        setSummary(nextSummary);
        setEvent(nextEvent);
      } catch (caught: unknown) {
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        hasLoadedSummaryRef.current = false;
        setError(caught instanceof DetectionApiError && caught.status === 422 ? "지원하지 않는 기간입니다." : "분석 보고서를 불러오지 못했습니다.");
        setSummary(null);
        setEvent(null);
      } finally {
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        setLoading(false);
        setPeriodLoading(false);
      }
    }

    void loadReport();
    return () => controller.abort();
  }, [eventId, invalidEventId, period]);

  useEffect(() => {
    if (!shouldPollVideoProcessing(event, eventId, invalidEventId)) {
      const seq = ++processingSeq.current;
      void Promise.resolve().then(() => {
        if (seq !== processingSeq.current) return;
        setProcessingStatus(null);
        setProcessingError("");
      });
      return;
    }
    if (eventId === null) return;
    const pollingEventId = eventId;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | null = null;
    let stopped = false;
    const seq = ++processingSeq.current;

    async function poll() {
      activeController = new AbortController();
      try {
        const nextStatus = await getVideoProcessingStatus(pollingEventId, activeController.signal);
        if (stopped || seq !== processingSeq.current) return;
        setProcessingStatus(nextStatus);
        setProcessingError("");
        if (nextStatus.status === "COMPLETED" || nextStatus.status === "FAILED") {
          const nextEvent = await getMyDetection(pollingEventId, activeController.signal);
          if (stopped || seq !== processingSeq.current) return;
          setEvent(nextEvent);
          return;
        }
        timer = setTimeout(() => void poll(), 3000);
      } catch (caught: unknown) {
        if (stopped || seq !== processingSeq.current || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setProcessingError("영상 처리 상태를 잠시 확인하지 못했습니다. 자동으로 다시 확인합니다.");
        timer = setTimeout(() => void poll(), 5000);
      }
    }

    void poll();
    return () => {
      stopped = true;
      activeController?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [event, eventId, invalidEventId]);

  const metrics = useMemo<Array<[string, string, string, MetricCardTone]>>(() => summary ? [
    ["전체 분석", `${summary.total_analyses}건`, `${summary.period_days}일 기준`, "primary" as const],
    ["완료율", formatCompletionRate(summary.completion_rate), `완료 ${summary.completed_count}건`, "success" as const],
    ["탐지 객체", `${summary.total_detected_objects}개`, "완료 분석의 실제 객체", "accent" as const],
    ["평균 신뢰도", formatPercentValue(summary.average_confidence), "객체 기준 평균", "primary" as const],
    ["이미지 분석", `${summary.image_count}건`, "저장형 이미지", "muted" as const],
    ["영상 분석", `${summary.video_count}건`, "저장형 영상", "muted" as const],
  ] : [], [summary]);

  return <main className={styles.page} data-print-report="analysis-report">
    <header className={styles.hero}>
      <div>
        <p>AI ANALYSIS REPORT</p>
        <h1>AI 분석 요약보고서</h1>
        <span>저장된 이미지·영상 AI 분석 기록을 기준으로 내 분석 흐름과 결과를 정리합니다.</span>
      </div>
      <div className={styles.heroActions}>
        <div className={styles.periods} role="group" aria-label="보고서 기간 선택">
          {ANALYSIS_PERIODS.map((days) => <button key={days} type="button" aria-pressed={period === days} onClick={() => setPeriod(days)}>{days}일</button>)}
        </div>
        <button type="button" className="button button-secondary" onClick={() => window.print()}>PDF로 저장</button>
        <Link className="button button-secondary" href="/detect">내 확인 기록으로 돌아가기</Link>
        {(eventId !== null || invalidEventId) && <Link className="button button-secondary" href="/mypage/analysis-report">전체 요약 보기</Link>}
      </div>
      {summary && <small>마지막 집계 시각 {formatDateTime(summary.generated_at)}</small>}
      <p className={styles.printHelp}>인쇄 창에서 “PDF로 저장”을 선택할 수 있습니다.</p>
    </header>

    {loading && <section className={styles.statePanel} role="status"><Icon name="scan" size={26} /><strong>보고서를 불러오는 중입니다.</strong><p>분석 기록과 차트 데이터를 안전하게 집계하고 있어요.</p></section>}
    {error && <section className={styles.statePanel} role="alert"><Icon name="info" size={26} /><strong>{error}</strong><p>잠시 후 다시 시도해 주세요.</p></section>}
    {!loading && invalidEventId && <EventDetail event={null} requestedId={null} invalidEventId processingStatus={null} processingError="" />}
    {summary && <>
      {periodLoading && <p className={styles.inlineLoading} role="status">기간 변경 내용을 불러오는 중입니다.</p>}
      <section className={styles.metrics} aria-label="AI 분석 요약 지표">
        {metrics.map(([label, value, hint, tone]) => <MetricCard key={label} label={label} value={value} hint={hint} tone={tone} />)}
        {(summary.in_progress_count > 0 || summary.failed_count > 0) && <MetricCard label="보조 상태" value={`${summary.in_progress_count + summary.failed_count}건`} hint={`처리 중 ${summary.in_progress_count}건 · 실패 ${summary.failed_count}건`} tone="muted" />}
      </section>
      <section className={styles.chartGrid} aria-label="AI 분석 차트">
        <ClassDonut summary={summary} />
        <TrendChart summary={summary} />
        <ConfidenceChart summary={summary} />
        <MediaRatioChart summary={summary} />
      </section>
      <section className={styles.notice}><Icon name="info" size={18} /><p>탐지 신뢰도는 AI가 해당 객체를 특정 클래스로 판단한 정도이며, 실제 소유권·위치 정확률이나 모델 전체 정확도를 의미하지 않습니다.</p></section>
      <EventDetail event={event} requestedId={eventId} invalidEventId={invalidEventId} processingStatus={processingStatus} processingError={processingError} />
      <section className={styles.recentPanel} aria-labelledby="recent-analysis-title">
        <div className={styles.panelTitle}><p>RECENT</p><h2 id="recent-analysis-title">최근 분석 기록</h2><span>최신 10건까지 표시합니다.</span></div>
        {summary.recent_events.length ? <div className={styles.recentList}>
          {summary.recent_events.map((item) => <Link key={item.id} href={`/mypage/analysis-report?eventId=${item.id}`}>
            <span>{sourceLabel[item.source_type] ?? item.source_type}</span>
            <strong>{statusLabel[item.status] ?? item.status}</strong>
            <em>{formatDateTime(item.created_at)}</em>
            <b>{item.object_count}개 · {item.primary_class_name_ko ?? "대표 클래스 없음"}</b>
          </Link>)}
        </div> : <EmptyChart message="선택한 기간에 분석 기록이 없습니다." />}
      </section>
    </>}
  </main>;
}
