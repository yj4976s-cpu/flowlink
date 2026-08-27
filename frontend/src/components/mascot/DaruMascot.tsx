"use client";

import type { CSSProperties } from "react";
import { DARU_ACTION_LABEL } from "./config";
import { DaruCharacter } from "./DaruCharacter";
import type { DaruRendererState } from "./daru.animation.adapter";
import type { DaruAction, DaruMode } from "./types";
import styles from "./DaruMascot.module.css";

interface DaruMascotProps {
  action: DaruAction;
  mode: DaruMode;
  message: string | null;
  reducedMotion: boolean;
  dragging: boolean;
  guideOpen: boolean;
  directGreeting: boolean;
  bubbleSide: "left" | "right";
  mobileBubbleStyle?: CSSProperties;
  rendererState: DaruRendererState;
  onInteract: () => void;
  onGuide: () => void;
  onHover: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

export function DaruMascot({ action, mode, message, reducedMotion, dragging, guideOpen, directGreeting, bubbleSide, mobileBubbleStyle, rendererState, onInteract, onGuide, onHover, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: DaruMascotProps) {
  const label = message ?? DARU_ACTION_LABEL[action];
  return (
    <div className={styles.mascot} data-action={action} data-mode={mode} data-dragging={dragging || undefined} data-reduced-motion={reducedMotion || undefined} data-direct-greeting={directGreeting || undefined} data-bubble-side={bubbleSide}>
      {mode === "active" && action !== "idle" && !guideOpen && <p className={styles.bubble} role="status" style={mobileBubbleStyle}>{label}</p>}
      <button className={styles.character} type="button" aria-label="다루와 상호작용하거나 끌어서 이동하기" onClick={onInteract} onPointerEnter={onHover} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
        <DaruCharacter state={rendererState} action={action} />
      </button>
      <button className={styles.guideTrigger} type="button" aria-label="다루 안내 열기" aria-expanded={guideOpen} aria-controls="daru-guide-panel" onClick={onGuide}>i</button>
    </div>
  );
}
