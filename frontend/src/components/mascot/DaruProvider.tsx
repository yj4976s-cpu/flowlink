"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DARU_ACTION_DURATION, DARU_ACTION_PRIORITY, DARU_MODE_STORAGE_KEY } from "./config";
import type { DaruAction, DaruCueOptions, DaruMode } from "./types";

interface DaruContextValue {
  action: DaruAction;
  message: string | null;
  mode: DaruMode;
  reducedMotion: boolean;
  occluded: boolean;
  cue: (action: DaruAction, options?: DaruCueOptions) => void;
  setMode: (mode: DaruMode) => void;
}

const DaruContext = createContext<DaruContextValue | null>(null);

function isDaruMode(value: string | null): value is DaruMode {
  return value === "active" || value === "quiet" || value === "hidden";
}

export function DaruProvider({ children }: { children: React.ReactNode }) {
  const [action, setAction] = useState<DaruAction>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setModeState] = useState<DaruMode>("active");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [occluded, setOccluded] = useState(false);
  const priorityRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const cueGenerationRef = useRef(0);

  const clearCueTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const cue = useCallback((nextAction: DaruAction, options: DaruCueOptions = {}) => {
    const source = options.source ?? "direct";
    const nextPriority = DARU_ACTION_PRIORITY[source];
    if (nextPriority < priorityRef.current) return;
    clearCueTimer();
    const generation = ++cueGenerationRef.current;
    priorityRef.current = nextPriority;
    setAction(nextAction);
    setMessage(options.message ?? null);
    const duration = options.duration ?? DARU_ACTION_DURATION[nextAction];
    if (duration > 0) {
      timerRef.current = window.setTimeout(() => {
        if (cueGenerationRef.current !== generation) return;
        priorityRef.current = 0;
        setAction("idle");
        setMessage(null);
        timerRef.current = null;
      }, duration);
    }
  }, [clearCueTimer]);

  const setMode = useCallback((nextMode: DaruMode) => {
    setModeState(nextMode);
    localStorage.setItem(DARU_MODE_STORAGE_KEY, nextMode);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(media.matches);
    const syncInitialState = window.setTimeout(() => {
      syncMotion();
      const stored = localStorage.getItem(DARU_MODE_STORAGE_KEY);
      setModeState(isDaruMode(stored) ? stored : "active");
    }, 0);
    media.addEventListener("change", syncMotion);
    return () => {
      window.clearTimeout(syncInitialState);
      media.removeEventListener("change", syncMotion);
    };
  }, []);

  useEffect(() => {
    const handleOcclusion = (event: Event) => {
      setOccluded(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open));
    };
    window.addEventListener("flowlink:daru-occlusion", handleOcclusion);
    return () => window.removeEventListener("flowlink:daru-occlusion", handleOcclusion);
  }, []);

  useEffect(() => () => clearCueTimer(), [clearCueTimer]);

  const value = useMemo(() => ({ action, message, mode, reducedMotion, occluded, cue, setMode }), [action, cue, message, mode, occluded, reducedMotion, setMode]);
  return <DaruContext.Provider value={value}>{children}</DaruContext.Provider>;
}

export function useDaru() {
  const context = useContext(DaruContext);
  if (!context) throw new Error("useDaru must be used within DaruProvider");
  return context;
}
