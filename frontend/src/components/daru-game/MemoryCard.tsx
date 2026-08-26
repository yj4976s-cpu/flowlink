import Image from "next/image";
import type { CSSProperties } from "react";
import { DARU_CARD_BACK_ASSETS } from "./game.config";
import type { GameCard } from "./game.types";
import { resolveDaruCardImage } from "./game.utils";
import styles from "./DaruGame.module.css";

export function MemoryCard({ card, theme, flipped, matched, locked, flipDelayMs = 0, onFlip }: { card: GameCard; theme: "dawn" | "day" | "night"; flipped: boolean; matched: boolean; locked: boolean; flipDelayMs?: number; onFlip: () => void }) {
  const revealed = flipped || matched;
  const accessibleLabel = matched ? `${card.label}, 찾은 카드` : revealed ? card.label : "뒤집지 않은 카드";
  return (
    <button
      className={styles.card}
      type="button"
      aria-label={accessibleLabel}
      aria-pressed={revealed}
      disabled={locked || revealed}
      data-flipped={revealed || undefined}
      data-matched={matched || undefined}
      style={{ "--flip-delay": `${flipDelayMs}ms` } as CSSProperties}
      onClick={onFlip}
    >
      <span className={styles.cardInner}>
        <span className={`${styles.cardFace} ${styles.cardBack}`} aria-hidden="true">
          <span className={styles.cardBackArtwork}><Image key={theme} src={DARU_CARD_BACK_ASSETS[theme]} alt="" fill sizes="(max-width: 720px) 13vw, 120px" draggable={false} unoptimized /></span>
        </span>
        <span className={`${styles.cardFace} ${styles.cardFront}`} aria-hidden={!revealed}>
          <span className={styles.cardVisual}>
            <Image src={resolveDaruCardImage(card, theme)} alt="" fill sizes="(max-width: 600px) 20vw, 120px" />
          </span>
        </span>
      </span>
    </button>
  );
}
