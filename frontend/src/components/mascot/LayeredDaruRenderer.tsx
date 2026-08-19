"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import { DARU_LAYERED_LAYOUT, DARU_LAYERED_MOTION, type DaruLayerName } from "./daru.layered.config";
import { DARU_GROUNDED_ROAMING_CONFIG } from "./daru.renderer.config";
import type { DaruRhythm } from "./types";
import styles from "./LayeredDaruRenderer.module.css";

const LAYER_ORDER: DaruLayerName[] = ["tail", "armFar", "legFar", "base", "legNear", "armNear"];
const WALKING = new Set(["start_walk", "walk", "stop_walk", "turn"]);

export interface DaruGaitSnapshot {
  phase: number;
  nearStage: "contact" | "down" | "passing" | "up";
  farStage: "contact" | "down" | "passing" | "up";
  stanceFoot: "near" | "far";
  nearX: number;
  farX: number;
  amplitude: number;
}

function stageX(element: HTMLElement): number {
  const value = getComputedStyle(element).translate;
  if (!value || value === "none") return element.getBoundingClientRect().left;
  const parsed = Number.parseFloat(value.split(" ")[0]);
  return Number.isFinite(parsed) ? parsed : element.getBoundingClientRect().left;
}

function smoothstep(value: number) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function gaitStage(phase: number): DaruGaitSnapshot["nearStage"] {
  if (phase < 0.08 || phase >= 0.92) return "contact";
  if (phase < 0.25) return "down";
  if (phase >= 0.62 && phase < 0.88) return "passing";
  return "up";
}

function sampleLeg(phase: number, stride: number) {
  const p = (phase + 1) % 1;
  const legTravel = stride / 2;
  const halfLegTravel = legTravel / 2;

  if (p < 0.5) {
    const stance = p / 0.5;
    return {
      x: halfLegTravel - legTravel * stance,
      y: 0,
      rotation: DARU_LAYERED_MOTION.legRotationDeg - DARU_LAYERED_MOTION.legRotationDeg * 2 * smoothstep(stance),
      stage: gaitStage(p),
      stance: true,
    };
  }

  const swing = (p - 0.5) / 0.5;
  const lift = Math.sin(Math.PI * swing);
  return {
    x: -halfLegTravel + legTravel * smoothstep(swing),
    y: -DARU_LAYERED_MOTION.footLiftPx * lift,
    rotation: -DARU_LAYERED_MOTION.legRotationDeg + DARU_LAYERED_MOTION.legRotationDeg * 2 * smoothstep(swing),
    stage: gaitStage(p),
    stance: false,
  };
}

function poseTransform(rotation: number, x: number, y: number) {
  return `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg)`;
}

export function LayeredDaruRenderer({
  state,
  theme,
  cycleMs = DARU_LAYERED_MOTION.cycleMs,
  phaseOverride,
  onGaitSnapshot,
}: {
  state: DaruRendererState;
  theme: DaruRhythm;
  cycleMs?: number;
  phaseOverride?: number;
  onGaitSnapshot?: (snapshot: DaruGaitSnapshot) => void;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const lastXRef = useRef<number | null>(null);
  const motionRef = useRef({ phase: 0, amplitude: 0 });
  const [motion, setMotion] = useState({ phase: 0, amplitude: 0 });
  const active = !state.reducedMotion && WALKING.has(state.locomotion);

  useEffect(() => {
    if (phaseOverride !== undefined) {
      lastXRef.current = null;
      return;
    }

    let frame = 0;
    const renderPose = () => {
      const root = rootRef.current;
      const stage = root?.closest<HTMLElement>("[data-daru-stage]");
      const previous = motionRef.current;
      let phase = previous.phase;

      if (active && stage) {
        const x = stageX(stage);
        if (lastXRef.current !== null) {
          const travelled = Math.abs(x - lastXRef.current);
          if (travelled > 0.001) phase = (phase + travelled / DARU_LAYERED_MOTION.stridePx) % 1;
          else if (state.locomotion === "walk") phase = (phase + 16.67 / cycleMs) % 1;
        }
        lastXRef.current = x;
      } else {
        lastXRef.current = null;
      }

      const targetAmplitude = state.locomotion === "walk" ? 1 : state.locomotion === "start_walk" ? 0.72 : 0;
      const blendMs =
        state.locomotion === "stop_walk" || state.locomotion === "turn"
          ? DARU_GROUNDED_ROAMING_CONFIG.stopWalkMs
          : DARU_GROUNDED_ROAMING_CONFIG.startWalkMs;
      const nextAmplitude = previous.amplitude + (targetAmplitude - previous.amplitude) * Math.min(1, (16.67 / blendMs) * 3.2);
      const next = { phase, amplitude: nextAmplitude < 0.002 ? 0 : nextAmplitude };
      motionRef.current = next;
      setMotion(next);
      frame = requestAnimationFrame(renderPose);
    };

    frame = requestAnimationFrame(renderPose);
    return () => cancelAnimationFrame(frame);
  }, [active, cycleMs, phaseOverride, state.locomotion]);

  const renderedPhase = phaseOverride === undefined ? motion.phase : (phaseOverride + 1) % 1;
  const amplitude = state.reducedMotion ? 0 : phaseOverride === undefined ? motion.amplitude : 1;
  const near = sampleLeg(renderedPhase, DARU_LAYERED_MOTION.stridePx);
  const far = sampleLeg(renderedPhase + 0.5, DARU_LAYERED_MOTION.stridePx);
  const bodyWave = Math.sin(renderedPhase * Math.PI * 2) * amplitude;
  const bodyBob = Math.sin(renderedPhase * Math.PI * 4) * DARU_LAYERED_MOTION.bodyBobPx * amplitude;
  const tailWave = Math.sin((renderedPhase - DARU_LAYERED_MOTION.tailDelay) * Math.PI * 2) * amplitude;
  const armNearRotation = -near.rotation * (DARU_LAYERED_MOTION.armSwingDeg / DARU_LAYERED_MOTION.legRotationDeg) * amplitude;
  const armFarRotation = -far.rotation * (DARU_LAYERED_MOTION.armSwingDeg / DARU_LAYERED_MOTION.legRotationDeg) * amplitude;

  const transforms: Partial<Record<DaruLayerName, string>> = {
    tail: poseTransform(tailWave * DARU_LAYERED_MOTION.tailSwingDeg, 0, bodyBob * 0.55),
    armFar: poseTransform(armFarRotation, 0, bodyBob),
    legFar: poseTransform(far.rotation * amplitude, far.x * amplitude, far.y * amplitude),
    base: poseTransform(bodyWave * DARU_LAYERED_MOTION.bodyRotateDeg, 0, bodyBob),
    legNear: poseTransform(near.rotation * amplitude, near.x * amplitude, near.y * amplitude),
    armNear: poseTransform(armNearRotation, 0, bodyBob),
  };

  const snapshot = useMemo<DaruGaitSnapshot>(
    () => ({
      phase: renderedPhase,
      nearStage: near.stage,
      farStage: far.stage,
      stanceFoot: near.stance ? "near" : "far",
      nearX: near.x,
      farX: far.x,
      amplitude,
    }),
    [amplitude, far.stage, far.x, near.stage, near.stance, near.x, renderedPhase],
  );

  useEffect(() => {
    onGaitSnapshot?.(snapshot);
  }, [onGaitSnapshot, snapshot]);

  return (
    <span
      ref={rootRef}
      className={styles.renderer}
      data-renderer="registered-rig-v2"
      data-rig-theme={theme}
      data-facing={state.facing}
      data-locomotion={state.locomotion}
      data-gait-phase={renderedPhase.toFixed(3)}
      aria-hidden="true"
    >
      <span className={styles.contactShadow} />
      <span className={styles.facing}>
        {LAYER_ORDER.map((name) => {
          const layout = DARU_LAYERED_LAYOUT[name];
          return (
            <span
              key={name}
              className={`${styles.layer} ${styles[name]}`}
              data-daru-part={name}
              style={
                {
                  left: `${layout.left}%`,
                  top: `${layout.top}%`,
                  width: `${layout.width}%`,
                  height: `${layout.height}%`,
                  "--layer-origin": layout.origin,
                  transform: transforms[name],
                } as React.CSSProperties
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={layout.src} alt="" draggable={false} />
            </span>
          );
        })}
      </span>
    </span>
  );
}
