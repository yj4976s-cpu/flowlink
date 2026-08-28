export const DECK_SHUFFLE_MAX_ATTEMPTS = 80;

interface PairCard {
  pairId: string;
}

export function shuffleCards<T>(cards: readonly T[], random = Math.random) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function hasAdjacentPair(cards: readonly PairCard[], columns: number) {
  const firstPositions = new Map<string, number>();
  for (let index = 0; index < cards.length; index += 1) {
    const pairId = cards[index].pairId;
    const firstIndex = firstPositions.get(pairId);
    if (firstIndex === undefined) {
      firstPositions.set(pairId, index);
      continue;
    }
    const firstRow = Math.floor(firstIndex / columns);
    const firstColumn = firstIndex % columns;
    const row = Math.floor(index / columns);
    const column = index % columns;
    if (Math.abs(firstRow - row) <= 1 && Math.abs(firstColumn - column) <= 1) return true;
  }
  return false;
}

export function constrainedShuffleCards<T extends PairCard>(cards: readonly T[], columns: number, random = Math.random, maxAttempts = DECK_SHUFFLE_MAX_ATTEMPTS) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = shuffleCards(cards, random);
    if (!hasAdjacentPair(candidate, columns)) return candidate;
  }

  const grouped = new Map<string, T[]>();
  for (const card of cards) grouped.set(card.pairId, [...(grouped.get(card.pairId) ?? []), card]);
  const pairOrder = shuffleCards([...grouped.keys()], random);
  return [
    ...pairOrder.map((pairId) => grouped.get(pairId)![0]),
    ...pairOrder.map((pairId) => grouped.get(pairId)![1]),
  ];
}
