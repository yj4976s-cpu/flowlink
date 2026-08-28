"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { DARU_CARD_BACK_ASSETS } from "./game.config";
import type { GameCard, GameDifficulty, GamePhase } from "./game.types";
import { MemoryCard } from "./MemoryCard";
import { calculateMemoryBoardGeometry, memoryBoardGeometryEqual, type MemoryBoardGeometry } from "./memoryBoard.geometry";
import styles from "./DaruGame.module.css";

export function MemoryBoard({ cards, difficulty, theme, phase, flippedIds, matchedPairIds, locked, hintActive, onFlip }: { cards: GameCard[]; difficulty: GameDifficulty; theme: "dawn" | "day" | "night"; phase: GamePhase; flippedIds: string[]; matchedPairIds: string[]; locked: boolean; hintActive: boolean; onFlip: (card: GameCard) => void }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const matched = new Set(matchedPairIds);
  useEffect(() => { Object.values(DARU_CARD_BACK_ASSETS).forEach((src) => { const image = new window.Image(); image.src = src; }); }, []);
  useLayoutEffect(() => {
    const board = boardRef.current;
    const stage = board?.parentElement;
    if (!board || !stage) return;
    let appliedGeometry: MemoryBoardGeometry | null = null;
    let animationFrame = 0;
    const fitBoard = () => {
      const availableWidth = stage.clientWidth;
      const availableHeight = stage.clientHeight;
      if (!availableWidth || !availableHeight) return;
      const next = calculateMemoryBoardGeometry({ difficulty, cardCount: cards.length, availableWidth, availableHeight, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
      if (memoryBoardGeometryEqual(appliedGeometry, next)) return;
      board.style.setProperty("--daru-card-width", `${next.cardWidth}px`);
      board.style.setProperty("--daru-board-columns", String(next.columns));
      board.style.setProperty("--daru-board-gap", `${next.gap}px`);
      board.toggleAttribute("data-reflow", next.reflow);
      appliedGeometry = next;
    };
    const scheduleFit = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => { animationFrame = 0; fitBoard(); });
    };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(stage);
    fitBoard();
    return () => { observer.disconnect(); if (animationFrame) window.cancelAnimationFrame(animationFrame); };
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
