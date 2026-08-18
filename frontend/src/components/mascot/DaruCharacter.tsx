"use client";

import { useCallback, useState } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import { StaticDaruFallback } from "./NaturalDaruRenderer";
import { LayeredDaruRenderer } from "./LayeredDaruRenderer";
import { useTheme } from "../theme/ThemeProvider";
import styles from "./LayeredDaruRenderer.module.css";

export function DaruCharacter({ state }: { state: DaruRendererState }) {
  const { theme } = useTheme();
  const [failedTheme, setFailedTheme] = useState<typeof theme | null>(null);
  const [readyTheme, setReadyTheme] = useState<typeof theme | null>(null);
  const handleAssetError = useCallback(() => setFailedTheme(theme), [theme]);
  const handleReady = useCallback(() => setReadyTheme(theme), [theme]);
  if (state.reducedMotion || failedTheme === theme) return <StaticDaruFallback state={state} theme={theme} />;
  return <span className={styles.characterStack} data-ready={readyTheme === theme || undefined}>
    <span className={styles.fallbackSlot}><StaticDaruFallback state={state} theme={theme} /></span>
    <span className={styles.layeredSlot}><LayeredDaruRenderer state={state} theme={theme} onAssetError={handleAssetError} onReady={handleReady} /></span>
  </span>;
}
