import type { ApiGameDifficulty, LeaderboardEntry } from "@/components/daru-game/game.types";
function apiBase() { return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, ""); }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new Error(`Daru game API failed (${response.status})`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export interface GameRecord { difficulty: ApiGameDifficulty; best_detection_power: number; score_version: number; best_attempts: number | null; best_elapsed_seconds: number | null; best_combo: number; best_hints_used: number | null; total_daru_points: number; play_count: number; best_achieved_at: string | null; rank: "S" | "A" | "B" | "C"; }
export interface ServerGameMetrics { memory_accuracy: number; speed_score: number; combo_score: number; hint_score: number; detection_power: number; attempts: number; matched_pairs: number; max_combo: number; hints_used: number; elapsed_seconds: number; earned_daru_points: number; within_time_limit: boolean; completed: boolean; }
export interface ServerFlipResponse { card: { position: number; card_id: string }; matched: boolean | null; matched_positions: number[]; attempts: number; matched_pairs: number; current_combo: number; max_combo: number; earned_daru_points: number; points_awarded: number; }
export function createDaruGameRun(difficulty: ApiGameDifficulty) { return request<{ run_id: string; difficulty: ApiGameDifficulty; started_at: string; positions: number[] }>("/api/daru-game/runs", { method: "POST", body: JSON.stringify({ difficulty }) }); }
export function startDaruGameRun(runId: string) { return request<void>(`/api/daru-game/runs/${runId}/start`, { method: "POST" }); }
export function flipDaruGameCard(runId: string, position: number) { return request<ServerFlipResponse>(`/api/daru-game/runs/${runId}/flip`, { method: "POST", body: JSON.stringify({ position }) }); }
export function requestDaruGameHint(runId: string) { return request<{ hints_used: number; hints_remaining: number; cards: { position: number; card_id: string }[] }>(`/api/daru-game/runs/${runId}/hint`, { method: "POST" }); }
export function getDaruGameRecords(signal?: AbortSignal) { return request<GameRecord[]>("/api/daru-game/me", { signal }); }
export function submitDaruGameResult(payload: { run_id: string; finish_partial?: boolean }) { return request<{ record: GameRecord; is_new_best: boolean; leaderboard_rank: number | null; metrics: ServerGameMetrics }>("/api/daru-game/results", { method: "POST", body: JSON.stringify(payload) }); }
export function getDaruLeaderboard(difficulty: ApiGameDifficulty, signal?: AbortSignal) { return request<{ difficulty: ApiGameDifficulty; entries: LeaderboardEntry[]; my_entry: LeaderboardEntry | null }>(`/api/daru-game/leaderboard?difficulty=${difficulty}`, { signal }); }
