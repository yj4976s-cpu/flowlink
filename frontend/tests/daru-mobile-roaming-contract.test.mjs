import assert from "node:assert/strict";
import test from "node:test";

import {
  canCompleteDirectGreetingMove,
  mobileDestinationCandidates,
  resolveMobileBubbleAnchor,
  resolveMobileRoamBounds,
  shouldPlaceDirectGreetingImmediately,
} from "../src/components/mascot/daru.mobile-roaming.ts";

function bounds(viewportWidth) {
  return resolveMobileRoamBounds({
    viewportWidth,
    stageWidth: 88,
    margin: 12,
    configuredMinTravelDistance: 76,
  });
}

test("320px mobile viewport still creates a destination away from the current position", () => {
  const resolved = bounds(320);
  const candidates = mobileDestinationCandidates(resolved, 210);

  assert.ok(resolved.minTravelDistance <= resolved.availableDistance);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((left) => left >= resolved.minLeft && left <= resolved.maxLeft));
  assert.ok(candidates.some((left) => Math.abs(left - 210) >= resolved.minTravelDistance));
});

test("360px mobile viewport clamps minimum travel to usable space", () => {
  const resolved = bounds(360);

  assert.ok(resolved.availableDistance > 0);
  assert.ok(resolved.minTravelDistance <= resolved.availableDistance);
  assert.ok(resolved.minTravelDistance <= 76);
});

test("390px and 430px mobile viewports keep Daru inside the screen", () => {
  for (const viewportWidth of [390, 430]) {
    const resolved = bounds(viewportWidth);
    const candidates = mobileDestinationCandidates(resolved, viewportWidth - 100);

    assert.ok(candidates.length > 0);
    assert.ok(candidates.every((left) => left >= 12));
    assert.ok(candidates.every((left) => left + 88 <= viewportWidth - 12));
  }
});

test("candidate order prefers the safest farthest horizontal destination", () => {
  const resolved = bounds(390);
  const candidates = mobileDestinationCandidates(resolved, 12);

  assert.equal(candidates[0], resolved.maxLeft);
});

test("direct greeting completion only moves while the current state is safe", () => {
  const safe = {
    mode: "active",
    guideOpen: false,
    occluded: false,
    dragging: false,
    pageVisible: true,
  };

  assert.equal(canCompleteDirectGreetingMove(safe), true);
  assert.equal(canCompleteDirectGreetingMove({ ...safe, mode: "quiet" }), false);
  assert.equal(canCompleteDirectGreetingMove({ ...safe, mode: "hidden" }), false);
  assert.equal(canCompleteDirectGreetingMove({ ...safe, guideOpen: true }), false);
  assert.equal(canCompleteDirectGreetingMove({ ...safe, occluded: true }), false);
  assert.equal(canCompleteDirectGreetingMove({ ...safe, dragging: true }), false);
  assert.equal(canCompleteDirectGreetingMove({ ...safe, pageVisible: false }), false);
});

test("reduced motion does not block the direct greeting completion guard", () => {
  const state = {
    mode: "active",
    guideOpen: false,
    occluded: false,
    dragging: false,
    pageVisible: true,
    reducedMotion: true,
  };

  assert.equal(canCompleteDirectGreetingMove(state), true);
  assert.equal(shouldPlaceDirectGreetingImmediately(state), true);
  assert.equal(shouldPlaceDirectGreetingImmediately({ ...state, guideOpen: true }), false);
  assert.equal(shouldPlaceDirectGreetingImmediately({ ...state, reducedMotion: false }), false);
});

function assertBubbleMargin(viewportWidth, stageLeft, stageWidth, bubbleWidth, preferredSide) {
  const anchor = resolveMobileBubbleAnchor({
    viewportWidth,
    stageLeft,
    stageWidth,
    bubbleWidth,
    preferredSide,
    margin: 12,
  });
  const globalLeft = stageLeft + anchor.leftOffset;
  const effectiveWidth = Math.min(bubbleWidth, viewportWidth - 24);

  assert.equal(anchor.side, preferredSide);
  assert.ok(globalLeft >= 12, `${viewportWidth}px ${preferredSide} left ${globalLeft} should keep 12px margin`);
  assert.ok(globalLeft + effectiveWidth <= viewportWidth - 12, `${viewportWidth}px ${preferredSide} right edge should keep 12px margin`);
}

test("mobile direct greeting bubble keeps a 12px safe margin near both viewport edges", () => {
  for (const viewportWidth of [320, 360, 390, 430]) {
    assertBubbleMargin(viewportWidth, 12, 92, 220, "right");
    assertBubbleMargin(viewportWidth, viewportWidth - 104, 92, 220, "left");
  }
});
