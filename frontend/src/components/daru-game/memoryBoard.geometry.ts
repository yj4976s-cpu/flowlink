import type { GameDifficulty } from "./game.types";

export const BOARD_SAFETY_PX = 12;
const BOARD_STAGE_PADDING_PX = 8;

const TARGETS = {
  easy: { columns: 5, cardWidth: 120, gap: 12 },
  normal: { columns: 8, cardWidth: 108, gap: 10 },
  hard: { columns: 10, cardWidth: 104, gap: 8 },
} as const;

export const BOARD_COLUMNS: Record<GameDifficulty, number> = {
  easy: TARGETS.easy.columns,
  normal: TARGETS.normal.columns,
  hard: TARGETS.hard.columns,
};

export interface MemoryBoardGeometry {
  cardWidth: number;
  columns: number;
  rows: number;
  gap: number;
  reflow: boolean;
  boardWidth: number;
  boardHeight: number;
}

export function calculateMemoryBoardGeometry({ difficulty, cardCount, availableWidth, availableHeight, viewportWidth, viewportHeight }: { difficulty: GameDifficulty; cardCount: number; availableWidth: number; availableHeight: number; viewportWidth: number; viewportHeight: number }): MemoryBoardGeometry {
  const target = TARGETS[difficulty];
  const reflow = viewportWidth <= 900 || (viewportHeight <= 520 && viewportWidth <= 960);
  const readableWidth = viewportWidth <= 480 ? 76 : 82;
  const usableWidth = Math.max(1, availableWidth - BOARD_STAGE_PADDING_PX - BOARD_SAFETY_PX);
  const usableHeight = Math.max(1, availableHeight - BOARD_STAGE_PADDING_PX - BOARD_SAFETY_PX);
  const responsiveColumns = Math.max(4, Math.floor((usableWidth + target.gap) / (readableWidth + target.gap)));
  const columns = reflow ? Math.min(target.columns, responsiveColumns) : target.columns;
  const rows = Math.max(1, Math.ceil(cardCount / columns));
  const compactGap = availableHeight < 560 ? Math.max(4, target.gap - 4) : target.gap;
  const gap = reflow ? Math.max(6, compactGap) : compactGap;
  const widthFit = (usableWidth - gap * (columns - 1)) / columns;
  const heightFit = ((usableHeight - gap * (rows - 1)) / rows) * 4 / 5;
  const cardWidth = Math.max(1, Math.floor(Math.min(target.cardWidth, widthFit, heightFit) * 10) / 10);
  return {
    cardWidth,
    columns,
    rows,
    gap,
    reflow,
    boardWidth: columns * cardWidth + gap * (columns - 1),
    boardHeight: rows * cardWidth * 5 / 4 + gap * (rows - 1),
  };
}

export function memoryBoardGeometryEqual(left: MemoryBoardGeometry | null, right: MemoryBoardGeometry) {
  return left !== null && left.cardWidth === right.cardWidth && left.columns === right.columns && left.gap === right.gap && left.reflow === right.reflow;
}
