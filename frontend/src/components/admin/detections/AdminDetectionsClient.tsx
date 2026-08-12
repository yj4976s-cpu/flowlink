"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/common/Icon";
import { adminDetectionMediaUrl, completeDetectedWasteCollection, createFoundItemFromDetection, createOperationDetection, listAdminCameras, listAdminDetections, updateDetectedObject, type AdminCamera, type DetectionEvent, type DetectionObject } from "@/lib/adminDetectionsApi";
import styles from "./AdminDetectionsClient.module.css";

const time = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
type Option = { value: string; label: string; icon?: IconName };
type ReviewFilter = "ALL" | "PENDING" | "CONFIRMED" | "REJECTED";
const classOptions: Option[] = [
  { value: "TRASH", label: "폐기물", icon: "cube" }, { value: "BRANCH", label: "나뭇가지", icon: "spark" },
  { value: "AQUATIC_PLANT", label: "수생식물", icon: "spark" }, { value: "BALL", label: "공", icon: "ball" },
  { value: "BAG", label: "가방", icon: "bag" }, { value: "UMBRELLA", label: "우산", icon: "umbrella" },
  { value: "FOOTWEAR", label: "신발·슬리퍼류", icon: "footwear" }, { value: "UNKNOWN", label: "미확인 부유물", icon: "category" },
];
const statusOptions: Option[] = [
  { value: "PENDING", label: "검토 필요", icon: "fileSearch" },
  { value: "CONFIRMED", label: "검토 완료", icon: "check" },
  { value: "REJECTED", label: "제외", icon: "close" },
];
const purposeOptions: Option[] = [{ value: "ALL", label: "전체 출처" }, { value: "OPERATION", label: "운영 탐지" }, { value: "USER_ANALYSIS", label: "사용자 분석" }];
const sortOptions: Option[] = [{ value: "NEWEST", label: "최신순" }, { value: "OLDEST", label: "오래된순" }];
const reviewLabels: Record<string, string> = { PENDING: "검토 필요", CONFIRMED: "검토 완료", REJECTED: "제외", EMPTY: "객체 없음" };
const purposeLabels: Record<DetectionEvent["purpose"], string> = { OPERATION: "운영 탐지", USER_ANALYSIS: "사용자 분석" };
const itemColorOptions = ["검정", "흰색", "회색", "아이보리", "크림", "베이지", "카멜", "갈색", "빨강", "주황", "노랑", "연두", "초록", "민트", "하늘", "파랑", "진파랑", "남색", "보라", "분홍"];

function SelectBox({ label, value, options, onChange, disabled, compact = false }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false); const root = useRef<HTMLDivElement>(null); const selectedIndex = Math.max(0, options.findIndex((item) => item.value === value)); const [active, setActive] = useState(selectedIndex); const selected = options[selectedIndex] ?? options[0];
  useEffect(() => { if (!open) return; const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); }; window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close); }, [open]);
  const choose = (index: number) => { onChange(options[index].value); setActive(index); setOpen(false); };
  const keyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); setOpen(true); setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? (current + 1) % options.length : (current - 1 + options.length) % options.length); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (open) choose(active); else setOpen(true); }
    else if (event.key === "Escape") setOpen(false);
  };
  const content = <div className={styles.select} ref={root}><button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => { setActive(selectedIndex); setOpen((current) => !current); }} onKeyDown={keyDown}>{selected.icon && <i><Icon name={selected.icon} size={16} /></i>}<span>{selected.label}</span><Icon name="chevron" size={15} /></button>{open && <div role="listbox" aria-label={label}>{options.map((item, index) => <button type="button" role="option" aria-selected={item.value === value} data-active={active === index} key={item.value} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>{item.icon && <i><Icon name={item.icon} size={16} /></i>}<span>{item.label}</span></button>)}</div>}</div>;
  return compact ? content : <label className={styles.field}><span>{label}</span>{content}</label>;
}

function Media({ src, alt, compact = false }: { src: string | null; alt: string; compact?: boolean }) { const resolved = adminDetectionMediaUrl(src); const [failedUrl, setFailedUrl] = useState<string | null>(null); return <span className={compact ? styles.thumb : styles.media}>{resolved && failedUrl !== resolved ? <Image src={resolved} alt={alt} fill sizes={compact ? "72px" : "(max-width: 1024px) 100vw, 680px"} unoptimized onError={() => setFailedUrl(resolved)} /> : <Icon name="scanLine" size={compact ? 24 : 44} />}</span>; }
function eventImage(event: DetectionEvent) { return event.source_type === "IMAGE" ? event.result_media_url || event.original_media_url : null; }
function eventReview(event: DetectionEvent): ReviewFilter | "EMPTY" { const statuses = event.detected_objects.map((item) => item.processing_status); if (!statuses.length) return "EMPTY"; if (statuses.includes("PENDING")) return "PENDING"; if (statuses.every((status) => status === "REJECTED")) return "REJECTED"; return "CONFIRMED"; }
function classLabel(object: DetectionObject) { const code = object.final_class_code || object.object_class; return classOptions.find((item) => item.value === code)?.label ?? object.object_class_name; }

function ConfirmDialog({ title, description, confirmLabel, busy, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.querySelector<HTMLElement>("button")?.focus(); const keyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); if (event.key !== "Tab") return; const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []); if (!controls.length) return; const index = controls.indexOf(document.activeElement as HTMLElement); const next = event.shiftKey ? index - 1 : index + 1; if (next < 0 || next >= controls.length) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus(); } }; document.addEventListener("keydown", keyDown); return () => { document.removeEventListener("keydown", keyDown); previous?.focus(); }; }, [busy, onCancel]);
  return <div className={styles.dialogBackdrop} onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}><div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="follow-up-title" ref={dialog}><Icon name="info" size={22} /><h3 id="follow-up-title">{title}</h3><p>{description}</p><div><button type="button" className="button button-secondary" disabled={busy} onClick={onCancel}>취소</button><button type="button" className="button button-primary" disabled={busy} onClick={onConfirm}>{busy ? "처리 중" : confirmLabel}</button></div></div></div>;
}

function ObjectReview({ object, purpose, onSaved }: { object: DetectionObject; purpose: DetectionEvent["purpose"]; onSaved: (object: DetectionObject) => void }) {
  const [finalClass, setFinalClass] = useState(object.final_class_code || object.object_class); const [status, setStatus] = useState(object.processing_status); const [memo, setMemo] = useState(object.admin_memo ?? ""); const [confirmedColor, setConfirmedColor] = useState(object.confirmed_color ?? ""); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [confirming, setConfirming] = useState<"FOUND_ITEM" | "WASTE" | null>(null); const [processing, setProcessing] = useState(false);
  const save = async () => { setSaving(true); setError(""); setMessage(""); try { await updateDetectedObject(object.id, { final_class_code: finalClass, processing_status: status, admin_memo: memo, confirmed_color: confirmedColor }); onSaved({ ...object, final_class_code: finalClass, processing_status: status, admin_memo: memo || null, confirmed_color: confirmedColor || null }); setMessage("검토 내용을 저장했습니다."); } catch (reason) { setError(reason instanceof Error ? reason.message : "검토 내용을 저장하지 못했습니다."); } finally { setSaving(false); } };
  const followUp = async () => { if (!confirming) return; setProcessing(true); setError(""); try { if (confirming === "FOUND_ITEM") { const result = await createFoundItemFromDetection(object.id); onSaved({ ...object, found_item_id: result.found_item_id }); } else { await completeDetectedWasteCollection(object.id); onSaved({ ...object, waste_collection_completed: true }); } setConfirming(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "후속 처리를 완료하지 못했습니다."); } finally { setProcessing(false); } };
  const completed = object.follow_up_kind === "FOUND_ITEM" ? object.found_item_id !== null : object.follow_up_kind === "WASTE" ? object.waste_collection_completed : false; const availableAction = object.follow_up_kind === "FOUND_ITEM" || object.follow_up_kind === "WASTE" ? object.follow_up_kind : null;
  return <div className={styles.inspectorContent}><div className={styles.objectSummary}><Media compact src={object.cropped_image_url} alt={`${object.object_class_name} 탐지 객체`} /><div><span>객체 #{object.id}</span><strong>{classLabel(object)}</strong><b>AI 신뢰도 {Math.round(Number(object.confidence) * 100)}%</b><small>bbox {Number(object.bbox_x).toFixed(0)}, {Number(object.bbox_y).toFixed(0)} · {Number(object.bbox_width).toFixed(0)}×{Number(object.bbox_height).toFixed(0)}</small></div></div><div className={styles.reviewForm}><SelectBox label="최종 분류" value={finalClass} options={classOptions} onChange={setFinalClass} disabled={saving || processing} /><div className={styles.colorReview}><div><span>AI 추정 색상</span><strong>{object.ai_color ?? "추정 실패"}</strong></div><p>이미지와 조명에 따라 다를 수 있어요. 관리자가 확인한 값이 우선 적용됩니다.</p></div><label className={styles.field}><span>최종 확인 색상</span><select value={confirmedColor} onChange={(event) => setConfirmedColor(event.target.value)} disabled={saving || processing}><option value="">확정하지 않음 · AI 추정값 사용</option>{itemColorOptions.map((color) => <option value={color} key={color}>{color}</option>)}</select></label><SelectBox label="처리 상태" value={status} options={statusOptions} onChange={(value) => setStatus(value as DetectionObject["processing_status"])} disabled={saving || processing} /><label className={styles.field}><span>관리자 메모</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} disabled={saving || processing} placeholder="검토 근거 또는 참고 내용을 입력하세요." /></label>{message && <p className={styles.success} role="status">{message}</p>}{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.saveBar}><button className="button button-primary" type="button" disabled={saving || processing} onClick={() => void save()}>{saving ? "저장 중" : "검토 내용 저장"}</button></div></div><section className={styles.followUp}><h3>후속 처리</h3>{purpose === "USER_ANALYSIS" ? <div className={styles.analysisNotice}><Icon name="userSearch" size={19} /><div><strong>사용자 분석 결과</strong><p>개인 분석 결과는 운영 후속 처리 대상이 아닙니다.</p></div></div> : status === "PENDING" ? <p>검토를 완료한 후 후속 처리를 진행할 수 있습니다.</p> : status === "REJECTED" || !availableAction ? <p>이 객체에는 가능한 후속 처리가 없습니다.</p> : completed ? <div className={styles.followUpComplete}><Icon name="packageCheck" size={19} /><strong>{object.follow_up_kind === "FOUND_ITEM" ? "공식 발견물 등록 완료" : "수거 완료"}</strong>{object.found_item_id && <Link href={`/found-items/${object.found_item_id}`}><Icon name="fileSearch" size={17} />발견물 확인</Link>}</div> : <button type="button" className="button button-secondary" disabled={processing} onClick={() => setConfirming(availableAction)}><Icon name={availableAction === "FOUND_ITEM" ? "archive" : "packageCheck"} size={18} />{availableAction === "FOUND_ITEM" ? "공식 발견물로 등록" : "수거 완료 처리"}</button>}</section>{confirming && <ConfirmDialog title={confirming === "FOUND_ITEM" ? "공식 발견물로 등록할까요?" : "수거 완료로 처리할까요?"} description={confirming === "FOUND_ITEM" ? "최종 확인 색상을 우선 적용해 공식 발견물을 생성합니다." : "처리 후 수거 완료 이력이 기록됩니다."} confirmLabel={confirming === "FOUND_ITEM" ? "등록하기" : "처리 완료"} busy={processing} onCancel={() => setConfirming(null)} onConfirm={() => void followUp()} />}</div>;
}

const MIN_REVIEW_ZOOM = 50;
const MAX_REVIEW_ZOOM = 300;
const REVIEW_ZOOM_STEP = 25;

function FocusedImageReview({ event, object, onSelectObject, onSaved, onClose }: { event: DetectionEvent; object: DetectionObject | null; onSelectObject: (id: number) => void; onSaved: (object: DetectionObject) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const mediaUrl = adminDetectionMediaUrl(eventImage(event));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button")?.focus();
    const keyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") { keyboardEvent.preventDefault(); onClose(); return; }
      if (keyboardEvent.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (keyboardEvent.shiftKey && document.activeElement === first) { keyboardEvent.preventDefault(); last.focus(); }
      else if (!keyboardEvent.shiftKey && document.activeElement === last) { keyboardEvent.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keyDown);
    return () => { document.removeEventListener("keydown", keyDown); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [onClose]);

  const fit = () => { setZoom(100); setPan({ x: 0, y: 0 }); };
  const changeZoom = (next: number) => { setZoom(Math.min(MAX_REVIEW_ZOOM, Math.max(MIN_REVIEW_ZOOM, next))); if (next <= 100) setPan({ x: 0, y: 0 }); };
  const focusObject = (next: DetectionObject) => {
    onSelectObject(next.id);
    if (!imageSize.width || !imageSize.height) return;
    const box = [next.bbox_x, next.bbox_y, next.bbox_width, next.bbox_height].map(Number);
    if (box.some((value) => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0) return;
    const nextZoom = Math.max(zoom, 150);
    const viewport = viewportRef.current?.getBoundingClientRect();
    if (!viewport) return;
    const centerX = (box[0] + box[2] / 2) / imageSize.width - .5;
    const centerY = (box[1] + box[3] / 2) / imageSize.height - .5;
    setZoom(nextZoom);
    setPan({ x: -centerX * viewport.width * (nextZoom / 100), y: -centerY * viewport.height * (nextZoom / 100) });
  };
  const pointerDown = (pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 100 || pointerEvent.button !== 0) return;
    dragRef.current = { pointerId: pointerEvent.pointerId, x: pointerEvent.clientX, y: pointerEvent.clientY, panX: pan.x, panY: pan.y };
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
  };
  const pointerMove = (pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
    setPan({ x: drag.panX + pointerEvent.clientX - drag.x, y: drag.panY + pointerEvent.clientY - drag.y });
  };
  const pointerUp = (pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== pointerEvent.pointerId) return;
    dragRef.current = null;
    pointerEvent.currentTarget.releasePointerCapture(pointerEvent.pointerId);
  };

  return <div className={styles.focusBackdrop} onMouseDown={(mouseEvent) => mouseEvent.target === mouseEvent.currentTarget && onClose()}>
    <div className={styles.focusDialog} role="dialog" aria-modal="true" aria-labelledby="focused-review-title" ref={dialogRef}>
      <header className={styles.focusHeader}><div><span>IMAGE REVIEW</span><h2 id="focused-review-title">탐지 #{event.id} 확대 검토</h2></div><div className={styles.focusToolbar} aria-label="이미지 확대 도구"><button type="button" aria-label="축소" disabled={zoom <= MIN_REVIEW_ZOOM} onClick={() => changeZoom(zoom - REVIEW_ZOOM_STEP)}>−</button><output aria-live="polite">{zoom}%</output><button type="button" aria-label="확대" disabled={zoom >= MAX_REVIEW_ZOOM} onClick={() => changeZoom(zoom + REVIEW_ZOOM_STEP)}>+</button><button type="button" onClick={fit}>화면 맞춤</button><button type="button" aria-label="확대 검토 닫기" onClick={onClose}><Icon name="close" size={19} /></button></div></header>
      <div className={styles.focusBody}><section className={styles.focusMediaPanel} aria-label="탐지 이미지 상세 보기"><div className={styles.focusViewport} data-draggable={zoom > 100} ref={viewportRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={(wheelEvent) => { if (!wheelEvent.ctrlKey) return; wheelEvent.preventDefault(); changeZoom(zoom + (wheelEvent.deltaY < 0 ? REVIEW_ZOOM_STEP : -REVIEW_ZOOM_STEP)); }}>
        {mediaUrl && !failed ? <Image src={mediaUrl} alt={`탐지 #${event.id} 원본 이미지`} fill sizes="(max-width: 900px) 100vw, 70vw" unoptimized draggable={false} onLoad={(loadEvent) => setImageSize({ width: loadEvent.currentTarget.naturalWidth, height: loadEvent.currentTarget.naturalHeight })} onError={() => setFailed(true)} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }} /> : <div className={styles.focusMediaEmpty}><Icon name="scanLine" size={46} /><span>표시할 탐지 이미지가 없습니다.</span></div>}
      </div><p>Ctrl + 마우스 휠로 확대하거나, 확대 후 이미지를 드래그해 이동할 수 있어요.</p><div className={styles.focusObjects} aria-label="탐지 객체 선택">{event.detected_objects.map((item) => <button type="button" aria-pressed={item.id === object?.id} onClick={() => focusObject(item)} key={item.id}><span>{classLabel(item)}</span><b>{Math.round(Number(item.confidence) * 100)}%</b></button>)}</div></section>
      <aside className={styles.focusInspector} aria-label="선택 객체 검토">{object ? <ObjectReview key={object.id} object={object} purpose={event.purpose} onSaved={onSaved} /> : <div className={styles.inspectorEmpty}>검토할 객체가 없습니다.</div>}</aside></div>
    </div>
  </div>;
}

export function AdminDetectionsClient() {
  const queryParams = useSearchParams(); const requested = Number(queryParams.get("detection")); const [events, setEvents] = useState<DetectionEvent[]>([]); const [selectedId, setSelectedId] = useState<number | null>(null); const [selectedObjectId, setSelectedObjectId] = useState<number | null>(null); const [filter, setFilter] = useState<ReviewFilter>("ALL"); const [purpose, setPurpose] = useState("ALL"); const [sort, setSort] = useState("NEWEST"); const [search, setSearch] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [cameras, setCameras] = useState<AdminCamera[]>([]); const [cameraId, setCameraId] = useState(""); const [operationFile, setOperationFile] = useState<File | null>(null); const [operationBusy, setOperationBusy] = useState(false); const [operationMessage, setOperationMessage] = useState(""); const [operationError, setOperationError] = useState(""); const [focusedReview, setFocusedReview] = useState(false); const focusTriggerRef = useRef<HTMLButtonElement>(null);
  const applyData = (data: DetectionEvent[]) => { setEvents(data); setSelectedId((current) => data.some((item) => item.id === (requested || current)) ? (requested || current) : data[0]?.id ?? null); };
  const load = () => { const controller = new AbortController(); setLoading(true); setError(""); listAdminDetections(controller.signal).then(applyData).catch(() => setError("탐지 결과를 불러오지 못했습니다.")).finally(() => setLoading(false)); return controller; };
  useEffect(() => { const controller = new AbortController(); listAdminDetections(controller.signal).then(applyData).catch(() => setError("탐지 결과를 불러오지 못했습니다.")).finally(() => setLoading(false)); return () => controller.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const controller = new AbortController(); listAdminCameras(controller.signal).then((rows) => { setCameras(rows); setCameraId(String(rows[0]?.id ?? "")); }).catch(() => setOperationError("운영 카메라를 불러오지 못했습니다.")); return () => controller.abort(); }, []);
  const counts = useMemo(() => ({ ALL: events.length, PENDING: events.filter((event) => eventReview(event) === "PENDING").length, CONFIRMED: events.filter((event) => eventReview(event) === "CONFIRMED").length, REJECTED: events.filter((event) => ["REJECTED", "EMPTY"].includes(eventReview(event))).length }), [events]);
  const visible = useMemo(() => events.filter((event) => (filter === "ALL" || eventReview(event) === filter || (filter === "REJECTED" && eventReview(event) === "EMPTY")) && (purpose === "ALL" || event.purpose === purpose) && (!search.trim() || String(event.id).includes(search.trim()) || event.detected_objects.some((object) => `${object.object_class_name} ${object.object_class} ${object.final_class_code ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())))).sort((a, b) => (new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()) * (sort === "NEWEST" ? 1 : -1)), [events, filter, purpose, search, sort]);
  const selected = events.find((event) => event.id === selectedId && visible.some((item) => item.id === event.id)) ?? visible[0] ?? null;
  const selectedObject = selected?.detected_objects.find((object) => object.id === selectedObjectId) ?? selected?.detected_objects[0] ?? null;
  const closeFocusedReview = useCallback(() => setFocusedReview(false), []);
  const updateObject = (next: DetectionObject) => { setEvents((current) => current.map((event) => ({ ...event, detected_objects: event.detected_objects.map((item) => item.id === next.id ? next : item) }))); void listAdminDetections().then(applyData).catch(() => undefined); };
  const resetFilters = () => { setFilter("ALL"); setPurpose("ALL"); setSort("NEWEST"); setSearch(""); };
  const filtersActive = filter !== "ALL" || purpose !== "ALL" || sort !== "NEWEST" || Boolean(search);
  const runOperationDetection = async () => { if (!operationFile || !cameraId) return; setOperationBusy(true); setOperationError(""); setOperationMessage(""); try { await createOperationDetection(Number(cameraId), operationFile); setOperationMessage("운영 탐지가 완료되었습니다. 아래 대기열에서 객체를 검토해 주세요."); setOperationFile(null); setPurpose("OPERATION"); await listAdminDetections().then(applyData); } catch (reason) { setOperationError(reason instanceof Error ? reason.message : "운영 탐지를 실행하지 못했습니다."); } finally { setOperationBusy(false); } };
  return <main className={styles.page}>
    <section className={styles.operationEntry} aria-labelledby="operation-detection-title"><div><span>OPERATION DETECTION</span><h2 id="operation-detection-title">운영 탐지 실행</h2><p>활성 카메라 위치와 이미지를 연결해 공식 발견물로 이어지는 운영 탐지를 생성합니다.</p></div>{cameras.length ? <div className={styles.operationControls}><label><span>운영 카메라</span><select value={cameraId} onChange={(event) => setCameraId(event.target.value)} disabled={operationBusy}>{cameras.map((camera) => <option value={camera.id} key={camera.id}>{camera.name} · {camera.area_name}</option>)}</select></label><label><span>탐지 이미지</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={operationBusy} onChange={(event) => setOperationFile(event.target.files?.[0] ?? null)} /></label><button type="button" className="button button-primary" disabled={!cameraId || !operationFile || operationBusy} onClick={() => void runOperationDetection()}><Icon name="scanLine" size={17} />{operationBusy ? "탐지 중" : "운영 탐지 시작"}</button></div> : <div className={styles.cameraEmpty}><strong>활성 카메라가 없습니다.</strong><span>발표 환경용 카메라 seed를 먼저 실행해 주세요.</span></div>}{operationMessage && <p className={styles.operationSuccess} role="status">{operationMessage}</p>}{operationError && <p className={styles.operationError} role="alert">{operationError}</p>}</section>
    <header className={styles.pageHeader}><div><nav aria-label="현재 위치"><Link href="/admin">대시보드</Link><Icon name="chevron" size={13} /><span>AI 탐지 관리</span></nav><h1>AI 탐지 관리</h1><p>AI 탐지 결과를 검토하고 필요한 후속 처리를 진행합니다.</p></div><button type="button" className={styles.refreshButton} data-loading={loading} disabled={loading} onClick={load}><Icon name="scanLine" size={17} />최신 탐지 불러오기</button></header>
    <div className={styles.summary} role="tablist" aria-label="탐지 검토 상태">{([{ value: "ALL", label: "전체" }, { value: "PENDING", label: "검토 필요" }, { value: "CONFIRMED", label: "검토 완료" }, { value: "REJECTED", label: "제외" }] as const).map((item) => <button type="button" role="tab" aria-selected={filter === item.value} data-status={item.value} onClick={() => setFilter(item.value)} key={item.value}><span>{item.label}</span><b>{counts[item.value]}</b></button>)}</div>
    <div className={styles.toolbar}><SelectBox compact label="탐지 출처" value={purpose} options={purposeOptions} onChange={setPurpose} /><SelectBox compact label="정렬" value={sort} options={sortOptions} onChange={setSort} /><label className={styles.search}><Icon name="search" size={17} /><span className="sr-only">탐지 검색</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="탐지 번호 또는 객체 검색" /></label></div>
    {loading ? <div className={styles.loadingConsole} role="status" aria-label="탐지 결과를 불러오는 중입니다."><div><i /><i /><i /></div><div><i /></div><div><i /><i /><i /></div></div> : error ? <div className={styles.errorPanel} role="alert"><Icon name="info" size={21} /><div><strong>탐지 결과를 불러오지 못했습니다.</strong><span>서버 연결 상태를 확인한 후 다시 시도해 주세요.</span></div><button type="button" onClick={load}><Icon name="scanLine" size={16} />다시 불러오기</button></div> : !visible.length ? <div className={styles.emptyState}><Icon name="scanLine" size={30} /><strong>{events.length ? "확인할 탐지 결과가 없습니다." : "아직 확인할 탐지 결과가 없습니다."}</strong><span>{events.length ? "현재 조건에 해당하는 AI 탐지 결과가 없습니다." : "새로운 탐지 결과가 들어오면 이곳에서 검토할 수 있습니다."}</span>{filtersActive && <button type="button" onClick={resetFilters}>필터 초기화</button>}</div> : <div className={styles.workspace}>
      <section className={styles.queue} aria-label="탐지 대기열"><div className={styles.panelTitle}><h2>탐지 대기열</h2><span>{visible.length}건</span></div><div>{visible.map((event) => { const state = eventReview(event); const confidence = Math.max(0, ...event.detected_objects.map((object) => Number(object.confidence))); return <button type="button" aria-pressed={event.id === selected?.id} onClick={() => { setSelectedId(event.id); setSelectedObjectId(event.detected_objects[0]?.id ?? null); }} key={event.id}><Media compact src={eventImage(event)} alt={`탐지 #${event.id} 대표 이미지`} /><span><small data-status={state}><i />{reviewLabels[state]}</small><strong>탐지 #{event.id}</strong><em>{event.detected_objects[0] ? `${event.detected_objects[0].object_class_name}${event.detected_objects.length > 1 ? ` 외 ${event.detected_objects.length - 1}개` : ""}` : "객체 없음"}</em>{confidence > 0 && <b>AI {Math.round(confidence * 100)}%</b>}<time>{purposeLabels[event.purpose]} · {event.camera_id ? `카메라 #${event.camera_id}` : "카메라 정보 없음"}<br />{time.format(new Date(event.captured_at))}</time></span></button>; })}</div></section>
      <section className={styles.viewer} aria-labelledby="viewer-title"><div className={styles.viewerHead}><div><span>{purposeLabels[selected!.purpose]}</span><h2 id="viewer-title">탐지 #{selected!.id}</h2><p>{time.format(new Date(selected!.captured_at))} · {selected!.camera_id ? `카메라 #${selected!.camera_id}` : "카메라 정보 없음"} · {selected!.source_type}</p></div><b data-status={eventReview(selected!)}>{reviewLabels[eventReview(selected!)]}</b></div><div className={styles.mediaReview}><Media src={eventImage(selected!)} alt={`탐지 #${selected!.id} 탐지 미디어`} /><button type="button" ref={focusTriggerRef} onClick={() => setFocusedReview(true)}><Icon name="maximize" size={16} />확대해서 보기</button></div><div className={styles.objectSelector}><div><h3>탐지 객체</h3><span>{selected!.detected_objects.length}개</span></div>{selected!.detected_objects.length ? <div>{selected!.detected_objects.map((object) => <button type="button" aria-pressed={object.id === selectedObject?.id} onClick={() => setSelectedObjectId(object.id)} key={object.id}><span>{classLabel(object)}</span><b>{Math.round(Number(object.confidence) * 100)}%</b></button>)}</div> : <p>이 탐지에는 확인할 객체가 없습니다.</p>}</div></section>
      <aside className={styles.inspector} aria-labelledby="inspector-title"><div className={styles.panelTitle}><h2 id="inspector-title">객체 검토</h2>{selectedObject && <span>#{selectedObject.id}</span>}</div>{selectedObject ? <ObjectReview key={selectedObject.id} object={selectedObject} purpose={selected!.purpose} onSaved={updateObject} /> : <div className={styles.inspectorEmpty}>검토할 객체가 없습니다.</div>}</aside>
    </div>}
    {focusedReview && selected && <FocusedImageReview event={selected} object={selectedObject} onSelectObject={setSelectedObjectId} onSaved={updateObject} onClose={closeFocusedReview} />}
  </main>;
}
