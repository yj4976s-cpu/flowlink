import type { GameDifficulty } from "./game.types";

export const BEST_RECORD_STORAGE_KEYS: Record<GameDifficulty, string> = {
  easy: "flowlink:daru-game:v2:best-detection:easy",
  normal: "flowlink:daru-game:v2:best-detection:normal",
  hard: "flowlink:daru-game:v2:hard40:best-detection:hard",
};

export function resolveGuestBest(storedValue: string | null, detectionPower: number, eligible: boolean) {
  const storedBest = Number.parseFloat(storedValue ?? "-1");
  const previousBest = Number.isFinite(storedBest) && storedBest >= 0 ? storedBest : null;
  return { previousBest, isNewBest: eligible && (previousBest === null || detectionPower > previousBest) };
}
