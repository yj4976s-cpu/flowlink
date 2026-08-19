import { DARU_GROUNDED_ROAMING_CONFIG, type DaruFacing } from "./daru.renderer.config";
import type { DaruRhythm } from "./types";

export type DaruLayerName =
  | "tail"
  | "backLegFar"
  | "backLegNear"
  | "body"
  | "frontLegFar"
  | "frontLegNear"
  | "scarf"
  | "head";

export interface DaruLayerLayout {
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  origin: string;
}

export const DARU_LAYERED_SCARF: Record<DaruRhythm, string> = {
  dawn: "/mascot/layered/scarf-dawn.png",
  day: "/mascot/layered/scarf-day.png",
  night: "/mascot/layered/scarf-night.png",
};

export const DARU_LAYERED_LAYOUT: Record<DaruLayerName, DaruLayerLayout> = {
  tail: { src: "/mascot/layered/tail.png", left: -14, top: 48, width: 61, height: 39, origin: "82% 48%" },
  backLegFar: { src: "/mascot/layered/back-leg-far.png", left: 51, top: 53, width: 29, height: 49, origin: "52% 14%" },
  backLegNear: { src: "/mascot/layered/back-leg-near.png", left: 18, top: 53, width: 31, height: 49, origin: "50% 14%" },
  body: { src: "/mascot/layered/body-torso-only.png", left: 17, top: 27, width: 67, height: 70, origin: "50% 72%" },
  frontLegFar: { src: "/mascot/layered/front-leg-far.png", left: 59, top: 35, width: 25, height: 48, origin: "50% 12%" },
  frontLegNear: { src: "/mascot/layered/front-leg-near.png", left: 14, top: 35, width: 27, height: 49, origin: "50% 12%" },
  scarf: { src: DARU_LAYERED_SCARF.day, left: 12, top: 29, width: 77, height: 39, origin: "50% 20%" },
  head: { src: "/mascot/layered/head-walk-3q.png", left: 4, top: -1, width: 92, height: 64, origin: "50% 78%" },
};

export const DARU_LAYERED_MOTION = {
  stridePx: DARU_GROUNDED_ROAMING_CONFIG.stridePx,
  frontSwingDeg: 11,
  backSwingDeg: 13,
  footLiftPct: 2.2,
  stanceCounterPct: 1.4,
  bodyBobPct: 1.25,
  bodyRotateDeg: 0.8,
  headDelay: 0.055,
  headRotateDeg: 0.55,
  tailDelay: 0.13,
  tailSwingDeg: 7,
  tailSmoothing: 0.13,
  scarfDelay: 0.08,
  scarfRotateDeg: 0.7,
} as const;

export function facingSign(facing: DaruFacing) {
  return facing === "left" ? -1 : 1;
}
