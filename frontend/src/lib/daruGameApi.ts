import { buildApiUrl } from "@/lib/apiBase";
import type { ApiGameDifficulty, LeaderboardEntry } from "@/components/daru-game/game.types";
import { invalidateAuthOnUnauthorized } from "@/lib/authEvents";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    invalidateAuthOnUnauthorized(response.status);
    const payload = await response.json().catch(() => null) as { detail?: string | { code?: string; message?: string } } | null;
    const detail = payload?.detail;
    throw new DaruGameApiError(response.status, typeof detail === "object" ? detail.code : undefined, typeof detail === "string" ? detail : detail?.message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export class DaruGameApiError extends Error {
  constructor(public status: number, public code?: string, message?: string) { super(message ?? `Daru game API failed (${status})`); }
}
function retryable(error: unknown) { return !(error instanceof DaruGameApiError) || [502, 503, 504].includes(error.status); }
async function actionRequest<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const actionId = crypto.randomUUID();
  const execute = () => request<T>(path, { method: "POST", body: JSON.stringify({ ...payload, action_id: actionId }) });
  try { return await execute(); } catch (error) { if (!retryable(error)) throw error; return execute(); }
}
export interface GameRecord { difficulty: ApiGameDifficulty; best_detection_power: number; score_version: number; best_attempts: number | null; best_elapsed_seconds: number | null; best_combo: number; best_hints_used: number | null; total_daru_points: number; play_count: number; best_achieved_at: string | null; rank: "S" | "A" | "B" | "C"; }
export interface ServerGameMetrics { memory_accuracy: number; speed_score: number; combo_score: number; hint_score: number; detection_power: number; attempts: number; matched_pairs: number; max_combo: number; hints_used: number; elapsed_seconds: number; earned_daru_points: number; within_time_limit: boolean; completed: boolean; }
export interface ServerFlipResponse { card: { position: number; card_id: string }; matched: boolean | null; matched_positions: number[]; attempts: number; matched_pairs: number; current_combo: number; max_combo: number; earned_daru_points: number; points_awarded: number; }
export interface ServerGameResult { record: GameRecord; is_new_best: boolean; leaderboard_rank: number | null; metrics: ServerGameMetrics; }
export interface ServerRunState { run_id: string; difficulty: ApiGameDifficulty; status: "CREATED" | "PLAYING" | "COMPLETED"; positions: number[]; play_started_at: string | null; server_now: string; attempts: number; matched_pairs: number; current_combo: number; max_combo: number; hints_used: number; earned_daru_points: number; matched_positions: number[]; first_position: number | null; visible_cards: { position: number; card_id: string }[]; completion_result: ServerGameResult | null; }
export interface ServerRunPreview { cards: { position: number; card_id: string }[]; }
export function createDaruGameRun(difficulty: ApiGameDifficulty) { return request<{ run_id: string; difficulty: ApiGameDifficulty; started_at: string; positions: number[] }>("/api/daru-game/runs", { method: "POST", body: JSON.stringify({ difficulty }) }); }
export function getDaruGameRunPreview(runId: string) { return request<ServerRunPreview>(`/api/daru-game/runs/${runId}/preview`); }
export function startDaruGameRun(runId: string) { return actionRequest<{ play_started_at: string }>(`/api/daru-game/runs/${runId}/start`, {}); }
export function flipDaruGameCard(runId: string, position: number) { return actionRequest<ServerFlipResponse>(`/api/daru-game/runs/${runId}/flip`, { position }); }
export function requestDaruGameHint(runId: string) { return actionRequest<{ hints_used: number; hints_remaining: number; cards: { position: number; card_id: string }[] }>(`/api/daru-game/runs/${runId}/hint`, {}); }
export function getDaruGameRunState(runId: string) { return request<ServerRunState>(`/api/daru-game/runs/${runId}/state`); }
export function getDaruGameRecords(signal?: AbortSignal) { return request<GameRecord[]>("/api/daru-game/me", { signal }); }
export function submitDaruGameResult(payload: { run_id: string; finish_partial?: boolean }) { return actionRequest<ServerGameResult>("/api/daru-game/results", payload); }
export interface DaruLeaderboardResponse { difficulty: ApiGameDifficulty; top_entries: LeaderboardEntry[]; entries: LeaderboardEntry[]; my_entry: LeaderboardEntry | null; next_rank_score: number | null; total: number; page: number; page_size: number; total_pages: number; }
export function getDaruLeaderboard(difficulty: ApiGameDifficulty, page: number, signal?: AbortSignal) { return request<DaruLeaderboardResponse>(`/api/daru-game/leaderboard?difficulty=${difficulty}&page=${page}&page_size=5`, { signal }); }
