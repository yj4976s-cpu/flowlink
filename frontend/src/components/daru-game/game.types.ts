export type GameDifficulty = "easy" | "normal" | "hard";
export type ApiGameDifficulty = "EASY" | "NORMAL" | "HARD";
export type CardKind = "daru" | "detected-item";
export type GamePhase = "lobby" | "preview" | "flipping" | "ready" | "playing" | "time-over" | "finished" | "partial";
export type DaruGameTheme = "dawn" | "day" | "night";
export type CardId =
  | "greeting" | "excited" | "heart" | "thumbs-up" | "sleeping" | "sulky" | "shy" | "search"
  | "coastal-cleanup" | "splash" | "branch-play" | "plastic-sort" | "umbrella-found" | "shoe-found"
  | "backpack-found" | "proud" | "umbrella" | "shoe" | "backpack" | "ball" | "can"
  | "plastic-bag" | "plastic-bottle" | "styrofoam";

export type DaruThemeAssets = Record<DaruGameTheme, string>;

export interface CardCatalogEntry {
  id: CardId;
  kind: CardKind;
  label: string;
  filename: string;
}

export interface GameCard {
  id: string;
  pairId: string;
  kind: CardKind;
  image: string;
  label: string;
  themeImages: DaruThemeAssets;
}

export interface GameResultData {
  difficulty: ApiGameDifficulty;
  daruPoints: number;
  detectionPower: number;
  clearTimeMs: number;
  attempts: number;
}

export interface DetectionMetrics {
  memoryAccuracy: number;
  speedScore: number;
  comboScore: number;
  hintScore: number;
  detectionPower: number;
}

export type GameRank = "S" | "A" | "B" | "C";

export interface DifficultyConfig {
  key: ApiGameDifficulty;
  label: string;
  description: string;
  pairCount: number;
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
  detection_power: number;
  attempts: number;
  elapsed_seconds: number;
  max_combo: number;
  hints_used: number;
  achieved_at: string;
  is_me: boolean;
}
