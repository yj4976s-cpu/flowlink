import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isMobileWasteCandidate } from "../src/components/admin/detections/mobileWasteFilters.ts";

test("mobile waste candidates require both TRASH class and WASTE group", () => {
  assert.equal(isMobileWasteCandidate({ class_code: "TRASH", group_code: "WASTE" }), true);
  assert.equal(isMobileWasteCandidate({ class_code: "trash", group_code: "waste" }), true);
  assert.equal(isMobileWasteCandidate({ class_code: "TRASH", group_code: "PERSONAL_ITEM" }), false);
  assert.equal(isMobileWasteCandidate({ class_code: "BAG", group_code: "WASTE" }), false);
  assert.equal(isMobileWasteCandidate({ class_code: null, group_code: "WASTE" }), false);
  assert.equal(isMobileWasteCandidate({ class_code: "TRASH", group_code: null }), false);
});

test("admin mobile waste screen exposes field workflow and safe recovery confirmation", () => {
  const source = readFileSync("src/components/admin/detections/AdminMobileWasteCamera.tsx", "utf8");

  assert.match(source, /FIELD_STEPS/);
  assert.match(source, /카메라 켜고 탐지 시작/);
  assert.match(source, /STATUS_LABELS/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /선택한 이 프레임만 등록됩니다/);
  assert.match(source, /startCameraAndDetection/);
});
