"use client";

import { useEffect, useRef } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import { DARU_SPRITE_CONFIG } from "./daru.sprite.config";
import type { DaruRhythm } from "./types";
import styles from "./DaruMascot.module.css";

const preloadPromises = new Map<DaruRhythm, Promise<void>>();

export function preloadDaruWalkFrames(theme: DaruRhythm = "day") {
  const existing = preloadPromises.get(theme);
  if (existing) return existing;
  const promise = Promise.all(
    DARU_SPRITE_CONFIG[theme].walkFrames.map(
      (src) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = src;
        }),
    ),
  ).then(() => undefined);
  preloadPromises.set(theme, promise);
  return promise;
}

function translatedX(element: HTMLElement): number {
  const value = getComputedStyle(element).translate;
  if (!value || value === "none") return 0;
  const x = Number.parseFloat(value.split(" ")[0]);
  return Number.isFinite(x) ? x : 0;
}

export function DaruSpriteRenderer({ state, theme = "day" }: { state: DaruRendererState; theme?: DaruRhythm }) {
  const rendererRef = useRef<HTMLSpanElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const travelledRef = useRef(0);
  const lastXRef = useRef<number | null>(null);
  const frameRef = useRef(-1);
  const walking = !state.reducedMotion && (state.locomotion === "start_walk" || state.locomotion === "walk");

  useEffect(() => {
    void preloadDaruWalkFrames(theme);
  }, [theme]);

  useEffect(() => {
    if (!walking) {
      lastXRef.current = null;
      travelledRef.current = 0;
      frameRef.current = -1;
      return;
    }

    let animationFrame = 0;
    const sample = () => {
      const image = imageRef.current;
      const stage = rendererRef.current?.closest<HTMLElement>("[data-daru-stage]");
      if (!image || !stage) return;

      const x = translatedX(stage);
      if (lastXRef.current !== null) travelledRef.current += Math.abs(x - lastXRef.current);
      lastXRef.current = x;

      const cycleProgress = (travelledRef.current % DARU_SPRITE_CONFIG.stridePx) / DARU_SPRITE_CONFIG.stridePx;
      const walkFrames = DARU_SPRITE_CONFIG[theme].walkFrames;
      const nextFrame = Math.floor(cycleProgress * walkFrames.length);
      if (nextFrame !== frameRef.current) {
        image.src = walkFrames[nextFrame];
        frameRef.current = nextFrame;
      }
      animationFrame = requestAnimationFrame(sample);
    };

    animationFrame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(animationFrame);
  }, [theme, walking]);

  return (
    <span ref={rendererRef} className={styles.renderer} data-renderer="sprite" data-locomotion={state.locomotion} data-facing={state.facing} aria-hidden="true">
      <span className={styles.contactShadow} />
      {/* The frame source is updated imperatively to avoid a React render on every step. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imageRef} className={styles.spriteImage} src={DARU_SPRITE_CONFIG[theme].walkFrames[0]} alt="" draggable={false} />
    </span>
  );
}
