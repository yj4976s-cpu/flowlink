import type { ApiGameDifficulty, LeaderboardEntry } from "@/components/daru-game/game.types";
function apiBase() { return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, ""); }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new Error(`Daru game API failed (${response.status})`);
  return response.json() as Promise<T>;
}
export interface GameRecord { difficulty: ApiGameDifficulty; best_detection_power: number; best_attempts: number | null; best_elapsed_seconds: number | null; best_combo: number; best_hints_used: number | null; total_daru_points: number; play_count: number; best_achieved_at: string | null; rank: "S" | "A" | "B" | "C"; }
export function submitDaruGameResult(payload: { difficulty: ApiGameDifficulty; completed: boolean; within_time_limit: boolean; matched_pairs: number; attempts: number; elapsed_seconds: number; max_combo: number; hints_used: number; earned_daru_points: number }) { return request<{ record: GameRecord; is_new_best: boolean; leaderboard_rank: number | null }>("/api/daru-game/results", { method: "POST", body: JSON.stringify(payload) }); }
export function getDaruLeaderboard(difficulty: ApiGameDifficulty) { return request<{ difficulty: ApiGameDifficulty; entries: LeaderboardEntry[]; my_entry: LeaderboardEntry | null }>(`/api/daru-game/leaderboard?difficulty=${difficulty}`); }
