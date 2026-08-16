"use client";

import { useEffect, useRef } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import { DARU_SPRITE_CONFIG } from "./daru.sprite.config";
import styles from "./DaruMascot.module.css";

function translatedX(element: HTMLElement): number {
  const value = getComputedStyle(element).translate;
  if (!value || value === "none") return 0;
  const x = Number.parseFloat(value.split(" ")[0]);
  return Number.isFinite(x) ? x : 0;
}

export function DaruSmoothSpritePreviewRenderer({
  state,
  frames,
}: {
  state: DaruRendererState;
  frames: readonly HTMLImageElement[];
}) {
  const rendererRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const travelledRef = useRef(0);
  const lastXRef = useRef<number | null>(null);
  const frameRef = useRef(-1);
  const walking = state.locomotion === "start_walk" || state.locomotion === "walk";

  useEffect(() => {
    const canvas = canvasRef.current;
    const firstFrame = frames[0];
    if (!canvas || !firstFrame) return;
    canvas.width = firstFrame.naturalWidth;
    canvas.height = firstFrame.naturalHeight;
  }, [frames]);

  useEffect(() => {
    if (!walking) {
      lastXRef.current = null;
      travelledRef.current = 0;
      frameRef.current = -1;
      return;
    }

    let animationFrame = 0;
    const sample = () => {
      const canvas = canvasRef.current;
      const stage = rendererRef.current?.closest<HTMLElement>("[data-daru-stage]");
      if (!canvas || !stage || frames.length !== 8) return;

      const x = translatedX(stage);
      if (lastXRef.current !== null) travelledRef.current += Math.abs(x - lastXRef.current);
      lastXRef.current = x;

      const cycleProgress = (travelledRef.current % DARU_SPRITE_CONFIG.stridePx) / DARU_SPRITE_CONFIG.stridePx;
      const nextFrame = Math.floor(cycleProgress * 16);
      if (nextFrame !== frameRef.current) {
        const context = canvas.getContext("2d");
        if (context) {
          const sourceIndex = Math.floor(nextFrame / 2);
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.globalAlpha = 1;
          context.drawImage(frames[sourceIndex], 0, 0);
          if (nextFrame % 2 === 1) {
            context.globalAlpha = 0.5;
            context.drawImage(frames[(sourceIndex + 1) % frames.length], 0, 0);
            context.globalAlpha = 1;
          }
        }
        frameRef.current = nextFrame;
      }
      animationFrame = requestAnimationFrame(sample);
    };

    animationFrame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(animationFrame);
  }, [frames, walking]);

  return (
    <span ref={rendererRef} className={styles.renderer} data-renderer="sprite" data-locomotion={state.locomotion} data-facing={state.facing} aria-hidden="true">
      <span className={styles.contactShadow} />
      <canvas ref={canvasRef} className={styles.spriteImage} />
    </span>
  );
}
