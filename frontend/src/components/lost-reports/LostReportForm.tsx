"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  createLostReport,
  LostReportResponse,
  LostReportsApiError,
  type LostReportCreateRequest,
} from "@/lib/lostReportsApi";
import { getLostReportFeatures, ITEM_TYPE_META, LOST_REPORT_SUBTYPES, type ItemFeatureDefinition, type LostReportCategory } from "@/lib/itemTypeMeta";
import { getContextualFeatureExamples } from "@/lib/lostReportFeatureExamples";
import { KakaoPlaceSearch, type SelectedLostLocation } from "./KakaoPlaceSearch";
import { MapPickerDialog, RegionPickerDialog } from "./LostLocationDialogs";
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
    example("양옆에 물병을 넣을 수 있는 주머니가 있어요.", "형태·구조", ["옆주머니", "수납"]), example("지퍼 손잡이에 짧은 끈이 달려 있어요.", "형태·구조", ["지퍼", "끈"]),
    example("손잡이 부분이 가죽 재질로 되어 있어요.", "형태·구조", ["손잡이", "가죽"]), example("앞주머니가 두 개로 나뉘어 있어요.", "형태·구조", ["앞주머니", "수납"]),
    example("어깨끈 길이를 조절하는 버클이 두 개 있어요.", "형태·구조", ["어깨끈", "버클"]), example("가방 입구가 덮개와 자석 단추로 닫혀요.", "형태·구조", ["덮개", "자석 단추"]),
    example("안쪽에 지퍼가 달린 작은 수납칸이 있어요.", "형태·구조", ["내부", "지퍼 수납"]), example("바닥이 넓고 네모난 형태로 각이 잡혀 있어요.", "형태·구조", ["바닥", "사각 형태"]),
    example("등판에 푹신한 쿠션과 통풍 홈이 있어요.", "형태·구조", ["등판", "쿠션"]), example("손잡이와 어깨끈을 모두 사용할 수 있는 가방이에요.", "형태·구조", ["손잡이", "어깨끈"]),
    example("앞주머니에 작은 키링이 달려 있어요.", "표시·장식", ["키링", "앞주머니"]), example("앞면 중앙에 작은 브랜드 로고가 있어요.", "표시·장식", ["로고", "앞면"]),
    example("앞면에 작은 금속 장식이 붙어 있어요.", "표시·장식", ["금속", "장식"]), example("어깨끈에 이름표가 매달려 있어요.", "표시·장식", ["이름표", "어깨끈"]),
    example("지퍼 끝에 동물 모양 장식이 달려 있어요.", "표시·장식", ["지퍼", "동물 장식"]), example("가방 앞면에 가로 줄무늬가 반복되어 있어요.", "표시·장식", ["줄무늬", "앞면"]),
    example("한쪽 옆면에 캐릭터 스티커가 붙어 있어요.", "표시·장식", ["스티커", "캐릭터"]), example("덮개 모서리에 밝은색 스티치가 보여요.", "표시·장식", ["스티치", "덮개"]),
    example("손잡이에 작은 리본 장식이 묶여 있어요.", "표시·장식", ["리본", "손잡이"]), example("뒷면 아래쪽에 이니셜이 적혀 있어요.", "표시·장식", ["이니셜", "뒷면"]),
    example("오른쪽 어깨끈 부분에 작은 흠집이 있어요.", "사용 흔적", ["어깨끈", "흠집"]), example("아래쪽 모서리 부분이 조금 닳아 있어요.", "사용 흔적", ["모서리", "마모"]),
    example("지퍼 손잡이 한쪽의 코팅이 벗겨져 있어요.", "사용 흔적", ["지퍼", "벗겨짐"]), example("가방 바닥에 길게 긁힌 자국이 있어요.", "사용 흔적", ["바닥", "긁힘"]),
    example("앞주머니 왼쪽에 작은 얼룩이 남아 있어요.", "사용 흔적", ["앞주머니", "얼룩"]), example("어깨끈 안쪽 천이 조금 헤져 있어요.", "사용 흔적", ["어깨끈", "헤짐"]),
    example("손잡이 가운데 부분이 눌려 납작해졌어요.", "사용 흔적", ["손잡이", "눌림"]), example("등판 아래쪽에 색이 바랜 부분이 있어요.", "사용 흔적", ["등판", "변색"]),
    example("내부 안감 한쪽이 약간 찢어져 있어요.", "사용 흔적", ["안감", "찢어짐"]), example("앞면 로고 옆에 볼펜 자국이 있어요.", "사용 흔적", ["앞면", "볼펜 자국"]),
  ],
  UMBRELLA: [
    example("곡선 형태의 손잡이가 달려 있어요.", "형태·구조", ["곡선 손잡이", "손잡이"]), example("세 단으로 접어서 보관하는 접이식 우산이에요.", "형태·구조", ["3단", "접이식"]),
    example("손목에 걸 수 있는 짧은 스트랩이 달려 있어요.", "형태·구조", ["스트랩", "손목끈"]), example("손잡이가 밝은 나무 재질로 되어 있어요.", "형태·구조", ["손잡이", "나무"]),
    example("접는 부분에 똑딱단추가 달린 고정 밴드가 있어요.", "형태·구조", ["고정 밴드", "단추"]), example("버튼을 누르면 자동으로 펼쳐지는 장우산이에요.", "형태·구조", ["자동", "장우산"]),
    example("우산대가 여덟 개의 살로 이루어져 있어요.", "형태·구조", ["우산살", "8개"]), example("손잡이가 짧고 둥근 원통형이에요.", "형태·구조", ["원통형", "손잡이"]),
    example("우산 끝이 길고 뾰족한 금속 재질이에요.", "형태·구조", ["우산 끝", "금속"]), example("투명한 비닐 천으로 된 장우산이에요.", "형태·구조", ["투명", "비닐"]),
    example("가장자리에 얇은 테두리 무늬가 있어요.", "표시·장식", ["테두리", "무늬"]), example("우산 천에 작은 꽃무늬가 반복되어 있어요.", "표시·장식", ["꽃무늬", "우산 천"]),
    example("손잡이 끝부분에 작은 장식이 붙어 있어요.", "표시·장식", ["손잡이", "장식"]), example("한쪽 면에 흰색 브랜드 로고가 인쇄되어 있어요.", "표시·장식", ["로고", "인쇄"]),
    example("우산 천이 두 가지 색으로 번갈아 나뉘어 있어요.", "표시·장식", ["배색", "두 가지 색"]), example("고정 밴드에 이름이 적힌 라벨이 붙어 있어요.", "표시·장식", ["이름", "라벨"]),
    example("손잡이에 캐릭터 얼굴이 그려져 있어요.", "표시·장식", ["캐릭터", "손잡이"]), example("가장자리를 따라 작은 물방울 무늬가 있어요.", "표시·장식", ["물방울", "테두리"]),
    example("우산 꼭대기에 밝은색 덮개 장식이 있어요.", "표시·장식", ["꼭대기", "장식"]), example("우산 천 한쪽에 이니셜 스티커가 붙어 있어요.", "표시·장식", ["이니셜", "스티커"]),
    example("손잡이 부분에 작은 흠집이 있어요.", "사용 흔적", ["손잡이", "흠집"]), example("우산 끝부분의 코팅이 조금 벗겨져 있어요.", "사용 흔적", ["우산 끝", "벗겨짐"]),
    example("우산 천 한쪽에 작은 구멍이 나 있어요.", "사용 흔적", ["우산 천", "구멍"]), example("고정 밴드 가장자리가 조금 헤져 있어요.", "사용 흔적", ["고정 밴드", "헤짐"]),
    example("우산살 하나가 안쪽으로 약간 휘어 있어요.", "사용 흔적", ["우산살", "휘어짐"]), example("손잡이 아래쪽에 테이프를 감아 놓았어요.", "사용 흔적", ["손잡이", "테이프"]),
    example("천 가장자리에 옅은 얼룩이 남아 있어요.", "사용 흔적", ["가장자리", "얼룩"]), example("자동 펼침 버튼의 글자가 지워져 있어요.", "사용 흔적", ["버튼", "마모"]),
    example("금속 우산대 중간에 녹슨 자국이 있어요.", "사용 흔적", ["우산대", "녹"]), example("스트랩 연결 부분이 조금 늘어나 있어요.", "사용 흔적", ["스트랩", "늘어남"]),
  ],
  BALL: [
    example("오각형과 육각형 조각이 이어진 축구공 형태예요.", "형태·구조", ["오각형", "축구공"]), example("공기 주입구가 한쪽 면 중앙에 있어요.", "형태·구조", ["공기 주입구", "중앙"]),
    example("표면에 깊고 촘촘한 돌기가 있어요.", "형태·구조", ["돌기", "표면"]), example("손바닥보다 조금 큰 고무공이에요.", "형태·구조", ["크기", "고무공"]),
    example("여러 개의 세로 홈이 일정하게 나 있어요.", "형태·구조", ["세로 홈", "표면"]), example("겉면이 부드러운 천 재질로 덮여 있어요.", "형태·구조", ["천", "부드러운 표면"]),
    example("한 손에 들어오는 작은 원형 공이에요.", "형태·구조", ["소형", "원형"]), example("농구공처럼 굵은 홈이 여덟 줄로 나뉘어 있어요.", "형태·구조", ["굵은 홈", "농구공"]),
    example("겉면이 여러 겹의 고무층으로 되어 있어요.", "형태·구조", ["고무", "겹"]), example("일반 공보다 약간 타원형으로 길쭉해요.", "형태·구조", ["타원형", "길쭉함"]),
    example("표면에 별 모양 패턴이 반복되어 있어요.", "표시·장식", ["별", "패턴"]), example("한쪽 면에 큰 브랜드 로고가 있어요.", "표시·장식", ["브랜드", "로고"]),
    example("표면에 이름과 전화번호가 적혀 있어요.", "표시·장식", ["이름", "글씨"]), example("한쪽 면에 검은색 사인이 적혀 있어요.", "표시·장식", ["사인", "검은색"]),
    example("표면을 따라 두 줄의 굵은 줄무늬가 있어요.", "표시·장식", ["줄무늬", "두 줄"]), example("여러 색의 삼각형 무늬가 이어져 있어요.", "표시·장식", ["삼각형", "여러 색"]),
    example("한쪽에 숫자 스티커가 붙어 있어요.", "표시·장식", ["숫자", "스티커"]), example("가운데에 동물 캐릭터가 인쇄되어 있어요.", "표시·장식", ["캐릭터", "인쇄"]),
    example("공기 주입구 옆에 작은 화살표 표시가 있어요.", "표시·장식", ["화살표", "공기 주입구"]), example("표면 절반이 다른 색으로 나뉘어 있어요.", "표시·장식", ["배색", "절반"]),
    example("한쪽 부분에 길게 긁힌 자국이 있어요.", "사용 흔적", ["긁힘", "스크래치"]), example("표면 일부의 색이 둥글게 벗겨져 있어요.", "사용 흔적", ["표면", "벗겨짐"]),
    example("한쪽 면이 다른 부분보다 많이 닳아 있어요.", "사용 흔적", ["마모", "한쪽 면"]), example("공기 주입구 주변에 작은 갈라짐이 있어요.", "사용 흔적", ["공기 주입구", "갈라짐"]),
    example("흰색 표면에 검은 흙 얼룩이 남아 있어요.", "사용 흔적", ["흙", "얼룩"]), example("로고 일부가 마찰로 지워져 있어요.", "사용 흔적", ["로고", "지워짐"]),
    example("표면 한곳이 눌려 살짝 들어가 있어요.", "사용 흔적", ["눌림", "찌그러짐"]), example("봉제선 한 부분의 실이 풀려 있어요.", "사용 흔적", ["봉제선", "실 풀림"]),
    example("표면에 파란색 볼펜 자국이 있어요.", "사용 흔적", ["볼펜", "자국"]), example("모서리 부분에 작은 찢김이 있어요.", "사용 흔적", ["모서리", "찢김"]),
  ],
  FOOTWEAR: [
    example("신발끈 한쪽이 다른 쪽보다 짧아요.", "형태·구조", ["신발끈", "좌우 차이"]), example("밑창에 지그재그 모양의 깊은 홈이 있어요.", "형태·구조", ["밑창", "지그재그"]),
    example("발목을 덮는 높이의 하이탑 신발이에요.", "형태·구조", ["하이탑", "발목"]), example("끈 대신 벨크로 띠가 두 줄 달려 있어요.", "형태·구조", ["벨크로", "두 줄"]),
    example("앞코가 둥글고 넓은 형태예요.", "형태·구조", ["앞코", "둥근 형태"]), example("뒤꿈치에 잡아당기는 고리가 있어요.", "형태·구조", ["뒤꿈치", "고리"]),
    example("밑창이 두껍고 굽이 약간 높은 신발이에요.", "형태·구조", ["두꺼운 밑창", "굽"]), example("옆면이 통풍용 망사 재질로 되어 있어요.", "형태·구조", ["망사", "통풍"]),
    example("발등 부분에 탄력 있는 밴드가 있어요.", "형태·구조", ["발등", "밴드"]), example("좌우 신발의 깔창 색상이 서로 달라요.", "형태·구조", ["깔창", "좌우 차이"]),
    example("옆면에 작은 브랜드 로고가 있어요.", "표시·장식", ["옆면", "로고"]), example("뒤꿈치 부분에 작은 로고가 있어요.", "표시·장식", ["뒤꿈치", "로고"]),
    example("한쪽에만 별 모양 장식이 달려 있어요.", "표시·장식", ["별", "좌우 차이"]), example("신발끈에 작은 금속 태그가 달려 있어요.", "표시·장식", ["신발끈", "금속 태그"]),
    example("옆면에 두 줄의 대비되는 색 띠가 있어요.", "표시·장식", ["색 띠", "옆면"]), example("신발 혀 안쪽에 이름이 적혀 있어요.", "표시·장식", ["이름", "신발 혀"]),
    example("앞코에 작은 꽃무늬 자수가 있어요.", "표시·장식", ["앞코", "자수"]), example("뒤축에 반사되는 은색 띠가 붙어 있어요.", "표시·장식", ["반사 띠", "뒤축"]),
    example("밑창 옆면에 숫자가 크게 인쇄되어 있어요.", "표시·장식", ["숫자", "밑창"]), example("신발끈 구멍 하나만 다른 색으로 되어 있어요.", "표시·장식", ["끈 구멍", "배색"]),
    example("앞부분에 작은 긁힌 자국이 있어요.", "사용 흔적", ["앞부분", "긁힘"]), example("밑창 바깥쪽이 조금 닳아 있어요.", "사용 흔적", ["밑창", "마모"]),
    example("옆면 봉제선 부분에 작은 흠집이 있어요.", "사용 흔적", ["봉제선", "흠집"]), example("왼쪽 앞코가 오른쪽보다 더 닳아 있어요.", "사용 흔적", ["앞코", "좌우 차이"]),
    example("흰색 끈 한 부분에 검은 얼룩이 있어요.", "사용 흔적", ["신발끈", "얼룩"]), example("뒤꿈치 안쪽 천이 조금 헤져 있어요.", "사용 흔적", ["뒤꿈치", "헤짐"]),
    example("밑창 옆면에 노란색 변색이 있어요.", "사용 흔적", ["밑창", "변색"]), example("오른쪽 신발 혀의 라벨이 반쯤 떨어져 있어요.", "사용 흔적", ["라벨", "떨어짐"]),
    example("앞코 고무 부분에 가느다란 금이 가 있어요.", "사용 흔적", ["앞코", "갈라짐"]), example("깔창의 뒤꿈치 부분 글씨가 지워져 있어요.", "사용 흔적", ["깔창", "지워짐"]),
  ],
};

const colorGroups = [
  { name: "무채색", colors: ["검정", "흰색", "회색"] },
  { name: "내추럴", colors: ["아이보리", "크림", "베이지", "갈색"] },
  { name: "따뜻한 색", colors: ["빨강", "주황", "노랑", "분홍"] },
  { name: "차가운 색", colors: ["연두", "초록", "민트", "하늘", "파랑", "남색", "보라"] },
];
const swatchClass: Record<string, string> = { 검정: "black", 흰색: "white", 회색: "gray", 아이보리: "ivory", 크림: "cream", 베이지: "beige", 카멜: "camel", 갈색: "brown", 빨강: "red", 주황: "orange", 노랑: "yellow", 연두: "lime", 초록: "green", 민트: "mint", 하늘: "sky", 파랑: "blue", 진파랑: "deepblue", 남색: "navy", 보라: "purple", 분홍: "pink", 투명: "clear" };
const recommendedColors: Record<string, string[]> = {
  BALL: ["흰색", "검정", "주황", "파랑", "노랑"], BAG: ["검정", "회색", "베이지", "남색", "갈색"],
  UMBRELLA: ["검정", "투명", "파랑", "남색", "노랑"], FOOTWEAR: ["흰색", "검정", "회색", "베이지", "남색"],
};
const categoryHints: Record<string, string> = { BALL: "무늬 · 이름 표시", BAG: "브랜드 · 주머니 · 키링", UMBRELLA: "손잡이 · 접이식 여부", FOOTWEAR: "사이즈 · 로고 · 흠집" };
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

type LostReportDescriptionDetails = {
  subtypeLabel: string;
  footwearCondition: string;
  footwearSide: string;
  ballSize: string;
  colorBalance: string;
};

function validColorBalance(colorBalance: string, colors: string[]) {
  if (colors.length < 2) return "";
  if (colorBalance === "비슷하게 섞여 있었어요" || colorBalance === "잘 모르겠어요") return colorBalance;
  return colors.some((color) => colorBalance === `${color}이 가장 많았어요`) ? colorBalance : "";
}

export function buildLostReportDescription(description: string, details: LostReportDescriptionDetails, colors: string[]) {
  const lines: string[] = [];
  const subtype = details.subtypeLabel.trim();
  if (subtype && subtype !== "기타" && subtype !== "잘 모르겠어요") lines.push(`세부 종류: ${subtype}`);
  if (details.footwearCondition && details.footwearCondition !== "잘 모르겠어요") {
    const side = details.footwearCondition === "한 짝" && details.footwearSide !== "기억나지 않아요" ? details.footwearSide : "";
    lines.push(`분실 상태: ${details.footwearCondition}${side ? ` · ${side}` : ""}`);
  }
  if (details.ballSize && details.ballSize !== "잘 모르겠어요") lines.push(`크기: ${details.ballSize}`);
  const colorBalance = validColorBalance(details.colorBalance, colors);
  if (colorBalance && colorBalance !== "잘 모르겠어요") lines.push(`색상 비중: ${colorBalance}`);
  const featureDescription = description.trim();
  if (featureDescription) lines.push(`구별 특징: ${featureDescription}`);
  return lines.join("\n");
}

function createRequest(formData: FormData, lostAt: Date, colors: string[], location: SelectedLostLocation | null, details: LostReportDescriptionDetails): LostReportCreateRequest {
  return {
    item_category: formData.item_category,
    color: colors[0] ?? null,
    colors,
    description: buildLostReportDescription(formData.description, details, colors),
    lost_location: formData.lost_location.trim(),
    ...(location?.latitude !== undefined && location?.longitude !== undefined
      ? { latitude: location.latitude, longitude: location.longitude }
      : {}),
    lost_at: lostAt.toISOString(),
  };
}

type FeatureAnswers = Record<string, Record<string, string>>;
type FeatureNotes = Record<string, string>;

const featurePlaceholders: Record<string, string> = {
  pattern: "예) 검은색 바탕에 얇은 흰색 줄무늬가 있었어요.",
  panel: "예) 전체에 작은 무늬가 반복되어 있었어요.",
  logo: "예) 한쪽에 흰색 로고가 작게 있었어요.",
  handle: "예) 검은색 곡선형 손잡이였어요.",
  writing: "예) 손잡이 안쪽에 영문 이니셜이 적혀 있었어요.",
  damage: "예) 오른쪽 아래에 길게 긁힌 흔적이 있었어요.",
  wear: "예) 가장자리 한쪽이 조금 닳아 있었어요.",
};

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
  const [placement, setPlacement] = useState<"up" | "down">("down");
  const [view, setView] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [hour, setHour] = useState(initial.getHours() % 12 || 12);
  const [minute, setMinute] = useState(Math.floor(initial.getMinutes() / 10) * 10);
  const [period, setPeriod] = useState<"오전" | "오후">(initial.getHours() < 12 ? "오전" : "오후");
  const root = useRef<HTMLDivElement>(null);
  const updatePlacement = useCallback(() => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    setPlacement(spaceBelow < 430 && rect.top > spaceBelow ? "up" : "down");
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", outside); window.addEventListener("keydown", escape); window.addEventListener("resize", updatePlacement); window.addEventListener("scroll", updatePlacement, true);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); window.removeEventListener("resize", updatePlacement); window.removeEventListener("scroll", updatePlacement, true); };
  }, [open, updatePlacement]);
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
  return <div className={styles.datePicker} ref={root}>
    <button className={styles.dateTrigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!open) updatePlacement(); setOpen((current) => !current); }}><Icon name="clock" size={19} /><span>{displayLocalDateTime(value)}</span><Icon name="chevron" size={16} /></button>
    {open && <div className={`${styles.datePopover} ${placement === "up" ? styles.datePopoverUp : ""}`} role="dialog" aria-label="분실 날짜와 시간 선택">
      <div className={styles.quickDates}><button type="button" onClick={() => { const now = new Date(); setView(new Date(now.getFullYear(), now.getMonth(), 1)); onChange(localDateTime(now)); }}>오늘</button><button type="button" onClick={() => { const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); setView(new Date(yesterday.getFullYear(), yesterday.getMonth(), 1)); onChange(localDateTime(yesterday)); }}>어제</button></div>
      <div className={styles.pickerBody}>
        <div><div className={styles.calendarHead}><button type="button" aria-label="이전 달" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button><strong>{view.getFullYear()}년 {view.getMonth() + 1}월</strong><button type="button" aria-label="다음 달" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button></div><div className={styles.week}>{["일", "월", "화", "수", "목", "금", "토"].map((name) => <span key={name}>{name}</span>)}</div><div className={styles.days}>{Array.from({ length: first }, (_, index) => <i key={index} />)}{Array.from({ length: total }, (_, index) => { const number = index + 1; const chosen = selected?.getFullYear() === view.getFullYear() && selected?.getMonth() === view.getMonth() && selected?.getDate() === number; return <button type="button" aria-pressed={chosen} key={number} onClick={() => chooseDate(number)}>{number}</button>; })}</div></div>
        <div className={styles.timePanel}><strong>시간</strong><div className={styles.period}>{(["오전", "오후"] as const).map((name) => <button type="button" aria-pressed={period === name} key={name} onClick={() => updateTime(hour, minute, name)}>{name}</button>)}</div><span>시</span><div className={styles.timeGrid}>{Array.from({ length: 12 }, (_, index) => index + 1).map((number) => <button type="button" aria-pressed={hour === number} key={number} onClick={() => updateTime(number, minute, period)}>{String(number).padStart(2, "0")}</button>)}</div><span>분</span><div className={styles.timeGrid}>{[0, 10, 20, 30, 40, 50].map((number) => <button type="button" aria-pressed={minute === number} key={number} onClick={() => updateTime(hour, number, period)}>{String(number).padStart(2, "0")}</button>)}</div></div>
      </div>
      <button className={styles.pickerDone} type="button" onClick={() => setOpen(false)}>{selected ? `${selected.getMonth() + 1}월 ${selected.getDate()}일 ${period} ${hour}:${String(minute).padStart(2, "0")} 선택` : "이 시간 선택"}</button>
    </div>}
  </div>;
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exampleLibraryOpen, setExampleLibraryOpen] = useState(false);
  const [exampleFilter, setExampleFilter] = useState<ExampleCategory | "전체">("전체");
  const [customColorOpen, setCustomColorOpen] = useState(false);
  const [customColor, setCustomColor] = useState("");
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [colorNotice, setColorNotice] = useState("");
  const [colorBalance, setColorBalance] = useState("");
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [activeFeature, setActiveFeature] = useState<string | null>(null);
  const [featureAnswers, setFeatureAnswers] = useState<FeatureAnswers>({});
  const [featureNotes, setFeatureNotes] = useState<FeatureNotes>({});
  const [subtype, setSubtype] = useState("");
  const [customSubtype, setCustomSubtype] = useState("");
  const [subtypeOpen, setSubtypeOpen] = useState(false);
  const [footwearCondition, setFootwearCondition] = useState("");
  const [footwearSide, setFootwearSide] = useState("");
  const [ballSize, setBallSize] = useState("");
  const [showAllFeatureExamples, setShowAllFeatureExamples] = useState(false);
  const [recentSuggestion, setRecentSuggestion] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<SelectedLostLocation | null>(null);
  const [regionPickerOpen, setRegionPickerOpen] = useState(false);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const paletteTriggerRef = useRef<HTMLButtonElement>(null);
  const regionPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const mapPickerTriggerRef = useRef<HTMLButtonElement>(null);

  const selectLocation = useCallback((location: SelectedLostLocation) => {
    setSelectedLocation(location);
    setFormData((current) => ({ ...current, lost_location: location.displayName }));
    setFieldErrors((current) => ({ ...current, lost_location: undefined }));
    setRegionPickerOpen(false);
    setMapPickerOpen(false);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (!paletteOpen) return;
    const close = (event: PointerEvent) => {
      if (!paletteRef.current?.contains(event.target as Node) && !paletteTriggerRef.current?.contains(event.target as Node)) setPaletteOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPaletteOpen(false); paletteTriggerRef.current?.focus(); }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [paletteOpen]);

  useEffect(() => {
    if (!exampleLibraryOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExampleLibraryOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", escape);
    };
  }, [exampleLibraryOpen]);

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
    clearImage();
    setPaletteOpen(false); setExampleLibraryOpen(false); setExampleFilter("전체"); setCustomColorOpen(false); setCustomColor(""); setSelectedColors([]); setColorNotice(""); setColorBalance(""); setSelectedFeatures([]); setActiveFeature(null); setFeatureAnswers({}); setFeatureNotes({}); setSubtype(""); setCustomSubtype(""); setSubtypeOpen(false); setFootwearCondition(""); setFootwearSide(""); setBallSize(""); setShowAllFeatureExamples(false); setRecentSuggestion(null); setSelectedLocation(null); setResetOpen(false);
  };

  const hasInput = selectedImage !== null || selectedColors.length > 0 || Object.values(formData).some((value) => value.trim());
  const quickColors = recommendedColors[formData.item_category] ?? ["검정", "흰색", "회색", "베이지", "파랑", "노랑"];
  const category = formData.item_category as LostReportCategory;
  const subtypeOptions = formData.item_category ? LOST_REPORT_SUBTYPES[category] ?? [] : [];
  const selectedSubtype = subtypeOptions.find((item) => item.code === subtype);
  const subtypeLabel = subtype === "OTHER" || subtype.startsWith("CUSTOM:") ? customSubtype.trim() || "기타" : selectedSubtype?.label ?? "";
  const featureDefinitions = formData.item_category ? getLostReportFeatures(category, subtype) : [];
  const rankedExamples = useMemo(() => {
    const entries = descriptionExamples[formData.item_category] ?? [];
    return [...entries].sort((left, right) => {
      const score = (entry: DescriptionExample) => entry.keywords.filter((keyword) => selectedFeatures.includes(keyword)).length;
      return score(right) - score(left);
    });
  }, [formData.item_category, selectedFeatures]);
  const libraryExamples = exampleFilter === "전체" ? rankedExamples : rankedExamples.filter((entry) => entry.category === exampleFilter);
  const completedCount = [Boolean(formData.item_category), selectedColors.length > 0, Boolean(formData.description.trim()), Boolean(formData.lost_location.trim()), Boolean(formData.lost_at)].filter(Boolean).length;
  const categoryLabel = itemCategories.find((item) => item.code === formData.item_category)?.label;
  const nodeValues = [formData.item_category, selectedColors.length ? "selected" : "", formData.description.trim(), formData.lost_location.trim(), formData.lost_at];
  const firstIncompleteNode = nodeValues.findIndex((value) => !value);
  const currentNode = firstIncompleteNode === -1 ? 4 : firstIncompleteNode;
  const extraItemSummary = formData.item_category === "FOOTWEAR" && footwearCondition ? `${footwearCondition}${footwearCondition === "한 짝" && footwearSide ? ` · ${footwearSide}` : ""}` : formData.item_category === "BALL" ? ballSize : "";
  const nodes = [
    { key: "item", label: "물품 종류", value: categoryLabel ? `${categoryLabel}${subtypeLabel ? ` · ${subtypeLabel}` : ""}` : "선택 전", done: Boolean(formData.item_category) },
    { key: "color", label: "색상", value: selectedColors.length ? selectedColors.join(" · ") : "선택 전", done: selectedColors.length > 0 },
    { key: "feature", label: extraItemSummary ? "핵심 정보·특징" : "구별 특징", value: [extraItemSummary, selectedFeatures.length ? featureDefinitions.filter((item) => selectedFeatures.includes(item.id)).map((item) => item.label).join(" · ") : formData.description.trim() ? "설명 작성됨" : ""].filter(Boolean).join(" / ") || "작성 전", done: Boolean(formData.description.trim()) },
    { key: "location", label: "위치", value: formData.lost_location.trim() || "입력 전", done: Boolean(formData.lost_location.trim()) },
    { key: "time", label: "시간", value: formData.lost_at ? displayLocalDateTime(formData.lost_at) : "선택 전", done: Boolean(formData.lost_at) },
  ].map((node, index) => ({ ...node, active: index === currentNode }));
  const requestReset = () => { if (hasInput) setResetOpen(true); else resetForm(); };
  const selectCategory = (code: LostReportCategory) => {
    updateField("item_category", code);
    setSubtype(""); setCustomSubtype(""); setSubtypeOpen(true); setFootwearCondition(""); setFootwearSide(""); setBallSize("");
    setSelectedFeatures([]); setFeatureAnswers({}); setFeatureNotes({}); setActiveFeature(null); setShowAllFeatureExamples(false);
  };
  const selectSubtype = (code: string) => {
    const nextDefinitions = getLostReportFeatures(category, code);
    const nextIds = new Set(nextDefinitions.map((item) => item.id));
    setSubtype(code); setCustomSubtype(""); setSubtypeOpen(code === "OTHER"); setShowAllFeatureExamples(false);
    setSelectedFeatures((current) => current.filter((id) => nextIds.has(id)));
    setFeatureAnswers((current) => Object.fromEntries(Object.entries(current).filter(([id]) => nextIds.has(id))));
    setFeatureNotes((current) => Object.fromEntries(Object.entries(current).filter(([id]) => nextIds.has(id))));
    setActiveFeature((current) => current && nextIds.has(current) ? current : null);
  };
  const chooseColor = (color: string) => {
    setColorNotice("");
    let nextColors: string[];
    if (selectedColors.includes(color)) nextColors = selectedColors.filter((item) => item !== color);
    else if (color === "여러 색") nextColors = [color];
    else {
      const withoutMixed = selectedColors.filter((item) => item !== "여러 색");
      if (withoutMixed.length >= 3) { setColorNotice("색상은 최대 3개까지 선택할 수 있어요."); return; }
      nextColors = [...withoutMixed, color];
    }
    setSelectedColors(nextColors);
    setColorBalance((balance) => validColorBalance(balance, nextColors));
    setFieldErrors((current) => ({ ...current, color: undefined }));
  };
  const addCustomColor = () => {
    const value = customColor.trim();
    if (!value) return;
    chooseColor(value);
    setCustomColor("");
  };
  const toggleFeature = (definition: ItemFeatureDefinition) => {
    setSelectedFeatures((current) => current.includes(definition.id) ? current : [...current, definition.id]);
    setActiveFeature(definition.id);
    setShowAllFeatureExamples(false);
  };
  const activeDefinition = featureDefinitions.find((item) => item.id === activeFeature) ?? null;
  const activeQuestion = activeDefinition?.questions.find((question) => !featureAnswers[activeDefinition.id]?.[question.id]) ?? null;
  const activeFeatureExamples = activeDefinition ? getContextualFeatureExamples(subtypeLabel || categoryLabel || "물품", activeDefinition) : [];
  const answerFeature = (answer: string) => {
    if (!activeDefinition || !activeQuestion) return;
    const nextAnswers = { ...(featureAnswers[activeDefinition.id] ?? {}), [activeQuestion.id]: answer };
    const allAnswers = { ...featureAnswers, [activeDefinition.id]: nextAnswers };
    setFeatureAnswers(allAnswers);
    syncFeatureDescription(featureNotes, allAnswers);
  };
  const featureSummary = (definition: ItemFeatureDefinition) => Object.values(featureAnswers[definition.id] ?? {}).filter((answer) => answer !== "잘 모르겠어요").join(" · ");
  const syncFeatureDescription = (notes: FeatureNotes, answers: FeatureAnswers = featureAnswers) => {
    const parts = featureDefinitions.filter((item) => selectedFeatures.includes(item.id)).map((item) => {
      const note = notes[item.id]?.trim();
      const answer = Object.values(answers[item.id] ?? {}).filter((value) => value !== "잘 모르겠어요").join(" · ");
      return note || answer ? `${item.label}: ${note || answer}` : "";
    }).filter(Boolean);
    setFormData((current) => ({ ...current, description: parts.join("\n") }));
    setFieldErrors((current) => ({ ...current, description: undefined }));
  };
  const updateFeatureNote = (featureId: string, value: string) => {
    const next = { ...featureNotes, [featureId]: value };
    setFeatureNotes(next);
    syncFeatureDescription(next);
  };
  const insertFeatureExample = (suggestion: string) => {
    if (!activeDefinition) return;
    const current = featureNotes[activeDefinition.id]?.trim() ?? "";
    if (current.includes(suggestion)) return;
    updateFeatureNote(activeDefinition.id, current ? `${current} ${suggestion}` : suggestion);
    setSuggestionFeedback(true); setRecentSuggestion(suggestion);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => { setSuggestionFeedback(false); setRecentSuggestion(null); }, 800);
  };
  const applyLibraryExample = (suggestion: string) => {
    const targetId = activeFeature ?? selectedFeatures[0];
    if (!targetId) return;
    const current = featureNotes[targetId]?.trim() ?? "";
    const next = { ...featureNotes, [targetId]: current ? `${current} ${suggestion}` : suggestion };
    setFeatureNotes(next); syncFeatureDescription(next); setActiveFeature(targetId); setExampleLibraryOpen(false);
  };

  const resetSection = (section: 1 | 2 | 3) => {
    if (section === 1) { updateField("item_category", ""); setSubtype(""); setCustomSubtype(""); setSubtypeOpen(false); setFootwearCondition(""); setFootwearSide(""); setBallSize(""); setSelectedFeatures([]); setFeatureAnswers({}); setFeatureNotes({}); setActiveFeature(null); setShowAllFeatureExamples(false); }
    if (section === 2) {
      setFormData((current) => ({ ...current, color: "", description: "" })); setSelectedColors([]); setColorBalance(""); setColorNotice(""); setSelectedFeatures([]); setFeatureAnswers({}); setFeatureNotes({}); setActiveFeature(null); setCustomColor(""); setCustomColorOpen(false); setPaletteOpen(false);
      clearImage();
    }
    if (section === 3) { setFormData((current) => ({ ...current, lost_location: "", lost_at: "" })); setSelectedLocation(null); }
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
      const report = await createLostReport(createRequest(formData, lostAt, selectedColors, selectedLocation, { subtypeLabel, footwearCondition, footwearSide, ballSize, colorBalance }), selectedImage ?? undefined);
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
                  {itemCategories.map((item) => <label key={item.code} className={`${styles.categoryOption} ${styles[`category_${item.code.toLowerCase()}`]}`}><input type="radio" name="item_category" value={item.code} checked={formData.item_category === item.code} onChange={() => selectCategory(item.code)} /><span><i><Icon name={item.icon} size={23} /></i><b>{item.label}</b></span></label>)}
                </fieldset>
                {formData.item_category && <p className={styles.categoryHint} key={formData.item_category}>선택한 물건: <strong>{categoryLabel}</strong> · {categoryHints[formData.item_category]} 중심으로 추천이 달라져요.</p>}
                {formData.item_category && (subtype && !subtypeOpen ? <div className={styles.subtypeSummary}><span><small>선택한 종류</small><strong>{categoryLabel} · {subtypeLabel}</strong></span><button type="button" onClick={() => setSubtypeOpen(true)}>변경</button></div> : <div className={styles.subtypePicker}><div><span><strong>어떤 종류에 가까웠나요?</strong><i>선택</i></span><p>정확하지 않아도 괜찮아요. 가장 비슷한 종류를 선택해주세요.</p></div><div className={styles.subtypeOptions}>{subtypeOptions.map((item) => <button type="button" aria-pressed={subtype === item.code} key={item.code} onClick={() => selectSubtype(item.code)}>{item.label}</button>)}</div>{subtype === "OTHER" && <label className={styles.customSubtype}><span>종류를 직접 입력해주세요.</span><input autoFocus value={customSubtype} maxLength={30} placeholder="예: 실내화, 장화, 미니백" onChange={(event) => setCustomSubtype(event.target.value)} /><button type="button" disabled={!customSubtype.trim()} onClick={() => { setSubtype(`CUSTOM:${customSubtype.trim()}`); setSubtypeOpen(false); }}>적용</button></label>}</div>)}
                {formData.item_category === "FOOTWEAR" && <div className={styles.auxQuestion}><strong>어떤 상태로 잃어버렸나요? <i>선택</i></strong><div>{["한 켤레", "한 짝", "잘 모르겠어요"].map((answer) => <button type="button" aria-pressed={footwearCondition === answer} key={answer} onClick={() => { setFootwearCondition(answer); if (answer !== "한 짝") setFootwearSide(""); }}>{answer}</button>)}</div>{footwearCondition === "한 짝" && <div className={styles.auxFollowup}><span>어느 쪽인가요?</span>{["왼쪽", "오른쪽", "기억나지 않아요"].map((answer) => <button type="button" aria-pressed={footwearSide === answer} key={answer} onClick={() => setFootwearSide(answer)}>{answer}</button>)}</div>}</div>}
                {formData.item_category === "BALL" && <div className={styles.auxQuestion}><strong>크기는 어느 정도였나요? <i>선택</i></strong><div>{["손바닥 정도", "두 손에 들어오는 정도", "축구공 정도", "더 컸어요", "잘 모르겠어요"].map((answer) => <button type="button" aria-pressed={ballSize === answer} key={answer} onClick={() => setBallSize(answer)}>{answer}</button>)}</div></div>}
                <div className={styles.errorSlot}>{fieldErrors.item_category && <small id={getErrorId("item_category")}>{fieldErrors.item_category}</small>}</div>
              </section>

              <section className={`${styles.composerSection} ${formData.description.trim() ? styles.isComplete : formData.item_category ? styles.isActive : ""}`} aria-labelledby="composer-description-title" onFocus={() => setActiveGuide("features")}>
                <div className={styles.composerHeading}><span>02</span><div><h3 id="composer-description-title">기억나는 모습을 알려주세요</h3><small>정확하지 않아도 괜찮아요. 기억나는 색상과 특징부터 선택해주세요.</small></div><button type="button" onClick={() => resetSection(2)}>초기화</button></div>
                <div className={styles.field}>
                  <label>색상 <i>최대 3개</i></label>
                  <div className={styles.quickChoices}><span>추천 색상</span><div>{quickColors.map((color) => <button type="button" key={color} aria-label={`${color} 색상 ${selectedColors.includes(color) ? "선택 해제" : "선택"}`} aria-pressed={selectedColors.includes(color)} onClick={() => chooseColor(color)}><i className={styles[`swatch_${swatchClass[color]}`]} />{color}</button>)}</div><div className={styles.colorActions}><button ref={paletteTriggerRef} type="button" aria-haspopup="dialog" aria-expanded={paletteOpen} onClick={() => { setPaletteOpen((current) => !current); setCustomColorOpen(false); }}>+ 다른 색상</button></div></div>
                  {selectedColors.length > 0 && <div className={styles.selectedColors}><span>선택한 색상 {selectedColors.length} / 3</span><div>{selectedColors.map((color) => <button type="button" key={color} onClick={() => chooseColor(color)} aria-label={`${color} 색상 제거`}><i className={styles[`swatch_${swatchClass[color] ?? "other"}`]} />{color}<Icon name="close" size={13} /></button>)}</div></div>}
                  {colorNotice && <p className={styles.colorNotice} role="status">{colorNotice}</p>}
                  {paletteOpen && <div ref={paletteRef} className={styles.palette} role="dialog" aria-label="다른 색상 선택"><div className={styles.paletteHead}><strong>다른 색상</strong><button type="button" onClick={() => { setPaletteOpen(false); paletteTriggerRef.current?.focus(); }} aria-label="색상 선택 닫기">닫기</button></div>{colorGroups.map((group) => <section key={group.name}><span>{group.name}</span><div>{group.colors.map((color) => <button type="button" key={color} aria-pressed={selectedColors.includes(color)} onClick={() => chooseColor(color)}><i className={styles[`swatch_${swatchClass[color] ?? "other"}`]} /><b>{color}</b></button>)}</div></section>)}<section><span>특수</span><div>{["여러 색", "투명"].map((color) => <button type="button" key={color} aria-pressed={selectedColors.includes(color)} onClick={() => chooseColor(color)}><i className={styles[`swatch_${swatchClass[color] ?? "other"}`]} /><b>{color}</b></button>)}</div></section><button className={styles.customColorToggle} type="button" onClick={() => setCustomColorOpen((current) => !current)}>목록에 없는 색상</button>{customColorOpen && <div className={styles.customColorInput}><input autoFocus value={customColor} maxLength={50} onChange={(event) => setCustomColor(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomColor(); } }} placeholder="예: 와인색, 형광 연두, 청록색" /><button type="button" onClick={addCustomColor}>추가</button></div>}</div>}
                  {selectedColors.length >= 2 && <div className={styles.colorBalance}><strong>색은 어떻게 보였나요?</strong><div>{[...selectedColors.map((color) => `${color}이 가장 많았어요`), "비슷하게 섞여 있었어요", "잘 모르겠어요"].map((answer) => <button type="button" key={answer} aria-pressed={colorBalance === answer} onClick={() => setColorBalance(answer)}>{answer}</button>)}</div></div>}
                  <div className={styles.errorSlot}>{fieldErrors.color && <small id={getErrorId("color")}>{fieldErrors.color}</small>}</div>
                </div>
                {formData.item_category && <div className={styles.linkedFeatureComposer} key={`features-${formData.item_category}-${subtype}`}>
                  <div className={styles.featureComposerIntro}><strong>특징을 알려주세요</strong><span>기억나는 항목부터 하나씩 알려주세요.</span></div>
                  <div className={styles.featureSelector}>{featureDefinitions.map((definition) => <button type="button" aria-expanded={activeFeature === definition.id} aria-controls={`feature-detail-${definition.id}`} data-has-content={Boolean(featureNotes[definition.id]?.trim() || featureSummary(definition))} key={definition.id} onClick={() => toggleFeature(definition)}>{definition.label}</button>)}</div>
                  {selectedFeatures.some((id) => id !== activeFeature) && <div className={styles.completedFeatures}><span>작성한 특징</span>{featureDefinitions.filter((definition) => selectedFeatures.includes(definition.id) && definition.id !== activeFeature).map((definition) => <article key={definition.id}><div><strong>{definition.label}</strong><p>{featureNotes[definition.id]?.trim() || featureSummary(definition) || "아직 자세한 내용은 작성하지 않았어요."}</p></div><button type="button" onClick={() => { setActiveFeature(definition.id); setShowAllFeatureExamples(false); }}>수정</button></article>)}</div>}
                  {activeDefinition && <section className={styles.featureDetailCard} id={`feature-detail-${activeDefinition.id}`} aria-labelledby={`feature-detail-title-${activeDefinition.id}`}>
                    <header><div><strong id={`feature-detail-title-${activeDefinition.id}`}>{activeDefinition.label}</strong><p>{activeQuestion?.prompt ?? `${activeDefinition.label}에서 기억나는 내용을 자유롭게 알려주세요.`}</p></div><button type="button" onClick={() => setActiveFeature(null)}>접어두기</button></header>
                    {activeQuestion && <div className={styles.featureOptionGroup} aria-label={activeQuestion.prompt}>{activeQuestion.options.map((answer) => <button type="button" aria-pressed={featureAnswers[activeDefinition.id]?.[activeQuestion.id] === answer} key={answer} onClick={() => answerFeature(answer)}>{answer === "잘 모르겠어요" ? "잘 기억나지 않음" : answer}</button>)}</div>}
                    {Object.values(featureAnswers[activeDefinition.id] ?? {}).includes("잘 모르겠어요") && <div className={styles.uncertainFeature}><strong>정확히 기억나지 않아도 괜찮아요.</strong><span>색이나 위치처럼 기억나는 부분만 적어도 발견물 비교에 도움이 돼요.</span></div>}
                    <label className={styles.featureNote}><span>기억나는 내용을 적어주세요.</span><textarea value={featureNotes[activeDefinition.id] ?? ""} onChange={(event) => { updateFeatureNote(activeDefinition.id, event.target.value); setSuggestionFeedback(false); }} placeholder={featurePlaceholders[activeDefinition.id] ?? `예) ${activeDefinition.label}에서 눈에 띄는 부분을 적어주세요.`} rows={4} aria-invalid={Boolean(fieldErrors.description)} aria-describedby={fieldErrors.description ? getErrorId("description") : undefined} /></label>
                    <div className={styles.featureRecommendations}><strong>표현이 어렵다면</strong>{activeFeatureExamples.slice(0, showAllFeatureExamples ? 10 : 3).map((sentence) => <button type="button" data-recent={recentSuggestion === sentence} key={sentence} onClick={() => insertFeatureExample(sentence)}><span aria-hidden="true">＋</span>{sentence}</button>)}{activeFeatureExamples.length > 3 && <button className={styles.moreExpressions} type="button" aria-expanded={showAllFeatureExamples} onClick={() => setShowAllFeatureExamples((current) => !current)}>{showAllFeatureExamples ? "간단히 보기" : "다른 표현 보기"}<Icon name="chevron" size={14} /></button>}</div>
                    <footer><button type="button" onClick={() => setActiveFeature(null)}>작성 완료</button></footer>
                  </section>}
                  {selectedFeatures.length > 0 && <section className={styles.featureFinalSummary}><div><span>신고에 사용할 특징</span><p>{formData.description.trim() || "작성한 특징이 여기에 정리돼요."}</p></div><button type="button" onClick={() => { setExampleFilter("전체"); setExampleLibraryOpen(true); }}>전체 예시 보기</button></section>}
                  <div className={styles.errorSlot}>{fieldErrors.description && <small id={getErrorId("description")}>{fieldErrors.description}</small>}{suggestionFeedback && <span className={styles.inlineFeedback} role="status">문장을 자연스럽게 추가했어요.</span>}</div>
                </div>}
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
                  <div className={`${styles.fieldShell} ${styles.locationFieldShell}`} onFocus={() => setActiveGuide("location")}><label htmlFor="lost-report-location">분실 위치 <em>필수</em></label><KakaoPlaceSearch value={formData.lost_location} selectedLocation={selectedLocation} invalid={Boolean(fieldErrors.lost_location)} describedBy={fieldErrors.lost_location ? getErrorId("lost_location") : "lost-report-location-help"} mapButtonRef={mapPickerTriggerRef} regionButtonRef={regionPickerTriggerRef} onValueChange={(value) => { updateField("lost_location", value); setSelectedLocation(null); }} onSelect={selectLocation} onOpenMap={() => setMapPickerOpen(true)} onOpenRegion={() => setRegionPickerOpen(true)} /><b id="lost-report-location-help">장소명이나 지역명을 검색하거나 기억나는 범위를 선택해 주세요.</b><div className={styles.errorSlot}>{fieldErrors.lost_location && <small id={getErrorId("lost_location")}>{fieldErrors.lost_location}</small>}</div></div>
                  <div className={styles.fieldShell} onFocus={() => setActiveGuide("time")}><label>분실 시각 <em>필수</em></label><DateTimePicker value={formData.lost_at} onChange={(value) => updateField("lost_at", value)} /><b id="lost-report-lost-at-help">물건을 마지막으로 확인한 현지 시각을 선택해주세요.</b><div className={styles.errorSlot}>{fieldErrors.lost_at && <small id={getErrorId("lost_at")}>{fieldErrors.lost_at}</small>}</div></div>
                </div>
              </section>

              {completedCount >= 4 && <section className={styles.preSubmit}><strong>등록 전 확인</strong><div><span>{itemCategories.find((item) => item.code === formData.item_category)?.label}</span><span>{selectedColors.join(" · ") || "색상 미입력"}</span><span>{formData.description}</span><span>{formData.lost_location}</span><span>{displayLocalDateTime(formData.lost_at)}</span></div></section>}

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
          <h2 id="lost-report-guide-title">신고 정보 요약</h2><p className={styles.guideCount}>{completedCount} / 5 정보 입력</p>
           <ol className={styles.flowNodes}>{nodes.map((node) => <li key={node.key} className={`${node.done ? styles.nodeDone : ""} ${node.active ? styles.nodeActive : ""}`} aria-current={node.active ? "step" : undefined}><i /><span><b>{node.label}</b><small>{node.value}</small></span></li>)}</ol>
           <div className={styles.contextHelp}><strong>현재 도움말</strong><p>{nodes[currentNode]?.key === "item" ? "잃어버린 물건의 종류를 선택해주세요." : nodes[currentNode]?.key === "color" ? "가장 가까운 색을 고르거나 직접 입력할 수 있어요." : nodes[currentNode]?.key === "feature" ? (selectedFeatures.length ? "예시를 참고하거나 직접 자유롭게 작성할 수 있어요." : "기억나는 특징을 고르면 관련 문장을 먼저 보여드려요.") : nodes[currentNode]?.key === "location" ? "장소명이나 지역명을 검색하고 결과에서 위치를 선택해주세요." : "마지막으로 확인한 시간을 선택해주세요."}</p></div>
          <p className={styles.guideNotice}>자동 매칭은 발견물 후보를 좁히기 위한 참고 정보이며, 동일 물품임을 확정하지 않습니다.</p>
        </aside>
      </div>
      {exampleLibraryOpen && <div className={styles.dialogBackdrop} onMouseDown={(event) => event.target === event.currentTarget && setExampleLibraryOpen(false)}>
        <section className={styles.exampleLibrary} role="dialog" aria-modal="true" aria-labelledby="example-library-title" aria-describedby="example-library-description">
          <div className={styles.libraryHeading}><div><p className={styles.eyebrow}>DESCRIPTION GUIDE</p><h2 id="example-library-title">{categoryLabel} 설명 예시</h2><span id="example-library-description">구별하기 쉬운 특징을 유형별로 살펴보고 내 물건과 가까운 문장을 선택하세요.</span></div><button autoFocus type="button" aria-label="설명 예시 팝업 닫기" onClick={() => setExampleLibraryOpen(false)}><Icon name="close" size={19} /></button></div>
          <div className={styles.libraryTips}><strong>잘 알아볼 수 있는 설명 작성법</strong><ul><li>특징이 있는 위치를 함께 적어주세요.</li><li>로고, 장식, 흠집처럼 눈에 띄는 차이를 적어주세요.</li><li>예시를 선택한 뒤 실제 물건에 맞게 수정해주세요.</li></ul></div>
          <div className={styles.libraryFilters} aria-label="설명 예시 유형">{(["전체", "형태·구조", "표시·장식", "사용 흔적"] as const).map((filter) => <button type="button" key={filter} aria-pressed={exampleFilter === filter} onClick={() => setExampleFilter(filter)}>{filter}</button>)}</div>
          <div className={styles.libraryList}>{libraryExamples.map((entry) => <button type="button" key={entry.text} onClick={() => applyLibraryExample(entry.text)}><span>{entry.category}</span><strong>{entry.text}</strong><small>{entry.keywords.map((keyword) => `#${keyword}`).join("  ")}</small></button>)}</div>
        </section>
      </div>}
      {resetOpen && <div className={styles.dialogBackdrop} onMouseDown={(event) => event.target === event.currentTarget && setResetOpen(false)}><section className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">작성한 내용을 모두 지울까요?</h2><p>입력한 내용은 복구할 수 없습니다.</p><div><button className="button button-secondary" type="button" onClick={() => setResetOpen(false)}>취소</button><button className="button button-primary" type="button" onClick={resetForm}>모두 지우기</button></div></section></div>}
      <RegionPickerDialog open={regionPickerOpen} triggerRef={regionPickerTriggerRef} onClose={() => setRegionPickerOpen(false)} onConfirm={selectLocation} />
      <MapPickerDialog open={mapPickerOpen} triggerRef={mapPickerTriggerRef} initialLocation={selectedLocation} onClose={() => setMapPickerOpen(false)} onConfirm={selectLocation} />
    </main>
  );
}
