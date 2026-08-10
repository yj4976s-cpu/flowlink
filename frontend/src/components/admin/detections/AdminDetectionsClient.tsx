"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/common/Icon";
import { adminDetectionMediaUrl, completeDetectedWasteCollection, createFoundItemFromDetection, listAdminDetections, updateDetectedObject, type DetectionEvent, type DetectionObject } from "@/lib/adminDetectionsApi";
import styles from "./AdminDetectionsClient.module.css";

const time = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
const classOptions = [
  { value: "TRASH", label: "폐기물", icon: "cube" as IconName }, { value: "BRANCH", label: "나뭇가지", icon: "spark" as IconName },
  { value: "AQUATIC_PLANT", label: "수생식물", icon: "spark" as IconName }, { value: "BALL", label: "공", icon: "ball" as IconName },
  { value: "BAG", label: "가방", icon: "bag" as IconName }, { value: "UMBRELLA", label: "우산", icon: "umbrella" as IconName },
  { value: "FOOTWEAR", label: "신발·슬리퍼류", icon: "footwear" as IconName }, { value: "UNKNOWN", label: "미확인 부유물", icon: "category" as IconName },
];
const statusOptions = [
  { value: "PENDING", label: "검토 필요", icon: "fileSearch" as IconName },
  { value: "CONFIRMED", label: "검토 완료", icon: "check" as IconName },
  { value: "REJECTED", label: "제외", icon: "close" as IconName },
];

function SelectBox({ label, value, options, onChange, disabled }: { label: string; value: string; options: typeof statusOptions; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false); const [active, setActive] = useState(0); const root = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.value === value) ?? options[0];
  useEffect(() => { if (!open) return; const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); }; window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close); }, [open]);
  const choose = (index: number) => { onChange(options[index].value); setActive(index); setOpen(false); };
  const keyDown = (event: React.KeyboardEvent) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); setActive((current) => event.key === "ArrowDown" ? (current + 1) % options.length : (current - 1 + options.length) % options.length); } if ((event.key === "Enter" || event.key === " ") && open) { event.preventDefault(); choose(active); } if (event.key === "Escape") setOpen(false); };
  return <label className={styles.field}><span>{label}</span><div className={styles.select} ref={root}><button type="button" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => { setActive(Math.max(0, options.indexOf(selected))); setOpen((value) => !value); }} onKeyDown={keyDown}><i><Icon name={selected.icon} size={16} /></i>{selected.label}<Icon name="chevron" size={15} /></button>{open && <div role="listbox" aria-label={label}>{options.map((item, index) => <button type="button" role="option" aria-selected={item.value === value} data-active={active === index} key={item.value} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}><i><Icon name={item.icon} size={16} /></i><span>{item.label}</span></button>)}</div>}</div></label>;
}

function Media({ src, alt, compact = false }: { src: string | null; alt: string; compact?: boolean }) { const [failed, setFailed] = useState(false); const resolved = adminDetectionMediaUrl(src); return <span className={compact ? styles.thumb : styles.media}>{resolved && !failed ? <Image src={resolved} alt={alt} fill sizes={compact ? "72px" : "(max-width: 820px) 100vw, 620px"} unoptimized onError={() => setFailed(true)} /> : <Icon name="scan" size={compact ? 23 : 42} />}</span>; }
function eventImage(event: DetectionEvent) { return event.source_type === "IMAGE" ? event.result_media_url || event.original_media_url : null; }
function eventReview(event: DetectionEvent) { const statuses = event.detected_objects.map((item) => item.processing_status); return statuses.includes("PENDING") ? "PENDING" : statuses.length ? "CONFIRMED" : "EMPTY"; }

function ConfirmDialog({ title, description, confirmLabel, busy, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
      if (!controls.length) return;
      const next = event.shiftKey ? controls.indexOf(document.activeElement as HTMLElement) - 1 : controls.indexOf(document.activeElement as HTMLElement) + 1;
      if (next < 0 || next >= controls.length) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [busy, onCancel]);
  return <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}><div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="follow-up-title" ref={dialog}><Icon name="info" size={22} /><h3 id="follow-up-title">{title}</h3><p>{description}</p><div><button type="button" className="button button-secondary" disabled={busy} onClick={onCancel}>취소</button><button type="button" className="button button-primary" disabled={busy} onClick={onConfirm}>{busy ? "처리 중" : confirmLabel}</button></div></div></div>;
}

function ObjectReview({ object, onSaved }: { object: DetectionObject; onSaved: (object: DetectionObject) => void }) {
  const [finalClass, setFinalClass] = useState(object.final_class_code || object.object_class); const [status, setStatus] = useState(object.processing_status); const [memo, setMemo] = useState(object.admin_memo ?? ""); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const save = async () => { setSaving(true); setError(""); setMessage(""); try { await updateDetectedObject(object.id, { final_class_code: finalClass, processing_status: status, admin_memo: memo }); onSaved({ ...object, final_class_code: finalClass, processing_status: status, admin_memo: memo || null }); setMessage("검토 내용을 저장했습니다."); } catch (reason) { setError(reason instanceof Error ? reason.message : "검토 내용을 저장하지 못했습니다."); } finally { setSaving(false); } };
  const [confirming, setConfirming] = useState<"FOUND_ITEM" | "WASTE" | null>(null); const [processing, setProcessing] = useState(false);
  const followUp = async () => { if (!confirming) return; setProcessing(true); setError(""); try { if (confirming === "FOUND_ITEM") { const result = await createFoundItemFromDetection(object.id); onSaved({ ...object, found_item_id: result.found_item_id }); } else { await completeDetectedWasteCollection(object.id); onSaved({ ...object, waste_collection_completed: true }); } setConfirming(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "후속 처리를 완료하지 못했습니다."); } finally { setProcessing(false); } };
  const completed = object.follow_up_kind === "FOUND_ITEM" ? object.found_item_id !== null : object.follow_up_kind === "WASTE" ? object.waste_collection_completed : false;
  const availableAction = object.follow_up_kind === "FOUND_ITEM" || object.follow_up_kind === "WASTE" ? object.follow_up_kind : null;
  return <article className={styles.objectCard}><Media compact src={object.cropped_image_url} alt={`${object.object_class_name} 탐지 객체`} /><div className={styles.objectInfo}><div><span>객체 #{object.id}</span><strong>{object.final_class_code || object.object_class_name}</strong><b>AI 신뢰도 {Math.round(Number(object.confidence) * 100)}%</b></div><small>bbox {Number(object.bbox_x).toFixed(0)}, {Number(object.bbox_y).toFixed(0)} · {Number(object.bbox_width).toFixed(0)}×{Number(object.bbox_height).toFixed(0)}</small></div><div className={styles.reviewForm}><SelectBox label="최종 분류" value={finalClass} options={classOptions} onChange={setFinalClass} disabled={saving || processing} /><SelectBox label="처리 상태" value={status} options={statusOptions} onChange={(value) => setStatus(value as DetectionObject["processing_status"])} disabled={saving || processing} /><label className={styles.field}><span>관리자 메모</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} disabled={saving || processing} placeholder="검토 근거 또는 참고 내용을 입력하세요." /></label><button className="button button-primary" type="button" disabled={saving || processing} onClick={() => void save()}>{saving ? "저장 중" : "검토 내용 저장"}</button>{message && <p className={styles.success} role="status">{message}</p>}{error && <p className={styles.error} role="alert">{error}</p>}</div><section className={styles.followUp} aria-label="후속 처리">{object.processing_status === "PENDING" ? <p>검토를 완료한 후 후속 처리를 진행할 수 있습니다.</p> : object.processing_status === "REJECTED" || !availableAction ? <p>이 객체에는 가능한 후속 처리가 없습니다.</p> : completed ? <div className={styles.followUpComplete}><Icon name="packageCheck" size={19} /><strong>{object.follow_up_kind === "FOUND_ITEM" ? "공식 발견물 등록 완료" : "수거 완료"}</strong>{object.found_item_id && <Link href={`/found-items/${object.found_item_id}`}><Icon name="fileSearch" size={17} /> 공식 발견물 확인</Link>}</div> : <button type="button" className="button button-secondary" disabled={processing} onClick={() => setConfirming(availableAction)}><Icon name={availableAction === "FOUND_ITEM" ? "archive" : "packageCheck"} size={18} />{availableAction === "FOUND_ITEM" ? "공식 발견물로 등록" : "수거 완료 처리"}</button>}</section>{confirming && <ConfirmDialog title={confirming === "FOUND_ITEM" ? "공식 발견물로 등록할까요?" : "수거 완료로 처리할까요?"} description={confirming === "FOUND_ITEM" ? "확인된 탐지 정보를 바탕으로 공식 발견물이 생성됩니다." : "처리 후 수거 완료 이력이 기록됩니다."} confirmLabel={confirming === "FOUND_ITEM" ? "등록하기" : "처리 완료"} busy={processing} onCancel={() => setConfirming(null)} onConfirm={() => void followUp()} />}</article>;
}

export function AdminDetectionsClient() {
  const query = useSearchParams(); const requested = Number(query.get("detection")); const [events, setEvents] = useState<DetectionEvent[]>([]); const [selectedId, setSelectedId] = useState<number | null>(null); const [filter, setFilter] = useState("ALL"); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const applyData = (data: DetectionEvent[]) => { setEvents(data); setSelectedId((current) => data.some((item) => item.id === (requested || current)) ? (requested || current) : data[0]?.id ?? null); };
  const load = () => { const controller = new AbortController(); setLoading(true); setError(""); listAdminDetections(controller.signal).then(applyData).catch(() => setError("탐지 결과를 불러오지 못했어요.")).finally(() => setLoading(false)); return controller; };
  useEffect(() => { const controller = new AbortController(); listAdminDetections(controller.signal).then(applyData).catch(() => setError("탐지 결과를 불러오지 못했어요.")).finally(() => setLoading(false)); return () => controller.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => events.filter((event) => filter === "ALL" || eventReview(event) === filter), [events, filter]); const selected = events.find((event) => event.id === selectedId) ?? visible[0] ?? null;
  const updateObject = (next: DetectionObject) => { setEvents((current) => current.map((event) => ({ ...event, detected_objects: event.detected_objects.map((item) => item.id === next.id ? next : item) }))); void listAdminDetections().then(applyData).catch(() => undefined); };
  return <main className={styles.page}><header className={styles.hero}><div><p>ADMIN · AI DETECTIONS</p><h1>AI 탐지 관리</h1><span>탐지 결과를 확인하고 객체 분류와 처리 상태를 검토합니다.</span></div><Link href="/admin"><Icon name="arrow" size={16} /> 대시보드로</Link></header><div className={styles.filters} role="tablist" aria-label="탐지 검토 상태">{[{ value: "ALL", label: "전체" }, { value: "PENDING", label: "검토 필요" }, { value: "CONFIRMED", label: "검토 완료" }].map((item) => <button type="button" role="tab" aria-selected={filter === item.value} onClick={() => setFilter(item.value)} key={item.value}>{item.label}</button>)}</div>
    {loading ? <div className={styles.state}><i /><span>탐지 결과를 불러오는 중입니다.</span></div> : error ? <div className={`${styles.state} ${styles.stateError}`} role="alert"><Icon name="info" size={24} /><span>{error}</span><button type="button" onClick={load}>다시 불러오기</button></div> : !events.length ? <div className={styles.state}><Icon name="scan" size={30} /><span>아직 확인할 탐지 결과가 없습니다.</span></div> : <div className={styles.workspace}><section className={styles.eventList} aria-label="AI 탐지 목록">{visible.map((event) => <button type="button" aria-pressed={event.id === selected?.id} onClick={() => setSelectedId(event.id)} key={event.id}><Media compact src={eventImage(event)} alt={`탐지 #${event.id} 대표 이미지`} /><span><b>탐지 #{event.id}</b><small>{time.format(new Date(event.captured_at))}</small><small>{event.source_type} · {event.camera_id ? `카메라 #${event.camera_id}` : "카메라 정보 없음"}</small></span><em>{event.detected_objects.length}개 객체</em><strong data-status={eventReview(event)}>{eventReview(event) === "PENDING" ? "검토 필요" : eventReview(event) === "CONFIRMED" ? "검토 완료" : "객체 없음"}</strong></button>)}</section>{selected && <section className={styles.detail} aria-labelledby="detection-detail-title"><div className={styles.detailHead}><div><p>DETECTION #{selected.id}</p><h2 id="detection-detail-title">탐지 상세</h2></div><span>{selected.status}</span></div><Media src={eventImage(selected)} alt={`탐지 #${selected.id} ${selected.result_media_url ? "결과" : "원본"} 이미지`} /><dl><div><dt>탐지 시각</dt><dd>{time.format(new Date(selected.captured_at))}</dd></div><div><dt>미디어</dt><dd>{selected.source_type}</dd></div><div><dt>카메라</dt><dd>{selected.camera_id ? `#${selected.camera_id}` : "정보 없음"}</dd></div><div><dt>탐지 객체</dt><dd>{selected.detected_objects.length}개</dd></div></dl><div className={styles.objectHeading}><h3>탐지 객체 검토</h3><span>객체별 분류·상태·메모를 저장할 수 있습니다.</span></div>{selected.detected_objects.length ? <div className={styles.objects}>{selected.detected_objects.map((object) => <ObjectReview object={object} onSaved={updateObject} key={object.id} />)}</div> : <div className={styles.objectEmpty}>이 탐지에는 확인할 객체가 없습니다.</div>}</section>}</div>}
  </main>;
}
