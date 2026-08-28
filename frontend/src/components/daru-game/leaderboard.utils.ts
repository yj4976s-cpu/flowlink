export function isLeaderboardDifficulty(responseDifficulty: string | undefined, selectedDifficulty: string) {
  return responseDifficulty === selectedDifficulty;
}

export function getBulkSelectedCount(deletableCount: number, excludedCount: number) {
  return Math.max(0, deletableCount - excludedCount);
}

export function bulkDeleteIncludesBest(target: "selected" | "difficulty" | "all", selectAllDifficulty: boolean, hasDeletableBest: boolean, hasDeletableBestAnyDifficulty: boolean, selectedItemsHaveBest: boolean) {
  if (target === "all") return hasDeletableBestAnyDifficulty;
  if (target === "difficulty" || selectAllDifficulty) return hasDeletableBest;
  return selectedItemsHaveBest;
}

export function getLeaderboardPageRequest(displayedPage: number, requestedPage: number, direction: -1 | 1, totalPages: number) {
  const page = Math.min(totalPages, Math.max(1, displayedPage + direction));
  return { page, retry: page === requestedPage };
}

export function isLeaderboardScoreTie(rank: number, gap: number | null) {
  return rank > 1 && gap === 0;
}
