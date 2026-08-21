export type DaruFacing = "left" | "right";

export const DARU_RIVE_CONFIG = {
  assetPath: null as string | null,
  artboard: "Daru",
  stateMachine: "DaruStateMachine",
  inputs: {
    speed: "speed", lookX: "lookX", lookY: "lookY", tailEnergy: "tailEnergy",
    isDragging: "isDragging", reducedMotion: "reducedMotion",
    turn: "turn", land: "land", hover: "hover", click: "click",
    groom: "groom", sniff: "sniff", happy: "happy", match: "match", alert: "alert", scan: "scan", rest: "rest",
  },
  requiredParts: ["DaruRoot", "Body", "Head", "FrontLegLeft", "FrontLegRight", "BackLegLeft", "BackLegRight", "TailRoot", "TailMid", "TailTip", "Scarf"],
} as const;

// Screen-space movement values stay independent from the renderer so a future
// Rive WALK cycle can derive its playback rate from speed / stridePx.
const DARU_WALK_STRIDE_PX = 54;
const DARU_NORMAL_WALK_CYCLE_MS = 1200;
const DARU_MOBILE_SPEED_RATIO = 58 / 78;
const DARU_NORMAL_WALK_SPEED = DARU_WALK_STRIDE_PX / (DARU_NORMAL_WALK_CYCLE_MS / 1000);

export const DARU_GROUNDED_ROAMING_CONFIG = {
  desktopSpeed: DARU_NORMAL_WALK_SPEED,
  mobileSpeed: DARU_NORMAL_WALK_SPEED * DARU_MOBILE_SPEED_RATIO,
  desktopGroundInset: 24,
  mobileGroundInset: 14,
  desktopMinTravelDistance: 120,
  mobileMinTravelDistance: 76,
  stridePx: DARU_WALK_STRIDE_PX,
  normalCycleMs: DARU_NORMAL_WALK_CYCLE_MS,
  startWalkMs: 170,
  arrivalSlackMs: 80,
  stopWalkMs: 220,
} as const;

export const DARU_ROAMING_PAUSED_STORAGE_KEY = "flowlink:daru-roaming-paused";
