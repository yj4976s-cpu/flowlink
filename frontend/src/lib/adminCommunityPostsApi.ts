export type AdminCommunitySummary = {
  total: number;
  visible: number;
  deleted: number;
  notices: number;
  comments: number;
  new_today: number;
  new_last_7_days: number;
};

export type AdminCommunityPost = {
  id: number;
  title: string;
  category: string;
  author_nickname: string;
  place_name: string | null;
  is_notice: boolean;
  comment_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type AdminCommunityPostsResponse = {
  summary: AdminCommunitySummary;
  category_breakdown: Array<{ category: string; count: number }>;
  posts: AdminCommunityPost[];
  total: number;
};

export class AdminCommunityPostsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AdminCommunityPostsApiError";
  }
}

function apiBaseUrl() {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!value) throw new AdminCommunityPostsApiError("API 서버 주소가 설정되지 않았습니다.");
  return value.replace(/\/+$/, "");
}

export async function getAdminCommunityPosts(
  filters: { skip: number; limit: number; q?: string; category?: string; include_deleted?: boolean; notice?: string },
  signal?: AbortSignal,
) {
  const url = new URL(`${apiBaseUrl()}/api/admin/community-posts`);
  Object.entries(filters).forEach(([key, value]) => {
    const normalized = String(value ?? "").trim();
    if (normalized) url.searchParams.set(key, normalized);
  });
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) {
    throw new AdminCommunityPostsApiError(
      response.status === 403 ? "관리자 권한이 필요합니다." : "게시글 현황을 불러오지 못했습니다.",
      response.status,
    );
  }
  return response.json() as Promise<AdminCommunityPostsResponse>;
}
