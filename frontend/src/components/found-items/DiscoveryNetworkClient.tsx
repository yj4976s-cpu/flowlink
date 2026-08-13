"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { getCurrentUser } from "@/lib/authApi";
import { addCitizenSighting, createCitizenReport, getCitizenReport, listCitizenReports } from "@/lib/citizenReportsApi";
import { FoundItemListItem, FoundItemMapItem, listFoundItems, listMapFoundItems, resolveFoundItemImageUrl } from "@/lib/foundItemsApi";
import { loadKakaoMaps } from "@/lib/kakaoMapLoader";
import { listMyLostReports, LostReportResponse } from "@/lib/lostReportsApi";
import { listMyMatches, MatchCandidate } from "@/lib/matchesApi";
import { discoveryCategoryOptions, getItemTypeMeta, ITEM_TYPE_META, type ItemTypeFamily } from "@/lib/itemTypeMeta";
import type { KakaoCustomOverlay, KakaoMap, KakaoMapsNamespace } from "@/types/kakao-maps";
import type { CitizenReport, CitizenReportDraft, SightingDraft } from "@/types/discoveryNetwork";
import styles from "./DiscoveryNetworkClient.module.css";

type Tab = "items" | "citizen" | "map";
type Modal = "report" | "sighting" | null;
const personalCategories = ["공", "가방", "백팩", "우산", "신발", "슬리퍼"];
const statusLabels: Record<string, string> = { AVAILABLE: "보관 중", RECOVERED: "확인된 발견물", CLAIM_PENDING: "소유자 확인 중", RETURNED: "반환 완료" };
const DEFAULT_MAP_CENTER = { latitude: 37.5665, longitude: 126.978 };
const MAJOR_AREAS = [
  { name: "서울", latitude: 37.5665, longitude: 126.978, level: 7 },
  { name: "경기", latitude: 37.4138, longitude: 127.5183, level: 9 },
  { name: "인천", latitude: 37.4563, longitude: 126.7052, level: 7 },
  { name: "부산", latitude: 35.1796, longitude: 129.0756, level: 7 },
  { name: "대구", latitude: 35.8714, longitude: 128.6014, level: 7 },
  { name: "대전", latitude: 36.3504, longitude: 127.3845, level: 7 },
  { name: "광주", latitude: 35.1595, longitude: 126.8526, level: 7 },
  { name: "울산", latitude: 35.5384, longitude: 129.3114, level: 7 },
  { name: "세종", latitude: 36.4801, longitude: 127.289, level: 7 },
  { name: "강원", latitude: 37.8228, longitude: 128.1555, level: 9 },
  { name: "충북", latitude: 36.8, longitude: 127.7, level: 9 },
  { name: "충남", latitude: 36.5184, longitude: 126.8, level: 9 },
  { name: "전북", latitude: 35.7175, longitude: 127.153, level: 9 },
  { name: "전남", latitude: 34.8679, longitude: 126.991, level: 9 },
  { name: "경북", latitude: 36.4919, longitude: 128.8889, level: 9 },
  { name: "경남", latitude: 35.4606, longitude: 128.2132, level: 9 },
  { name: "제주", latitude: 33.4996, longitude: 126.5312, level: 8 },
] as const;
const MAJOR_AREA_NAMES: ReadonlySet<string> = new Set(MAJOR_AREAS.map((area) => area.name));
const date = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
const categoryOptions: SelectOption[] = discoveryCategoryOptions.map((item) => ({ value: item.filterValue, label: item.label, icon: item.icon, family: item.family }));
const reportCategoryOptions: SelectOption[] = [
  ITEM_TYPE_META.BALL, ITEM_TYPE_META.BAG, ITEM_TYPE_META.UMBRELLA, ITEM_TYPE_META.FOOTWEAR,
].map((item) => ({ value: item.filterValue, label: item.label, icon: item.icon, family: item.family }));
const statusOptions = [
  { value: "", label: "전체", icon: "category" as const, statusIdentity: "neutral" as const, separateAfter: true },
  { value: "AVAILABLE", label: "보관 중", icon: "archive" as const, statusIdentity: "stored" as const },
  { value: "RECOVERED", label: "확인된 발견물", icon: "locate" as const, statusIdentity: "discovered" as const },
  { value: "CLAIM_PENDING", label: "소유자 확인 중", icon: "userSearch" as const, statusIdentity: "progress" as const },
  { value: "RETURNED", label: "반환 완료", icon: "packageCheck" as const, statusIdentity: "complete" as const },
] satisfies SelectOption[];

type StatusIdentity = "neutral" | "stored" | "discovered" | "progress" | "complete";
type SelectOption = { value: string; label: string; icon?: Parameters<typeof Icon>[0]["name"]; family?: ItemTypeFamily; tone?: string; statusIdentity?: StatusIdentity; separateAfter?: boolean };

function FilterSelect({ label, value, options, onChange, disabled = false, selectedIndicator = true }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean; selectedIndicator?: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [open]);
  const choose = (index: number) => { onChange(options[index].value); setActive(index); setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { setOpen(false); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); setOpen(true);
      setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? (current + 1) % options.length : (current - 1 + options.length) % options.length);
    }
    if ((event.key === "Enter" || event.key === " ") && open) { event.preventDefault(); choose(active); }
  };
  return <div className={styles.filterField} ref={root}><span>{label}</span><button ref={trigger} className={styles.selectTrigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => { setActive(Math.max(0, options.indexOf(selected))); setOpen((current) => !current); }} onKeyDown={onKeyDown}>
    <span>{selected.icon && <i className={`${styles.optionIcon} ${selected.family ? styles[`family_${selected.family}`] : ""} ${selected.statusIdentity ? styles[`status_${selected.statusIdentity}`] : ""}`}><Icon name={selected.icon} size={17} /></i>}{selected.label}</span><Icon name="chevron" size={16} />
  </button>{open && <div className={styles.selectMenu} id={id} role="listbox" aria-label={label}>{options.map((option, index) => <button key={option.value || "all"} type="button" role="option" aria-selected={option.value === value} data-active={index === active} data-status-option={option.statusIdentity ? "true" : undefined} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
    <span className={option.separateAfter ? styles.optionSeparate : undefined}>{option.icon ? <i className={`${styles.optionIcon} ${option.family ? styles[`family_${option.family}`] : ""} ${option.statusIdentity ? styles[`status_${option.statusIdentity}`] : ""}`}><Icon name={option.icon} size={17} /></i> : <i className={styles[`tone_${option.tone}`]} />}{option.label}</span>{selectedIndicator && option.value === value && <i className={styles.selectedNode} aria-hidden="true" />}
  </button>)}</div>}</div>;
}

function DateFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const base = value ? new Date(`${value}T00:00:00`) : new Date();
  const [view, setView] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [open]);
  const first = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
  const total = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const serialize = (next: Date) => `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  const selectDay = (dateNumber: number) => { onChange(serialize(new Date(view.getFullYear(), view.getMonth(), dateNumber))); setOpen(false); };
  return <div className={styles.filterField} ref={root}><span>발견 날짜</span><button ref={trigger} className={styles.selectTrigger} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen((current) => !current)}><span><i className={styles.optionIcon}><Icon name="clock" size={16} /></i>{value || "날짜 선택"}</span><Icon name="chevron" size={16} /></button>
    {open && <div className={`${styles.selectMenu} ${styles.calendar}`} id={id}><div className={styles.calendarHead}><button type="button" aria-label="이전 달" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button><strong>{view.getFullYear()}년 {view.getMonth() + 1}월</strong><button type="button" aria-label="다음 달" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button></div><div className={styles.week}>{["일", "월", "화", "수", "목", "금", "토"].map((name) => <span key={name}>{name}</span>)}</div><div className={styles.days}>{Array.from({ length: first }, (_, index) => <i key={`blank-${index}`} />)}{Array.from({ length: total }, (_, index) => { const number = index + 1; const key = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, "0")}-${String(number).padStart(2, "0")}`; return <button type="button" key={key} aria-pressed={key === value} onClick={() => selectDay(number)}>{number}</button>; })}</div><div className={styles.calendarActions}><button type="button" onClick={() => { const today = new Date(); setView(new Date(today.getFullYear(), today.getMonth(), 1)); onChange(serialize(today)); setOpen(false); }}>오늘</button><button type="button" onClick={() => { onChange(""); setOpen(false); }}>날짜 초기화</button></div></div>}
  </div>;
}

function format(value: string, withTime = false) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "일시 확인 중" : (withTime ? date : day).format(parsed);
}

function matchesMapFilters(item: FoundItemMapItem, query: string, category: string, area: string, status: string, foundDate: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const text = `${item.public_description ?? ""} ${item.item_category_name} ${item.item_category} ${item.color ?? ""} ${item.area_name}`.toLowerCase();
  return personalCategories.some((name) => item.item_category_name.includes(name))
    && (!normalizedQuery || text.includes(normalizedQuery))
    && (!category || item.item_category === category || item.item_category_name.includes(category))
    && (!area || item.area_name.toLowerCase().includes(area.trim().toLowerCase()))
    && (!status || item.status === status)
    && (!foundDate || item.found_at.startsWith(foundDate));
}

function getAreaOptions(...groups: Array<Array<{ area_name?: string; areaName?: string }>>) {
  const registeredAreas = groups.flatMap((items) => items.map((item) => item.area_name ?? item.areaName ?? "").filter(Boolean)).sort((a, b) => a.localeCompare(b, "ko"));
  return Array.from(new Set([...MAJOR_AREAS.map((area) => area.name), ...registeredAreas]));
}

function getMajorAreaTarget(area: string) {
  const keyword = area.trim().toLowerCase();
  return MAJOR_AREAS.find((item) => item.name.toLowerCase() === keyword);
}

function AreaPicker({ value, options, onChange, onSelect }: { value: string; options: string[]; onChange: (value: string) => void; onSelect?: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [suggestionsStyle, setSuggestionsStyle] = useState<CSSProperties>();
  const root = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const visibleOptions = useMemo(() => {
    const keyword = value.trim().toLowerCase();
    const majorOptions = options.filter((option) => MAJOR_AREA_NAMES.has(option));
    const registeredOptions = options.filter((option) => !MAJOR_AREA_NAMES.has(option) && (!keyword || option.toLowerCase().includes(keyword))).slice(0, 8);
    return [...majorOptions, ...registeredOptions];
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !suggestionsRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, Math.max(260, window.innerWidth - rect.left - 16));
      const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
      setSuggestionsStyle({ left, top: rect.bottom + 7, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const choose = (nextArea: string) => {
    onChange(nextArea);
    onSelect?.(nextArea);
    setOpen(false);
  };

  const suggestions = open ? <div className={styles.areaSuggestions} id={id} style={suggestionsStyle} ref={suggestionsRef}><strong>주요 지역 / 등록 구역</strong>{visibleOptions.length ? visibleOptions.map((option) => <button type="button" key={option} onClick={() => choose(option)}><Icon name="location" size={15} /><span>{option}</span></button>) : <p>일치하는 지역이 없습니다.</p>}</div> : null;

  return <div className={`${styles.locationField} ${styles.areaPicker}`} ref={root}><span>지역</span><div><Icon name="location" size={16} /><input value={value} onChange={(event) => { onChange(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="대략적인 발견 구역" aria-controls={id} /><button className={styles.areaSearchButton} type="button" onClick={() => setOpen((current) => !current)} aria-label="지역 목록 열기" aria-controls={id} aria-expanded={open}><Icon name="search" size={15} /></button></div>{suggestions && typeof document !== "undefined" ? createPortal(suggestions, document.body) : suggestions}</div>;
}

function createAreaMapMarker(item: FoundItemMapItem, selected: boolean, onSelect: () => void) {
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = `${styles.mapMarker} ${selected ? styles.mapMarkerSelected : ""}`;
  marker.setAttribute("aria-label", `${item.item_category_name} 지도 마커 선택`);
  const dot = document.createElement("span");
  dot.className = styles.mapMarkerDot;
  const label = document.createElement("span");
  label.className = styles.mapMarkerLabel;
  label.textContent = item.item_category_name;
  marker.append(dot, label);
  marker.addEventListener("click", onSelect);
  return marker;
}

function itemVisualClass(item: Pick<FoundItemListItem, "item_category" | "item_category_name">) {
  const meta = getItemTypeMeta(item.item_category, item.item_category_name);
  if (meta.family === "umbrella") return styles.umbrella;
  if (meta.family === "bag") return styles.backpack;
  if (meta.family === "ball") return styles.ball;
  return styles.shoe;
}

function ItemVisual({ item, source = "AI 탐지" }: { item: Pick<FoundItemListItem, "item_category" | "item_category_name" | "image_url">; source?: string }) {
  const imageUrl = resolveFoundItemImageUrl(item.image_url);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <div className={`${styles.visual} ${itemVisualClass(item)}`}>{imageUrl && failedUrl !== imageUrl && <img src={imageUrl} alt={`${item.item_category_name} 발견물 이미지`} onError={() => setFailedUrl(imageUrl)} />}<span className={source === "발견 제보" ? styles.sourceCitizen : styles.sourceAi}>{source}</span></div>;
}

function OfficialCard({ item }: { item: FoundItemListItem }) {
  return <article className={styles.card}>
    <ItemVisual item={item} />
    <div className={styles.cardBody}><div className={styles.cardHead}><span>{item.item_category_name}</span><b>{statusLabels[item.status] ?? item.status}</b></div>
      <h3>{item.public_description || `${item.item_category_name} 발견물`}</h3>
      <p>{format(item.found_at)} · {item.area_name}</p><p>{item.color || "색상 미상"} 계열</p>
      <Link href={`/found-items/${item.id}`}>상세 보기 <Icon name="chevronRight" size={15} /></Link>
    </div>
  </article>;
}

function RecommendationCard({ match }: { match: MatchCandidate }) {
  return <article className={styles.recommendCard}>
    <ItemVisual item={match.found_item} />
    <div><span className={styles.similarity}>{match.total_score}점 · 일치 가능성 높음</span><h3>{match.found_item.public_description || match.found_item.item_category_name}</h3>
      <p>{match.found_item.area_name}</p><p>{format(match.found_item.found_at)} · AI 탐지</p>
      <Link className="button button-secondary" href="/matches">비교하기</Link></div>
  </article>;
}

function CitizenCard({ report, onOpen }: { report: CitizenReport; onOpen: () => void }) {
  return <button className={`${styles.card} ${styles.citizenCard}`} type="button" onClick={onOpen}>
    <CitizenVisual report={report} />
    <div className={styles.cardBody}><div className={styles.cardHead}><span>{report.category}</span><b>{report.status}</b></div><h3>{report.title}</h3>
      <p>{report.areaName} · {format(report.foundAt, true)}</p><p>{report.description}</p>
      <div className={styles.cardLink}><span>추가 목격 {Math.max(0, report.history.length - 1)}건</span><span>상세 보기 <Icon name="chevronRight" size={15} /></span></div>
    </div>
  </button>;
}

function CitizenVisual({ report, detail = false }: { report: CitizenReport; detail?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <div className={`${detail ? styles.detailVisual : styles.visual} ${styles[report.imageClass]}`}>{report.imageUrl && failedUrl !== report.imageUrl && <img src={report.imageUrl} alt={`${report.title} 발견 제보 이미지`} onError={() => setFailedUrl(report.imageUrl)} />}{!detail && <span className={styles.sourceCitizen}>발견 제보</span>}</div>;
}

export function DiscoveryNetworkClient() {
  const [tab, setTab] = useState<Tab>(() => typeof window !== "undefined" && window.location.hash === "#citizen" ? "citizen" : "items");
  const [items, setItems] = useState<FoundItemListItem[]>([]);
  const [reports, setReports] = useState<CitizenReport[]>([]);
  const [matches, setMatches] = useState<MatchCandidate[]>([]);
  const [lostReports, setLostReports] = useState<LostReportResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [citizenError, setCitizenError] = useState<string | null>(null);
  const [submitKind, setSubmitKind] = useState<"report" | "sighting" | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [area, setArea] = useState("");
  const [status, setStatus] = useState("");
  const [foundDate, setFoundDate] = useState("");
  const [selectedReport, setSelectedReport] = useState<CitizenReport | null>(null);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const detailRequest = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      const [citizenResult, userResult] = await Promise.allSettled([listCitizenReports(), getCurrentUser()]);
      if (citizenResult.status === "fulfilled") setReports(citizenResult.value);
      else setCitizenError("발견 제보를 불러오지 못했습니다.");
      if (userResult.status === "fulfilled") {
        const [matchResult, lostResult] = await Promise.allSettled([listMyMatches(controller.signal), listMyLostReports(controller.signal)]);
        if (matchResult.status === "fulfilled") setMatches(matchResult.value);
        if (lostResult.status === "fulfilled") setLostReports(lostResult.value);
      }
      if (!controller.signal.aborted) setLoading(false);
    };
    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setSectionError(null);
      void listFoundItems({ q: query, item_category: category, area_name: area, status, found_date: foundDate }, controller.signal)
        .then((result) => setItems(result.filter((item) => personalCategories.some((name) => item.item_category_name.includes(name)))))
        .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setSectionError("공식 발견물을 불러오지 못했습니다."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [area, category, foundDate, query, status]);

  useEffect(() => {
    if (!modal && !selectedReport) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setModal(null); detailRequest.current += 1; setDetailRefreshing(false); setSelectedReport(null); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [modal, selectedReport]);

  const filteredItems = items;
  const filteredReports = useMemo(() => reports.filter((report) => `${report.title} ${report.description} ${report.areaName}`.toLowerCase().includes(query.toLowerCase()) && (!category || report.category.includes(category)) && (!area || report.areaName.includes(area)) && (!foundDate || report.foundAt.startsWith(foundDate))), [area, category, foundDate, query, reports]);
  const areaOptions = useMemo(() => getAreaOptions(items, reports), [items, reports]);
  const activeReport = lostReports.find((report) => ["OPEN", "MATCHED", "CLAIM_PENDING"].includes(report.status));

  const resetFilters = () => { setQuery(""); setCategory(""); setArea(""); setStatus(""); setFoundDate(""); };
  const openCitizenReport = (report: CitizenReport) => {
    setSelectedReport(report);
    const request = ++detailRequest.current;
    setDetailRefreshing(true);
    void getCitizenReport(report.id).then((fresh) => {
      if (request !== detailRequest.current) return;
      setSelectedReport(fresh);
      setReports((current) => current.map((item) => item.id === fresh.id ? fresh : item));
    }).catch(() => {
      // Keep the already-rendered server list data when a background refresh fails.
    }).finally(() => { if (request === detailRequest.current) setDetailRefreshing(false); });
  };
  const closeCitizenReport = () => { detailRequest.current += 1; setDetailRefreshing(false); setSelectedReport(null); };
  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const photo = data.get("photo") as File;
    setSubmitKind("report"); setSubmitError("");
    try {
      const created = await createCitizenReport({ category: String(data.get("category")), color: String(data.get("color")), description: String(data.get("description")), areaName: String(data.get("areaName")), foundAt: String(data.get("foundAt")), image: photo.size ? photo : undefined } satisfies CitizenReportDraft);
      setReports((current) => [created, ...current]); setModal(null); setTab("citizen");
    } catch { setSubmitError("제보 등록에 실패했습니다. 입력 내용을 확인하고 다시 시도해 주세요."); }
    finally { setSubmitKind(null); }
  };
  const submitSighting = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedReport) return;
    const data = new FormData(event.currentTarget);
    const photo = data.get("photo") as File;
    setSubmitKind("sighting"); setSubmitError("");
    try {
      const updated = await addCitizenSighting(selectedReport.id, { foundAt: String(data.get("foundAt")), areaName: String(data.get("areaName")), description: String(data.get("description")), image: photo.size ? photo : undefined } satisfies SightingDraft);
      setReports((current) => current.map((report) => report.id === updated.id ? updated : report)); setSelectedReport(updated); setModal(null);
    } catch { setSubmitError("목격 정보 등록에 실패했습니다. 입력 내용을 확인하고 다시 시도해 주세요."); }
    finally { setSubmitKind(null); }
  };

  return <main className={styles.page}>
    <section className={styles.hero}><div><p>DISCOVERY CENTER</p><h1>발견물 센터</h1><span>AI 탐지와 발견 제보로 확인된 물품을 한곳에서 살펴보고 내 분실 신고와 비교해 보세요.</span></div><aside className={styles.smartPanel}><Icon name="match" size={22} /><div><b>내 신고와 비교하기</b><span>등록한 분실 신고와 유사한 발견물을 확인해 보세요.</span></div><Link href="/matches">내 신고 확인 <Icon name="chevronRight" size={15} /></Link></aside></section>

    <section className={styles.recommendations} aria-labelledby="recommend-title"><div className={styles.sectionHeading}><div><p>SMART MATCH</p><h2 id="recommend-title">내 신고와 비슷한 발견물</h2></div>{matches.length > 3 && <Link href="/matches">전체 보기</Link>}</div>
      {loading ? <div className={styles.skeletonRow}>{[0, 1, 2].map((key) => <i key={key} />)}</div> : matches.length > 0 ? <div className={styles.recommendGrid}>{matches.slice(0, 3).map((match) => <RecommendationCard key={match.id} match={match} />)}</div> : <div className={styles.matchEmpty}><Icon name="match" size={28} /><div><strong>{activeReport ? "아직 비슷한 발견물을 찾지 못했어요." : "잃어버린 물건이 있나요?"}</strong><p>{activeReport ? "새로운 발견물이 등록되면 신고 내용과 다시 비교해 드려요." : "분실 신고를 등록하면 새로운 발견물과 자동으로 비교해 드려요."}</p></div>{!activeReport && <Link className="button button-primary" href="/lost-reports/new">분실 신고하기</Link>}</div>}
    </section>

    <div className={styles.tabs} role="tablist" aria-label="발견물 센터 콘텐츠"><button role="tab" aria-selected={tab === "items"} onClick={() => setTab("items")}><Icon name="scan" size={18} /><span><b>발견물</b><small>AI 탐지·확인 물품</small></span></button><button role="tab" aria-selected={tab === "citizen"} onClick={() => setTab("citizen")}><Icon name="eye" size={18} /><span><b>발견 제보</b><small>시민이 남긴 목격</small></span></button><button role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}><Icon name="location" size={18} /><span><b>지도에서 찾기</b><small>발견 구역 탐색</small></span></button></div>

    <section className={styles.filters} aria-label="검색 및 필터"><label className={styles.search}><span className="sr-only">검색</span><Icon name="search" size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="물품명이나 기억나는 특징을 검색해보세요" /></label><div className={styles.filterRow}>
      <FilterSelect label="물품 종류" value={category} options={categoryOptions} onChange={setCategory} />
      <AreaPicker value={area} options={areaOptions} onChange={setArea} />
      <DateFilter value={foundDate} onChange={setFoundDate} />
      {tab === "items" && <FilterSelect label="상태" value={status} options={statusOptions} onChange={setStatus} selectedIndicator={false} />}
      <button className={styles.reset} type="button" onClick={resetFilters} disabled={!query && !category && !area && !status && !foundDate}>필터 초기화</button></div>
    </section>

    {tab === "items" && <section aria-labelledby="official-title"><div className={styles.sectionHeading}><div><p>OFFICIAL ITEMS</p><h2 id="official-title">확인된 발견물</h2></div><span>{filteredItems.length}건</span></div>
      {loading ? <SkeletonGrid /> : sectionError ? <State title="발견물 정보를 가져오지 못했어요" text="잠시 후 다시 시도해 주세요." error action={<button className="button button-secondary" onClick={() => window.location.reload()}>다시 불러오기</button>} /> : filteredItems.length ? <div className={styles.grid}>{filteredItems.map((item) => <OfficialCard item={item} key={item.id} />)}</div> : <State title="조건에 맞는 발견물이 없어요" text="필터를 변경하거나 다른 검색어를 사용해 보세요." action={<button className="button button-secondary" onClick={resetFilters}>필터 초기화</button>} />}</section>}

    {tab === "citizen" && <section aria-labelledby="citizen-title"><div className={styles.sectionHeading}><div><p>CITIZEN SIGHTINGS</p><h2 id="citizen-title">시민 발견 제보</h2></div><button className="button button-primary" type="button" onClick={() => { setSubmitError(""); setModal("report"); }}>+ 발견물 제보하기</button></div>
      {loading ? <SkeletonGrid /> : citizenError ? <State title="발견 제보를 가져오지 못했어요" text="API 오류는 빈 목록과 구분해 표시됩니다." error action={<button className="button button-secondary" onClick={() => window.location.reload()}>다시 불러오기</button>} /> : filteredReports.length ? <div className={styles.grid}>{filteredReports.map((report) => <CitizenCard report={report} key={report.id} onOpen={() => openCitizenReport(report)} />)}</div> : <State title="아직 등록된 발견 제보가 없어요." text="수변에서 발견한 물건이 있다면 첫 제보를 남겨주세요." action={<button className="button button-primary" onClick={() => { setSubmitError(""); setModal("report"); }}>발견물 제보하기</button>} />}</section>}

    {tab === "map" && <MapPanel query={query} category={category} area={area} status={status} foundDate={foundDate} />}
    {activeReport && <Progress report={activeReport} hasMatch={matches.length > 0} />}
    {selectedReport && <CitizenDetail report={selectedReport} refreshing={detailRefreshing} onClose={closeCitizenReport} onSighting={() => { setSubmitError(""); setModal("sighting"); }} />}
    {modal === "report" && <ReportModal onClose={() => setModal(null)} onSubmit={submitReport} pending={submitKind === "report"} error={submitError} />}
    {modal === "sighting" && selectedReport && <SightingModal report={selectedReport} onClose={() => setModal(null)} onSubmit={submitSighting} pending={submitKind === "sighting"} error={submitError} />}
  </main>;
}

function SkeletonGrid() { return <div className={styles.skeletonGrid} role="status"><span className="sr-only">목록을 불러오는 중입니다.</span>{[0, 1, 2].map((key) => <i key={key} />)}</div>; }
function State({ title, text, error, action }: { title: string; text: string; error?: boolean; action?: ReactNode }) { return <div className={`${styles.state} ${error ? styles.error : ""}`}><Icon name={error ? "spark" : "document"} size={25} /><div><strong>{title}</strong><p>{text}</p>{action}</div></div>; }

function MapPanel({ query, category, area, status, foundDate }: { query: string; category: string; area: string; status: string; foundDate: string }) {
  const [mapItems, setMapItems] = useState<FoundItemMapItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingMapItems, setLoadingMapItems] = useState(true);
  const [itemsError, setItemsError] = useState("");
  const [mapLoadError, setMapLoadError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const mapsRef = useRef<KakaoMapsNamespace | null>(null);
  const overlaysRef = useRef<Map<number, KakaoCustomOverlay>>(new Map());
  const filteredMapItems = useMemo(() => mapItems.filter((item) => matchesMapFilters(item, query, category, area, status, foundDate)), [area, category, foundDate, mapItems, query, status]);
  const selected = filteredMapItems.find((item) => item.id === selectedId) ?? filteredMapItems[0] ?? null;

  useEffect(() => {
    const controller = new AbortController();
    void listMapFoundItems(controller.signal)
      .then((result) => setMapItems(result))
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setItemsError(error instanceof Error ? error.message : "지도 발견물을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setLoadingMapItems(false); });
    return () => controller.abort();
  }, [retryKey]);

  useEffect(() => {
    let cancelled = false;
    const overlays = overlaysRef.current;
    void loadKakaoMaps().then((maps) => {
      if (cancelled || !mapContainerRef.current) return;
      mapsRef.current = maps;
      if (!mapRef.current) {
        const center = new maps.LatLng(DEFAULT_MAP_CENTER.latitude, DEFAULT_MAP_CENTER.longitude);
        const map = new maps.Map(mapContainerRef.current, { center, level: 7 });
        mapRef.current = map;
      }
      setMapReady(true);
    }).catch((error) => setMapLoadError(error instanceof Error ? error.message : "지도를 불러오지 못했습니다."));
    return () => { cancelled = true; overlays.forEach((overlay) => overlay.setMap(null)); overlays.clear(); };
  }, []);

  const selectMapItem = useCallback((item: FoundItemMapItem) => {
    setSelectedId(item.id);
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (maps && map) map.panTo(new maps.LatLng(item.latitude, item.longitude));
  }, []);

  const fitMapToItems = useCallback(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;
    if (!filteredMapItems.length) {
      const target = getMajorAreaTarget(area);
      if (target) {
        map.setCenter(new maps.LatLng(target.latitude, target.longitude));
        map.setLevel(target.level);
      }
      return;
    }
    if (filteredMapItems.length === 1) {
      map.setCenter(new maps.LatLng(filteredMapItems[0].latitude, filteredMapItems[0].longitude));
      map.setLevel(5);
      return;
    }
    const bounds = new maps.LatLngBounds();
    filteredMapItems.forEach((item) => bounds.extend(new maps.LatLng(item.latitude, item.longitude)));
    map.setBounds(bounds);
  }, [area, filteredMapItems]);

  const zoomMap = useCallback((direction: "in" | "out") => {
    const map = mapRef.current;
    if (!map) return;
    map.setLevel(direction === "in" ? Math.max(1, map.getLevel() - 1) : Math.min(14, map.getLevel() + 1));
  }, []);

  useEffect(() => {
    if (!mapExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMapExpanded(false); };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [mapExpanded]);

  useEffect(() => {
    if (!mapReady) return;
    const timeoutId = window.setTimeout(() => {
      mapRef.current?.relayout?.();
      fitMapToItems();
    }, 160);
    return () => window.clearTimeout(timeoutId);
  }, [fitMapToItems, mapExpanded, mapReady]);

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map || !mapReady) return;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current.clear();
    if (!filteredMapItems.length) {
      const target = getMajorAreaTarget(area);
      map.setCenter(new maps.LatLng(target?.latitude ?? DEFAULT_MAP_CENTER.latitude, target?.longitude ?? DEFAULT_MAP_CENTER.longitude));
      map.setLevel(target?.level ?? 8);
      return;
    }
    const bounds = new maps.LatLngBounds();
    filteredMapItems.forEach((item) => {
      const position = new maps.LatLng(item.latitude, item.longitude);
      bounds.extend(position);
      const overlay = new maps.CustomOverlay({ position, content: createAreaMapMarker(item, item.id === selected?.id, () => selectMapItem(item)), yAnchor: 1.05, zIndex: item.id === selected?.id ? 20 : 10 });
      overlay.setMap(map);
      overlaysRef.current.set(item.id, overlay);
    });
    if (filteredMapItems.length === 1) {
      map.setCenter(new maps.LatLng(filteredMapItems[0].latitude, filteredMapItems[0].longitude));
      map.setLevel(5);
    } else {
      map.setBounds(bounds);
    }
  }, [area, filteredMapItems, mapReady, selected?.id, selectMapItem]);

  return <section aria-labelledby="map-title"><div className={styles.sectionHeading}><div><p>AREA MAP</p><h2 id="map-title">지도에서 찾기</h2></div><span>대략적인 발견 구역</span></div><div className={styles.mapLayout}>
    <aside className={styles.mapListPanel}><div className={styles.mapListHead}><span>PUBLIC MAP</span><strong>현재 표시 {filteredMapItems.length}개</strong></div>
      {loadingMapItems ? <div className={styles.mapSideState}>지도 발견물을 불러오는 중입니다.</div> : itemsError ? <div className={`${styles.mapSideState} ${styles.mapSideError}`}>지도 정보를 불러오지 못했습니다.<button type="button" onClick={() => { setLoadingMapItems(true); setItemsError(""); setRetryKey((value) => value + 1); }}>다시 시도</button></div> : filteredMapItems.length ? <div className={styles.mapList}>{filteredMapItems.map((item) => <button key={item.id} type="button" className={item.id === selected?.id ? styles.mapListSelected : undefined} onClick={() => selectMapItem(item)}><span>{item.item_category_name}</span><strong>{item.public_description || `${item.color ?? "색상 미상"} ${item.item_category_name}`}</strong><small>{item.area_name} · {format(item.found_at, true)}</small></button>)}</div> : <div className={styles.mapSideState}>지도에 표시할 공개 발견물이 아직 없습니다.</div>}
    </aside><div className={`${styles.map} ${mapExpanded ? styles.mapExpanded : ""}`} role={mapExpanded ? "dialog" : undefined} aria-modal={mapExpanded ? "true" : undefined} aria-label={mapExpanded ? "확대된 발견물 센터 지도" : undefined}><div ref={mapContainerRef} className={styles.mapCanvas} aria-label="공개 발견물 지도" /><div className={styles.mapTopControls}><button type="button" onClick={fitMapToItems} disabled={!filteredMapItems.length}>전체 보기</button><button type="button" onClick={() => setMapExpanded((current) => !current)}>{mapExpanded ? "닫기" : "크게 보기"}</button></div><div className={styles.mapZoomControls} aria-label="지도 확대 축소"><button type="button" onClick={() => zoomMap("in")} aria-label="지도 확대">+</button><button type="button" onClick={() => zoomMap("out")} aria-label="지도 축소">−</button></div>{mapLoadError ? <div className={`${styles.mapOverlayState} ${styles.mapSideError}`}>{mapLoadError}</div> : !mapReady && <div className={styles.mapOverlayState}>Kakao 지도를 준비하고 있습니다.</div>}{selected && <div className={styles.mapPreview}><b>{statusLabels[selected.status] ?? selected.status}</b><h3>{selected.public_description || selected.item_category_name}</h3><p>{selected.area_name} · {format(selected.found_at, true)}</p><Link href={`/found-items/${selected.id}`}>발견물 보기</Link></div>}<div className={styles.legend}><span><i /> 공개 발견물</span><span>대략 위치</span></div></div>
  </div><p className={styles.mapNotice}>개인정보와 보관 안전을 위해 정확한 위치가 아닌 대략적인 발견 구역만 표시합니다.</p></section>;
}

function Progress({ report, hasMatch }: { report: LostReportResponse; hasMatch: boolean }) { const current = report.status === "RESOLVED" ? 4 : report.status === "CLAIM_PENDING" ? 2 : hasMatch ? 1 : 0; return <section className={styles.progress}><div><p>FINDING PROGRESS</p><h2>찾기 진행상황</h2><span>{report.item_category_name} · {report.area_name}</span></div><ol>{["분실 신고 접수", "유사 발견물 매칭", "소유권 확인", "반환 준비", "반환 완료"].map((label, index) => <li className={index <= current ? styles.done : ""} key={label}><i>{index < current ? "✓" : index + 1}</i><span>{label}</span></li>)}</ol></section>; }

function CitizenDetail({ report, refreshing, onClose, onSighting }: { report: CitizenReport; refreshing: boolean; onClose: () => void; onSighting: () => void }) { return <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.modal} ${styles.detailModal}`} role="dialog" aria-modal="true" aria-labelledby="citizen-detail-title"><button className={styles.close} onClick={onClose} aria-label="상세 닫기"><Icon name="close" size={20} /></button><CitizenVisual report={report} detail /><div className={styles.detailContent}><div><span className={styles.sourceCitizen}>발견 제보</span><span className={styles.status}>{report.status}</span>{refreshing && <span className={styles.detailRefreshing} role="status">최신 정보 확인 중</span>}</div><h2 id="citizen-detail-title">{report.title}</h2><p>{format(report.foundAt, true)} · {report.areaName}</p><p>{report.description}</p><div className={styles.timeline}><h3>발견 히스토리</h3>{report.history.map((history) => <div key={history.id}><i /><time>{format(history.at, true)}</time><strong>{history.label}</strong><span>{history.place}{history.detail ? ` · ${history.detail}` : ""}</span>{history.imageUrl && <SightingThumbnail src={history.imageUrl} label={`${history.label} 이미지`} />}</div>)}</div><button className="button button-primary" onClick={onSighting}>이 물건을 봤어요</button></div></section></div>; }

function SightingThumbnail({ src, label }: { src: string; label: string }) { const [failed, setFailed] = useState(false); return failed ? null : <img className={styles.sightingImage} src={src} alt={label} onError={() => setFailed(true)} />; }

function Fields({ sighting = false, category = "", onCategoryChange, disabled = false }: { sighting?: boolean; category?: string; onCategoryChange?: (value: string) => void; disabled?: boolean }) { return <><label>{sighting ? "목격 시간" : "발견 날짜 / 시간"}<input required name="foundAt" type="datetime-local" disabled={disabled} /></label><label>{sighting ? "목격 장소" : "발견 지역"}<input required name="areaName" placeholder="정확한 GPS 대신 대략적인 장소" disabled={disabled} /></label>{!sighting && <><input type="hidden" name="category" value={category} /><FilterSelect label="물품 종류" value={category} options={reportCategoryOptions} onChange={(value) => onCategoryChange?.(value)} disabled={disabled} /><label>색상<input required name="color" placeholder="예: 검정색" disabled={disabled} /></label></>}<label>추가 특징<textarea required minLength={5} name="description" placeholder="공개 가능한 특징을 적어주세요." disabled={disabled} /></label><label>사진 <span>(선택)</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} /></label></>; }
function ReportModal({ onClose, onSubmit, pending, error }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean; error: string }) { const [category, setCategory] = useState("공"); return <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && !pending && onClose()}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="report-title"><button className={styles.close} onClick={onClose} disabled={pending} aria-label="제보 등록 닫기"><Icon name="close" size={20} /></button><p>NEW REPORT</p><h2 id="report-title">발견물 제보하기</h2><form onSubmit={onSubmit}><Fields category={category} onCategoryChange={setCategory} disabled={pending} />{error && <p className={styles.formError} role="alert">{error}</p>}<div><button type="button" className="button button-secondary" onClick={onClose} disabled={pending}>취소</button><button className="button button-primary" disabled={pending}>{pending ? "등록 중..." : "제보 등록"}</button></div></form></section></div>; }
function SightingModal({ report, onClose, onSubmit, pending, error }: { report: CitizenReport; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean; error: string }) { return <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && !pending && onClose()}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="sighting-title"><button className={styles.close} onClick={onClose} disabled={pending} aria-label="추가 목격 닫기"><Icon name="close" size={20} /></button><p>SIGHTING</p><h2 id="sighting-title">이 물건을 봤어요</h2><span>{report.title}의 새로운 목격 정보를 추가합니다.</span><form onSubmit={onSubmit}><Fields sighting disabled={pending} />{error && <p className={styles.formError} role="alert">{error}</p>}<div><button type="button" className="button button-secondary" onClick={onClose} disabled={pending}>취소</button><button className="button button-primary" disabled={pending}>{pending ? "등록 중..." : "목격 추가"}</button></div></form></section></div>; }
