import type { IconName } from "@/components/common/Icon";

export type GameDifficulty = "easy" | "normal" | "hard";
export type ApiGameDifficulty = "EASY" | "NORMAL" | "HARD";
export type CardKind = "daru" | "detected-item";
export type GamePhase = "lobby" | "preview" | "flipping" | "ready" | "playing" | "time-over" | "finished" | "partial";
export type DaruGameTheme = "dawn" | "day" | "night";

export type DaruThemeAssets = Record<DaruGameTheme, string>;

export interface DaruCardAsset {
  key: string;
  label: string;
  images: DaruThemeAssets;
}

export interface GameCard {
  id: string;
  pairId: string;
  kind: CardKind;
  image: string;
  label: string;
  icon?: IconName;
  themeImages?: DaruThemeAssets;
}

export interface GameResultData {
  difficulty: ApiGameDifficulty;
  daruPoints: number;
  detectionPower: number;
  clearTimeMs: number;
  attempts: number;
}

export interface DetectionMetrics {
  memoryEfficiency: number;
  speedScore: number;
  comboScore: number;
  detectionPower: number;
}

export type GameRank = "S" | "A" | "B" | "C";

export interface DifficultyConfig {
  key: ApiGameDifficulty;
  label: string;
  description: string;
  pairCount: number;
  daruCount: number;
  itemCount: number;
  cardCount: number;
  timeLimitSeconds: number;
  speedBenchmarkSeconds: number;
  hintCount: number;
  hintRevealSeconds: number;
  comboTarget: number;
  clearBonus: number;
  previewSeconds: number;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  best_detection_power: number;
  best_attempts: number;
  best_elapsed_seconds: number;
  best_combo: number;
  best_hints_used: number;
  achieved_at: string;
  is_me: boolean;
}
