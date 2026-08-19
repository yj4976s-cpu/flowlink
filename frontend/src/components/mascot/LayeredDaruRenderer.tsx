"use client";

import { useEffect, useRef } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import {
  DARU_LAYERED_LAYOUT,
  DARU_LAYERED_MOTION,
  DARU_LAYERED_SCARF,
  type DaruLayerName,
} from "./daru.layered.config";
import type { DaruRhythm } from "./types";
import styles from "./LayeredDaruRenderer.module.css";

const LAYER_ORDER: DaruLayerName[] = ["tail", "backLegFar", "backLegNear", "body", "frontLegFar", "frontLegNear", "scarf", "head"];
const WALKING = new Set(["start_walk", "walk", "stop_walk"]);

function stageX(element: HTMLElement): number {
  const value = getComputedStyle(element).translate;
  if (!value || value === "none") return 0;
  const parsed = Number.parseFloat(value.split(" ")[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function poseTransform(rotation: number, x: number, y: number) {
  return `translate3d(${x}%, ${y}%, 0) rotate(${rotation}deg)`;
}

export function LayeredDaruRenderer({ state, theme }: { state: DaruRendererState; theme: DaruRhythm }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const layerRefs = useRef<Partial<Record<DaruLayerName, HTMLSpanElement | null>>>({});
  const lastXRef = useRef<number | null>(null);
  const travelledRef = useRef(0);
  const tailRotationRef = useRef(0);
  const stopStartedRef = useRef<number | null>(null);
  const active = !state.reducedMotion && WALKING.has(state.locomotion);

  useEffect(() => {
    if (!active) {
      lastXRef.current = null;
      travelledRef.current = 0;
      stopStartedRef.current = null;
      return;
    }

    let frame = 0;
    const renderPose = (time: number) => {
      const root = rootRef.current;
      const stage = root?.closest<HTMLElement>("[data-daru-stage]");
      if (!root || !stage) return;

      const x = stageX(stage);
      if (lastXRef.current !== null) travelledRef.current += Math.abs(x - lastXRef.current);
      lastXRef.current = x;
      const phase = (travelledRef.current % DARU_LAYERED_MOTION.stridePx) / DARU_LAYERED_MOTION.stridePx;
      const angle = phase * Math.PI * 2;
      let gait = Math.sin(angle);
      let settle = 1;
      if (state.locomotion === "stop_walk") {
        stopStartedRef.current ??= time;
        settle = Math.max(0, 1 - (time - stopStartedRef.current) / 210);
        gait *= settle;
      } else {
        stopStartedRef.current = null;
      }

      const pairA = gait;
      const pairB = -gait;
      const liftA = Math.max(0, Math.sin(angle)) * DARU_LAYERED_MOTION.footLiftPct * settle;
      const liftB = Math.max(0, -Math.sin(angle)) * DARU_LAYERED_MOTION.footLiftPct * settle;
      const counterA = -pairA * DARU_LAYERED_MOTION.stanceCounterPct * settle;
      const counterB = -pairB * DARU_LAYERED_MOTION.stanceCounterPct * settle;
      const bodyWave = Math.cos(angle * 2) * settle;
      const headWave = Math.sin((phase - DARU_LAYERED_MOTION.headDelay) * Math.PI * 4) * settle;
      const tailTarget = Math.sin((phase - DARU_LAYERED_MOTION.tailDelay) * Math.PI * 2) * DARU_LAYERED_MOTION.tailSwingDeg * settle;
      tailRotationRef.current += (tailTarget - tailRotationRef.current) * DARU_LAYERED_MOTION.tailSmoothing;
      const scarfWave = Math.sin((phase - DARU_LAYERED_MOTION.scarfDelay) * Math.PI * 2) * settle;

      const set = (name: DaruLayerName, transform: string) => {
        const layer = layerRefs.current[name];
        if (layer) layer.style.transform = transform;
      };
      set("frontLegNear", poseTransform(pairA * DARU_LAYERED_MOTION.frontSwingDeg, counterA, -liftA));
      set("frontLegFar", poseTransform(pairB * DARU_LAYERED_MOTION.frontSwingDeg, counterB, -liftB));
      set("backLegFar", poseTransform(pairA * DARU_LAYERED_MOTION.backSwingDeg, counterA, -liftA));
      set("backLegNear", poseTransform(pairB * DARU_LAYERED_MOTION.backSwingDeg, counterB, -liftB));
      set("body", poseTransform(bodyWave * DARU_LAYERED_MOTION.bodyRotateDeg, 0, -Math.abs(bodyWave) * DARU_LAYERED_MOTION.bodyBobPct));
      set("head", poseTransform(headWave * DARU_LAYERED_MOTION.headRotateDeg, 0, -Math.abs(headWave) * 0.45));
      set("tail", poseTransform(tailRotationRef.current, 0, Math.abs(bodyWave) * 0.3));
      set("scarf", poseTransform(scarfWave * DARU_LAYERED_MOTION.scarfRotateDeg, -scarfWave * 0.25, Math.abs(scarfWave) * 0.18));

      frame = requestAnimationFrame(renderPose);
    };
    frame = requestAnimationFrame(renderPose);
    return () => cancelAnimationFrame(frame);
  }, [active, state.locomotion]);

  return (
    <span ref={rootRef} className={styles.renderer} data-renderer="layered" data-facing={state.facing} aria-hidden="true">
      <span className={styles.contactShadow} />
      <span className={styles.facing}>
        {LAYER_ORDER.map((name) => {
          const layout = DARU_LAYERED_LAYOUT[name];
          const src = name === "scarf" ? DARU_LAYERED_SCARF[theme] : layout.src;
          return (
            <span
              key={name}
              ref={(element) => { layerRefs.current[name] = element; }}
              className={`${styles.layer} ${styles[name]}`}
              data-daru-part={name}
              style={{ left: `${layout.left}%`, top: `${layout.top}%`, width: `${layout.width}%`, height: `${layout.height}%`, "--layer-origin": layout.origin } as React.CSSProperties}
            >
              {/* Layer sources are changed only by theme, while motion is updated imperatively on the wrapper. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" draggable={false} />
            </span>
          );
        })}
      </span>
    </span>
  );
}
