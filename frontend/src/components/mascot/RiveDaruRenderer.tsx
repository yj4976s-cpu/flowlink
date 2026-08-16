"use client";

import { useEffect, useRef } from "react";
import { Alignment, Fit, Layout, StateMachineInputType, useRive } from "@rive-app/react-canvas";
import { DARU_RIVE_CONFIG } from "./daru.renderer.config";
import type { DaruBehavior, DaruLocomotion, DaruRendererState } from "./daru.animation.adapter";
import styles from "./DaruMascot.module.css";

const BEHAVIOR_TRIGGERS: Partial<Record<DaruBehavior, keyof typeof DARU_RIVE_CONFIG.inputs>> = {
  groom: "groom", sniff: "sniff", alert: "alert", happy: "happy", match: "match", scan: "scan", rest: "rest",
};
const LOCOMOTION_TRIGGERS: Partial<Record<DaruLocomotion, keyof typeof DARU_RIVE_CONFIG.inputs>> = { turn: "turn", land: "land" };

export function RiveDaruRenderer({ state, onFallback }: { state: DaruRendererState; onFallback: () => void }) {
  const previousBehavior = useRef<DaruBehavior>("normal");
  const previousLocomotion = useRef<DaruLocomotion>("idle");
  const previousInteraction = useRef(state.interaction);
  const { rive, RiveComponent } = useRive({
    src: DARU_RIVE_CONFIG.assetPath!,
    artboard: DARU_RIVE_CONFIG.artboard,
    stateMachines: DARU_RIVE_CONFIG.stateMachine,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.BottomCenter }),
    onLoadError: onFallback,
  }, { shouldUseIntersectionObserver: true });

  useEffect(() => {
    if (!rive) return;
    const inputs = new Map(rive.stateMachineInputs(DARU_RIVE_CONFIG.stateMachine).map((input) => [input.name, input]));
    const setValue = (name: string, value: number | boolean) => {
      const input = inputs.get(name);
      if (input && input.type !== StateMachineInputType.Trigger) input.value = value;
    };
    const fire = (key: keyof typeof DARU_RIVE_CONFIG.inputs | undefined) => {
      if (!key) return;
      const input = inputs.get(DARU_RIVE_CONFIG.inputs[key]);
      if (input?.type === StateMachineInputType.Trigger) input.fire();
    };

    setValue(DARU_RIVE_CONFIG.inputs.speed, state.reducedMotion ? 0 : state.movementSpeed);
    setValue(DARU_RIVE_CONFIG.inputs.lookX, state.lookX);
    setValue(DARU_RIVE_CONFIG.inputs.lookY, state.lookY);
    setValue(DARU_RIVE_CONFIG.inputs.tailEnergy, state.reducedMotion ? 0 : state.tailEnergy);
    setValue(DARU_RIVE_CONFIG.inputs.isDragging, state.dragging);
    setValue(DARU_RIVE_CONFIG.inputs.reducedMotion, state.reducedMotion);

    if (state.behavior !== previousBehavior.current) fire(BEHAVIOR_TRIGGERS[state.behavior]);
    if (state.locomotion !== previousLocomotion.current) fire(LOCOMOTION_TRIGGERS[state.locomotion]);
    if (state.interaction !== previousInteraction.current && state.interaction !== "none") fire(state.interaction);
    previousBehavior.current = state.behavior;
    previousLocomotion.current = state.locomotion;
    previousInteraction.current = state.interaction;
  }, [rive, state]);

  useEffect(() => {
    if (!rive) return;
    const syncVisibility = () => { if (document.hidden) rive.pause(); else rive.play(); };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, [rive]);

  return <span className={styles.renderer} data-renderer="rive" data-facing={state.facing} aria-hidden="true"><RiveComponent className={styles.riveCanvas} /></span>;
}
