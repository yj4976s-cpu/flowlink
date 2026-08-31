import type { ApiGameDifficulty } from "@/components/daru-game/game.types";

export const DARU_ACTIVE_RUN_STORAGE_KEY = "flowlink:daru-game:active-run";

export type StoredDaruActiveRun = {
  runId: string;
  difficulty: ApiGameDifficulty;
  previewCards?: Array<{
    position: number;
    cardId: string;
  }>;
};

export function loadDaruActiveRun(): StoredDaruActiveRun | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(DARU_ACTIVE_RUN_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDaruActiveRun>;
    if (typeof parsed.runId !== "string" || !parsed.runId) return null;
    if (!parsed.difficulty || !["EASY", "NORMAL", "HARD"].includes(parsed.difficulty)) return null;
    const previewCards = Array.isArray(parsed.previewCards) && parsed.previewCards.every((card) =>
      card && Number.isInteger(card.position) && card.position >= 0 && typeof card.cardId === "string" && card.cardId,
    ) ? parsed.previewCards : undefined;
    return { runId: parsed.runId, difficulty: parsed.difficulty, ...(previewCards ? { previewCards } : {}) } as StoredDaruActiveRun;
  } catch {
    return null;
  }
}

export function storeDaruActiveRun(run: StoredDaruActiveRun) {
  window.sessionStorage.setItem(DARU_ACTIVE_RUN_STORAGE_KEY, JSON.stringify(run));
}

export function clearDaruActiveRun() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(DARU_ACTIVE_RUN_STORAGE_KEY);
}
