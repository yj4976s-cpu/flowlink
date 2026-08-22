"use client";

import { useEffect } from "react";
import { DARU_CARD_BACK_ASSETS } from "./game.config";
import type { GameCard, GameDifficulty, GamePhase } from "./game.types";
import { MemoryCard } from "./MemoryCard";
import styles from "./DaruGame.module.css";

export function MemoryBoard({ cards, difficulty, theme, phase, flippedIds, matchedPairIds, locked, hintActive, onFlip }: { cards: GameCard[]; difficulty: GameDifficulty; theme: "dawn" | "day" | "night"; phase: GamePhase; flippedIds: string[]; matchedPairIds: string[]; locked: boolean; hintActive: boolean; onFlip: (card: GameCard) => void }) {
  const matched = new Set(matchedPairIds);
  useEffect(() => { Object.values(DARU_CARD_BACK_ASSETS).forEach((src) => { const image = new window.Image(); image.src = src; }); }, []);
  return (
    <div className={styles.board} data-difficulty={difficulty} aria-label="다루 카드 게임판" aria-busy={locked}>
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
