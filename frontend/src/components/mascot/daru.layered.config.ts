import type { DaruRhythm } from "./types";

export const DARU_RIG_SPACE = { width: 1254, height: 1254, groundY: 1100 } as const;
export type DaruLayerName = "armFar" | "legFar" | "body" | "legNear" | "armNear" | "scarf";
export interface DaruRigLayer { src: string; sourceWidth: number; sourceHeight: number; x: number; y: number; scale: number; pivotX?: number; pivotY?: number; alphaBounds: readonly [number, number, number, number]; }

export const DARU_LAYERED_SCARF: Record<DaruRhythm, string> = {
  dawn: "/mascot/layered/scarf-dawn.png", day: "/mascot/layered/scarf-day.png", night: "/mascot/layered/scarf-night.png",
};

// All registration values use the shared 1254 x 1254 rig coordinate system.
// Limb pivots are source-image pixel coordinates; x/y place the source image in neutral pose.
export const DARU_LAYERED_LAYOUT: Record<DaruLayerName, DaruRigLayer> = {
  armFar: { src: "/mascot/layered/daru-arm-far.png", sourceWidth: 1254, sourceHeight: 1254, x: 420, y: 400, scale: 0.34, pivotX: 190, pivotY: 235, alphaBounds: [96, 21, 1196, 1212] },
  legFar: { src: "/mascot/layered/daru-leg-far.png", sourceWidth: 1254, sourceHeight: 1254, x: 150, y: 700, scale: 0.34, pivotX: 640, pivotY: 110, alphaBounds: [96, 21, 1210, 1254] },
  body: { src: "/mascot/layered/daru-body-base.png", sourceWidth: 1388, sourceHeight: 1133, x: 58, y: 54, scale: 0.82, alphaBounds: [51, 11, 1326, 1133] },
  legNear: { src: "/mascot/layered/daru-leg-near.png", sourceWidth: 1254, sourceHeight: 1254, x: 740, y: 728, scale: 0.33, pivotX: 570, pivotY: 110, alphaBounds: [0, 17, 1230, 1254] },
  armNear: { src: "/mascot/layered/daru-arm-near.png", sourceWidth: 1254, sourceHeight: 1254, x: 760, y: 394, scale: 0.39, pivotX: 225, pivotY: 230, alphaBounds: [0, 21, 1242, 1214] },
  scarf: { src: DARU_LAYERED_SCARF.day, sourceWidth: 1448, sourceHeight: 1086, x: 620, y: 410, scale: 0.32, alphaBounds: [39, 7, 1438, 1029] },
};

export const DARU_LAYER_ORDER: readonly DaruLayerName[] = ["armFar", "legFar", "body", "legNear", "armNear", "scarf"];
export const DARU_LAYERED_ASSETS = Object.entries(DARU_LAYERED_LAYOUT)
  .filter(([name]) => name !== "scarf")
  .map(([, layer]) => layer.src);
