export type ChatRole = "GUEST" | "USER" | "ADMIN";
export type ChatPageContext = "HOME" | "FOUND_ITEMS" | "FOUND_ITEM_DETAIL" | "LOST_REPORT_NEW" | "MATCH_LIST" | "NOTIFICATIONS" | "MY_PAGE" | "DETECTION" | "COMMUNITY" | "ADMIN_DASHBOARD" | "ADMIN_DETECTIONS" | "ADMIN_OWNERSHIP_CLAIMS" | "ADMIN_FOUND_ITEMS" | "ADMIN_OPERATIONS" | "GUIDE";

export type ChatPrompt = {
  id: string;
  title: string;
  message: string;
  description?: string;
  roles: ChatRole[];
  pages?: ChatPageContext[];
  priority: number;
};

export type GuestIntent = {
  id: "find" | "report" | "analysis";
  title: string;
  description: string;
  heading: string;
  questions: string[];
};

export const guestIntents: GuestIntent[] = [
  { id: "find", title: "분실물을 찾고 있어요", description: "발견물 확인부터 다음 단계까지 안내해요.", heading: "분실물 찾기", questions: ["발견물은 어디서 확인해?", "내 물건 같으면 어떻게 해야 해?", "발견 위치는 어디까지 공개돼?", "AI가 발견물을 어떻게 분류해?", "로그인하면 어떤 기능을 더 쓸 수 있어?"] },
  { id: "report", title: "분실 신고를 하고 싶어요", description: "어떤 정보를 적어야 하는지 안내해요.", heading: "분실 신고", questions: ["분실 신고는 어떻게 해?", "어떤 정보를 적어야 해?", "위치를 정확히 몰라도 돼?", "사진이 없어도 신고할 수 있어?", "신고 후에는 어떻게 진행돼?"] },
  { id: "analysis", title: "AI 분석이 궁금해요", description: "탐지 결과와 점수의 의미를 설명해요.", heading: "AI 분석 이해하기", questions: ["탐지 신뢰도는 무슨 뜻이야?", "매칭 점수와 뭐가 달라?", "AI는 어떤 물품을 탐지해?", "AI 탐지는 어떻게 작동해?", "발견물 분석 결과는 어디서 확인해?"] },
];

export function guestContextPrompts(pageContext: ChatPageContext): ChatPrompt[] {
  const byPage: Partial<Record<ChatPageContext, string[]>> = {
    FOUND_ITEMS: ["발견물은 어떻게 찾아?", "이 발견물 목록은 어떻게 보면 돼?", "AI 탐지 결과는 어떤 의미야?"],
    FOUND_ITEM_DETAIL: ["이 분석 결과를 설명해줘", "탐지 신뢰도는 무슨 뜻이야?", "내 물건 같으면 어떻게 해야 해?"],
    LOST_REPORT_NEW: ["신고 작성 방법을 알려줘", "위치와 시간은 어떻게 입력해?", "특징은 어떻게 설명하면 좋아?"],
    DETECTION: ["AI 탐지는 어떻게 작동해?", "탐지 신뢰도는 무슨 뜻이야?", "분석 결과는 어디서 확인해?"],
  };
  return (byPage[pageContext] ?? ["FlowLink는 어떤 서비스야?"]).map((message, index) => ({ id: `guest-context-${pageContext}-${index}`, title: message, message, roles: ["GUEST"], pages: [pageContext], priority: 50 - index }));
}

const allPublic: ChatRole[] = ["GUEST", "USER"];
const prompts: ChatPrompt[] = [
  { id: "lost-write", title: "신고 내용 작성하기", description: "찾는 데 도움이 되는 필수 정보를 확인해요.", message: "분실 신고에 어떤 내용을 적어야 해?", roles: allPublic, pages: ["LOST_REPORT_NEW"], priority: 100 },
  { id: "lost-location", title: "위치가 정확하지 않을 때", message: "위치를 정확히 기억하지 못하면 어떻게 해?", roles: allPublic, pages: ["LOST_REPORT_NEW"], priority: 95 },
  { id: "lost-photo", title: "사진 없이 신고하기", message: "사진이 없어도 분실 신고를 할 수 있어?", roles: allPublic, pages: ["LOST_REPORT_NEW"], priority: 90 },
  { id: "lost-features", title: "특징 설명 도움받기", message: "특징을 잘 기억하지 못하면 어떻게 적어?", roles: allPublic, pages: ["LOST_REPORT_NEW"], priority: 85 },
  { id: "lost-match-next", title: "신고 후 매칭 확인하기", message: "신고하면 매칭 결과는 어떻게 확인해?", roles: allPublic, pages: ["LOST_REPORT_NEW"], priority: 80 },
  { id: "found-similar", title: "비슷한 발견물 확인하기", description: "내 신고 조건과 유사한 후보를 확인해요.", message: "내 신고와 비슷한 발견물이 있어?", roles: ["USER"], pages: ["FOUND_ITEMS", "FOUND_ITEM_DETAIL"], priority: 100 },
  { id: "found-info", title: "발견물 정보 확인하기", message: "이 발견물 정보는 어떻게 확인해?", roles: allPublic, pages: ["FOUND_ITEMS", "FOUND_ITEM_DETAIL"], priority: 90 },
  { id: "found-ai", title: "AI 탐지 결과 이해하기", message: "발견물의 AI 탐지 결과도 볼 수 있어?", roles: allPublic, pages: ["FOUND_ITEMS", "FOUND_ITEM_DETAIL"], priority: 85 },
  { id: "found-mine", title: "내 물건 같을 때", message: "발견물이 내 물건 같으면 어떻게 해야 해?", roles: allPublic, pages: ["FOUND_ITEMS", "FOUND_ITEM_DETAIL"], priority: 80 },
  { id: "claim-process", title: "소유권 확인 진행하기", message: "소유권 확인은 어떻게 진행해?", roles: allPublic, pages: ["FOUND_ITEMS", "FOUND_ITEM_DETAIL", "MATCH_LIST"], priority: 75 },
  { id: "match-new", title: "새로운 매칭 확인하기", description: "내 신고와 연결된 최신 후보를 확인해요.", message: "새로운 매칭 결과가 있어?", roles: ["USER"], pages: ["MATCH_LIST"], priority: 100 },
  { id: "match-best", title: "가장 비슷한 발견물", message: "가장 비슷한 발견물을 알려줘", roles: ["USER"], pages: ["MATCH_LIST"], priority: 95 },
  { id: "match-score", title: "매칭 점수 이해하기", message: "매칭 점수는 어떤 의미야?", roles: allPublic, pages: ["MATCH_LIST"], priority: 90 },
  { id: "match-reason", title: "비슷한 조건 확인하기", message: "내 신고와 어떤 조건이 비슷해?", roles: ["USER"], pages: ["MATCH_LIST"], priority: 85 },
  { id: "match-next", title: "다음 단계 확인하기", message: "내 물건 같으면 다음에 뭘 해야 해?", roles: ["USER"], pages: ["MATCH_LIST"], priority: 80 },
  { id: "notice-important", title: "중요한 알림 확인하기", description: "최근 확인해야 할 알림을 정리해요.", message: "최근 중요한 알림을 알려줘", roles: ["USER"], pages: ["NOTIFICATIONS"], priority: 100 },
  { id: "notice-match", title: "매칭 알림 확인하기", message: "새로운 매칭 알림이 있어?", roles: ["USER"], pages: ["NOTIFICATIONS"], priority: 95 },
  { id: "notice-report", title: "신고 상태 변경 확인하기", message: "내 신고 상태가 바뀐 게 있어?", roles: ["USER"], pages: ["NOTIFICATIONS"], priority: 90 },
  { id: "notice-claim", title: "소유권 알림 확인하기", message: "소유권 확인 관련 알림이 있어?", roles: ["USER"], pages: ["NOTIFICATIONS"], priority: 85 },
  { id: "notice-meaning", title: "알림 의미 알아보기", message: "FlowLink 알림 상태가 각각 무슨 뜻인지 알려줘", roles: ["USER"], pages: ["NOTIFICATIONS"], priority: 80 },
  { id: "admin-summary", title: "오늘의 운영 현황", description: "현재 운영 지표와 처리 상태를 요약해요.", message: "오늘 운영 현황을 정리해줘", roles: ["ADMIN"], priority: 100 },
  { id: "admin-detections", title: "탐지 처리 현황", message: "오늘 탐지 처리 상태를 알려줘", roles: ["ADMIN"], priority: 90 },
  { id: "admin-claims", title: "소유권 요청 현황", message: "소유권 확인 요청 상태별 현황을 알려줘", roles: ["ADMIN"], priority: 85 },
  { id: "admin-found", title: "발견물 운영 현황", message: "오늘 발견물 운영 현황을 알려줘", roles: ["ADMIN"], priority: 80 },
  { id: "admin-confidence", title: "평균 탐지 신뢰도", message: "오늘 평균 탐지 신뢰도를 알려줘", roles: ["ADMIN"], priority: 75 },
];

const examples: Record<ChatRole, ChatPrompt[]> = {
  GUEST: [
    ["claim-how", "내 물건 같으면 어떻게 확인해?"], ["report-how", "분실 신고는 어떻게 작성해?"], ["confidence", "AI 탐지 신뢰도는 무슨 뜻이야?"], ["match-score", "매칭 점수는 어떤 의미야?"], ["privacy", "내 정보는 어떻게 보호돼?"],
  ].map(([id, message], priority) => ({ id: `guest-${id}`, title: message, message, roles: ["GUEST"], priority: 20 - priority })),
  USER: [
    ["reports", "내 신고 상태 알려줘"], ["matches", "새로운 매칭이 있는지 확인해줘"], ["analysis", "최근 AI 분석 결과 보여줘"], ["reason", "왜 이 발견물이 매칭됐는지 알려줘"], ["next", "지금 내가 해야 할 일을 알려줘"],
  ].map(([id, message], priority) => ({ id: `user-${id}`, title: message, message, roles: ["USER"], priority: 20 - priority })),
  ADMIN: [
    ["summary", "오늘 확인해야 할 운영 항목을 알려줘"], ["detections", "검토 대기 탐지가 몇 건인지 알려줘"], ["claims", "소유권 확인 요청 현황을 알려줘"], ["processing", "오늘 탐지 처리 현황을 요약해줘"], ["pending", "현재 처리할 운영 항목을 정리해줘"],
  ].map(([id, message], priority) => ({ id: `admin-example-${id}`, title: message, message, roles: ["ADMIN"], priority: 20 - priority })),
};

const roleFallback: Record<ChatRole, ChatPrompt[]> = {
  GUEST: examples.GUEST,
  USER: [
    { id: "user-status", title: "내 신고 상태 확인하기", description: "최근 신고 진행 상황을 확인해요.", message: "내 분실 신고 상태 알려줘", roles: ["USER"], priority: 70 },
    { id: "user-match", title: "새 매칭 확인하기", message: "새로운 매칭 결과가 있어?", roles: ["USER"], priority: 65 },
    { id: "user-alert", title: "최근 알림 확인하기", message: "최근 알림 확인해줘", roles: ["USER"], priority: 60 },
    { id: "user-similar", title: "비슷한 발견물 찾기", message: "내 신고와 비슷한 발견물을 찾아줘", roles: ["USER"], priority: 55 },
    { id: "user-claim", title: "소유권 확인 알아보기", message: "소유권 확인은 어떻게 진행돼?", roles: ["USER"], priority: 50 },
  ],
  ADMIN: prompts.filter((prompt) => prompt.roles.includes("ADMIN")),
};

function unique(items: ChatPrompt[], excluded: ChatPrompt[] = []) {
  const ids = new Set(excluded.map((item) => item.id));
  const messages = new Set(excluded.map((item) => item.message.trim().toLowerCase()));
  return items.filter((item) => {
    const message = item.message.trim().toLowerCase();
    if (ids.has(item.id) || messages.has(message)) return false;
    ids.add(item.id); messages.add(message); return true;
  });
}

export function resolveChatPrompts({ role, pageContext }: { role: ChatRole; pageContext: ChatPageContext }) {
  const contextual = prompts.filter((prompt) => prompt.roles.includes(role) && prompt.pages?.includes(pageContext)).sort((a, b) => b.priority - a.priority);
  const recommendations = unique([...contextual, ...roleFallback[role]]).slice(0, 5);
  const examplePrompts = unique(examples[role]).slice(0, 5);
  return { primaryRecommendation: recommendations[0] ?? null, contextualPrompts: recommendations.slice(1), examplePrompts };
}
