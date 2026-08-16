export type DaruGuideRole = "GUEST" | "USER" | "ADMIN";

export interface DaruGuideItem { label: string; href: string }
export interface DaruGuideContent { roleLabel: string; greeting: string; description: string; items: DaruGuideItem[] }

export const DARU_GUIDE_CONFIG: Record<DaruGuideRole, DaruGuideContent> = {
  GUEST: {
    roleLabel: "FlowLink 서비스 길잡이",
    greeting: "안녕하세요, 다루예요.",
    description: "FlowLink가 처음이라면 필요한 곳을 간단하게 안내해드릴게요.",
    items: [
      { label: "FlowLink 알아보기", href: "/about" },
      { label: "발견물 찾아보기", href: "/found-items" },
      { label: "AI 탐지 체험하기", href: "/detect" },
      { label: "이용 방법 보기", href: "/guide" },
    ],
  },
  USER: {
    roleLabel: "분실물 이용 도우미",
    greeting: "다시 만났네요.",
    description: "분실 신고부터 매칭과 소유권 확인까지 필요한 과정을 안내해드릴게요.",
    items: [
      { label: "분실 신고하기", href: "/lost-reports/new" },
      { label: "내 매칭 결과 보기", href: "/matches" },
      { label: "발견물 찾아보기", href: "/found-items" },
      { label: "소유권 확인 방법", href: "/guide" },
      { label: "내 활동 보기", href: "/mypage" },
    ],
  },
  ADMIN: {
    roleLabel: "FlowLink 운영 안내 도우미",
    greeting: "운영 업무를 확인하고 계시네요.",
    description: "필요한 관리 화면을 빠르게 찾아드릴게요.",
    items: [
      { label: "AI 탐지 관리", href: "/admin/detections" },
      { label: "시민 제보 검토", href: "/admin/citizen-reports" },
      { label: "발견물 관리", href: "/admin/found-items" },
      { label: "소유권 요청 관리", href: "/admin/ownership-claims" },
      { label: "운영 대시보드", href: "/admin" },
    ],
  },
};
