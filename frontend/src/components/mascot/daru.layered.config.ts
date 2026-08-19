import { DARU_GROUNDED_ROAMING_CONFIG, type DaruFacing } from "./daru.renderer.config";

export type DaruLayerName = "tail" | "armFar" | "legFar" | "base" | "legNear" | "armNear";

export interface DaruLayerPivot {
  x: number;
  y: number;
}

export interface DaruLayerLayout {
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  pivot: DaruLayerPivot;
  origin: string;
}

const RIG_CANVAS_SIZE = 1254;

function originFromPivot({ x, y }: DaruLayerPivot) {
  return `${(x / RIG_CANVAS_SIZE) * 100}% ${(y / RIG_CANVAS_SIZE) * 100}%`;
}

function rigLayer(src: string, pivot: DaruLayerPivot): DaruLayerLayout {
  return {
    src,
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    pivot,
    origin: originFromPivot(pivot),
  };
}

export const DARU_RIG_SOURCE_IMAGE = "/mascot/sprites/day/walk/walk-01.png";
export const DARU_RIG_CANVAS_SIZE = RIG_CANVAS_SIZE;

export const DARU_LAYERED_LAYOUT: Record<DaruLayerName, DaruLayerLayout> = {
  tail: rigLayer("/mascot/rig-v2/daru-rig-tail-day.png", { x: 485, y: 780 }),
  armFar: rigLayer("/mascot/rig-v2/daru-rig-arm-far-day.png", { x: 520, y: 575 }),
  legFar: rigLayer("/mascot/rig-v2/daru-rig-leg-far-day.png", { x: 798, y: 850 }),
  base: rigLayer("/mascot/rig-v2/daru-rig-base-day.png", { x: 627, y: 735 }),
  legNear: rigLayer("/mascot/rig-v2/daru-rig-leg-near-day.png", { x: 476, y: 920 }),
  armNear: rigLayer("/mascot/rig-v2/daru-rig-arm-near-day.png", { x: 955, y: 665 }),
};

export const DARU_LAYERED_MOTION = {
  stridePx: DARU_GROUNDED_ROAMING_CONFIG.stridePx,
  cycleMs: 780,
  legRotationDeg: 9,
  footLiftPx: 22,
  armSwingDeg: 4.5,
  bodyBobPx: 7,
  bodyRotateDeg: 0.5,
  tailSwingDeg: 2.6,
  tailDelay: 0.13,
  tailSmoothing: 0.13,
} as const;

export function facingSign(facing: DaruFacing) {
  return facing === "left" ? -1 : 1;
}
