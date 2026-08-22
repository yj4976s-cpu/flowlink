import type { DaruCardAsset, DaruThemeAssets, DifficultyConfig, GameDifficulty } from "./game.types";

export const DIFFICULTY_CONFIG: Record<GameDifficulty, DifficultyConfig> = {
  easy: { key: "EASY", label: "쉬움", description: "워밍업", cardCount: 20, pairCount: 10, daruCount: 5, itemCount: 5, timeLimitSeconds: 120, speedBenchmarkSeconds: 90, hintCount: 2, hintRevealSeconds: 4, comboTarget: 5, clearBonus: 300, previewSeconds: 5 },
  normal: { key: "NORMAL", label: "보통", description: "집중 모드", cardCount: 32, pairCount: 16, daruCount: 8, itemCount: 8, timeLimitSeconds: 210, speedBenchmarkSeconds: 150, hintCount: 2, hintRevealSeconds: 6, comboTarget: 7, clearBonus: 500, previewSeconds: 7 },
  hard: { key: "HARD", label: "어려움", description: "풀 챌린지", cardCount: 48, pairCount: 24, daruCount: 1, itemCount: 23, timeLimitSeconds: 330, speedBenchmarkSeconds: 240, hintCount: 2, hintRevealSeconds: 8, comboTarget: 9, clearBonus: 700, previewSeconds: 9 },
};
export const POINT_CONFIG = { pairPoint: 100, comboBonusStep: 25, maxComboBonus: 100 } as const;
export const DETECTION_POWER_WEIGHTS = { memory: 0.6, speed: 0.25, combo: 0.15 } as const;
export const RANK_THRESHOLDS = { S: 80, A: 65, B: 50, C: 0 } as const;
export const BEST_RECORD_STORAGE_KEYS: Record<GameDifficulty, string> = { easy: "flowlink:daru-game:best-detection:easy", normal: "flowlink:daru-game:best-detection:normal", hard: "flowlink:daru-game:best-detection:hard" };
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
export const DARU_CARD_ASSETS: readonly DaruCardAsset[] = [
  { key: "wave", label: "인사하는 다루", images: { ...THEMED_IDLE, day: "/mascot/daru-wave-day.png" } },
  { key: "excited", label: "신난 다루", images: THEMED_IDLE }, { key: "heart", label: "마음을 전하는 다루", images: THEMED_IDLE },
  { key: "thumbs-up", label: "응원하는 다루", images: THEMED_IDLE }, { key: "sleep", label: "쉬고 있는 다루", images: THEMED_IDLE },
  { key: "angry", label: "화난 다루", images: THEMED_IDLE }, { key: "water-play", label: "물놀이하는 다루", images: THEMED_IDLE },
  { key: "magnifier", label: "찾아보는 다루", images: THEMED_IDLE },
] as const;
export const DARU_CLEAR_ASSETS = THEMED_IDLE;
export const DETECTED_ITEMS = [
  { key: "plastic", label: "플라스틱", icon: "cube" }, { key: "vinyl", label: "비닐", icon: "bag" },
  { key: "can", label: "캔", icon: "archive" }, { key: "styrofoam", label: "스티로폼", icon: "packageCheck" },
  { key: "ball", label: "공", icon: "ball" }, { key: "backpack", label: "백팩", icon: "backpack" },
  { key: "umbrella", label: "우산", icon: "umbrella" }, { key: "footwear", label: "운동화", icon: "footwear" },
  { key: "slipper", label: "슬리퍼", icon: "slipper" }, { key: "document", label: "서류", icon: "document" },
  { key: "camera", label: "카메라", icon: "camera" }, { key: "key", label: "열쇠 꾸러미", icon: "match" },
  { key: "watch", label: "손목시계", icon: "clock" }, { key: "phone", label: "휴대전화", icon: "scanLine" },
  { key: "wallet", label: "지갑", icon: "category" }, { key: "glasses", label: "안경", icon: "eye" },
  { key: "bottle", label: "물병", icon: "location" }, { key: "tag", label: "이름표", icon: "userSearch" },
  { key: "notebook", label: "수첩", icon: "fileSearch" }, { key: "ring", label: "반지", icon: "search" },
  { key: "case", label: "케이스", icon: "layers" }, { key: "alarm", label: "알람", icon: "bell" },
  { key: "charm", label: "키링", icon: "spark" },
] as const;
export const EASY_ITEM_KEYS = ["umbrella", "footwear", "backpack", "can", "vinyl"] as const;
