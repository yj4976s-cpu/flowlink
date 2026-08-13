"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Icon } from "@/components/common/Icon";
import { adminDetectionMediaUrl, listAdminDetections, type DetectionEvent, type DetectionObject } from "@/lib/adminDetectionsApi";
import styles from "./AdminAiReportClient.module.css";

type Tab = "overview" | "operations" | "models";
type Period = 7 | 30;
type ReportObject = DetectionObject & { event: DetectionEvent };
type Report = { objects: ReportObject[]; pending: ReportObject[]; reviewed: ReportObject[]; corrected: ReportObject[]; kept: ReportObject[]; rejected: ReportObject[]; classes: Array<{ code: string; name: string; count: number; confidence: number; pending: number; corrected: number }>; trend: Array<{ label: string; total: number; personal: number }>; average: number | null; averageTime: number | null; personal: number };
const personalCodes = new Set(["BALL", "BACKPACK", "BAG", "UMBRELLA", "SHOE", "SLIPPER", "FOOTWEAR"]);
const dateTime = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function duration(event: DetectionEvent) {
  if (!event.processing_started_at || !event.processing_completed_at) return null;
  const value = new Date(event.processing_completed_at).getTime() - new Date(event.processing_started_at).getTime();
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function finalCode(item: DetectionObject) { return item.final_class_code || item.object_class; }
function isCorrection(item: DetectionObject) { return Boolean(item.final_class_code && item.final_class_code !== item.object_class); }
function pct(value: number, total: number) { return total ? `${(value / total * 100).toFixed(1)}%` : "–"; }
function isAbortError(reason: unknown) { return reason instanceof DOMException && reason.name === "AbortError"; }

export function reviewBuckets(objects: ReportObject[]) {
  const rejected = objects.filter((item) => item.processing_status === "REJECTED");
  const pending = objects.filter((item) => item.processing_status === "PENDING");
  const confirmed = objects.filter((item) => item.processing_status === "CONFIRMED");
  const corrected = confirmed.filter(isCorrection);
  const kept = confirmed.filter((item) => !isCorrection(item));
  return { pending, reviewed: [...kept, ...corrected, ...rejected], corrected, kept, rejected };
}

export function AdminAiReportClient() {
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<Period>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportNow] = useState(() => Date.now());
  const load = () => { const controller = new AbortController(); setLoading(true); setError(""); listAdminDetections(controller.signal).then(setEvents).catch((reason) => { if (!isAbortError(reason)) setError("AI 탐지 리포트를 불러오지 못했습니다."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return controller; };
  useEffect(() => { const controller = new AbortController(); listAdminDetections(controller.signal).then(setEvents).catch((reason) => { if (!isAbortError(reason)) setError("AI 탐지 리포트를 불러오지 못했습니다."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);

  const report = useMemo(() => {
    const cutoff = reportNow - period * 86400000;
    const scopedEvents = events.filter((event) => new Date(event.captured_at).getTime() >= cutoff);
    const objects = scopedEvents.flatMap((event) => event.detected_objects.map((item) => ({ ...item, event })));
    const { pending, reviewed, corrected, kept, rejected } = reviewBuckets(objects);
    const times = scopedEvents.map(duration).filter((value): value is number => value !== null);
    const classes = new Map<string, { code: string; name: string; count: number; confidence: number; pending: number; corrected: number }>();
    objects.forEach((item) => { const current = classes.get(item.object_class) ?? { code: item.object_class, name: item.object_class_name, count: 0, confidence: 0, pending: 0, corrected: 0 }; current.count += 1; current.confidence += Number(item.confidence); current.pending += item.processing_status === "PENDING" ? 1 : 0; current.corrected += item.processing_status === "CONFIRMED" && isCorrection(item) ? 1 : 0; classes.set(item.object_class, current); });
    const days = Array.from({ length: period }, (_, index) => { const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (period - 1 - index)); return day; });
    const trend = days.map((day) => { const key = day.toDateString(); const found = objects.filter((item) => new Date(item.detected_at).toDateString() === key); return { label: `${day.getMonth() + 1}.${day.getDate()}`, total: found.length, personal: found.filter((item) => personalCodes.has(finalCode(item))).length }; });
    return { objects, pending, reviewed, corrected, kept, rejected, classes: [...classes.values()].sort((a, b) => b.count - a.count), trend, average: objects.length ? objects.reduce((sum, item) => sum + Number(item.confidence), 0) / objects.length : null, averageTime: times.length ? times.reduce((sum, value) => sum + value, 0) / times.length : null, personal: objects.filter((item) => personalCodes.has(finalCode(item))).length };
  }, [events, period, reportNow]);

  return <main className={styles.page}>
    <header className={styles.intro}><div><p>ADMIN · AI OPERATIONS</p><h1>AI 탐지 리포트</h1><span>AI 탐지 결과와 운영 상태를 한곳에서 확인합니다.</span></div><small>최근 최대 100개 탐지 이벤트 기준</small></header>
    <div className={styles.tabs} role="tablist" aria-label="AI 탐지 리포트"><button role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>종합 현황</button><button role="tab" aria-selected={tab === "operations"} onClick={() => setTab("operations")}>운영 분석</button><button role="tab" aria-selected={tab === "models"} onClick={() => setTab("models")}>모델 비교</button></div>
    {loading ? <ReportState loading /> : error ? <ReportState error={error} retry={() => { load(); }} /> : !report.objects.length ? <ReportState /> : <>
      {tab !== "models" && <div className={styles.period}><span>조회 기간</span>{([7, 30] as Period[]).map((value) => <button type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} key={value}>{value}일</button>)}</div>}
      {tab === "overview" && <Overview report={report} />}
      {tab === "operations" && <Operations report={report} />}
      {tab === "models" && <ModelEmpty />}
    </>}
  </main>;
}

function Overview({ report }: { report: Report }) {
  const total = report.objects.length; const waste = total - report.personal;
  return <>
    <section className={styles.kpi} aria-label="AI 탐지 핵심 지표"><Metric label="전체 탐지" value={`${total}건`} note="선택 기간" /><Metric label="평균 신뢰도" value={report.average == null ? "–" : `${(report.average * 100).toFixed(1)}%`} note="AI 분류 신뢰도" /><Metric label="확인 필요" value={`${report.pending.length}건`} note={pct(report.pending.length, total)} tone /><Metric label="평균 분석 시간" value={report.averageTime == null ? "–" : report.averageTime < 1000 ? `${Math.round(report.averageTime)}ms` : `${(report.averageTime / 1000).toFixed(1)}초`} note="처리시간 기록 기준" /></section>
    <div className={styles.chartGrid}><section className={styles.panel}><h2>탐지 추이</h2><p>전체 탐지와 개인 물품 후보를 함께 봅니다.</p><TrendChart data={report.trend} /></section><section className={styles.panel}><h2>탐지 구성</h2><p>최종 분류 기준 구성입니다.</p><Composition total={total} personal={report.personal} waste={waste} /></section></div>
    <div className={styles.actionGrid}><section className={styles.panel}><h2>관리자 확인 결과</h2><ReviewSummary report={report} /></section><section className={styles.panel}><div className={styles.panelHead}><div><h2>확인이 필요한 탐지</h2><p>검토 대기 중인 최근 항목입니다.</p></div><Link href="/admin/detections">전체 검토</Link></div><NeedsReview items={report.pending.slice(0, 3)} /></section></div>
    <section className={styles.panel}><div className={styles.panelHead}><div><h2>최근 관리자 수정</h2><p>AI 분류와 최종 분류가 달랐던 사례입니다.</p></div><Link href="/admin/detections">탐지 관리</Link></div><Corrections items={report.corrected.slice(0, 5)} /></section>
  </>;
}
function Operations({ report }: { report: Report }) { return <><section className={styles.panel}><h2>클래스별 탐지 현황</h2><p>실제 탐지 건수, 평균 신뢰도, 수정 및 확인 대기를 비교합니다.</p><ClassTable data={report.classes} /></section><section className={styles.panel}><div className={styles.panelHead}><div><h2>확인이 필요한 탐지</h2><p>운영 조치가 필요한 탐지로 바로 이동할 수 있습니다.</p></div><Link href="/admin/detections">전체 검토</Link></div><NeedsReview items={report.pending.slice(0, 5)} /></section></>; }
function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: boolean }) { return <article data-tone={tone ? "warning" : "normal"}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function TrendChart({ data }: { data: Report["trend"] }) { const max = Math.max(1, ...data.flatMap((item) => [item.total, item.personal])); const x = (i: number) => data.length === 1 ? 50 : i / (data.length - 1) * 100; const y = (v: number) => 92 - v / max * 78; const shown = data.length > 10 ? data.filter((_, index) => index % 5 === 0 || index === data.length - 1) : data; return <div className={styles.trend}><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="날짜별 전체 탐지 및 개인 물품 후보 추이">{(["total", "personal"] as const).map((key) => <g key={key}><polyline data-line={key} points={data.map((item, index) => `${x(index)},${y(item[key])}`).join(" ")} />{data.map((item, index) => <circle key={`${key}-${item.label}`} cx={x(index)} cy={y(item[key])} r="1.2"><title>{item.label} · {key === "total" ? "전체" : "개인 물품"} {item[key]}건</title></circle>)}</g>)}</svg><div className={styles.axis}>{shown.map((item) => <span key={item.label}>{item.label}</span>)}</div><div className={styles.legend}><span><i />전체 탐지</span><span><i />개인 물품 후보</span></div></div>; }
function Composition({ total, personal, waste }: { total: number; personal: number; waste: number }) { const split = total ? personal / total * 100 : 0; return <div className={styles.composition}><div className={styles.donut} style={{ "--split": `${split}%` } as CSSProperties}><span><strong>{total}</strong><small>전체 탐지</small></span></div><dl><div><dt><i />개인 물품 후보</dt><dd>{personal}건</dd></div><div><dt><i />폐기물</dt><dd>{waste}건</dd></div></dl></div>; }
function ReviewSummary({ report }: { report: Report }) { const total = report.objects.length; return <div className={styles.review}><div><span style={{ width: pct(report.kept.length, total) }} /><span style={{ width: pct(report.corrected.length, total) }} /><span style={{ width: pct(report.rejected.length, total) }} /><span style={{ width: pct(report.pending.length, total) }} /></div><dl><div><dt>AI 분류 유지</dt><dd>{pct(report.kept.length, total)}</dd></div><div><dt>관리자 분류 수정</dt><dd>{pct(report.corrected.length, total)}</dd></div><div><dt>탐지 제외</dt><dd>{pct(report.rejected.length, total)}</dd></div><div><dt>확인 대기</dt><dd>{pct(report.pending.length, total)}</dd></div></dl></div>; }
function NeedsReview({ items }: { items: Report["pending"] }) { if (!items.length) return <p className={styles.empty}>현재 확인을 기다리는 탐지가 없습니다.</p>; return <div className={styles.reviewCards}>{items.map((item) => <Link href={`/admin/detections?detection=${item.event.id}`} key={item.id}><Thumb item={item} /><div><strong>{item.object_class_name}</strong><span>AI 신뢰도 {Math.round(Number(item.confidence) * 100)}%</span><small>{item.event.camera_id ? `카메라 #${item.event.camera_id}` : "위치 정보 없음"} · {dateTime.format(new Date(item.detected_at))}</small><em>신뢰도와 분류를 관리자 확인 중입니다.</em></div></Link>)}</div>; }
function Corrections({ items }: { items: Report["corrected"] }) { if (!items.length) return <p className={styles.empty}>선택 기간에 관리자 분류 수정 기록이 없습니다.</p>; return <div className={styles.corrections}>{items.map((item) => <Link href={`/admin/detections?detection=${item.event.id}`} key={item.id}><span><small>AI 판단</small><strong>{item.object_class_name} · {Math.round(Number(item.confidence) * 100)}%</strong></span><b aria-hidden="true">→</b><span><small>관리자 확인</small><strong>{item.final_class_code}</strong></span></Link>)}</div>; }
function ClassTable({ data }: { data: Report["classes"] }) { const max = Math.max(1, ...data.map((item) => item.count)); return <div className={styles.classTable}><div><span>클래스</span><span>탐지</span><span>평균 신뢰도</span><span>관리자 수정</span><span>확인 필요</span></div>{data.map((item) => <article key={item.code}><strong>{item.name}<small>{item.code}</small></strong><span><i><b style={{ width: `${item.count / max * 100}%` }} /></i>{item.count}건</span><span>{(item.confidence / item.count * 100).toFixed(1)}%</span><span>{item.corrected}건</span><span>{item.pending}건</span></article>)}</div>; }
function reportObjectImageUrl(item: ReportObject) {
  return adminDetectionMediaUrl(item.cropped_image_url) ?? (item.event.source_type === "IMAGE" ? adminDetectionMediaUrl(item.event.result_media_url || item.event.original_media_url) : null);
}
function Thumb({ item }: { item: ReportObject }) { const url = reportObjectImageUrl(item); const [failedUrl, setFailedUrl] = useState<string | null>(null); return <span className={styles.thumb}>{url && failedUrl !== url ? <Image src={url} width={68} height={68} alt={`${item.object_class_name} 탐지 이미지`} unoptimized onError={() => setFailedUrl(url)} /> : <Icon name="scanLine" size={24} />}</span>; }
function ModelEmpty() { return <section className={`${styles.panel} ${styles.modelEmpty}`}><Icon name="layers" size={30} /><h2>모델 평가 데이터가 연결되지 않았습니다.</h2><p>현재 데이터베이스에는 모델 버전별 Precision, Recall, mAP 및 추론 평가 결과가 없습니다. 실제 평가 데이터가 연결되면 현재 운영 모델과 이전 모델을 이 탭에서 비교할 수 있습니다.</p></section>; }
function ReportState({ loading = false, error, retry }: { loading?: boolean; error?: string; retry?: () => void }) { return <section className={styles.state} role={error ? "alert" : "status"}>{loading ? <><div><i /><i /><i /></div><strong>AI 탐지 데이터를 불러오고 있습니다.</strong></> : error ? <><Icon name="info" size={25} /><strong>{error}</strong><button type="button" onClick={retry}>다시 불러오기</button></> : <><Icon name="scanLine" size={28} /><strong>선택 기간에 탐지 데이터가 없습니다.</strong><span>새 탐지가 처리되면 실제 운영 지표가 표시됩니다.</span></>}</section>; }
