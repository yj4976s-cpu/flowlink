"use client";

import { useEffect, useRef } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import { DARU_SPRITE_CONFIG } from "./daru.sprite.config";
import type { DaruRhythm } from "./types";
import styles from "./DaruMascot.module.css";
import { loadThemedDaruImageSrc } from "./daru.theme-image";

const preloadPromises = new Map<DaruRhythm, Promise<void>>();
const PREBLEND_START = 0.86;
const PREBLEND_MAX_OPACITY = 0;

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

function framePositionForDistance(travelledPx: number, frameCount: number) {
  const cycleProgress = (travelledPx % DARU_SPRITE_CONFIG.stridePx) / DARU_SPRITE_CONFIG.stridePx;
  const frameProgress = cycleProgress * frameCount;
  const frameBase = Math.floor(frameProgress);
  const frameIndex = frameBase % frameCount;
  const nextFrameIndex = (frameIndex + 1) % frameCount;
  const frameLocalProgress = frameProgress - frameBase;
  const preblendProgress = Math.max(0, (frameLocalProgress - PREBLEND_START) / (1 - PREBLEND_START));
  return {
    frameIndex,
    nextFrameIndex,
    nextFrameOpacity: preblendProgress * PREBLEND_MAX_OPACITY,
  };
}

export function DaruSpriteRenderer({ state, theme = "day" }: { state: DaruRendererState; theme?: DaruRhythm }) {
  const rendererRef = useRef<HTMLSpanElement>(null);
  const currentImageRef = useRef<HTMLImageElement>(null);
  const nextImageRef = useRef<HTMLImageElement>(null);
  const travelledRef = useRef(0);
  const lastXRef = useRef<number | null>(null);
  const frameRef = useRef(-1);
  const nextFrameRef = useRef(-1);
  const themedFramesRef = useRef<readonly string[]>(DARU_SPRITE_CONFIG[theme].walkFrames);
  const initialFrameSrc = DARU_SPRITE_CONFIG[theme].walkFrames[0];
  const initialNextFrameSrc = DARU_SPRITE_CONFIG[theme].walkFrames[1] ?? initialFrameSrc;
  const walking = !state.reducedMotion && (state.locomotion === "start_walk" || state.locomotion === "walk");

  useEffect(() => {
    void preloadDaruWalkFrames(theme);
    let active = true;
    const syncCurrentFrame = (frames: readonly string[]) => {
      const { frameIndex, nextFrameIndex, nextFrameOpacity } = framePositionForDistance(travelledRef.current, frames.length);
      themedFramesRef.current = frames;
      frameRef.current = frameIndex;
      nextFrameRef.current = nextFrameIndex;
      if (currentImageRef.current?.getAttribute("src") !== frames[frameIndex]) {
        currentImageRef.current?.setAttribute("src", frames[frameIndex]);
      }
      if (nextImageRef.current?.getAttribute("src") !== frames[nextFrameIndex]) {
        nextImageRef.current?.setAttribute("src", frames[nextFrameIndex]);
      }
      if (nextImageRef.current) {
        nextImageRef.current.style.opacity = String(nextFrameOpacity);
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
      nextFrameRef.current = -1;
      if (nextImageRef.current) nextImageRef.current.style.opacity = "0";
      return;
    }

    let animationFrame = 0;
    const sample = () => {
      const currentImage = currentImageRef.current;
      const nextImage = nextImageRef.current;
      const stage = rendererRef.current?.closest<HTMLElement>("[data-daru-stage]");
      if (!currentImage || !nextImage || !stage) {
        animationFrame = requestAnimationFrame(sample);
        return;
      }

      const x = translatedX(stage);
      if (lastXRef.current !== null) travelledRef.current += Math.abs(x - lastXRef.current);
      lastXRef.current = x;

      const walkFrames = themedFramesRef.current;
      const { frameIndex, nextFrameIndex, nextFrameOpacity } = framePositionForDistance(travelledRef.current, walkFrames.length);
      if (frameIndex !== frameRef.current) {
        currentImage.src = walkFrames[frameIndex];
        frameRef.current = frameIndex;
      }
      if (nextFrameIndex !== nextFrameRef.current) {
        nextImage.src = walkFrames[nextFrameIndex];
        nextFrameRef.current = nextFrameIndex;
      }
      nextImage.style.opacity = String(nextFrameOpacity);
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
      <img key={`current-${theme}`} ref={currentImageRef} className={styles.spriteImage} src={initialFrameSrc} alt="" draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={`next-${theme}`} ref={nextImageRef} className={styles.spriteImage} data-next="true" src={initialNextFrameSrc} alt="" draggable={false} onError={(event) => { event.currentTarget.style.opacity = "0"; }} />
    </span>
  );
}
