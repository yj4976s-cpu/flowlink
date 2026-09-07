import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getReportableClassCode,
  isReportablePersonalItem,
  reportableClassNames,
} from "../src/components/detection/reportablePersonalItems.ts";

for (const source of ["IMAGE", "VIDEO", "WEBCAM"]) {
  test(`${source}: HAT survives the report candidate filter`, () => {
    const hat = { class_code: "HAT", group_code: "PERSONAL_ITEM", label: "hat" };
    const objects = [hat, { class_code: "TRASH", group_code: "WASTE" }];
    assert.deepEqual(objects.filter(isReportablePersonalItem), [hat]);
    assert.equal(getReportableClassCode(hat.class_code), "HAT");
    assert.equal(reportableClassNames[hat.class_code], "모자");
  });
}

test("report form options include HAT and preserve all existing personal items", () => {
  assert.deepEqual(Object.entries(reportableClassNames), [
    ["BAG", "가방"], ["UMBRELLA", "우산"], ["FOOTWEAR", "신발"], ["BALL", "공"], ["HAT", "모자"],
  ]);
  for (const class_code of Object.keys(reportableClassNames)) {
    assert.equal(isReportablePersonalItem({ class_code, group_code: "PERSONAL_ITEM" }), true);
  }
});

test("unknown, missing, natural and waste classes cannot become personal reports", () => {
  for (const class_code of [undefined, null, "", "UNKNOWN", "TRASH", "BRANCH", "AQUATIC_PLANT", "hat", "toString", "__proto__"]) {
    assert.equal(getReportableClassCode(class_code), "");
    assert.equal(isReportablePersonalItem({ class_code, group_code: "PERSONAL_ITEM" }), false);
  }
  for (const group_code of [undefined, null, "", "UNKNOWN", "WASTE", "NATURAL"]) {
    assert.equal(isReportablePersonalItem({ class_code: "HAT", group_code }), false);
  }
});

test("workbench and webcam use the tested shared policy", () => {
  const workbench = readFileSync(new URL("../src/components/detection/DetectionWorkbench.tsx", import.meta.url), "utf8");
  const webcam = readFileSync(new URL("../src/components/detection/WebcamDetectionPanel.tsx", import.meta.url), "utf8");
  assert.match(workbench, /import \{ getReportableClassCode, isReportablePersonalItem, reportableClassNames \} from "\.\/reportablePersonalItems"/);
  assert.match(workbench, /detected_objects\.filter\(isReportablePersonalItem\)/);
  assert.match(workbench, /Object\.entries\(reportableClassNames\)/);
  assert.match(webcam, /import \{ isReportablePersonalItem as isReportableObject \} from "\.\/reportablePersonalItems"/);
  assert.match(webcam, /detected_objects\.filter\(isReportableObject\)/);
});
