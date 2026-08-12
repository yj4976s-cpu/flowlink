export type CopilotMode = "GUIDE" | "PERSONAL" | "OPERATIONS";
export type CopilotCard = { type: "MATCH" | "ANALYSIS" | "STATUS" | "TIMELINE" | "EVIDENCE" | "SYSTEM_NOTICE" | "COMMUNITY"; title: string; subtitle?: string | null; score?: number | null; confidence?: number | null; status?: string | null; details: string[]; entity_id?: number | null };
export type CopilotAction = { type: "NAVIGATE" | "ASK"; label: string; target: string };
export type CopilotSuggestion = { id: string; message: string };
export type CopilotResponse = { message: string; cards: CopilotCard[]; actions: CopilotAction[]; suggestions: CopilotSuggestion[]; mode: CopilotMode; provider: string; model: string; conversation_public_id?: string | null };
export type CopilotHistoryMessage = { role: "user" | "assistant"; content: string };
export type CopilotConversationSummary = { public_id: string; title: string; context_type: string; context_entity_id?: number | null; last_message_at: string };
export type CopilotStoredMessage = { id: number; role: "USER" | "ASSISTANT"; content: string; cards: CopilotCard[]; actions: CopilotAction[]; suggestions: CopilotSuggestion[]; created_at: string };
export type CopilotConversationDetail = CopilotConversationSummary & { messages: CopilotStoredMessage[] };

export class CopilotApiError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterSeconds?: number) { super(message); this.name = "CopilotApiError"; }
}

function baseUrl() {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!value) throw new CopilotApiError("API 서버 주소가 설정되지 않았습니다.");
  return value.replace(/\/+$/, "");
}

export async function sendCopilotMessage(messages: CopilotHistoryMessage[], context: { page: string; path: string; entity_id?: number }, options?: { signal?: AbortSignal; conversationId?: string | null; clientMessageId?: string }) {
  const response = await fetch(`${baseUrl()}/api/copilot/chat`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, context, conversation_public_id: options?.conversationId, client_message_id: options?.clientMessageId }), signal: options?.signal });
  if (!response.ok) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined;
    let message = response.status === 429 ? "AI 사용량이 잠시 한도에 도달했어요. 잠시 후 다시 시도해 주세요." : response.status === 503 ? "FlowLink AI 모델 연결이 아직 설정되지 않았어요." : "FlowLink AI 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.";
    try { const body = await response.json() as { detail?: string | { status?: string; message?: string } }; if (typeof body.detail === "string") message = body.detail; else if (body.detail?.message) message = body.detail.message; } catch { /* safe fallback */ }
    throw new CopilotApiError(message, response.status, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined);
  }
  return response.json() as Promise<CopilotResponse>;
}

async function memoryFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl()}${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new CopilotApiError("Flow Memory를 불러오지 못했어요.", response.status);
  return response;
}

export async function listCopilotConversations(signal?: AbortSignal) { return (await memoryFetch("/api/copilot/conversations?skip=0&limit=100", { signal })).json() as Promise<CopilotConversationSummary[]>; }
export async function countCopilotConversations(signal?: AbortSignal) { return (await memoryFetch("/api/copilot/conversations/count", { signal })).json() as Promise<{ count: number }>; }
export async function getCopilotConversation(id: string, signal?: AbortSignal) { return (await memoryFetch(`/api/copilot/conversations/${id}`, { signal })).json() as Promise<CopilotConversationDetail>; }
export async function renameCopilotConversation(id: string, title: string) { return (await memoryFetch(`/api/copilot/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) })).json() as Promise<CopilotConversationSummary>; }
export async function deleteCopilotConversation(id: string) { await memoryFetch(`/api/copilot/conversations/${id}`, { method: "DELETE" }); }
export async function deleteAllCopilotConversations() { await memoryFetch("/api/copilot/conversations", { method: "DELETE" }); }

export async function getCopilotBriefing(signal?: AbortSignal) {
  const response = await fetch(`${baseUrl()}/api/copilot/briefing`, { credentials: "include", signal });
  if (!response.ok) throw new CopilotApiError("개인 브리핑을 불러오지 못했어요.", response.status);
  return response.json() as Promise<CopilotResponse>;
}
