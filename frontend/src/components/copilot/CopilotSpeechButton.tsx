import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import styles from "./FlowCopilot.module.css";
import { SPEECH_RATES, type SpeechRate } from "@/hooks/useSpeechSynthesis";

type CopilotSpeechButtonProps = {
  speaking: boolean;
  paused: boolean;
  speechRate: SpeechRate;
  disabled?: boolean;
  unsupported?: boolean;
  onSpeak: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRateChange: (rate: number) => void;
  ratePanelOpen: boolean;
  onRatePanelOpenChange: (open: boolean) => void;
};

export function CopilotSpeechButton({
  speaking,
  paused,
  speechRate,
  disabled = false,
  unsupported = false,
  onSpeak,
  onPause,
  onResume,
  onStop,
  onRateChange,
  ratePanelOpen,
  onRatePanelOpenChange,
}: CopilotSpeechButtonProps) {
  const controlsDisabled = disabled || unsupported;
  const ratePanelId = useId();
  const rateControlRef = useRef<HTMLSpanElement>(null);
  const rateButtonRef = useRef<HTMLButtonElement>(null);
  const ratePanelRef = useRef<HTMLDivElement>(null);
  const rateOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [ratePanelPosition, setRatePanelPosition] = useState<{ top: number; left: number } | null>(null);
  const restoreRateButtonFocus = useCallback(() => {
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>(`[aria-controls="${ratePanelId}"]`)?.focus();
    }, 0);
  }, [ratePanelId]);

  useEffect(() => {
    if (!ratePanelOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rateControlRef.current?.contains(target) && !ratePanelRef.current?.contains(target)) {
        onRatePanelOpenChange(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onRatePanelOpenChange(false);
      restoreRateButtonFocus();
    };
    const closeOnViewportChange = () => onRatePanelOpenChange(false);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    const focusFrame = window.requestAnimationFrame(() => {
      const selectedIndex = SPEECH_RATES.indexOf(speechRate);
      rateOptionRefs.current[selectedIndex]?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [onRatePanelOpenChange, ratePanelOpen, restoreRateButtonFocus, speechRate]);

  const openRatePanel = () => {
    const trigger = rateButtonRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportMargin = 10;
    const panelGap = 6;
    const panelWidth = 104;
    const panelHeight = 166;
    const top = window.innerHeight - rect.bottom >= panelHeight + panelGap + viewportMargin
      ? rect.bottom + panelGap
      : Math.max(viewportMargin, rect.top - panelGap - panelHeight);
    const left = Math.min(
      window.innerWidth - panelWidth - viewportMargin,
      Math.max(viewportMargin, rect.right - panelWidth),
    );
    setRatePanelPosition({ top, left });
    onRatePanelOpenChange(true);
  };

  const selectRate = (rate: SpeechRate) => {
    onRateChange(rate);
    onRatePanelOpenChange(false);
    restoreRateButtonFocus();
  };

  const moveRateFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const currentIndex = rateOptionRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0) return;
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + offset + SPEECH_RATES.length) % SPEECH_RATES.length;
    rateOptionRefs.current[nextIndex]?.focus({ preventScroll: true });
  };

  return (
    <span
      className={styles.speechControls}
      title={unsupported ? "이 브라우저에서는 음성 안내를 지원하지 않아요." : undefined}
    >
      {speaking ? (
        <>
          <button
            className={styles.speechButton}
            type="button"
            aria-label={paused ? "음성 안내 계속 재생" : "음성 안내 일시정지"}
            disabled={controlsDisabled}
            onClick={paused ? onResume : onPause}
          >
            <span aria-hidden="true">{paused ? "▶" : "⏸"}</span>
            {paused ? "계속 듣기" : "일시정지"}
          </button>
          <button
            className={styles.speechButton}
            type="button"
            aria-label="음성 안내 중지"
            disabled={controlsDisabled}
            onClick={onStop}
          >
            <span aria-hidden="true">■</span>
            정지
          </button>
        </>
      ) : (
        <button
          className={styles.speechButton}
          type="button"
          aria-label="이 답변 음성으로 듣기"
          disabled={controlsDisabled}
          onClick={onSpeak}
        >
          <span aria-hidden="true">🔊</span>
          듣기
        </button>
      )}
      <span className={styles.speechRateControl} ref={rateControlRef}>
        <button
          className={styles.speechRateButton}
          type="button"
          aria-controls={ratePanelId}
          aria-expanded={ratePanelOpen}
          aria-haspopup="menu"
          aria-label="음성 재생 속도 설정"
          disabled={controlsDisabled}
          ref={rateButtonRef}
          onClick={() => {
            if (ratePanelOpen) onRatePanelOpenChange(false);
            else openRatePanel();
          }}
        >
          <span className={styles.speechRateGauge} aria-hidden="true" />
          <span>배속 {speechRate.toFixed(1)}×</span>
          <svg
            className={styles.speechRateAdjust}
            viewBox="0 0 14 14"
            aria-hidden="true"
          >
            <path d="M2 3.5h10M2 7h10M2 10.5h10" />
            <circle cx="5" cy="3.5" r="1.25" />
            <circle cx="9" cy="7" r="1.25" />
            <circle cx="6.5" cy="10.5" r="1.25" />
          </svg>
        </button>
        {ratePanelOpen && ratePanelPosition && typeof document !== "undefined" && createPortal(
          <div
            className={styles.speechRatePanel}
            id={ratePanelId}
            role="menu"
            aria-label="재생 속도"
            ref={ratePanelRef}
            style={ratePanelPosition}
            onKeyDown={moveRateFocus}
          >
            <div className={styles.speechRatePanelTitle}>재생 속도</div>
            {SPEECH_RATES.map((rate, index) => (
              <button
                className={styles.speechRateOption}
                data-selected={speechRate === rate || undefined}
                type="button"
                role="menuitemradio"
                aria-checked={speechRate === rate}
                key={rate}
                ref={(element) => { rateOptionRefs.current[index] = element; }}
                onClick={() => selectRate(rate)}
              >
                {rate.toFixed(1)}×
                <span aria-hidden="true" />
              </button>
            ))}
          </div>,
          document.body,
        )}
      </span>
    </span>
  );
}
