"use client";
/* eslint-disable @next/next/no-img-element -- transparent rig layers must preserve their exact source geometry */

import { useEffect, useState } from "react";
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

function StaticLayer({ name, layer, src }: { name: DaruLayerName; layer: DaruRigLayer; src: string }) {
  const jointX = layer.pivotX === undefined ? undefined : layer.x + layer.pivotX * layer.scale;
  const jointY = layer.pivotY === undefined ? undefined : layer.y + layer.pivotY * layer.scale;
  const transformOrigin = layer.pivotX === undefined ? undefined : `${(layer.pivotX / layer.sourceWidth) * 100}% ${(layer.pivotY! / layer.sourceHeight) * 100}%`;
  return <span className={`${styles.layer} ${styles[name]}`} data-daru-part={name} data-joint-x={jointX} data-joint-y={jointY}
    style={{ left: percent(layer.x, "x"), top: percent(layer.y, "y"), transformOrigin, ...layerSize(layer) }}>
    <img src={src} alt="" draggable={false} />
  </span>;
}

export function LayeredDaruRenderer({ state, theme, onAssetError }: { state: DaruRendererState; theme: DaruRhythm; onAssetError?: () => void }) {
  const [readyTheme, setReadyTheme] = useState<DaruRhythm | null>(null);
  const [failedTheme, setFailedTheme] = useState<DaruRhythm | null>(null);
  useEffect(() => {
    let current = true;
    preloadDaruLayeredAssets(theme).then(() => { if (current) { setReadyTheme(theme); setFailedTheme(null); } }).catch(() => { if (current) { setFailedTheme(theme); onAssetError?.(); } });
    return () => { current = false; };
  }, [onAssetError, theme]);
  if (failedTheme === theme) return null;
  return <span className={styles.renderer} data-renderer="layered" data-rig-mode="neutral" data-locomotion={state.locomotion} data-facing={state.facing} data-ready={readyTheme === theme || undefined} aria-hidden="true">
    <span className={styles.contactShadow} />
    <span className={styles.facing}>
      {DARU_LAYER_ORDER.map((name) => {
        const layer = DARU_LAYERED_LAYOUT[name];
        const src = name === "scarf" ? DARU_LAYERED_SCARF[theme] : layer.src;
        return <StaticLayer key={name} name={name} layer={layer} src={src} />;
      })}
    </span>
  </span>;
}
