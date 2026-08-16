"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { DARU_RIVE_CONFIG } from "./daru.renderer.config";
import type { DaruRendererState } from "./daru.animation.adapter";
import { StaticDaruFallback } from "./NaturalDaruRenderer";
import { DaruSpriteRenderer, preloadDaruWalkFrames } from "./DaruSpriteRenderer";
import type { DaruRhythm } from "./types";

const RiveDaruRenderer = dynamic(() => import("./RiveDaruRenderer").then((module) => module.RiveDaruRenderer), { ssr: false });

export function DaruCharacter({ state }: { state: DaruRendererState }) {
  const [riveFailed, setRiveFailed] = useState(false);
  const [theme, setTheme] = useState<DaruRhythm>("day");

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      const value = root.dataset.theme;
      setTheme(value === "dawn" || value === "night" ? value : "day");
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    void preloadDaruWalkFrames(theme);
  }, [theme]);

  const walking = state.locomotion === "start_walk" || state.locomotion === "walk";
  if (walking && !state.reducedMotion) return <DaruSpriteRenderer state={state} theme={theme} />;
  if (!DARU_RIVE_CONFIG.assetPath || riveFailed) return <StaticDaruFallback state={state} />;
  return <RiveDaruRenderer state={state} onFallback={() => setRiveFailed(true)} />;
}
