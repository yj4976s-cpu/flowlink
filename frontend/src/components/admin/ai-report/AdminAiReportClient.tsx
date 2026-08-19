"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { getAdminAiReport, type AdminAiReport } from "@/lib/adminAiReportApi";
import styles from "./AdminAiReportClient.module.css";

function isAbortError(reason: unknown) { return reason instanceof DOMException && reason.name === "AbortError"; }
function confidence(value: string | null) { return value == null ? "–" : `${(Number(value) * 100).toFixed(1)}%`; }

export function AdminAiReportClient() {
  const [report, setReport] = useState<AdminAiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const applyRequest = (signal?: AbortSignal) => getAdminAiReport(signal).then(setReport).catch((reason: unknown) => { if (!isAbortError(reason)) setError("AI 운영 분석 데이터를 불러오지 못했습니다."); }).finally(() => { if (!signal?.aborted) setLoading(false); });
  const retry = () => { setLoading(true); setError(""); void applyRequest(); };
  useEffect(() => { const controller = new AbortController(); void getAdminAiReport(controller.signal).then(setReport).catch((reason: unknown) => { if (!isAbortError(reason)) setError("AI 운영 분석 데이터를 불러오지 못했습니다."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  return <main className={styles.page}>
    <header className={styles.intro}><div><p>ADMIN · AI OPERATIONS</p><h1>AI 운영 분석</h1><span>AI 탐지 신뢰도와 관리자 검토 데이터를 기반으로 운영 현황과 취약 클래스를 확인하세요.</span></div><small>전체 운영 탐지 데이터 기준</small></header>
    {loading ? <ReportState loading /> : error ? <ReportState error={error} retry={retry} /> : !report || report.summary.total === 0 ? <EmptyReport /> : <Report report={report} />}
  </main>;
}

function Report({ report }: { report: AdminAiReport }) {
  const insights = useMemo(() => { const measurable = report.class_metrics.filter((item) => item.average_confidence != null); return { lowest: [...measurable].sort((a, b) => Number(a.average_confidence) - Number(b.average_confidence))[0], corrected: [...report.class_metrics].filter((item) => item.corrected > 0).sort((a, b) => b.corrected - a.corrected)[0] }; }, [report]);
  return <>
    <section className={styles.kpi} aria-label="AI 운영 핵심 지표"><Metric label="전체 운영 탐지" value={`${report.summary.total}건`} note="OPERATION 탐지 객체" /><Metric label="평균 신뢰도" value={confidence(report.summary.average_confidence)} note="AI 분류 confidence 평균" /><Metric label="관리자 검토" value={`${report.summary.reviewed}건`} note="확정 또는 제외 처리" /><Metric label="검토 후 클래스 변경" value={`${report.summary.corrected}건`} note="AI 예측과 최종 클래스가 다른 건" /></section>
    <section className={styles.panel}><h2>클래스별 탐지 품질</h2><p>운영 탐지의 실제 건수와 평균 confidence, 관리자 검토 결과입니다.</p><ClassTable data={report.class_metrics} /></section>
    <section className={styles.panel}><h2>Confidence 분포</h2><p>낮은 confidence 탐지가 어느 구간에 집중되는지 확인합니다. 마지막 구간만 상한 1.0을 포함합니다.</p><Distribution data={report.confidence_distribution} /></section>
    <section className={styles.panel}><div className={styles.panelHead}><div><h2>관리자 수정 패턴</h2><p>AI 예측이 관리자 검토 후 다른 클래스로 확정된 기록입니다. 모델 평가용 혼동행렬과는 다릅니다.</p></div><Link href="/admin/detections">탐지 검토</Link></div><CorrectionPatterns data={report.correction_patterns} /></section>
    <section className={`${styles.panel} ${styles.modelEmpty}`}><Icon name="layers" size={30} /><div><h2>모델 평가 데이터가 아직 등록되지 않았어요.</h2><p>현재 저장소에는 ground truth 기반 Precision, Recall, F1, mAP 또는 혼동행렬 결과가 없습니다. 실제 평가 결과가 연결되면 운영 데이터와 구분해 보여줄 수 있습니다.</p></div></section>
    <section className={styles.panel}><h2>운영 인사이트</h2><p>현재 전체 운영 집계에서 단순 규칙으로 도출한 결과입니다.</p><div className={styles.insights}>{insights.lowest && <article><span>평균 confidence가 가장 낮은 클래스</span><strong>{insights.lowest.name}</strong><small>{confidence(insights.lowest.average_confidence)} · {insights.lowest.count}건</small></article>}{insights.corrected && <article><span>클래스 변경이 가장 많은 예측</span><strong>{insights.corrected.name}</strong><small>{insights.corrected.corrected}건 변경</small></article>}{!insights.lowest && !insights.corrected && <p className={styles.empty}>도출할 수 있는 운영 인사이트가 없습니다.</p>}</div></section>
  </>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function ClassTable({ data }: { data: AdminAiReport["class_metrics"] }) { return <div className={styles.tableWrap}><table><thead><tr><th scope="col">클래스</th><th scope="col">탐지 건수</th><th scope="col">평균 신뢰도</th><th scope="col">관리자 검토</th><th scope="col">클래스 변경</th></tr></thead><tbody>{data.map((item) => <tr key={item.code}><th scope="row">{item.name}<small>{item.code}</small></th><td>{item.count}건</td><td>{confidence(item.average_confidence)}</td><td>{item.reviewed}건</td><td>{item.corrected}건</td></tr>)}</tbody></table></div>; }
function Distribution({ data }: { data: AdminAiReport["confidence_distribution"] }) { const max = Math.max(1, ...data.map((item) => item.count)); return <div className={styles.distribution}>{data.map((item) => <div key={item.key}><span>{item.label}</span><i><b style={{ width: `${item.count / max * 100}%` }} /></i><strong>{item.count}건</strong></div>)}</div>; }
function CorrectionPatterns({ data }: { data: AdminAiReport["correction_patterns"] }) { if (!data.length) return <p className={styles.empty}>관리자가 클래스를 변경한 운영 탐지 기록이 없습니다.</p>; return <div className={styles.patterns}>{data.map((item) => <article key={`${item.predicted_code}-${item.final_code}`}><span><small>AI 예측</small><strong>{item.predicted_name}<em>{item.predicted_code}</em></strong></span><b aria-hidden="true">→</b><span><small>관리자 최종 확정</small><strong>{item.final_name}<em>{item.final_code}</em></strong></span><mark>{item.count}건</mark></article>)}</div>; }
function EmptyReport() { return <section className={styles.state} role="status"><Icon name="scanLine" size={28} /><strong>아직 분석할 운영 탐지 데이터가 없어요.</strong><span>운영 목적 탐지 결과가 쌓이면 클래스별 품질과 confidence 분포를 확인할 수 있습니다.</span></section>; }
function ReportState({ loading = false, error, retry }: { loading?: boolean; error?: string; retry?: () => void }) { return <section className={styles.state} role={error ? "alert" : "status"}>{loading ? <><div><i /><i /><i /></div><strong>AI 운영 데이터를 집계하고 있습니다.</strong></> : <><Icon name="info" size={25} /><strong>{error}</strong><button type="button" onClick={retry}>다시 불러오기</button></>}</section>; }
