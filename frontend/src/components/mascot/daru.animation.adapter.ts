import type { DaruAction } from "./types";
import type { DaruFacing } from "./daru.renderer.config";

export type DaruLocomotion = "idle" | "start_walk" | "walk" | "stop_walk" | "turn" | "drag" | "land";
export type DaruBehavior = "normal" | "look" | "sniff" | "groom" | "alert" | "happy" | "match" | "scan" | "rest";
export type DaruInteraction = "none" | "hover" | "click";

export interface DaruRendererState {
  locomotion: DaruLocomotion;
  behavior: DaruBehavior;
  interaction: DaruInteraction;
  facing: DaruFacing;
  movementSpeed: number;
  dragging: boolean;
  reducedMotion: boolean;
  lookX: number;
  lookY: number;
  tailEnergy: number;
}

const BEHAVIOR_BY_ACTION: Record<DaruAction, DaruBehavior> = {
  idle: "normal",
  rest: "rest",
  alert: "alert",
  listen: "alert",
  think: "rest",
  sniff: "sniff",
  groom: "groom",
  float: "rest",
  stretch: "normal",
  wave: "happy",
  look: "look",
  scan: "scan",
  found: "happy",
  happy: "happy",
  match: "match",
};

export function behaviorForAction(action: DaruAction): DaruBehavior {
  return BEHAVIOR_BY_ACTION[action];
}

export function normalizedMovementSpeed(speedPxPerSecond: number, baselinePxPerSecond: number): number {
  if (baselinePxPerSecond <= 0) return 0;
  return Math.min(1.6, Math.max(0, speedPxPerSecond / baselinePxPerSecond));
}

export function tailEnergyFor(behavior: DaruBehavior, movementSpeed: number, dragging: boolean): number {
  if (dragging) return 0.9;
  if (behavior === "alert" || behavior === "scan") return 0.12;
  if (behavior === "happy" || behavior === "match") return Math.min(1, 0.58 + movementSpeed * 0.22);
  return Math.min(0.72, 0.18 + movementSpeed * 0.34);
}
