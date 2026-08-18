"use client";
/* eslint-disable @next/next/no-img-element -- transparent rig layers must preserve their exact source geometry */

import { useEffect, useMemo, useRef, useState } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import { DARU_LAYERED_ASSETS, DARU_LAYERED_LAYOUT, DARU_LAYERED_SCARF, DARU_LAYER_ORDER, DARU_RIG_SPACE, type DaruLayerName, type DaruRigLayer } from "./daru.layered.config";
import type { DaruRhythm } from "./types";
import styles from "./LayeredDaruRenderer.module.css";

const preloadCache = new Map<DaruRhythm, Promise<void>>();

async function loadImage(src: string) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Failed to load Daru layer: ${src}`));
    image.src = src;
  });
  if (typeof image.decode === "function") await Promise.race([image.decode(), new Promise<void>((resolve) => window.setTimeout(resolve, 1200))]);
}

export function preloadDaruLayeredAssets(theme: DaruRhythm) {
  const cached = preloadCache.get(theme);
  if (cached) return cached;
  const sources = [...new Set([...DARU_LAYERED_ASSETS, DARU_LAYERED_SCARF[theme]])];
  const promise = Promise.all(sources.map(loadImage)).then(() => undefined);
  preloadCache.set(theme, promise);
  return promise;
}

function percent(value: number, axis: "x" | "y") {
  return `${(value / (axis === "x" ? DARU_RIG_SPACE.width : DARU_RIG_SPACE.height)) * 100}%`;
}

function layerSize(layer: DaruRigLayer) {
  return { width: percent(layer.sourceWidth * layer.scale, "x"), height: percent(layer.sourceHeight * layer.scale, "y") };
}

const WALK_CYCLE_MS = 620;
const START_BLEND_MS = 170;
const STOP_SETTLE_MS = 220;

function smoothstep(value: number) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export interface DaruGaitSnapshot {
  phase: number;
  nearStage: "contact" | "down" | "passing" | "up";
  farStage: "contact" | "down" | "passing" | "up";
}

function gaitStage(phase: number): DaruGaitSnapshot["nearStage"] {
  if (phase < 0.125 || phase >= 0.95) return "contact";
  if (phase < 0.25) return "down";
  if (phase >= 0.625 && phase < 0.875) return "passing";
  return "up";
}

function sampleLeg(phase: number) {
  const p = (phase + 1) % 1;
  if (p < 0.5) {
    const stance = p / 0.5;
    return { x: 34 - 68 * smoothstep(stance), y: stance < 0.2 ? 1.5 * smoothstep(stance / 0.2) : 1.5 * (1 - smoothstep((stance - 0.2) / 0.8)), rotation: 12 - 24 * smoothstep(stance), stage: gaitStage(p) };
  }
  const swing = (p - 0.5) / 0.5;
  const lift = Math.sin(Math.PI * swing);
  return { x: -34 + 68 * smoothstep(swing), y: -22 * lift, rotation: -12 + 24 * smoothstep(swing), stage: gaitStage(p) };
}

function StaticLayer({ name, layer, src, motion }: { name: DaruLayerName; layer: DaruRigLayer; src: string; motion?: { x: number; y: number; rotation: number } }) {
  const jointX = layer.pivotX === undefined ? undefined : layer.x + layer.pivotX * layer.scale;
  const jointY = layer.pivotY === undefined ? undefined : layer.y + layer.pivotY * layer.scale;
  const transformOrigin = layer.pivotX === undefined ? undefined : `${(layer.pivotX / layer.sourceWidth) * 100}% ${(layer.pivotY! / layer.sourceHeight) * 100}%`;
  return <span className={`${styles.layer} ${styles[name]}`} data-daru-part={name} data-joint-x={jointX} data-joint-y={jointY}
    style={{ left: percent(layer.x, "x"), top: percent(layer.y, "y"), transformOrigin, translate: `${percent(motion?.x ?? 0, "x")} ${percent(motion?.y ?? 0, "y")}`, rotate: `${motion?.rotation ?? 0}deg`, ...layerSize(layer) }}>
    <img src={src} alt="" draggable={false} />
  </span>;
}

export function LayeredDaruRenderer({ state, theme, onAssetError, phaseOverride, onGaitSnapshot }: { state: DaruRendererState; theme: DaruRhythm; onAssetError?: () => void; phaseOverride?: number; onGaitSnapshot?: (snapshot: DaruGaitSnapshot) => void }) {
  const [readyTheme, setReadyTheme] = useState<DaruRhythm | null>(null);
  const [failedTheme, setFailedTheme] = useState<DaruRhythm | null>(null);
  const [motion, setMotion] = useState({ phase: 0, amplitude: 0 });
  const motionRef = useRef(motion);
  const phaseRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  useEffect(() => {
    let current = true;
    preloadDaruLayeredAssets(theme).then(() => { if (current) { setReadyTheme(theme); setFailedTheme(null); } }).catch(() => { if (current) { setFailedTheme(theme); onAssetError?.(); } });
    return () => { current = false; };
  }, [onAssetError, theme]);
  useEffect(() => {
    if (phaseOverride !== undefined) return;
    let frame = 0;
    const animate = (now: number) => {
      const last = lastFrameRef.current ?? now;
      const delta = Math.min(50, now - last);
      lastFrameRef.current = now;
      const walking = state.locomotion === "walk";
      const starting = state.locomotion === "start_walk";
      const stopping = state.locomotion === "stop_walk" || state.locomotion === "turn";
      const targetAmplitude = walking ? 1 : starting ? 0.72 : 0;
      const blendMs = stopping ? STOP_SETTLE_MS : START_BLEND_MS;
      const blendStep = delta / blendMs;
      const amplitude = motionRef.current.amplitude + (targetAmplitude - motionRef.current.amplitude) * Math.min(1, blendStep * 3.2);
      if (walking || starting) phaseRef.current = (phaseRef.current + delta * Math.max(0.55, state.movementSpeed || 1) / WALK_CYCLE_MS) % 1;
      const next = { phase: phaseRef.current, amplitude: amplitude < 0.002 ? 0 : amplitude };
      motionRef.current = next;
      setMotion(next);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); lastFrameRef.current = null; };
  }, [phaseOverride, state.locomotion, state.movementSpeed]);

  const renderedMotion = phaseOverride === undefined ? motion : { phase: (phaseOverride + 1) % 1, amplitude: 1 };
  const near = sampleLeg(renderedMotion.phase);
  const far = sampleLeg((renderedMotion.phase + 0.5) % 1);
  const amplitude = state.reducedMotion ? 0 : renderedMotion.amplitude;
  const bodyBob = amplitude * (near.stage === "down" || far.stage === "down" ? 3 : near.stage === "up" || far.stage === "up" ? -2 : 0);
  const weightShift = amplitude * Math.sin(renderedMotion.phase * Math.PI * 2) * 2;
  const motions: Partial<Record<DaruLayerName, { x: number; y: number; rotation: number }>> = {
    legNear: { x: near.x * amplitude, y: near.y * amplitude, rotation: near.rotation * amplitude },
    legFar: { x: far.x * amplitude, y: far.y * amplitude, rotation: far.rotation * amplitude },
    armNear: { x: -far.x * 0.18 * amplitude, y: 0, rotation: -far.rotation * 0.72 * amplitude },
    armFar: { x: -near.x * 0.18 * amplitude, y: 0, rotation: -near.rotation * 0.72 * amplitude },
  };
  const snapshot = useMemo<DaruGaitSnapshot>(() => ({ phase: renderedMotion.phase, nearStage: near.stage, farStage: far.stage }), [far.stage, near.stage, renderedMotion.phase]);
  useEffect(() => { onGaitSnapshot?.(snapshot); }, [onGaitSnapshot, snapshot]);
  if (failedTheme === theme) return null;
  return <span className={styles.renderer} data-renderer="layered" data-rig-mode={amplitude === 0 ? "neutral" : "walk"} data-locomotion={state.locomotion} data-facing={state.facing} data-ready={readyTheme === theme || undefined} data-gait-phase={renderedMotion.phase.toFixed(3)} data-near-stage={near.stage} data-far-stage={far.stage} aria-hidden="true">
    <span className={styles.contactShadow} />
    <span className={styles.motionRoot} style={{ translate: `${percent(weightShift, "x")} ${percent(bodyBob, "y")}` }}><span className={styles.facing}>
      {DARU_LAYER_ORDER.map((name) => {
        const layer = DARU_LAYERED_LAYOUT[name];
        const src = name === "scarf" ? DARU_LAYERED_SCARF[theme] : layer.src;
        return <StaticLayer key={name} name={name} layer={layer} src={src} motion={motions[name]} />;
      })}
    </span></span>
  </span>;
}
