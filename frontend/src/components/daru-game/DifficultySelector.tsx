import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { CARD_CATALOG, getCardThemeImages } from "./card.catalog";
import { DARU_CARD_BACK_ASSETS, DIFFICULTY_CONFIG } from "./game.config";
import type { GameDifficulty } from "./game.types";
import styles from "./DaruGame.module.css";

const PREVIEW_ITEMS = CARD_CATALOG.filter((card) => ["umbrella", "shoe", "backpack"].includes(card.id));
const DIFFICULTY_LEVELS: Record<GameDifficulty, string> = { easy: "●", normal: "●●", hard: "●●●" };

function PawMark() {
  return (
    <svg className={styles.pawMark} viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="15.2" rx="5.2" ry="4.4" transform="rotate(-4 12 15.2)" />
      <ellipse cx="6.6" cy="10" rx="2.2" ry="2.7" transform="rotate(-24 6.6 10)" />
      <ellipse cx="10.2" cy="6.9" rx="2.1" ry="2.7" transform="rotate(-8 10.2 6.9)" />
      <ellipse cx="14.5" cy="6.9" rx="2.1" ry="2.7" transform="rotate(9 14.5 6.9)" />
      <ellipse cx="18" cy="10.1" rx="2.2" ry="2.7" transform="rotate(24 18 10.1)" />
    </svg>
  );
}

export function DifficultySelector({ onSelect }: { onSelect: (difficulty: GameDifficulty) => void }) {
  const { theme } = useTheme();
  const previewTimerRef = useRef<number | null>(null);
  const [selected, setSelected] = useState<GameDifficulty>("easy");
  const [previewCard, setPreviewCard] = useState<string | null>(null);
  const selectedConfig = DIFFICULTY_CONFIG[selected];
  const revealPreview = (key: string) => {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
    setPreviewCard(key);
    previewTimerRef.current = window.setTimeout(() => { setPreviewCard(null); previewTimerRef.current = null; }, 1600);
  };
  useEffect(() => () => { if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current); }, []);

  return (
    <section className={styles.selector} aria-labelledby="daru-game-title">
      <div className={styles.ambient} aria-hidden="true"><i /><i /><i /><i /></div>
      <header className={styles.lobbyHeader}><div className={styles.introBadge}>DARU MEMORY</div><h1 id="daru-game-title">다루와 숨은 짝을 찾아봐요</h1><p>카드의 위치를 기억해 같은 그림을 맞춰보세요.</p></header>
      <div className={styles.previewBoard} aria-label="카드 뒤집기 게임 미리보기">
        {(["umbrella", "shoe"] as const).map((cardId, index) => {
          const card = CARD_CATALOG.find((entry) => entry.id === cardId)!;
          return <button key={cardId} className={`${styles.previewCard} ${styles.previewBack} ${index ? styles.previewTwo : styles.previewOne}`} type="button" aria-label={`${card.label} 미리보기 카드 뒤집기`} aria-pressed={previewCard === cardId} data-revealed={previewCard === cardId || undefined} onClick={() => revealPreview(cardId)}><span className={styles.previewCardInner}><span className={styles.previewCardBack}><span className={styles.cardBackArtwork}><Image key={theme} src={DARU_CARD_BACK_ASSETS[theme]} alt="" fill sizes="74px" draggable={false} unoptimized /></span></span><span className={styles.previewCardFront}><Image src={getCardThemeImages(card)[theme]} alt="" fill sizes="74px" /></span></span></button>;
        })}
        <div className={styles.previewDaru} aria-hidden="true"><Image className={styles.daruDawn} src="/mascot/daru-idle-dawn.png" alt="" fill sizes="180px" priority /><Image className={styles.daruDay} src="/mascot/daru-idle-day.png" alt="" fill sizes="180px" priority /><Image className={styles.daruNight} src="/mascot/daru-idle-night.png" alt="" fill sizes="180px" priority /></div>
        <p className={styles.previewBubble}>준비됐어? 같이 시작해볼까?</p>
        {PREVIEW_ITEMS.map((card, index) => <div className={`${styles.previewCard} ${styles.previewFace} ${styles[`previewItem${index + 1}`]}`} key={card.id} aria-hidden="true"><Image src={getCardThemeImages(card)[theme]} alt="" fill sizes="74px" /></div>)}
        <ol className={styles.lobbyFlow} aria-label="게임 진행 방법">
          <li><b>1</b><span>카드 공개</span></li><li aria-hidden="true">→</li>
          <li><b>2</b><span>짝 맞추기</span></li><li aria-hidden="true">→</li>
          <li><b>3</b><span>메모리 점수</span></li>
        </ol>
      </div>
      <div className={styles.compactDifficulty} aria-label="난이도 선택">
        {(Object.entries(DIFFICULTY_CONFIG) as [GameDifficulty, (typeof DIFFICULTY_CONFIG)[GameDifficulty]][]).map(([key, config]) => (
          <button key={key} className={styles.difficultyOption} type="button" aria-pressed={selected === key} onClick={() => setSelected(key)}>
            <span className={styles.difficultyHeading}><small>{config.key === "NORMAL" ? "MEDIUM" : config.key}</small><strong>{config.label}</strong></span>
            <span className={styles.difficultyPair}><b>{config.pairCount}</b><em>쌍</em></span>
            <span className={styles.difficultyMeta}>총 {config.cardCount}장 · 목표 {config.speedBenchmarkSeconds}초</span>
            <span className={styles.difficultyFooter}><small>{config.description}</small><i aria-label={`난이도 ${key === "easy" ? 1 : key === "normal" ? 2 : 3}단계`}>{DIFFICULTY_LEVELS[key]}</i></span>
            {selected === key && <PawMark />}
          </button>
        ))}
      </div>
      <button className={`button button-primary ${styles.startButton}`} type="button" onClick={() => onSelect(selectedConfig.key.toLowerCase() as GameDifficulty)}>
        <strong>{selectedConfig.label}으로 시작</strong>
        <span>{selectedConfig.pairCount}쌍 · 목표 시간 {selectedConfig.speedBenchmarkSeconds}초</span>
      </button>
    </section>
  );
}
