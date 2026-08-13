export type DiscoverySource = "AI 탐지" | "발견 제보";
export type CitizenReportStatus = "검토 대기" | "관리자 확인 중" | "기존 발견물 연결" | "반려" | "취소";

export type DiscoveryHistory = {
  id: string;
  at: string;
  label: string;
  place: string;
  detail?: string;
  imageUrl?: string | null;
  source: DiscoverySource;
};

export type CitizenReport = {
  id: string;
  category: string;
  title: string;
  color: string;
  description: string;
  areaName: string;
  foundAt: string;
  imageClass: "umbrella" | "backpack" | "ball" | "shoe";
  imageUrl: string | null;
  status: CitizenReportStatus;
  history: DiscoveryHistory[];
  mapPosition: { x: number; y: number };
};

export type CitizenReportDraft = Pick<CitizenReport, "category" | "color" | "description" | "areaName" | "foundAt"> & {
  image?: File;
};

export type SightingDraft = {
  foundAt: string;
  areaName: string;
  description: string;
  image?: File;
};
