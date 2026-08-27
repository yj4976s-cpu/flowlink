export interface DaruMobileRoamBoundsInput {
  viewportWidth: number;
  stageWidth: number;
  margin: number;
  configuredMinTravelDistance: number;
}

export interface DaruMobileRoamBounds {
  minLeft: number;
  maxLeft: number;
  availableDistance: number;
  minTravelDistance: number;
}

export function clampValue(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

export function resolveMobileRoamBounds({
  viewportWidth,
  stageWidth,
  margin,
  configuredMinTravelDistance,
}: DaruMobileRoamBoundsInput): DaruMobileRoamBounds {
  const safeMargin = Math.max(0, margin);
  const minLeft = safeMargin;
  const maxLeft = Math.max(minLeft, viewportWidth - stageWidth - safeMargin);
  const availableDistance = Math.max(0, maxLeft - minLeft);
  const dynamicMinimum = Math.max(24, availableDistance * 0.45);
  return {
    minLeft,
    maxLeft,
    availableDistance,
    minTravelDistance: Math.min(configuredMinTravelDistance, dynamicMinimum, Math.max(0, availableDistance)),
  };
}

export function mobileDestinationCandidates(bounds: DaruMobileRoamBounds, currentLeft: number) {
  const { minLeft, maxLeft, availableDistance, minTravelDistance } = bounds;
  const center = minLeft + availableDistance / 2;
  const thirds = [minLeft + availableDistance * 0.25, minLeft + availableDistance * 0.75];
  const candidates = [minLeft, maxLeft, center, ...thirds]
    .map((left) => clampValue(left, minLeft, maxLeft))
    .filter((left, index, values) => values.findIndex((value) => Math.abs(value - left) < 1) === index)
    .filter((left) => Math.abs(left - currentLeft) >= minTravelDistance);
  return candidates.sort((leftA, leftB) => Math.abs(leftB - currentLeft) - Math.abs(leftA - currentLeft));
}
