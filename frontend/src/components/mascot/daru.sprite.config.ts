import { DARU_GROUNDED_ROAMING_CONFIG } from "./daru.renderer.config";

const DAY_WALK_FRAME_COUNT = 8;

function walkFramesFor(theme: "dawn" | "day" | "night") {
  return Array.from(
    { length: DAY_WALK_FRAME_COUNT },
    (_, index) => `/mascot/sprites/${theme}/walk/walk-${String(index + 1).padStart(2, "0")}.png`,
  );
}

export const DARU_SPRITE_CONFIG = {
  dawn: { walkFrames: walkFramesFor("dawn") },
  day: { walkFrames: walkFramesFor("day") },
  night: { walkFrames: walkFramesFor("night") },
  stridePx: DARU_GROUNDED_ROAMING_CONFIG.stridePx,
  baselineFps:
    (DARU_GROUNDED_ROAMING_CONFIG.desktopSpeed / DARU_GROUNDED_ROAMING_CONFIG.stridePx) *
    DAY_WALK_FRAME_COUNT,
} as const;
