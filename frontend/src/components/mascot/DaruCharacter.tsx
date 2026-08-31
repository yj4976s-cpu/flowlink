"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { DARU_RIVE_CONFIG } from "./daru.renderer.config";
import type { DaruRendererState } from "./daru.animation.adapter";
import type { DaruAction } from "./types";
import { StaticDaruFallback } from "./NaturalDaruRenderer";
import { DaruSpriteRenderer, preloadDaruWalkFrames } from "./DaruSpriteRenderer";
import { useTheme } from "../theme/ThemeProvider";

const RiveDaruRenderer = dynamic(() => import("./RiveDaruRenderer").then((module) => module.RiveDaruRenderer), { ssr: false });

export function DaruCharacter({ state, action }: { state: DaruRendererState; action: DaruAction }) {
  const [riveFailed, setRiveFailed] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    void preloadDaruWalkFrames(theme);
  }, [theme]);

  const spriteVisible = state.locomotion === "start_walk" || state.locomotion === "walk" || state.locomotion === "stop_walk";
  if (spriteVisible && !state.reducedMotion) return <DaruSpriteRenderer state={state} theme={theme} />;
  if (!DARU_RIVE_CONFIG.assetPath || riveFailed) return <StaticDaruFallback state={state} theme={theme} action={action} />;
  return <RiveDaruRenderer state={state} onFallback={() => setRiveFailed(true)} />;
}
