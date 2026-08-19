"use client";

import { useEffect, useRef, useState } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import { DARU_SPRITE_CONFIG } from "./daru.sprite.config";
import type { DaruRhythm } from "./types";
import styles from "./DaruMascot.module.css";
import { loadThemedDaruImageSrc } from "./daru.theme-image";

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

function frameIndexForDistance(travelledPx: number, frameCount: number) {
  const cycleProgress = (travelledPx % DARU_SPRITE_CONFIG.stridePx) / DARU_SPRITE_CONFIG.stridePx;
  return Math.floor(cycleProgress * frameCount);
}

export function DaruSpriteRenderer({ state, theme = "day" }: { state: DaruRendererState; theme?: DaruRhythm }) {
  const rendererRef = useRef<HTMLSpanElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const travelledRef = useRef(0);
  const lastXRef = useRef<number | null>(null);
  const frameRef = useRef(-1);
  const themedFramesRef = useRef<readonly string[]>(DARU_SPRITE_CONFIG[theme].walkFrames);
  const [initialFrameSrc] = useState(() => DARU_SPRITE_CONFIG[theme].walkFrames[0]);
  const walking = !state.reducedMotion && (state.locomotion === "start_walk" || state.locomotion === "walk");

  useEffect(() => {
    void preloadDaruWalkFrames(theme);
    let active = true;
    const syncCurrentFrame = (frames: readonly string[]) => {
      const frameIndex = frameIndexForDistance(travelledRef.current, frames.length);
      themedFramesRef.current = frames;
      frameRef.current = frameIndex;
      if (imageRef.current?.getAttribute("src") !== frames[frameIndex]) {
        imageRef.current?.setAttribute("src", frames[frameIndex]);
      }
    };

    syncCurrentFrame(DARU_SPRITE_CONFIG[theme].walkFrames);
    Promise.all(DARU_SPRITE_CONFIG[theme].walkFrames.map((src) => loadThemedDaruImageSrc(src, theme))).then((frames) => {
      if (!active) return;
      syncCurrentFrame(frames);
    });
    return () => { active = false; };
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

      const walkFrames = themedFramesRef.current;
      const nextFrame = frameIndexForDistance(travelledRef.current, walkFrames.length);
      if (nextFrame !== frameRef.current) {
        image.src = walkFrames[nextFrame];
        frameRef.current = nextFrame;
      }
      animationFrame = requestAnimationFrame(sample);
    };

    animationFrame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(animationFrame);
  }, [walking]);

  return (
    <span ref={rendererRef} className={styles.renderer} data-renderer="sprite" data-locomotion={state.locomotion} data-facing={state.facing} aria-hidden="true">
      <span className={styles.contactShadow} />
      {/* The frame source is updated imperatively to avoid a React render on every step. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imageRef} className={styles.spriteImage} src={initialFrameSrc} alt="" draggable={false} />
    </span>
  );
}
