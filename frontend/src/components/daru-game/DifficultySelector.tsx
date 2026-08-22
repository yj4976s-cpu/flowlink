import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Icon } from "@/components/common/Icon";
import { DARU_CARD_BACK_ASSETS, DETECTED_ITEMS, DIFFICULTY_CONFIG } from "./game.config";
import type { GameDifficulty } from "./game.types";
import styles from "./DaruGame.module.css";

const PREVIEW_ITEMS = DETECTED_ITEMS.filter((item) => ["umbrella", "footwear", "backpack"].includes(item.key));

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
      <header className={styles.lobbyHeader}><div className={styles.introBadge}>DARU MEMORY</div><h1 id="daru-game-title">다루와 숨은 짝을 찾아봐요</h1><p>뒤집힌 카드의 위치를 기억해 같은 그림을 맞춰보세요.</p></header>
      <div className={styles.previewBoard} aria-label="카드 뒤집기 게임 미리보기">
        {(["umbrella", "footwear"] as const).map((key, index) => {
          const item = DETECTED_ITEMS.find((entry) => entry.key === key)!;
          return <button key={key} className={`${styles.previewCard} ${styles.previewBack} ${index ? styles.previewTwo : styles.previewOne}`} type="button" aria-label={`${item.label} 미리보기 카드 뒤집기`} aria-pressed={previewCard === key} data-revealed={previewCard === key || undefined} onClick={() => revealPreview(key)}><span className={styles.previewCardInner}><span className={styles.previewCardBack}><span className={styles.cardBackArtwork}><Image key={theme} src={DARU_CARD_BACK_ASSETS[theme]} alt="" fill sizes="74px" draggable={false} unoptimized /></span></span><span className={styles.previewCardFront}><Icon name={item.icon} size={31} /><small>{item.label}</small></span></span></button>;
        })}
        <div className={styles.previewDaru} aria-hidden="true"><Image className={styles.daruDawn} src="/mascot/daru-idle-dawn.png" alt="" fill sizes="180px" priority /><Image className={styles.daruDay} src="/mascot/daru-idle-day.png" alt="" fill sizes="180px" priority /><Image className={styles.daruNight} src="/mascot/daru-idle-night.png" alt="" fill sizes="180px" priority /></div>
        <p className={styles.previewBubble}>준비됐어? 같이 시작해볼까?</p>
        {PREVIEW_ITEMS.map((item, index) => <div className={`${styles.previewCard} ${styles.previewFace} ${styles[`previewItem${index + 1}`]}`} key={item.key} aria-hidden="true"><Icon name={item.icon} size={30} /><small>{item.label}</small></div>)}
      </div>
      <div className={styles.compactDifficulty} aria-label="난이도 선택">
        {(Object.entries(DIFFICULTY_CONFIG) as [GameDifficulty, (typeof DIFFICULTY_CONFIG)[GameDifficulty]][]).map(([key, config]) => <button key={key} className={styles.difficultyOption} type="button" aria-pressed={selected === key} onClick={() => setSelected(key)}><span><strong>{config.label}</strong>{selected === key && <Icon name="check" size={17} />}</span><b>{config.pairCount * 2}장 · {config.pairCount}쌍</b><small>{config.description}</small><i aria-hidden="true">{"●".repeat(key === "easy" ? 1 : key === "normal" ? 2 : 3)}</i></button>)}
      </div>
      <button className={`button button-primary ${styles.startButton}`} type="button" onClick={() => onSelect(selectedConfig.key.toLowerCase() as GameDifficulty)}>{selectedConfig.label}으로 시작</button>
    </section>
  );
}
