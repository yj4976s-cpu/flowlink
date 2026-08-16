import type { DaruIdleAction, DaruRhythm } from "./types";

export const DARU_IDLE_DELAY = { dawn: [14000, 26000], day: [19000, 34000], night: [12000, 24000] } satisfies Record<DaruRhythm, readonly [number, number]>;
export const DARU_IDLE_WEIGHTS = {
  dawn: { rest: 38, alert: 8, sniff: 8, listen: 10, groom: 16, float: 8, stretch: 12 },
  day: { rest: 48, alert: 8, sniff: 5, listen: 15, groom: 12, float: 9, stretch: 3 },
  night: { rest: 30, alert: 18, sniff: 17, listen: 16, groom: 5, float: 8, stretch: 6 },
} satisfies Record<DaruRhythm, Record<DaruIdleAction, number>>;
export const DARU_ADMIN_IDLE_MULTIPLIER = 1.7;
export const DARU_MOBILE_IDLE_MULTIPLIER = 1.45;

export function pickNaturalIdle(rhythm: DaruRhythm, previous: DaruIdleAction | null): DaruIdleAction {
  const entries = Object.entries(DARU_IDLE_WEIGHTS[rhythm]) as [DaruIdleAction, number][];
  const candidates = entries.filter(([action]) => action !== previous);
  const total = candidates.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = Math.random() * total;
  for (const [action, weight] of candidates) { cursor -= weight; if (cursor <= 0) return action; }
  return candidates[0][0];
}
