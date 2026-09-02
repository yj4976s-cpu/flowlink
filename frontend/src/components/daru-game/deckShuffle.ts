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

export function hasAdjacentPairForColumns(cards: readonly PairCard[], supportedColumns: readonly number[]) {
  return supportedColumns.some((columns) => hasAdjacentPair(cards, columns));
}

function positionsAreAdjacent(first: number, second: number, columns: number) {
  const firstRow = Math.floor(first / columns);
  const firstColumn = first % columns;
  const secondRow = Math.floor(second / columns);
  const secondColumn = second % columns;
  return Math.abs(firstRow - secondRow) <= 1 && Math.abs(firstColumn - secondColumn) <= 1;
}

function randomizedPositionPairs(cardCount: number, supportedColumns: readonly number[], random: () => number): [number, number][] {
  const pairPositions = (available: number[]): [number, number][] | null => {
    if (available.length === 0) return [];
    const candidates = shuffleCards(available, random);
    const first = candidates.reduce((best, position) => {
      const partnerCount = available.filter((other) => other !== position && supportedColumns.every((columns) => !positionsAreAdjacent(position, other, columns))).length;
      const bestPartnerCount = available.filter((other) => other !== best && supportedColumns.every((columns) => !positionsAreAdjacent(best, other, columns))).length;
      return partnerCount < bestPartnerCount ? position : best;
    });
    const remaining = available.filter((position) => position !== first);
    for (const second of shuffleCards(remaining.filter((position) => supportedColumns.every((columns) => !positionsAreAdjacent(first, position, columns))), random)) {
      const rest = pairPositions(remaining.filter((position) => position !== second));
      if (rest) return [[first, second], ...rest];
    }
    return null;
  };
  const result = pairPositions(Array.from({ length: cardCount }, (_item, index) => index));
  if (!result) throw new Error("Unable to construct a non-adjacent card layout");
  return result;
}

export function constrainedShuffleCards<T extends PairCard>(cards: readonly T[], supportedColumns: readonly number[], random = Math.random, maxAttempts = DECK_SHUFFLE_MAX_ATTEMPTS) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = shuffleCards(cards, random);
    if (!hasAdjacentPairForColumns(candidate, supportedColumns)) return candidate;
  }

  const grouped = new Map<string, T[]>();
  for (const card of cards) grouped.set(card.pairId, [...(grouped.get(card.pairId) ?? []), card]);
  const pairOrder = shuffleCards([...grouped.keys()], random);
  const positions = randomizedPositionPairs(cards.length, supportedColumns, random);
  const result = Array<T>(cards.length);
  pairOrder.forEach((pairId, index) => {
    const pair = shuffleCards(grouped.get(pairId)!, random);
    const [first, second] = positions[index];
    result[first] = pair[0];
    result[second] = pair[1];
  });
  return result;
}
