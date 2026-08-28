import type { IconName } from "@/components/common/Icon";

export type MapMarkerKind = "camera" | "detection" | "found" | "citizen";
export type MapMarkerStatus = "normal" | "review" | "waiting";
export type MapMarker = {
  id: string; kind: MapMarkerKind; status: MapMarkerStatus; title: string; subtitle: string;
  latitude: number; longitude: number; icon: IconName; camera?: string; time?: string;
  confidence?: number; linkedItem?: string; linkedReports?: number;
};

export type SearchResult = {
  id: string; group: "장소" | "카메라" | "발견물" | "AI 탐지" | "시민 제보"; title: string; detail: string;
  latitude: number; longitude: number; markerId?: string;
};

export const operationsMarkers: MapMarker[] = [
  { id: "CAM-01", kind: "camera", status: "normal", title: "CAM-01", subtitle: "여의도 수변", latitude: 37.5286, longitude: 126.9347, icon: "camera", time: "마지막 탐지 10:34" },
  { id: "CAM-03", kind: "camera", status: "review", title: "CAM-03", subtitle: "한강 A구역", latitude: 37.5127, longitude: 126.9958, icon: "camera", time: "마지막 탐지 10:42" },
  { id: "CAM-06", kind: "camera", status: "waiting", title: "CAM-06", subtitle: "잠실 수변", latitude: 37.5187, longitude: 127.0817, icon: "camera", time: "마지막 탐지 10:27" },
  { id: "DET-2048", kind: "detection", status: "review", title: "우산", subtitle: "신뢰도 94%", latitude: 37.5127, longitude: 126.9958, icon: "umbrella", camera: "CAM-03", time: "오늘 10:42", confidence: 94, linkedItem: "FI-1024", linkedReports: 2 },
  { id: "DET-2045", kind: "detection", status: "normal", title: "쇼핑백", subtitle: "신뢰도 91%", latitude: 37.5127, longitude: 126.9958, icon: "archive", camera: "CAM-03", time: "오늘 10:39", confidence: 91 },
  { id: "DET-2044", kind: "detection", status: "waiting", title: "운동화", subtitle: "신뢰도 88%", latitude: 37.5127, longitude: 126.9958, icon: "archive", camera: "CAM-03", time: "오늘 10:31", confidence: 88 },
  { id: "DET-2043", kind: "detection", status: "normal", title: "모자", subtitle: "신뢰도 83%", latitude: 37.5127, longitude: 126.9958, icon: "archive", camera: "CAM-03", time: "오늘 10:25", confidence: 83 },
  { id: "DET-2047", kind: "detection", status: "normal", title: "백팩", subtitle: "신뢰도 89%", latitude: 37.5286, longitude: 126.9347, icon: "backpack", camera: "CAM-01", time: "오늘 10:34", confidence: 89 },
  { id: "DET-2042", kind: "detection", status: "review", title: "지갑", subtitle: "신뢰도 87%", latitude: 37.5286, longitude: 126.9347, icon: "archive", camera: "CAM-01", time: "오늘 10:29", confidence: 87 },
  { id: "DET-2041", kind: "detection", status: "normal", title: "텀블러", subtitle: "신뢰도 82%", latitude: 37.5286, longitude: 126.9347, icon: "archive", camera: "CAM-01", time: "오늘 10:20", confidence: 82 },
  { id: "DET-2046", kind: "detection", status: "waiting", title: "공", subtitle: "신뢰도 86%", latitude: 37.5187, longitude: 127.0817, icon: "ball", camera: "CAM-06", time: "오늘 10:27", confidence: 86 },
  { id: "DET-2040", kind: "detection", status: "normal", title: "물병", subtitle: "신뢰도 84%", latitude: 37.5187, longitude: 127.0817, icon: "archive", camera: "CAM-06", time: "오늘 10:16", confidence: 84 },
  { id: "FI-1024", kind: "found", status: "waiting", title: "검정 장우산", subtitle: "회수 확인 대기", latitude: 37.5109, longitude: 127.0011, icon: "umbrella", time: "오늘 10:48", linkedReports: 2 },
  { id: "FI-1021", kind: "found", status: "normal", title: "회색 백팩", subtitle: "보관 중", latitude: 37.5264, longitude: 126.9398, icon: "backpack", time: "오늘 10:38" },
  { id: "FI-1019", kind: "found", status: "review", title: "흰색 운동화", subtitle: "분류 확인 필요", latitude: 37.5202, longitude: 127.0754, icon: "archive", time: "오늘 10:25" },
  { id: "CR-031", kind: "citizen", status: "review", title: "시민 발견 제보", subtitle: "검정 가방", latitude: 37.5171, longitude: 127.0874, icon: "eye", time: "오늘 10:22" },
  { id: "CR-029", kind: "citizen", status: "waiting", title: "시민 분실 제보", subtitle: "파란 우산", latitude: 37.5311, longitude: 126.9296, icon: "eye", time: "오늘 10:08" },
];

export const operationsSummary = [
  { label: "AI 탐지", value: 10, tone: "primary" }, { label: "확인 필요", value: 4, tone: "attention" },
  { label: "처리 대기", value: 4, tone: "waiting" }, { label: "발견물", value: 3, tone: "found" },
  { label: "카메라", value: 3, tone: "camera" },
] as const;

export const recentDetections = [
  { item: "우산", time: "3분 전", camera: "CAM-03" }, { item: "백팩", time: "11분 전", camera: "CAM-01" },
  { item: "공", time: "18분 전", camera: "CAM-06" },
];

export const searchResults: SearchResult[] = operationsMarkers.map((marker) => ({
  id: `operation-${marker.id}`,
  group: marker.kind === "camera" ? "카메라" : marker.kind === "found" ? "발견물" : marker.kind === "detection" ? "AI 탐지" : "시민 제보",
  title: marker.kind === "camera" ? `${marker.id} · ${marker.subtitle}` : `${marker.id} · ${marker.title}`,
  detail: marker.kind === "detection" ? `${marker.camera} · ${marker.time}` : marker.subtitle,
  markerId: marker.id, latitude: marker.latitude, longitude: marker.longitude,
}));

export function getOperationsMapSnapshot() {
  return Promise.resolve({ markers: operationsMarkers, summary: operationsSummary, recent: recentDetections });
}
