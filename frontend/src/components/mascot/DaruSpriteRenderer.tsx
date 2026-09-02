"use client";

import { useEffect, useRef } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import { DARU_SPRITE_CONFIG } from "./daru.sprite.config";
import type { DaruRhythm } from "./types";
import styles from "./DaruMascot.module.css";
import { loadThemedDaruImageSrc } from "./daru.theme-image";

const preloadPromises = new Map<DaruRhythm, Promise<void>>();
const DARU_MOBILE_FRAME_SAMPLE_MS = 84;

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

function translatedPosition(element: HTMLElement): { x: number; y: number } {
  const computed = getComputedStyle(element);
  const value = computed.translate;
  if (value && value !== "none") {
    const translated = value.split(" ");
    const x = Number.parseFloat(translated[0]);
    const y = Number.parseFloat(translated[1] ?? "0");
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }

  const matrix = computed.transform;
  if (!matrix || matrix === "none") return { x: 0, y: 0 };
  const matrix3d = matrix.match(/^matrix3d\((.+)\)$/);
  if (matrix3d) {
    const values = matrix3d[1].split(",").map((item) => Number.parseFloat(item.trim()));
    return Number.isFinite(values[12]) && Number.isFinite(values[13]) ? { x: values[12], y: values[13] } : { x: 0, y: 0 };
  }
  const matrix2d = matrix.match(/^matrix\((.+)\)$/);
  if (matrix2d) {
    const values = matrix2d[1].split(",").map((item) => Number.parseFloat(item.trim()));
    return Number.isFinite(values[4]) && Number.isFinite(values[5]) ? { x: values[4], y: values[5] } : { x: 0, y: 0 };
  }
  return { x: 0, y: 0 };
}

function frameIndexForDistance(travelledPx: number, frameCount: number) {
  const cycleProgress = (travelledPx % DARU_SPRITE_CONFIG.stridePx) / DARU_SPRITE_CONFIG.stridePx;
  return Math.floor(cycleProgress * frameCount) % frameCount;
}

export function DaruSpriteRenderer({ state, theme = "day" }: { state: DaruRendererState; theme?: DaruRhythm }) {
  const rendererRef = useRef<HTMLSpanElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const travelledRef = useRef(0);
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef(-1);
  const themedFramesRef = useRef<readonly string[]>(DARU_SPRITE_CONFIG[theme].walkFrames);
  const initialFrameSrc = DARU_SPRITE_CONFIG[theme].walkFrames[0];
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
      lastPositionRef.current = null;
      travelledRef.current = 0;
      frameRef.current = -1;
      return;
    }

    let animationFrame = 0;
    let lastSampleMs = 0;
    const mobileViewport = window.matchMedia("(max-width: 600px)").matches;
    const sample = (timestamp: number) => {
      if (mobileViewport && timestamp - lastSampleMs < DARU_MOBILE_FRAME_SAMPLE_MS) {
        animationFrame = requestAnimationFrame(sample);
        return;
      }
      lastSampleMs = timestamp;
      const image = imageRef.current;
      const stage = rendererRef.current?.closest<HTMLElement>("[data-daru-stage]");
      if (!image || !stage) {
        animationFrame = requestAnimationFrame(sample);
        return;
      }

      const position = translatedPosition(stage);
      if (lastPositionRef.current !== null) {
        const deltaX = position.x - lastPositionRef.current.x;
        const deltaY = position.y - lastPositionRef.current.y;
        travelledRef.current += stage.dataset.gameReturning === "true" ? Math.hypot(deltaX, deltaY) : Math.abs(deltaX);
      }
      lastPositionRef.current = position;

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
      <img key={theme} ref={imageRef} className={styles.spriteImage} src={initialFrameSrc} alt="" draggable={false} />
    </span>
  );
}
