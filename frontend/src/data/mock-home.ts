import type { FoundItem } from "@/types/home";

// Demo-only values. Replace with API responses when the backend contract is implemented.
export const homeStats = [
  { label: "최근 발견", value: "24", suffix: "건", icon: "scan" as const },
  { label: "매칭 진행", value: "7", suffix: "건", icon: "document" as const },
  { label: "반환 완료", value: "5", suffix: "건", icon: "check" as const },
  { label: "오늘 탐지", value: "12", suffix: "건", icon: "spark" as const },
];

export const recentItems: FoundItem[] = [
  {
    id: 1,
    category: "가방",
    title: "검정색 백팩",
    location: "잠실 한강공원",
    confidence: 92,
    foundAt: "2026-08-06T07:35:00+09:00",
    objectKind: "backpack",
  },
  {
    id: 2,
    category: "우산",
    title: "주황색 우산",
    location: "뚝섬 한강공원",
    confidence: 88,
    foundAt: "2026-08-06T06:50:00+09:00",
    objectKind: "umbrella",
  },
  {
    id: 3,
    category: "나뭇가지",
    title: "나뭇가지",
    location: "여의도 한강공원",
    confidence: 81,
    foundAt: "2026-08-05T18:22:00+09:00",
    objectKind: "branch",
  },
  {
    id: 4,
    category: "기타",
    title: "투명 플라스틱 용기",
    location: "반포 한강공원",
    confidence: 76,
    foundAt: "2026-08-05T16:10:00+09:00",
    objectKind: "container",
  },
];
