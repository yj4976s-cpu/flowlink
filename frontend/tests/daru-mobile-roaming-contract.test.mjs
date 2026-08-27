import assert from "node:assert/strict";
import test from "node:test";

import {
  mobileDestinationCandidates,
  resolveMobileRoamBounds,
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
