import type { DaruThemeAssets, DifficultyConfig, GameDifficulty } from "./game.types";

export const DIFFICULTY_CONFIG: Record<GameDifficulty, DifficultyConfig> = {
  easy: { key: "EASY", label: "쉬움", description: "워밍업", cardCount: 20, pairCount: 10, daruCount: 5, itemCount: 5, timeLimitSeconds: 120, speedBenchmarkSeconds: 90, hintCount: 2, hintRevealSeconds: 4, comboTarget: 5, clearBonus: 300, previewSeconds: 5 },
  normal: { key: "NORMAL", label: "보통", description: "집중 모드", cardCount: 32, pairCount: 16, daruCount: 9, itemCount: 7, timeLimitSeconds: 210, speedBenchmarkSeconds: 150, hintCount: 2, hintRevealSeconds: 6, comboTarget: 7, clearBonus: 500, previewSeconds: 7 },
  hard: { key: "HARD", label: "어려움", description: "풀 챌린지", cardCount: 48, pairCount: 24, daruCount: 16, itemCount: 8, timeLimitSeconds: 330, speedBenchmarkSeconds: 240, hintCount: 2, hintRevealSeconds: 8, comboTarget: 9, clearBonus: 700, previewSeconds: 9 },
};
export const POINT_CONFIG = { pairPoint: 100, comboBonusStep: 25, maxComboBonus: 100 } as const;
export const DETECTION_POWER_WEIGHTS = { memory: 0.5, speed: 0.25, combo: 0.15, hint: 0.1 } as const;
export const RANK_THRESHOLDS = { S: 80, A: 65, B: 50, C: 0 } as const;
export const BEST_RECORD_STORAGE_KEYS: Record<GameDifficulty, string> = { easy: "flowlink:daru-game:v2:best-detection:easy", normal: "flowlink:daru-game:v2:best-detection:normal", hard: "flowlink:daru-game:v2:best-detection:hard" };
export const MISMATCH_REVEAL_MS = 850;

const THEMED_IDLE = { dawn: "/mascot/daru-idle-dawn.png", day: "/mascot/daru-idle-day.png", night: "/mascot/daru-idle-night.png" } as const;
export const DARU_MEMORY_GUIDE_ASSETS: DaruThemeAssets = {
  dawn: "/mascot/daru-memory-guide-dawn.png",
  day: "/mascot/daru-memory-guide-day.png",
  night: "/mascot/daru-memory-guide-night.png",
};
export const DARU_TIME_OVER_ASSETS: DaruThemeAssets = {
  dawn: "/mascot/daru-timeover-dawn.png",
  day: "/mascot/daru-timeover-day.png",
  night: "/mascot/daru-timeover-night.png",
};
export const DARU_CARD_BACK_ASSETS: DaruThemeAssets = {
  dawn: "/daru-game/daru-card-back-dawn.png",
  day: "/daru-game/daru-card-back-day.png",
  night: "/daru-game/daru-card-back-night.png",
};
export const DARU_CLEAR_ASSETS = THEMED_IDLE;
