import type { IconName } from "@/components/common/Icon";

export type MapMarkerKind = "camera" | "detection" | "found" | "citizen";
export type MapMarkerStatus = "normal" | "review" | "waiting";
export type MapMarker = {
  id: string;
  kind: MapMarkerKind;
  status: MapMarkerStatus;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  icon: IconName;
  camera?: string;
  time?: string;
  confidence?: number;
  linkedItem?: string;
  linkedReports?: number;
};

export type SearchResult = {
  id: string;
  group: "장소" | "카메라" | "발견물" | "AI 탐지";
  title: string;
  detail: string;
  markerId?: string;
  x: number;
  y: number;
};

export const operationsSummary = [
  { label: "AI 탐지", value: 12, tone: "primary" },
  { label: "확인 필요", value: 5, tone: "attention" },
  { label: "처리 대기", value: 4, tone: "waiting" },
  { label: "발견물", value: 8, tone: "found" },
  { label: "카메라", value: 6, tone: "camera" },
] as const;

export const recentDetections = [
  { item: "우산", time: "3분 전", camera: "CAM-03" },
  { item: "백팩", time: "11분 전", camera: "CAM-01" },
  { item: "공", time: "18분 전", camera: "CAM-06" },
];

export const operationsMarkers: MapMarker[] = [
  { id: "DET-2048", kind: "detection", status: "review", title: "우산", subtitle: "신뢰도 94%", x: 54, y: 42, icon: "umbrella", camera: "CAM-03", time: "오늘 10:42", confidence: 94, linkedItem: "FI-1024", linkedReports: 2 },
  { id: "DET-2047", kind: "detection", status: "normal", title: "백팩", subtitle: "신뢰도 89%", x: 34, y: 57, icon: "backpack", camera: "CAM-01", time: "오늘 10:34", confidence: 89 },
  { id: "DET-2046", kind: "detection", status: "waiting", title: "공", subtitle: "신뢰도 86%", x: 70, y: 64, icon: "ball", camera: "CAM-06", time: "오늘 10:27", confidence: 86 },
  { id: "CAM-03", kind: "camera", status: "normal", title: "CAM-03", subtitle: "한강 A구역", x: 49, y: 27, icon: "camera", time: "마지막 탐지 10:42" },
  { id: "CAM-01", kind: "camera", status: "normal", title: "CAM-01", subtitle: "여의도 수변", x: 22, y: 43, icon: "camera", time: "마지막 탐지 10:34" },
  { id: "CAM-06", kind: "camera", status: "normal", title: "CAM-06", subtitle: "잠실 수변", x: 78, y: 38, icon: "camera", time: "마지막 탐지 10:27" },
  { id: "FI-1024", kind: "found", status: "waiting", title: "검정 장우산", subtitle: "회수 확인 대기", x: 59, y: 51, icon: "umbrella", time: "오늘 10:48", linkedReports: 2 },
  { id: "FI-1021", kind: "found", status: "normal", title: "회색 백팩", subtitle: "보관 중", x: 29, y: 66, icon: "backpack", time: "오늘 10:38" },
  { id: "CR-031", kind: "citizen", status: "review", title: "시민 발견 제보", subtitle: "검토 전", x: 83, y: 70, icon: "eye", time: "오늘 10:22" },
];

export const searchResults: SearchResult[] = [
  { id: "place-yeouido", group: "장소", title: "여의도한강공원", detail: "서울 영등포구 여의동로 330", x: 25, y: 48 },
  { id: "place-jamsil", group: "장소", title: "잠실한강공원", detail: "서울 송파구 한가람로 65", x: 76, y: 48 },
  { id: "search-cam03", group: "카메라", title: "CAM-03 · 한강 A구역", detail: "운영 상태 정상", markerId: "CAM-03", x: 49, y: 27 },
  { id: "search-fi1024", group: "발견물", title: "FI-1024 · 검정 장우산", detail: "회수 확인 대기", markerId: "FI-1024", x: 59, y: 51 },
  { id: "search-det2048", group: "AI 탐지", title: "DET-2048 · 우산 · 94%", detail: "CAM-03 · 오늘 10:42", markerId: "DET-2048", x: 54, y: 42 },
];

export function getOperationsMapSnapshot() {
  return Promise.resolve({ markers: operationsMarkers, summary: operationsSummary, recent: recentDetections });
}
