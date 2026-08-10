"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  createLostReport,
  LostReportResponse,
  LostReportsApiError,
  type LostReportCreateRequest,
} from "@/lib/lostReportsApi";
import { ITEM_TYPE_META } from "@/lib/itemTypeMeta";
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
  ITEM_TYPE_META.BALL,
  ITEM_TYPE_META.BAG,
  ITEM_TYPE_META.UMBRELLA,
  ITEM_TYPE_META.FOOTWEAR,
] .map((item) => ({ code: item.apiCode!, label: item.label, icon: item.icon })) as Array<{
  code: "BALL" | "BAG" | "UMBRELLA" | "FOOTWEAR";
  label: string;
  icon: typeof ITEM_TYPE_META.BALL.icon;
}>;

type ExampleCategory = "형태·구조" | "표시·장식" | "사용 흔적";
type DescriptionExample = { text: string; category: ExampleCategory; keywords: string[] };
const example = (text: string, category: ExampleCategory, keywords: string[]): DescriptionExample => ({ text, category, keywords });
const descriptionExamples: Record<string, DescriptionExample[]> = {
  BAG: [
    example("앞주머니에 작은 키링이 달려 있어요.", "표시·장식", ["키링", "앞주머니"]), example("앞면 중앙에 작은 로고가 있어요.", "표시·장식", ["로고"]),
    example("오른쪽 어깨끈 부분에 작은 흠집이 있어요.", "사용 흔적", ["끈", "흠집"]), example("양옆에 물병을 넣을 수 있는 주머니가 있어요.", "형태·구조", ["앞주머니", "내부 특징"]),
    example("지퍼 손잡이에 짧은 끈이 달려 있어요.", "형태·구조", ["지퍼", "끈"]), example("아래쪽 모서리 부분이 조금 닳아 있어요.", "사용 흔적", ["마모"]),
    example("앞면에 작은 금속 장식이 붙어 있어요.", "표시·장식", ["장식"]), example("손잡이 부분이 가죽 재질로 되어 있어요.", "형태·구조", ["끈"]),
    example("앞주머니가 두 개로 나뉘어 있어요.", "형태·구조", ["앞주머니"]), example("지퍼 손잡이 한쪽이 조금 벗겨져 있어요.", "사용 흔적", ["지퍼", "마모"]),
  ],
  UMBRELLA: [
    example("곡선 형태의 손잡이가 달려 있어요.", "형태·구조", ["곡선 손잡이", "손잡이"]), example("접어서 보관할 수 있는 접이식 우산이에요.", "형태·구조", ["접이식"]),
    example("손잡이 부분에 작은 흠집이 있어요.", "사용 흔적", ["손잡이", "흠집"]), example("가장자리에 얇은 테두리 무늬가 있어요.", "표시·장식", ["무늬"]),
    example("손목에 걸 수 있는 짧은 스트랩이 달려 있어요.", "형태·구조", ["스트랩"]), example("손잡이가 나무 재질로 되어 있어요.", "형태·구조", ["손잡이"]),
    example("우산 천에 반복되는 작은 무늬가 있어요.", "표시·장식", ["무늬"]), example("우산 끝부분이 조금 벗겨져 있어요.", "사용 흔적", ["흠집", "사용감"]),
    example("접는 부분에 고정용 밴드가 달려 있어요.", "형태·구조", ["고정 밴드"]), example("손잡이 끝부분에 작은 장식이 붙어 있어요.", "표시·장식", ["손잡이", "장식"]),
  ],
  BALL: [
    example("표면에 반복되는 패턴이 들어가 있어요.", "표시·장식", ["무늬"]), example("한쪽 면에 브랜드 로고가 있어요.", "표시·장식", ["로고"]),
    example("표면에 이름이나 글씨가 적혀 있어요.", "표시·장식", ["이름 표시"]), example("한쪽 부분에 긁힌 자국이 있어요.", "사용 흔적", ["스크래치"]),
    example("표면 일부가 조금 벗겨져 있어요.", "사용 흔적", ["표면 손상"]), example("여러 조각이 이어진 형태의 무늬가 있어요.", "형태·구조", ["무늬"]),
    example("한쪽 면에 작은 사인이 적혀 있어요.", "표시·장식", ["사인"]), example("공기 주입구 주변에 작은 표시가 있어요.", "형태·구조", ["공기 주입구"]),
    example("표면에 길게 이어지는 줄무늬가 있어요.", "표시·장식", ["줄무늬"]), example("일부분이 다른 부분보다 많이 닳아 있어요.", "사용 흔적", ["사용감"]),
  ],
  FOOTWEAR: [
    example("옆면에 작은 브랜드 로고가 있어요.", "표시·장식", ["로고"]), example("신발끈 한쪽이 다른 쪽보다 짧아요.", "형태·구조", ["끈", "좌우 차이"]),
    example("앞부분에 작은 긁힌 자국이 있어요.", "사용 흔적", ["흠집"]), example("밑창 한쪽이 조금 닳아 있어요.", "사용 흔적", ["밑창", "마모"]),
    example("뒤꿈치 부분에 작은 로고가 있어요.", "표시·장식", ["로고"]), example("한쪽에만 작은 장식이 달려 있어요.", "표시·장식", ["장식", "좌우 차이"]),
    example("신발끈에 작은 장식이나 태그가 달려 있어요.", "표시·장식", ["끈", "장식"]), example("옆면 봉제선 부분에 작은 흠집이 있어요.", "사용 흔적", ["봉제선", "흠집"]),
    example("밑창에 반복되는 무늬가 들어가 있어요.", "형태·구조", ["밑창"]), example("한쪽 앞부분이 다른 쪽보다 조금 더 닳아 있어요.", "사용 흔적", ["마모", "좌우 차이"]),
  ],
};

const colorGroups = [
  { name: "무채색", colors: ["검정", "흰색", "회색"] }, { name: "Natural", colors: ["아이보리", "크림", "베이지", "갈색"] },
  { name: "Warm", colors: ["빨강", "주황", "노랑", "분홍"] }, { name: "Cool", colors: ["연두", "초록", "민트", "하늘", "파랑", "남색", "보라"] },
  { name: "Special", colors: ["투명"] },
];
const colorFamilies: Record<string, string[]> = { 파랑: ["하늘", "파랑", "진파랑", "남색"], 베이지: ["아이보리", "크림", "베이지", "카멜"], 초록: ["연두", "초록", "민트"], 빨강: ["분홍", "빨강", "주황"] };
const swatchClass: Record<string, string> = { 검정: "black", 흰색: "white", 회색: "gray", 아이보리: "ivory", 크림: "cream", 베이지: "beige", 카멜: "camel", 갈색: "brown", 빨강: "red", 주황: "orange", 노랑: "yellow", 연두: "lime", 초록: "green", 민트: "mint", 하늘: "sky", 파랑: "blue", 진파랑: "deepblue", 남색: "navy", 보라: "purple", 분홍: "pink", 투명: "clear" };
const recommendedColors: Record<string, string[]> = {
  BALL: ["흰색", "검정", "주황", "파랑", "노랑"], BAG: ["검정", "회색", "베이지", "남색", "갈색"],
  UMBRELLA: ["검정", "투명", "파랑", "남색", "노랑"], FOOTWEAR: ["흰색", "검정", "회색", "베이지", "남색"],
};
const featureOptions: Record<string, string[]> = {
  BAG: ["키링", "로고", "앞주머니", "이름표", "지퍼", "끈", "장식", "흠집", "마모", "내부 특징"], UMBRELLA: ["접이식", "장우산", "곡선 손잡이", "스트랩", "무늬", "고정 밴드", "장식", "손잡이", "흠집", "사용감"],
  BALL: ["무늬", "로고", "이름 표시", "사인", "줄무늬", "표면 손상", "스크래치", "공기 주입구", "사용감"], FOOTWEAR: ["로고", "사이즈", "끈", "밑창", "이름표", "장식", "흠집", "마모", "좌우 차이", "봉제선"],
};
const categoryHints: Record<string, string> = { BALL: "무늬 · 이름 표시", BAG: "브랜드 · 주머니 · 키링", UMBRELLA: "손잡이 · 접이식 여부", FOOTWEAR: "사이즈 · 로고 · 흠집" };
const locationSuggestions = ["잠실 한강공원", "여의도 한강공원", "뚝섬 수변광장", "반포 한강공원"];

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

function localDateTime(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function displayLocalDateTime(value: string) {
  const parsed = parseLostAt(value);
  if (!parsed) return "날짜와 시간 선택";
  const hour = parsed.getHours();
  return `${parsed.getFullYear()}.${String(parsed.getMonth() + 1).padStart(2, "0")}.${String(parsed.getDate()).padStart(2, "0")} ${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function DateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const initial = parseLostAt(value) ?? new Date();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [hour, setHour] = useState(initial.getHours() % 12 || 12);
  const [minute, setMinute] = useState(Math.floor(initial.getMinutes() / 10) * 10);
  const [period, setPeriod] = useState<"오전" | "오후">(initial.getHours() < 12 ? "오전" : "오후");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", outside); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open]);
  const selected = parseLostAt(value);
  const chooseDate = (dayNumber: number) => {
    const hours = (hour % 12) + (period === "오후" ? 12 : 0);
    onChange(localDateTime(new Date(view.getFullYear(), view.getMonth(), dayNumber, hours, minute)));
  };
  const updateTime = (nextHour: number, nextMinute: number, nextPeriod: "오전" | "오후") => {
    setHour(nextHour); setMinute(nextMinute); setPeriod(nextPeriod);
    const base = selected ?? new Date(); const hours = (nextHour % 12) + (nextPeriod === "오후" ? 12 : 0);
    onChange(localDateTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, nextMinute)));
  };
  const first = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
  const total = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  return <div className={styles.datePicker} ref={root}><button className={styles.dateTrigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}><Icon name="clock" size={19} /><span>{displayLocalDateTime(value)}</span><Icon name="chevron" size={16} /></button>{open && <div className={styles.datePopover} role="dialog" aria-label="분실 날짜와 시간 선택"><div className={styles.quickDates}><button type="button" onClick={() => { const now = new Date(); setView(new Date(now.getFullYear(), now.getMonth(), 1)); onChange(localDateTime(now)); }}>오늘</button><button type="button" onClick={() => { const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); setView(new Date(yesterday.getFullYear(), yesterday.getMonth(), 1)); onChange(localDateTime(yesterday)); }}>어제</button></div><div className={styles.pickerBody}><div><div className={styles.calendarHead}><button type="button" aria-label="이전 달" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button><strong>{view.getFullYear()}년 {view.getMonth() + 1}월</strong><button type="button" aria-label="다음 달" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button></div><div className={styles.week}>{["일", "월", "화", "수", "목", "금", "토"].map((name) => <span key={name}>{name}</span>)}</div><div className={styles.days}>{Array.from({ length: first }, (_, index) => <i key={index} />)}{Array.from({ length: total }, (_, index) => { const number = index + 1; const chosen = selected?.getFullYear() === view.getFullYear() && selected?.getMonth() === view.getMonth() && selected?.getDate() === number; return <button type="button" aria-pressed={chosen} key={number} onClick={() => chooseDate(number)}>{number}</button>; })}</div></div><div className={styles.timePanel}><strong>시간</strong><div className={styles.period}>{(["오전", "오후"] as const).map((name) => <button type="button" aria-pressed={period === name} key={name} onClick={() => updateTime(hour, minute, name)}>{name}</button>)}</div><span>시</span><div className={styles.timeGrid}>{Array.from({ length: 12 }, (_, index) => index + 1).map((number) => <button type="button" aria-pressed={hour === number} key={number} onClick={() => updateTime(number, minute, period)}>{String(number).padStart(2, "0")}</button>)}</div><span>분</span><div className={styles.timeGrid}>{[0, 10, 20, 30, 40, 50].map((number) => <button type="button" aria-pressed={minute === number} key={number} onClick={() => updateTime(hour, number, period)}>{String(number).padStart(2, "0")}</button>)}</div></div></div><button className={styles.pickerDone} type="button" onClick={() => setOpen(false)}>{selected ? `${selected.getMonth() + 1}월 ${selected.getDate()}일 ${period} ${hour}:${String(minute).padStart(2, "0")} 선택` : "이 시간 선택"}</button></div>}</div>;
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
  const [, setActiveGuide] = useState<"features" | "location" | "time" | null>(null);
  const [suggestionFeedback, setSuggestionFeedback] = useState(false);
  const [descriptionHighlight, setDescriptionHighlight] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [exampleFilter, setExampleFilter] = useState<"전체" | ExampleCategory>("전체");
  const [pendingExample, setPendingExample] = useState<string | null>(null);
  const [selectedFamily, setSelectedFamily] = useState("");
  const [customColorOpen, setCustomColorOpen] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [locationOpen, setLocationOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const clearImage = (error: string | null = null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setSelectedImage(null);
    setImageError(error);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const selectImage = (file: File | null) => {
    clearImage();
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return clearImage("JPEG, PNG, WebP 이미지 파일만 선택할 수 있습니다.");
    if (file.size > 5 * 1024 * 1024) return clearImage("이미지는 5MB 이하만 선택할 수 있습니다.");
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setSelectedImage(file);
    setPreviewUrl(url);
  };

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
    setActiveGuide(null);
    setSuggestionFeedback(false);
    setDescriptionHighlight(false);
    clearImage();
    setPaletteOpen(false); setExamplesOpen(false); setExampleFilter("전체"); setPendingExample(null); setSelectedFamily(""); setCustomColorOpen(false); setSelectedFeatures([]); setLocationOpen(false); setResetOpen(false);
  };

  const hasInput = selectedImage !== null || Object.values(formData).some((value) => value.trim());
  const suggestions = useMemo(() => locationSuggestions.filter((name) => !formData.lost_location || name.includes(formData.lost_location.trim())).slice(0, 4), [formData.lost_location]);
  const quickColors = recommendedColors[formData.item_category] ?? ["검정", "흰색", "회색", "베이지"];
  const rankedExamples = useMemo(() => {
    const entries = descriptionExamples[formData.item_category] ?? [];
    return [...entries].sort((left, right) => {
      const score = (entry: DescriptionExample) => entry.keywords.filter((keyword) => selectedFeatures.includes(keyword)).length;
      return score(right) - score(left);
    });
  }, [formData.item_category, selectedFeatures]);
  const libraryExamples = rankedExamples.filter((entry) => exampleFilter === "전체" || entry.category === exampleFilter);
  const completedCount = [formData.item_category, formData.color.trim(), formData.description.trim(), formData.lost_location.trim(), formData.lost_at].filter(Boolean).length;
  const categoryLabel = itemCategories.find((item) => item.code === formData.item_category)?.label;
  const nodeValues = [formData.item_category, formData.color.trim(), formData.description.trim(), formData.lost_location.trim(), formData.lost_at];
  const firstIncompleteNode = nodeValues.findIndex((value) => !value);
  const currentNode = firstIncompleteNode === -1 ? 4 : firstIncompleteNode;
  const nodes = [
    { key: "item", label: "물품 종류", value: categoryLabel ?? "선택 전", done: Boolean(formData.item_category) },
    { key: "color", label: "색상", value: formData.color.trim() || "선택 전", done: Boolean(formData.color.trim()) },
    { key: "feature", label: "구별 특징", value: selectedFeatures.length ? selectedFeatures.join(" · ") : formData.description.trim() ? "설명 작성됨" : "작성 전", done: Boolean(formData.description.trim()) },
    { key: "location", label: "위치", value: formData.lost_location.trim() || "입력 전", done: Boolean(formData.lost_location.trim()) },
    { key: "time", label: "시간", value: formData.lost_at ? displayLocalDateTime(formData.lost_at) : "선택 전", done: Boolean(formData.lost_at) },
  ].map((node, index) => ({ ...node, active: index === currentNode }));
  const requestReset = () => { if (hasInput) setResetOpen(true); else resetForm(); };
  const toggleFeature = (feature: string) => setSelectedFeatures((current) => current.includes(feature) ? current.filter((item) => item !== feature) : [...current, feature]);

  const commitExample = (suggestion: string, mode: "append" | "replace") => {
    setFormData((current) => ({ ...current, description: mode === "append" && current.description.trim() ? `${current.description.trim()} ${suggestion}` : suggestion }));
    setFieldErrors((current) => ({ ...current, description: undefined }));
    setPendingExample(null);
    setExamplesOpen(false);
    setSuggestionFeedback(true);
    setDescriptionHighlight(true);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => {
      setSuggestionFeedback(false);
      setDescriptionHighlight(false);
    }, 1800);
  };
  const applyDescriptionSuggestion = (suggestion: string) => {
    if (formData.description.trim()) { setPendingExample(suggestion); setExamplesOpen(false); }
    else commitExample(suggestion, "replace");
  };

  const resetSection = (section: 1 | 2 | 3) => {
    if (section === 1) updateField("item_category", "");
    if (section === 2) {
      setFormData((current) => ({ ...current, color: "", description: "" })); setSelectedFeatures([]); setSelectedFamily(""); setCustomColorOpen(false); setPaletteOpen(false); setExamplesOpen(false); setPendingExample(null);
      clearImage();
    }
    if (section === 3) setFormData((current) => ({ ...current, lost_location: "", lost_at: "" }));
    setFieldErrors((current) => section === 1 ? { ...current, item_category: undefined } : section === 2 ? { ...current, color: undefined, description: undefined } : { ...current, lost_location: undefined, lost_at: undefined });
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
      const report = await createLostReport(createRequest(formData, lostAt), selectedImage ?? undefined);
      setCreatedReport(report);
      clearImage();
    } catch (caught) {
      const isApiError = caught instanceof LostReportsApiError;
      const message = isApiError
        ? caught.message
        : "분실 신고를 등록하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.";
      setSubmitError(message);
      setSubmitErrorStatus(isApiError ? caught.status ?? null : null);
      if (isApiError && (caught.status === 413 || caught.status === 415)) clearImage(message);
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
            <span>기억나는 정보부터 편하게 작성해주세요.</span>
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

              <section className={`${styles.composerSection} ${formData.item_category ? styles.isComplete : styles.isActive}`} aria-labelledby="composer-category-title">
                <div className={styles.composerHeading}><span>01</span><div><h3 id="composer-category-title">어떤 물건인가요?</h3><small>잃어버린 물건과 가장 가까운 종류를 선택해주세요.</small></div><button type="button" onClick={() => resetSection(1)}>초기화</button></div>
                <fieldset className={styles.categoryGroup} aria-invalid={Boolean(fieldErrors.item_category)} aria-describedby={fieldErrors.item_category ? getErrorId("item_category") : undefined}>
                  <legend className="sr-only">분실 물품 종류</legend>
                  {itemCategories.map((item) => <label key={item.code} className={`${styles.categoryOption} ${styles[`category_${item.code.toLowerCase()}`]}`}><input type="radio" name="item_category" value={item.code} checked={formData.item_category === item.code} onChange={() => { updateField("item_category", item.code); setSelectedFeatures([]); setExamplesOpen(false); }} /><span><i><Icon name={item.icon} size={23} /></i><b>{item.label}</b></span></label>)}
                </fieldset>
                {formData.item_category && <p className={styles.categoryHint} key={formData.item_category}>선택한 물건: <strong>{categoryLabel}</strong> · {categoryHints[formData.item_category]} 중심으로 추천이 달라져요.</p>}
                <div className={styles.errorSlot}>{fieldErrors.item_category && <small id={getErrorId("item_category")}>{fieldErrors.item_category}</small>}</div>
              </section>

              <section className={`${styles.composerSection} ${formData.description.trim() ? styles.isComplete : formData.item_category ? styles.isActive : ""}`} aria-labelledby="composer-description-title" onFocus={() => setActiveGuide("features")}>
                <div className={styles.composerHeading}><span>02</span><div><h3 id="composer-description-title">어떻게 생겼나요?</h3><small>도우미를 건너뛰고 직접 설명해도 괜찮아요.</small></div><button type="button" onClick={() => resetSection(2)}>초기화</button></div>
                <div className={styles.field}>
                  <label htmlFor="lost-report-color">색상 <i>선택</i></label>
                   <div id="lost-report-color-help" className={styles.quickChoices}><span>물품별 추천색</span><div>{quickColors.map((color) => <button type="button" key={color} aria-pressed={formData.color === color} onClick={() => updateField("color", color)}><i className={styles[`swatch_${swatchClass[color]}`]} />{color}</button>)}</div><div className={styles.colorActions}><button type="button" onClick={() => { setPaletteOpen((current) => !current); setCustomColorOpen(false); }}>전체 색상 보기</button><button type="button" onClick={() => { setCustomColorOpen((current) => !current); setPaletteOpen(false); }}>직접 색상 입력</button></div></div>
                   <div className={styles.familyChoices} aria-label="색상 계열">{Object.keys(colorFamilies).map((family) => <button type="button" key={family} aria-pressed={selectedFamily === family} onClick={() => setSelectedFamily((current) => current === family ? "" : family)}>{family} 계열</button>)}</div>
                   {selectedFamily && <div className={styles.toneChoices}>{colorFamilies[selectedFamily].map((color) => <button type="button" key={color} aria-pressed={formData.color === color} onClick={() => updateField("color", color)}><i className={styles[`swatch_${swatchClass[color]}`]} />{color}</button>)}</div>}
                   {customColorOpen && <input id="lost-report-color" autoFocus value={formData.color} onChange={(event) => updateField("color", event.target.value)} maxLength={50} placeholder="예: 연보라, 아이보리, 형광 연두" aria-invalid={Boolean(fieldErrors.color)} aria-describedby={fieldErrors.color ? getErrorId("color") : "lost-report-color-help"} />}
                   {paletteOpen && <div className={styles.palette} role="group" aria-label="전체 색상 팔레트"><div className={styles.paletteHead}><strong>전체 색상</strong><button type="button" onClick={() => setPaletteOpen(false)} aria-label="전체 색상 닫기">닫기</button></div>{colorGroups.map((group) => <section key={group.name}><span>{group.name}</span><div>{group.colors.map((color) => <button type="button" key={color} aria-pressed={formData.color === color} onClick={() => { updateField("color", color); setPaletteOpen(false); }}><i className={styles[`swatch_${swatchClass[color]}`]} /><b>{color}</b></button>)}</div></section>)}</div>}
                  <div className={styles.errorSlot}>{fieldErrors.color && <small id={getErrorId("color")}>{fieldErrors.color}</small>}</div>
                </div>
                {formData.item_category && <div className={styles.featureBuilder} key={`features-${formData.item_category}`}><span>기억나는 특징 <i>선택</i></span><p>선택한 특징과 관련된 문장을 먼저 보여드려요.</p><div>{featureOptions[formData.item_category].map((feature) => <button type="button" aria-pressed={selectedFeatures.includes(feature)} key={feature} onClick={() => toggleFeature(feature)}>{feature}</button>)}</div>{selectedFeatures.length > 0 && <small>선택한 특징: {selectedFeatures.join(" · ")}</small>}</div>}
                <div className={styles.exampleHeading}><div><strong>설명 작성 예시</strong><span>비슷한 문장을 선택한 뒤 내 물건에 맞게 자유롭게 수정해보세요.</span></div><button type="button" disabled={!formData.item_category} onClick={() => { setExampleFilter("전체"); setExamplesOpen(true); }}>예시 문장 10개 보기</button></div>
                {formData.item_category && <div className={styles.suggestions} key={`${formData.item_category}-${selectedFeatures.join("-")}`}>{rankedExamples.slice(0, 3).map((entry) => <button type="button" key={entry.text} onClick={() => applyDescriptionSuggestion(entry.text)}><Icon name={itemCategories.find((item) => item.code === formData.item_category)?.icon ?? "document"} size={19} /><span><b>{entry.category}</b><small>{entry.text}</small></span></button>)}</div>}
                {pendingExample && <div className={styles.exampleChoice}><p>작성 중인 내용이 있어요. 예시를 어떻게 반영할까요?</p><blockquote>{pendingExample}</blockquote><div><button type="button" onClick={() => commitExample(pendingExample, "append")}>현재 내용에 추가</button><button type="button" onClick={() => commitExample(pendingExample, "replace")}>이 문장으로 바꾸기</button><button type="button" onClick={() => setPendingExample(null)}>취소</button></div></div>}
                <div className={styles.field}>
                  <label htmlFor="lost-report-description">물품 설명 <em>필수</em></label>
                   <textarea className={descriptionHighlight ? styles.inputHighlight : ""} id="lost-report-description" value={formData.description} onChange={(event) => { updateField("description", event.target.value); setSuggestionFeedback(false); }} placeholder="브랜드, 무늬, 흠집, 부착물처럼 구별되는 특징을 자유롭게 적어주세요." rows={5} aria-invalid={Boolean(fieldErrors.description)} aria-describedby={fieldErrors.description ? getErrorId("description") : "lost-report-description-help"} required />
                   <b id="lost-report-description-help">브랜드, 무늬, 흠집, 부착물처럼 다른 물건과 구별할 수 있는 특징을 적어주세요.</b>
                  <div className={styles.errorSlot}>{fieldErrors.description && <small id={getErrorId("description")}>{fieldErrors.description}</small>}{suggestionFeedback && <span className={styles.inlineFeedback} role="status">예시가 입력되었어요. 내 물건에 맞게 수정해보세요.</span>}</div>
                </div>
                <div className={styles.photoField}>
                  <label htmlFor="lost-report-image">물품 사진 <i>선택</i></label>
                  <input ref={imageInputRef} id="lost-report-image" type="file" accept="image/jpeg,image/png,image/webp" disabled={submitting} onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => selectImage(event.target.files?.[0] ?? null)} aria-describedby="lost-report-image-help" />
                  {previewUrl && selectedImage && <div className={styles.imagePreview}><img src={previewUrl} alt="선택한 분실 물품 사진 미리보기" onError={() => clearImage("이미지를 미리 볼 수 없습니다. 손상되지 않은 파일을 선택해주세요.")} /><button type="button" onClick={() => clearImage()} disabled={submitting} aria-label="선택한 물품 사진 제거"><Icon name="close" size={17} /></button></div>}
                  <b id="lost-report-image-help">{selectedImage ? `${selectedImage.name} · ${(selectedImage.size / 1024).toFixed(1)}KB` : "JPEG, PNG, WebP · 최대 5MB"}</b>
                  {imageError && <small className={styles.imageError} role="alert">{imageError}</small>}
                </div>
              </section>

              <section className={`${styles.composerSection} ${formData.lost_location.trim() && formData.lost_at ? styles.isComplete : formData.description.trim() ? styles.isActive : ""}`} aria-labelledby="composer-place-title">
                 <div className={styles.composerHeading}><span>03</span><div><h3 id="composer-place-title">어디서 언제 잃어버렸나요?</h3><small>정확하지 않아도 마지막으로 기억나는 범위면 괜찮아요.</small></div><button type="button" onClick={() => resetSection(3)}>초기화</button></div>
                <div className={styles.placeTimeGrid}>
                  <div className={styles.fieldShell} onFocus={() => setActiveGuide("location")}><label htmlFor="lost-report-location">분실 위치 <em>필수</em></label><div className={styles.locationCombobox}><div className={styles.controlWithIcon}><input id="lost-report-location" role="combobox" aria-controls="lost-report-location-options" aria-expanded={locationOpen && suggestions.length > 0} value={formData.lost_location} onFocus={() => setLocationOpen(true)} onChange={(event) => { updateField("lost_location", event.target.value); setLocationOpen(true); }} maxLength={100} placeholder="예: 잠실 한강공원 자전거도로 인근" aria-invalid={Boolean(fieldErrors.lost_location)} aria-describedby={fieldErrors.lost_location ? getErrorId("lost_location") : "lost-report-location-help"} required /><Icon name="location" size={19} /></div>{locationOpen && suggestions.length > 0 && <div className={styles.locationResults} id="lost-report-location-options" role="listbox"><span>입력 예시 · 직접 수정할 수 있어요</span>{suggestions.map((name) => <button type="button" role="option" aria-selected={formData.lost_location === name} key={name} onClick={() => { updateField("lost_location", name); setLocationOpen(false); }}><Icon name="location" size={16} /><span><b>{name}</b><small>서울 한강공원 구역</small></span></button>)}</div>}</div><b id="lost-report-location-help">정확하지 않아도 기억나는 범위까지 입력해주세요.</b><div className={styles.errorSlot}>{fieldErrors.lost_location && <small id={getErrorId("lost_location")}>{fieldErrors.lost_location}</small>}</div></div>
                  <div className={styles.fieldShell} onFocus={() => setActiveGuide("time")}><label>분실 시각 <em>필수</em></label><DateTimePicker value={formData.lost_at} onChange={(value) => updateField("lost_at", value)} /><b id="lost-report-lost-at-help">물건을 마지막으로 확인한 현지 시각을 선택해주세요.</b><div className={styles.errorSlot}>{fieldErrors.lost_at && <small id={getErrorId("lost_at")}>{fieldErrors.lost_at}</small>}</div></div>
                </div>
              </section>

              {completedCount >= 4 && <section className={styles.preSubmit}><strong>등록 전 확인</strong><div><span>{itemCategories.find((item) => item.code === formData.item_category)?.label}</span><span>{formData.color || "색상 미입력"}</span><span>{formData.description}</span><span>{formData.lost_location}</span><span>{displayLocalDateTime(formData.lost_at)}</span></div></section>}

              <div className={styles.actions}>
                <button className="button button-primary" type="submit" disabled={submitting}>
                  {submitting ? "등록 중..." : "분실 신고 등록"}
                </button>
                <button className="button button-secondary" type="button" onClick={requestReset} disabled={submitting}>
                  전체 초기화
                </button>
              </div>
            </form>
          )}
        </section>

        <aside className={styles.guideCard} aria-labelledby="lost-report-guide-title">
          <span className={styles.guideIcon}><Icon name="scan" size={24} /></span>
          <p className={styles.eyebrow}>REPORT ASSIST</p>
          <h2 id="lost-report-guide-title">신고 정보 연결</h2><p className={styles.guideCount}>{completedCount} / 5 정보 입력</p>
           <ol className={styles.flowNodes}>{nodes.map((node) => <li key={node.key} className={`${node.done ? styles.nodeDone : ""} ${node.active ? styles.nodeActive : ""}`} aria-current={node.active ? "step" : undefined}><i /><span><b>{node.label}</b><small>{node.value}</small></span></li>)}</ol>
           <div className={styles.contextHelp}><strong>현재 도움말</strong><p>{nodes[currentNode]?.key === "item" ? "잃어버린 물건의 종류를 선택해주세요." : nodes[currentNode]?.key === "color" ? "가장 가까운 색을 고르거나 직접 입력할 수 있어요." : nodes[currentNode]?.key === "feature" ? (selectedFeatures.length ? "예시를 참고하거나 직접 자유롭게 작성할 수 있어요." : "기억나는 특징을 고르면 관련 문장을 먼저 보여드려요.") : nodes[currentNode]?.key === "location" ? "정확한 주소가 아니어도 기억나는 장소면 괜찮아요." : "마지막으로 확인한 시간을 선택해주세요."}</p></div>
          <p className={styles.guideNotice}>자동 매칭은 발견물 후보를 좁히기 위한 참고 정보이며, 동일 물품임을 확정하지 않습니다.</p>
        </aside>
      </div>
      {resetOpen && <div className={styles.dialogBackdrop} onMouseDown={(event) => event.target === event.currentTarget && setResetOpen(false)}><section className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">작성한 내용을 모두 지울까요?</h2><p>입력한 내용은 복구할 수 없습니다.</p><div><button className="button button-secondary" type="button" onClick={() => setResetOpen(false)}>취소</button><button className="button button-primary" type="button" onClick={resetForm}>모두 지우기</button></div></section></div>}
      {examplesOpen && formData.item_category && <div className={styles.dialogBackdrop} onMouseDown={(event) => event.target === event.currentTarget && setExamplesOpen(false)}><section className={styles.exampleLibrary} role="dialog" aria-modal="true" aria-labelledby="example-library-title"><div className={styles.libraryHeading}><div><p className={styles.eyebrow}>EXAMPLE LIBRARY</p><h2 id="example-library-title">예시 문장 10개</h2><span>선택한 특징과 관련된 문장이 먼저 보여요.</span></div><button type="button" onClick={() => setExamplesOpen(false)} aria-label="예시 문장 닫기"><Icon name="close" size={19} /></button></div><div className={styles.libraryFilters}>{(["전체", "형태·구조", "표시·장식", "사용 흔적"] as const).map((filter) => <button type="button" key={filter} aria-pressed={exampleFilter === filter} onClick={() => setExampleFilter(filter)}>{filter}</button>)}</div><div className={styles.libraryList}>{libraryExamples.map((entry) => <button type="button" key={entry.text} onClick={() => applyDescriptionSuggestion(entry.text)}><span>{entry.category}</span><strong>{entry.text}</strong></button>)}</div></section></div>}
    </main>
  );
}
