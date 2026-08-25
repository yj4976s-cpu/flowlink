"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { DARU_CARD_BACK_ASSETS } from "./game.config";
import type { GameCard, GameDifficulty, GamePhase } from "./game.types";
import { MemoryCard } from "./MemoryCard";
import styles from "./DaruGame.module.css";

export function MemoryBoard({ cards, difficulty, theme, phase, flippedIds, matchedPairIds, locked, hintActive, onFlip }: { cards: GameCard[]; difficulty: GameDifficulty; theme: "dawn" | "day" | "night"; phase: GamePhase; flippedIds: string[]; matchedPairIds: string[]; locked: boolean; hintActive: boolean; onFlip: (card: GameCard) => void }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const matched = new Set(matchedPairIds);
  useEffect(() => { Object.values(DARU_CARD_BACK_ASSETS).forEach((src) => { const image = new window.Image(); image.src = src; }); }, []);
  useLayoutEffect(() => {
    const board = boardRef.current;
    const stage = board?.parentElement;
    if (!board || !stage) return;
    const targets = {
      easy: { columns: 5, cardWidth: 120, gap: 12 },
      normal: { columns: 8, cardWidth: 108, gap: 10 },
      hard: { columns: 12, cardWidth: 94, gap: 8 },
    } as const;
    const target = targets[difficulty];
    const fitBoard = () => {
      const availableWidth = stage.clientWidth;
      const availableHeight = stage.clientHeight;
      if (!availableWidth || !availableHeight) return;
      const reflow = window.innerWidth <= 900 || (window.innerHeight <= 520 && window.innerWidth <= 960);
      const readableWidth = window.innerWidth <= 480 ? 76 : 82;
      const responsiveColumns = Math.max(4, Math.floor((availableWidth + target.gap) / (readableWidth + target.gap)));
      const columns = reflow ? Math.min(target.columns, responsiveColumns) : target.columns;
      const rows = Math.ceil(cards.length / columns);
      const compactGap = availableHeight < 560 ? Math.max(4, target.gap - 4) : target.gap;
      const gap = reflow ? Math.max(6, compactGap) : compactGap;
      const widthFit = (availableWidth - 8 - gap * (columns - 1)) / columns;
      const heightFit = ((availableHeight - 8 - gap * (rows - 1)) / rows) * 4 / 5;
      const fittedWidth = Math.min(target.cardWidth, widthFit, reflow ? target.cardWidth : heightFit);
      const minimumWidth = reflow ? Math.min(readableWidth, widthFit) : Math.min(64, widthFit);
      const cardWidth = Math.max(minimumWidth, fittedWidth);
      board.style.setProperty("--daru-card-width", `${Math.floor(cardWidth * 10) / 10}px`);
      board.style.setProperty("--daru-board-columns", String(columns));
      board.style.setProperty("--daru-board-gap", `${gap}px`);
      board.toggleAttribute("data-reflow", reflow);
    };
    const observer = new ResizeObserver(fitBoard);
    observer.observe(stage);
    fitBoard();
    return () => observer.disconnect();
  }, [cards.length, difficulty]);
  return (
    <div ref={boardRef} className={styles.board} data-difficulty={difficulty} aria-label="다루 카드 게임판" aria-busy={locked}>
      {cards.map((card, index) => (
        <MemoryCard
          key={card.id}
          card={card}
          theme={theme}
          flipped={phase === "preview" || hintActive || flippedIds.includes(card.id)}
          flipDelayMs={phase === "flipping" ? Math.abs(index - (cards.length - 1) / 2) * 14 : 0}
          matched={matched.has(card.pairId)}
          locked={locked || hintActive || phase !== "playing"}
          onFlip={() => onFlip(card)}
        />
      ))}
    </div>
  );
}
