import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { CARD_CATALOG, getCardThemeImages } from "./card.catalog";
import { DARU_CARD_BACK_ASSETS, DETECTION_POWER_WEIGHTS, DIFFICULTY_CONFIG, RANK_THRESHOLDS } from "./game.config";
import type { GameDifficulty } from "./game.types";
import styles from "./DaruGame.module.css";

const PREVIEW_ITEMS = CARD_CATALOG.filter((card) => ["umbrella", "shoe", "backpack"].includes(card.id));
const DIFFICULTY_LEVELS: Record<GameDifficulty, string> = { easy: "●", normal: "●●", hard: "●●●" };
const SCORE_PERCENTAGES = {
  memory: Math.round(DETECTION_POWER_WEIGHTS.memory * 100),
  speed: Math.round(DETECTION_POWER_WEIGHTS.speed * 100),
  combo: Math.round(DETECTION_POWER_WEIGHTS.combo * 100),
  hint: Math.round(DETECTION_POWER_WEIGHTS.hint * 100),
} as const;

function ScoreIcon({ type }: { type: "memory" | "speed" | "combo" | "hint" }) {
  const paths = {
    memory: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    speed: <><circle cx="12" cy="13" r="8" /><path d="M9 2h6M12 5v8l4 2" /></>,
    combo: <><path d="M9.5 14.5l-1.4 1.4a3.5 3.5 0 01-5-5l3-3a3.5 3.5 0 015 0M14.5 9.5l1.4-1.4a3.5 3.5 0 015 5l-3 3a3.5 3.5 0 01-5 0M8.5 15.5l7-7" /></>,
    hint: <><path d="M8.5 16.5h7M9.5 20h5M8 13.5a6 6 0 118 0c-1.2 1-1.7 1.8-1.8 3h-4.4c-.1-1.2-.6-2-1.8-3z" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[type]}</svg>;
}

function ScoreGuide() {
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 12, left: 12 });

  useEffect(() => {
    if (!open) return;
    const placePopover = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(900, window.innerWidth - 24);
      const height = popoverRef.current?.offsetHeight ?? 250;
      const left = Math.max(12, (window.innerWidth - width) / 2);
      const safeTop = window.innerWidth <= 720 ? 76 : 88;
      const top = Math.max(safeTop, Math.min(trigger.top - height - 12, window.innerHeight - height - 12));
      setPosition({ top, left });
    };
    placePopover();
    closeRef.current?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    window.addEventListener("resize", placePopover);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", placePopover);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const closePopover = () => { setOpen(false); triggerRef.current?.focus(); };
  const scoreRows = [
    { type: "memory" as const, label: "기억 정확도", value: SCORE_PERCENTAGES.memory, detail: "적은 시도로 찾을수록 높아요." },
    { type: "speed" as const, label: "플레이 속도", value: SCORE_PERCENTAGES.speed, detail: "목표 시간보다 빠를수록 높아요." },
    { type: "combo" as const, label: "최고 콤보", value: SCORE_PERCENTAGES.combo, detail: "연속으로 성공할수록 높아요." },
    { type: "hint" as const, label: "힌트 절약", value: SCORE_PERCENTAGES.hint, detail: "힌트를 적게 쓸수록 높아요." },
  ];

  return (
    <div className={styles.scoreGuide} ref={rootRef}>
      <span className={styles.scoreSummary} aria-label={`기억 정확도 ${SCORE_PERCENTAGES.memory}퍼센트, 플레이 속도 ${SCORE_PERCENTAGES.speed}퍼센트, 최고 콤보 ${SCORE_PERCENTAGES.combo}퍼센트, 힌트 절약 ${SCORE_PERCENTAGES.hint}퍼센트`}>
        <span>기억 정확도 <b>{SCORE_PERCENTAGES.memory}%</b></span><i aria-hidden="true" />
        <span>플레이 속도 <b>{SCORE_PERCENTAGES.speed}%</b></span><i aria-hidden="true" />
        <span>최고 콤보 <b>{SCORE_PERCENTAGES.combo}%</b></span><i aria-hidden="true" />
        <span>힌트 절약 <b>{SCORE_PERCENTAGES.hint}%</b></span>
      </span>
      <button ref={triggerRef} className={styles.scoreGuideTrigger} type="button" aria-expanded={open} aria-controls={popoverId} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">ⓘ</span> 점수 계산법
      </button>
      {open && (
        <div ref={popoverRef} id={popoverId} className={styles.scorePopover} role="dialog" aria-labelledby={`${popoverId}-title`} style={position}>
          <header><strong id={`${popoverId}-title`}>메모리 점수는 이렇게 계산돼요</strong><button ref={closeRef} type="button" onClick={closePopover} aria-label="점수 계산법 닫기">×</button></header>
          <div className={styles.scoreRows}>
            {scoreRows.map((row) => <div className={styles.scoreRow} key={row.type}><span className={styles.scoreIcon}><ScoreIcon type={row.type} /></span><span><strong>{row.label}</strong><small>{row.detail}</small></span><b>{row.value}%</b></div>)}
          </div>
          <div className={styles.scoreGuideMeta}><p><strong>동점 기준</strong><span>시도 횟수 → 플레이 시간 → 먼저 달성</span></p><p><strong>등급</strong><span>S {RANK_THRESHOLDS.S}+ · A {RANK_THRESHOLDS.A}+ · B {RANK_THRESHOLDS.B}+ · C {RANK_THRESHOLDS.B} 미만</span></p></div>
          <ul className={styles.scoreNotice}>
            <li>다루 포인트는 별도 플레이 보상이며 랭킹 순위를 결정하지 않아요.</li>
            <li>시간이 지나도 완주할 수 있으며, 시간 초과 시 속도 점수는 0점이에요.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

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

export function DifficultySelector({ onSelect, startDisabled = false, startPending = false }: { onSelect: (difficulty: GameDifficulty) => void | Promise<void>; startDisabled?: boolean; startPending?: boolean }) {
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
        <div className={styles.scanField} aria-hidden="true"><i /><i /><i /></div>
        {(["umbrella", "shoe"] as const).map((cardId, index) => {
          const card = CARD_CATALOG.find((entry) => entry.id === cardId)!;
          return <button key={cardId} className={`${styles.previewCard} ${styles.previewBack} ${index ? styles.previewTwo : styles.previewOne}`} type="button" aria-label={`${card.label} 미리보기 카드 뒤집기`} aria-pressed={previewCard === cardId} data-revealed={previewCard === cardId || undefined} onClick={() => revealPreview(cardId)}><span className={styles.previewCardInner}><span className={styles.previewCardBack}><span className={styles.cardBackArtwork}><Image key={theme} src={DARU_CARD_BACK_ASSETS[theme]} alt="" fill sizes="82px" draggable={false} unoptimized /></span></span><span className={`${styles.previewCardFront} ${styles.previewCardShell}`}><Image src={getCardThemeImages(card)[theme]} alt="" fill sizes="82px" /></span></span></button>;
        })}
        <div className={styles.previewDaru} aria-hidden="true"><Image className={styles.daruDawn} src="/mascot/daru-idle-dawn.png" alt="" fill sizes="180px" priority /><Image className={styles.daruDay} src="/mascot/daru-idle-day.png" alt="" fill sizes="180px" priority /><Image className={styles.daruNight} src="/mascot/daru-idle-night.png" alt="" fill sizes="180px" priority /></div>
        <p className={styles.previewBubble}><strong>준비됐어?</strong><span>같이 시작해볼까?</span></p>
        {PREVIEW_ITEMS.map((card, index) => <div className={`${styles.previewCard} ${styles.previewFace} ${styles.previewCardShell} ${styles[`previewItem${index + 1}`]}`} key={card.id} aria-hidden="true"><Image src={getCardThemeImages(card)[theme]} alt="" fill sizes="82px" /></div>)}
        <ol className={styles.lobbyFlow} aria-label="게임 진행 방법">
          <li><b>1</b><span>카드 공개</span></li><li aria-hidden="true">→</li>
          <li><b>2</b><span>짝 맞추기</span></li><li aria-hidden="true">→</li>
          <li><b>3</b><span>메모리 점수</span></li>
        </ol>
      </div>
      <ScoreGuide />
      <div className={styles.modeHeading}><h2>게임 모드 선택</h2><p>난이도에 따라 카드 수와 목표 시간이 달라져요.</p></div>
      <div className={styles.compactDifficulty} aria-label="난이도 선택">
        {(Object.entries(DIFFICULTY_CONFIG) as [GameDifficulty, (typeof DIFFICULTY_CONFIG)[GameDifficulty]][]).map(([key, config]) => (
          <button key={key} className={styles.difficultyOption} type="button" aria-pressed={selected === key} disabled={startPending} onClick={() => setSelected(key)}>
            <span className={styles.difficultyHeading}><small>{config.key === "NORMAL" ? "MEDIUM" : config.key}</small><strong>{config.label}</strong></span>
            <span className={styles.difficultyPair}><b>{config.pairCount}</b><em>쌍</em></span>
            <span className={styles.difficultyMeta}>총 {config.cardCount}장 · 목표 {config.speedBenchmarkSeconds}초</span>
            <span className={styles.difficultyFooter}><small>{config.description}</small><i aria-label={`난이도 ${key === "easy" ? 1 : key === "normal" ? 2 : 3}단계`}>{DIFFICULTY_LEVELS[key]}</i></span>
            {selected === key && <PawMark />}
          </button>
        ))}
      </div>
      <p className={styles.selectedModeSummary}><span>선택한 모드</span><strong>{selectedConfig.label} · {selectedConfig.pairCount}쌍 · 목표 {selectedConfig.speedBenchmarkSeconds}초</strong></p>
      <button className={`button button-primary ${styles.startButton}`} type="button" disabled={startDisabled || startPending} aria-busy={startPending || undefined} onClick={() => onSelect(selectedConfig.key.toLowerCase() as GameDifficulty)}>
        <strong>{startPending ? "게임 준비 중…" : startDisabled ? "로그인 상태 확인 중…" : "게임 시작하기"}</strong>
        {(startPending || startDisabled) && <span>{startPending ? "기록 저장 준비를 확인하고 있어요" : "로그인 상태를 확인하고 있어요"}</span>}
      </button>
    </section>
  );
}
