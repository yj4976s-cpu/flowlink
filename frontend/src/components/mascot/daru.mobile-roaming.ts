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

export interface DaruDirectGreetingState {
  mode: "active" | "quiet" | "hidden";
  guideOpen: boolean;
  occluded: boolean;
  dragging: boolean;
  pageVisible: boolean;
}

export interface DaruMobileBubbleAnchorInput {
  viewportWidth: number;
  stageLeft: number;
  stageWidth: number;
  bubbleWidth: number;
  preferredSide: "left" | "right";
  margin: number;
}

export interface DaruMobileBubbleAnchor {
  side: "left" | "right";
  leftOffset: number;
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

export function canCompleteDirectGreetingMove({
  mode,
  guideOpen,
  occluded,
  dragging,
  pageVisible,
}: DaruDirectGreetingState) {
  return mode === "active" && !guideOpen && !occluded && !dragging && pageVisible;
}

export function shouldReduceDaruMovement(reducedMotion: boolean, mobileViewport: boolean) {
  return reducedMotion && !mobileViewport;
}

export function resolveMobileBubbleAnchor({
  viewportWidth,
  stageLeft,
  stageWidth,
  bubbleWidth,
  preferredSide,
  margin,
}: DaruMobileBubbleAnchorInput): DaruMobileBubbleAnchor {
  const safeMargin = Math.max(0, margin);
  const maxBubbleWidth = Math.max(0, viewportWidth - safeMargin * 2);
  const effectiveBubbleWidth = Math.min(Math.max(0, bubbleWidth), maxBubbleWidth);
  const minLeftOffset = safeMargin - stageLeft;
  const maxLeftOffset = viewportWidth - safeMargin - effectiveBubbleWidth - stageLeft;
  const preferredLeftOffset = preferredSide === "right"
    ? -4
    : stageWidth - effectiveBubbleWidth + 4;

  return {
    side: preferredSide,
    leftOffset: clampValue(preferredLeftOffset, minLeftOffset, maxLeftOffset),
  };
}
