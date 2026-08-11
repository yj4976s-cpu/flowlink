import type { IconName } from "@/components/common/Icon";

export type ItemTypeKey = "ALL" | "BALL" | "BAG" | "BACKPACK" | "UMBRELLA" | "SHOE" | "SLIPPER" | "FOOTWEAR";
export type ItemTypeFamily = "neutral" | "ball" | "bag" | "umbrella" | "footwear";

export type ItemTypeMeta = {
  key: ItemTypeKey;
  apiCode: "BALL" | "BAG" | "UMBRELLA" | "FOOTWEAR" | null;
  label: string;
  filterValue: string;
  icon: IconName;
  family: ItemTypeFamily;
};

export type FeatureQuestion = {
  id: string;
  prompt: string;
  options: string[];
};

export type ItemFeatureDefinition = {
  id: string;
  label: string;
  questions: FeatureQuestion[];
};

const commonQuestions: Record<string, FeatureQuestion[]> = {
  logo: [
    { id: "place", prompt: "어디에 있었나요?", options: ["한쪽 면", "양쪽 면", "여러 곳", "잘 모르겠어요"] },
    { id: "shape", prompt: "어떤 모습이었나요?", options: ["글자로 된 로고", "그림·심볼", "글자와 그림", "잘 모르겠어요"] },
    { id: "tone", prompt: "기억나는 색이 있나요?", options: ["흰색", "검정", "밝은색", "잘 모르겠어요"] },
  ],
  pattern: [
    { id: "kind", prompt: "어떤 무늬였나요?", options: ["줄무늬", "반복 무늬", "그림 무늬", "잘 모르겠어요"] },
    { id: "range", prompt: "어느 정도 있었나요?", options: ["전체", "일부분", "한쪽 면", "잘 모르겠어요"] },
  ],
  writing: [
    { id: "place", prompt: "어디에 적혀 있었나요?", options: ["겉면", "안쪽", "라벨·이름표", "잘 모르겠어요"] },
    { id: "kind", prompt: "어떤 글씨였나요?", options: ["손글씨", "인쇄 글씨", "숫자", "잘 모르겠어요"] },
  ],
  damage: [
    { id: "kind", prompt: "어떤 흔적이었나요?", options: ["긁힘", "벗겨짐", "찢김", "찍힘", "잘 모르겠어요"] },
    { id: "place", prompt: "어디에 있었나요?", options: ["앞쪽", "뒤쪽", "옆면", "바닥·밑면", "잘 모르겠어요"] },
    { id: "amount", prompt: "눈에 띄는 정도였나요?", options: ["작게", "조금", "크게", "잘 모르겠어요"] },
  ],
  wear: [
    { id: "kind", prompt: "어떤 사용 흔적이었나요?", options: ["오염", "변색", "마모", "잘 모르겠어요"] },
    { id: "place", prompt: "어느 부분이었나요?", options: ["앞쪽", "뒤쪽", "옆면", "전체", "잘 모르겠어요"] },
  ],
};

const feature = (id: string, label: string, questions: FeatureQuestion[]): ItemFeatureDefinition => ({ id, label, questions });

export const LOST_REPORT_FEATURES: Record<"BALL" | "BAG" | "UMBRELLA" | "FOOTWEAR", ItemFeatureDefinition[]> = {
  BALL: [feature("logo", "브랜드·로고", commonQuestions.logo), feature("pattern", "무늬·패턴", commonQuestions.pattern), feature("writing", "글씨·이름", commonQuestions.writing), feature("damage", "긁힘·손상", commonQuestions.damage), feature("valve", "공기 주입구", [{ id: "mark", prompt: "주입구 주변에 표시가 있었나요?", options: ["글씨", "색 띠", "작은 그림", "잘 모르겠어요"] }]), feature("wear", "사용 흔적", commonQuestions.wear)],
  BAG: [feature("logo", "브랜드·로고", commonQuestions.logo), feature("zipper", "지퍼", [{ id: "kind", prompt: "지퍼에서 기억나는 점이 있나요?", options: ["색이 달라요", "손잡이 장식", "일부 손상", "잘 모르겠어요"] }]), feature("pocket", "주머니", [{ id: "place", prompt: "주머니가 어디에 있었나요?", options: ["앞면", "양옆", "안쪽", "잘 모르겠어요"] }, { id: "count", prompt: "몇 개였나요?", options: ["1개", "2개", "3개 이상", "잘 모르겠어요"] }]), feature("decoration", "키링·장식", [{ id: "place", prompt: "어디에 달려 있었나요?", options: ["지퍼", "손잡이", "어깨끈", "잘 모르겠어요"] }, { id: "kind", prompt: "어떤 장식이었나요?", options: ["캐릭터", "금속 장식", "끈·태그", "잘 모르겠어요"] }]), feature("writing", "이름표", commonQuestions.writing), feature("damage", "찢김·손상", commonQuestions.damage)],
  UMBRELLA: [feature("handle", "손잡이", [{ id: "shape", prompt: "손잡이는 어떤 형태였나요?", options: ["곡선형", "일자형", "둥근 손잡이", "잘 모르겠어요"] }, { id: "material", prompt: "재질이 기억나나요?", options: ["플라스틱", "고무", "나무", "잘 모르겠어요"] }]), feature("pattern", "무늬·패턴", commonQuestions.pattern), feature("logo", "브랜드·로고", commonQuestions.logo), feature("strap", "우산끈", [{ id: "kind", prompt: "우산끈에서 기억나는 점이 있나요?", options: ["고정 밴드", "손목 스트랩", "색이 달라요", "잘 모르겠어요"] }]), feature("damage", "휘어진 부분", commonQuestions.damage), feature("writing", "이름·글씨", commonQuestions.writing)],
  FOOTWEAR: [feature("logo", "브랜드·로고", commonQuestions.logo), feature("lace", "끈", [{ id: "kind", prompt: "끈에서 기억나는 점이 있나요?", options: ["색이 달라요", "한쪽이 짧아요", "장식이 있어요", "잘 모르겠어요"] }]), feature("sole", "밑창", [{ id: "kind", prompt: "밑창에서 기억나는 점이 있나요?", options: ["특이한 무늬", "한쪽 마모", "색이 달라요", "잘 모르겠어요"] }]), feature("size", "사이즈 표시", [{ id: "place", prompt: "사이즈가 어디에 표시됐나요?", options: ["안쪽 라벨", "밑창", "뒤꿈치", "잘 모르겠어요"] }]), feature("wear", "오염", commonQuestions.wear), feature("damage", "긁힘·손상", commonQuestions.damage)],
};

export type LostReportCategory = "BALL" | "BAG" | "UMBRELLA" | "FOOTWEAR";
export type LostReportSubtype = { code: string; label: string };

export const LOST_REPORT_SUBTYPES: Record<LostReportCategory, LostReportSubtype[]> = {
  BALL: [{ code: "SOCCER_BALL", label: "축구공" }, { code: "BASKETBALL", label: "농구공" }, { code: "VOLLEYBALL", label: "배구공" }, { code: "BASEBALL", label: "야구공" }, { code: "TENNIS_BALL", label: "테니스공" }, { code: "PLAY_BALL", label: "고무·놀이공" }, { code: "OTHER", label: "기타" }, { code: "UNKNOWN", label: "잘 모르겠어요" }],
  BAG: [{ code: "BACKPACK", label: "백팩" }, { code: "CROSSBODY", label: "크로스백" }, { code: "SHOULDER", label: "숄더백" }, { code: "TOTE", label: "토트백" }, { code: "HANDBAG", label: "핸드백" }, { code: "POUCH", label: "파우치·소형가방" }, { code: "OTHER", label: "기타" }, { code: "UNKNOWN", label: "잘 모르겠어요" }],
  UMBRELLA: [{ code: "LONG", label: "장우산" }, { code: "FOLDING", label: "접이식 우산" }, { code: "PARASOL", label: "양산" }, { code: "OTHER", label: "기타" }, { code: "UNKNOWN", label: "잘 모르겠어요" }],
  FOOTWEAR: [{ code: "SNEAKERS", label: "운동화" }, { code: "DRESS_SHOES", label: "구두" }, { code: "SLIPPERS", label: "슬리퍼" }, { code: "SANDALS", label: "샌들" }, { code: "BOOTS", label: "부츠" }, { code: "AQUA_SHOES", label: "아쿠아슈즈" }, { code: "OTHER", label: "기타" }, { code: "UNKNOWN", label: "잘 모르겠어요" }],
};

const extraFeatures: Record<string, ItemFeatureDefinition> = {
  size: feature("size", "크기·사이즈", [{ id: "mark", prompt: "크기나 사이즈를 어떻게 기억하나요?", options: ["표시를 봤어요", "작은 편", "보통", "큰 편", "잘 모르겠어요"] }]),
  panel: feature("panel", "패널·무늬", commonQuestions.pattern),
  character: feature("character", "캐릭터·그림", [{ id: "kind", prompt: "어떤 그림이었나요?", options: ["캐릭터", "동물", "도형", "잘 모르겠어요"] }, { id: "place", prompt: "어디에 있었나요?", options: ["전체", "한쪽", "가장자리", "잘 모르겠어요"] }]),
  surface: feature("surface", "표면 손상", commonQuestions.damage),
  crush: feature("crush", "찌그러짐", [{ id: "amount", prompt: "어느 정도 찌그러졌나요?", options: ["한쪽만", "조금", "눈에 띄게", "잘 모르겠어요"] }]),
  frontPocket: feature("frontPocket", "앞주머니", [{ id: "count", prompt: "앞주머니가 몇 개였나요?", options: ["1개", "2개", "3개 이상", "잘 모르겠어요"] }, { id: "kind", prompt: "어떻게 닫혔나요?", options: ["지퍼", "단추", "덮개", "잘 모르겠어요"] }]),
  sidePocket: feature("sidePocket", "옆주머니", [{ id: "side", prompt: "어느 쪽에 있었나요?", options: ["왼쪽", "오른쪽", "양쪽", "잘 모르겠어요"] }]),
  handle: feature("handle", "손잡이", [{ id: "kind", prompt: "손잡이는 어떤 모습이었나요?", options: ["짧은 손잡이", "긴 손잡이", "가죽", "천", "잘 모르겠어요"] }]),
  heel: feature("heel", "굽", [{ id: "height", prompt: "굽 높이는 어느 정도였나요?", options: ["낮은 굽", "중간 굽", "높은 굽", "잘 모르겠어요"] }, { id: "shape", prompt: "굽 모양은 어땠나요?", options: ["가느다란 굽", "두꺼운 굽", "통굽", "잘 모르겠어요"] }]),
  buckle: feature("buckle", "버클·장식", [{ id: "place", prompt: "버클이나 장식이 어디에 있었나요?", options: ["발등", "옆면", "뒤쪽", "잘 모르겠어요"] }, { id: "kind", prompt: "어떤 모습이었나요?", options: ["금속 버클", "리본", "작은 장식", "잘 모르겠어요"] }]),
  toe: feature("toe", "앞코 모양", [{ id: "shape", prompt: "앞코는 어떤 모양이었나요?", options: ["둥근 모양", "뾰족한 모양", "네모난 모양", "잘 모르겠어요"] }]),
  strap: feature("strap", "스트랩", [{ id: "kind", prompt: "스트랩은 어떤 형태였나요?", options: ["한 줄", "여러 줄", "발목 스트랩", "잘 모르겠어요"] }, { id: "detail", prompt: "기억나는 특징이 있나요?", options: ["버클", "벨크로", "장식", "잘 모르겠어요"] }]),
  auto: feature("auto", "자동 개폐", [{ id: "kind", prompt: "자동 개폐 방식이 기억나나요?", options: ["자동으로 펴짐", "자동으로 접힘", "버튼이 있었어요", "잘 모르겠어요"] }]),
};

const subtypeFeatureIds: Record<string, string[]> = {
  SOCCER_BALL: ["logo", "panel", "writing", "valve", "size", "surface", "wear"], PLAY_BALL: ["character", "pattern", "writing", "size", "valve", "crush", "surface"],
  BACKPACK: ["logo", "zipper", "frontPocket", "sidePocket", "decoration", "writing", "handle", "damage"],
  LONG: ["handle", "auto", "strap", "pattern", "character", "logo", "writing", "damage"], FOLDING: ["handle", "auto", "strap", "pattern", "character", "logo", "writing", "damage"],
  SNEAKERS: ["logo", "lace", "sole", "size", "pattern", "wear", "damage"], DRESS_SHOES: ["logo", "heel", "buckle", "toe", "sole", "size", "damage", "wear"],
  SLIPPERS: ["logo", "strap", "sole", "buckle", "size", "pattern", "damage"], SANDALS: ["logo", "strap", "sole", "buckle", "size", "pattern", "damage"],
};

export function getLostReportFeatures(category: LostReportCategory, subtype?: string | null) {
  const base = LOST_REPORT_FEATURES[category];
  const ids = subtype ? subtypeFeatureIds[subtype] : undefined;
  if (!ids) return base;
  const available = new Map([...base, ...Object.values(extraFeatures)].map((item) => [item.id, item]));
  return ids.map((id) => available.get(id)).filter((item): item is ItemFeatureDefinition => Boolean(item));
}

export const ITEM_TYPE_META: Record<ItemTypeKey, ItemTypeMeta> = {
  ALL: { key: "ALL", apiCode: null, label: "전체", filterValue: "", icon: "category", family: "neutral" },
  BALL: { key: "BALL", apiCode: "BALL", label: "공", filterValue: "공", icon: "ball", family: "ball" },
  BAG: { key: "BAG", apiCode: "BAG", label: "가방", filterValue: "가방", icon: "bag", family: "bag" },
  BACKPACK: { key: "BACKPACK", apiCode: "BAG", label: "백팩", filterValue: "백팩", icon: "backpack", family: "bag" },
  UMBRELLA: { key: "UMBRELLA", apiCode: "UMBRELLA", label: "우산", filterValue: "우산", icon: "umbrella", family: "umbrella" },
  SHOE: { key: "SHOE", apiCode: "FOOTWEAR", label: "신발", filterValue: "신발", icon: "footwear", family: "footwear" },
  SLIPPER: { key: "SLIPPER", apiCode: "FOOTWEAR", label: "슬리퍼", filterValue: "슬리퍼", icon: "slipper", family: "footwear" },
  FOOTWEAR: { key: "FOOTWEAR", apiCode: "FOOTWEAR", label: "신발·슬리퍼류", filterValue: "신발·슬리퍼류", icon: "footwear", family: "footwear" },
};

const aliases: Array<[RegExp, ItemTypeKey]> = [
  [/백팩|배낭/i, "BACKPACK"], [/슬리퍼|샌들|플립플롭/i, "SLIPPER"],
  [/신발|운동화|구두/i, "SHOE"], [/우산/i, "UMBRELLA"],
  [/가방|숄더백|토트백/i, "BAG"], [/공|볼/i, "BALL"],
];

export function getItemTypeMeta(code?: string | null, label?: string | null): ItemTypeMeta {
  const normalizedCode = code?.trim().toUpperCase();
  if (normalizedCode && normalizedCode in ITEM_TYPE_META) return ITEM_TYPE_META[normalizedCode as ItemTypeKey];
  const match = aliases.find(([pattern]) => pattern.test(label?.trim() ?? ""));
  return match ? ITEM_TYPE_META[match[1]] : ITEM_TYPE_META.ALL;
}

export const discoveryCategoryOptions = (["ALL", "BALL", "BAG", "BACKPACK", "UMBRELLA", "SHOE", "SLIPPER"] as const).map((key) => ITEM_TYPE_META[key]);
