import assert from "node:assert/strict";
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
