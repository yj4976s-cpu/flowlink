"use client";
/* eslint-disable @next/next/no-img-element -- transparent rig layers must preserve their exact source geometry */

import { useEffect, useMemo, useRef, useState } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import { DARU_LAYERED_ASSETS, DARU_LAYERED_LAYOUT, DARU_LAYERED_SCARF, DARU_LAYER_ORDER, DARU_RIG_SPACE, type DaruLayerName, type DaruRigLayer } from "./daru.layered.config";
import { DARU_GROUNDED_ROAMING_CONFIG } from "./daru.renderer.config";
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

function smoothstep(value: number) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export interface DaruGaitSnapshot {
  phase: number;
  nearStage: "contact" | "down" | "passing" | "up";
  farStage: "contact" | "down" | "passing" | "up";
  stageActualX: number;
  stanceFoot: "near" | "far";
  stanceFootLocalX: number;
  stanceFootWorldX: number;
}

function gaitStage(phase: number): DaruGaitSnapshot["nearStage"] {
  if (phase < 0.125 || phase >= 0.95) return "contact";
  if (phase < 0.25) return "down";
  if (phase >= 0.625 && phase < 0.875) return "passing";
  return "up";
}

function sampleLeg(phase: number, stride: number) {
  const p = (phase + 1) % 1;
  const legTravel = stride / 2;
  const halfLegTravel = legTravel / 2;
  if (p < 0.5) {
    const stance = p / 0.5;
    return { x: halfLegTravel - legTravel * stance, y: stance < 0.2 ? 1.5 * smoothstep(stance / 0.2) : 1.5 * (1 - smoothstep((stance - 0.2) / 0.8)), rotation: 12 - 24 * smoothstep(stance), stage: gaitStage(p), stance: true };
  }
  const swing = (p - 0.5) / 0.5;
  const lift = Math.sin(Math.PI * swing);
  return { x: -halfLegTravel + legTravel * smoothstep(swing), y: -22 * lift, rotation: -12 + 24 * smoothstep(swing), stage: gaitStage(p), stance: false };
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

export function LayeredDaruRenderer({ state, theme, onAssetError, onReady, phaseOverride, onGaitSnapshot }: { state: DaruRendererState; theme: DaruRhythm; onAssetError?: () => void; onReady?: () => void; phaseOverride?: number; onGaitSnapshot?: (snapshot: DaruGaitSnapshot) => void }) {
  const rendererRef = useRef<HTMLSpanElement>(null);
  const [readyTheme, setReadyTheme] = useState<DaruRhythm | null>(null);
  const [failedTheme, setFailedTheme] = useState<DaruRhythm | null>(null);
  const [motion, setMotion] = useState({ phase: 0, amplitude: 0, stageX: 0, rendererWidth: 148 });
  const motionRef = useRef(motion);
  const phaseRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const lastStageXRef = useRef<number | null>(null);
  useEffect(() => {
    let current = true;
    preloadDaruLayeredAssets(theme).then(() => { if (current) { setReadyTheme(theme); setFailedTheme(null); onReady?.(); } }).catch(() => { if (current) { setFailedTheme(theme); onAssetError?.(); } });
    return () => { current = false; };
  }, [onAssetError, onReady, theme]);
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
      const blendMs = stopping ? DARU_GROUNDED_ROAMING_CONFIG.stopWalkMs : DARU_GROUNDED_ROAMING_CONFIG.startWalkMs;
      const blendStep = delta / blendMs;
      const amplitude = motionRef.current.amplitude + (targetAmplitude - motionRef.current.amplitude) * Math.min(1, blendStep * 3.2);
      const stage = rendererRef.current?.closest<HTMLElement>("[data-daru-stage]");
      const stageX = stage?.getBoundingClientRect().left ?? motionRef.current.stageX;
      const rendererWidth = rendererRef.current?.getBoundingClientRect().width || motionRef.current.rendererWidth;
      const previousStageX = lastStageXRef.current;
      if ((walking || starting) && previousStageX !== null) {
        const travelled = Math.abs(stageX - previousStageX);
        if (travelled > 0.001) phaseRef.current = (phaseRef.current + travelled / DARU_GROUNDED_ROAMING_CONFIG.stridePx) % 1;
      }
      lastStageXRef.current = stageX;
      const next = { phase: phaseRef.current, amplitude: amplitude < 0.002 ? 0 : amplitude, stageX, rendererWidth };
      motionRef.current = next;
      setMotion(next);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); lastFrameRef.current = null; };
  }, [phaseOverride, state.locomotion]);

  const renderedMotion = phaseOverride === undefined ? motion : { ...motion, phase: (phaseOverride + 1) % 1, amplitude: 1 };
  const rigPixelsPerScreenPixel = DARU_RIG_SPACE.width / Math.max(1, renderedMotion.rendererWidth);
  const strideInRigPixels = DARU_GROUNDED_ROAMING_CONFIG.stridePx * rigPixelsPerScreenPixel;
  const near = sampleLeg(renderedMotion.phase, strideInRigPixels);
  const far = sampleLeg((renderedMotion.phase + 0.5) % 1, strideInRigPixels);
  const amplitude = state.reducedMotion ? 0 : renderedMotion.amplitude;
  const bodyBob = amplitude * (near.stage === "down" || far.stage === "down" ? 3 : near.stage === "up" || far.stage === "up" ? -2 : 0);
  const weightShift = amplitude * Math.sin(renderedMotion.phase * Math.PI * 2) * 2;
  const motions: Partial<Record<DaruLayerName, { x: number; y: number; rotation: number }>> = {
    legNear: { x: near.x * amplitude, y: near.y * amplitude, rotation: near.rotation * amplitude },
    legFar: { x: far.x * amplitude, y: far.y * amplitude, rotation: far.rotation * amplitude },
    armNear: { x: -far.x * 0.18 * amplitude, y: 0, rotation: -far.rotation * 0.72 * amplitude },
    armFar: { x: -near.x * 0.18 * amplitude, y: 0, rotation: -near.rotation * 0.72 * amplitude },
  };
  const stanceFoot = near.stance ? "near" : "far";
  const stanceLocalRigX = near.stance ? near.x : far.x;
  const stanceFootLocalX = stanceLocalRigX / rigPixelsPerScreenPixel;
  const facingMultiplier = state.facing === "right" ? 1 : -1;
  const stanceFootWorldX = renderedMotion.stageX + stanceFootLocalX * facingMultiplier;
  const snapshot = useMemo<DaruGaitSnapshot>(() => ({ phase: renderedMotion.phase, nearStage: near.stage, farStage: far.stage, stageActualX: renderedMotion.stageX, stanceFoot, stanceFootLocalX, stanceFootWorldX }), [far.stage, near.stage, renderedMotion.phase, renderedMotion.stageX, stanceFoot, stanceFootLocalX, stanceFootWorldX]);
  useEffect(() => { onGaitSnapshot?.(snapshot); }, [onGaitSnapshot, snapshot]);
  if (failedTheme === theme) return null;
  return <span ref={rendererRef} className={styles.renderer} data-renderer="layered" data-rig-mode={amplitude === 0 ? "neutral" : "walk"} data-locomotion={state.locomotion} data-behavior={state.behavior} data-interaction={state.interaction} data-dragging={state.dragging || undefined} data-facing={state.facing} data-ready={readyTheme === theme || undefined} data-gait-phase={renderedMotion.phase.toFixed(3)} data-near-stage={near.stage} data-far-stage={far.stage} aria-hidden="true">
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
