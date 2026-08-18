"use client";

import { useCallback, useState } from "react";
import type { DaruRendererState } from "./daru.animation.adapter";
import { StaticDaruFallback } from "./NaturalDaruRenderer";
import { LayeredDaruRenderer } from "./LayeredDaruRenderer";
import { useTheme } from "../theme/ThemeProvider";

export function DaruCharacter({ state }: { state: DaruRendererState }) {
  const { theme } = useTheme();
  const [failedTheme, setFailedTheme] = useState<typeof theme | null>(null);
  const handleAssetError = useCallback(() => setFailedTheme(theme), [theme]);
  if (state.reducedMotion || failedTheme === theme) return <StaticDaruFallback state={state} theme={theme} />;
  return <LayeredDaruRenderer state={state} theme={theme} onAssetError={handleAssetError} />;
}
