import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classComparisonStatus,
  currentModelLabel,
  fileSizeLabel,
  metricDelta,
  metricLabel,
} from "../src/components/admin/model-comparison/modelComparisonViewState.ts";

test("model comparison metric labels keep unknown values explicit", () => {
  assert.equal(metricLabel(null, { percent: true }), "측정 전");
  assert.equal(metricLabel(Number.NaN, { suffix: "ms" }), "측정 전");
  assert.equal(metricLabel(0.912, { percent: true }), "91.2%");
  assert.equal(fileSizeLabel(null), "측정 전");
});

test("model comparison deltas show percent points and lower-is-better timing", () => {
  assert.deepEqual(metricDelta(0.81, 0.86, { percentPoint: true }), {
    label: "+5.0%p",
    tone: "better",
  });
  assert.deepEqual(metricDelta(25, 20, { lowerIsBetter: true }), {
    label: "-5.0",
    tone: "better",
  });
  assert.deepEqual(metricDelta(null, 0.5, { percentPoint: true }), {
    label: "비교 전",
    tone: "missing",
  });
});

test("model comparison class status treats HAT as a new class instead of a zero score", () => {
  assert.deepEqual(
    classComparisonStatus(
      { code: "HAT", label: "모자", supported: false, precision: null, recall: null, map50: null, map50_95: null },
      { code: "HAT", label: "모자", supported: true, precision: null, recall: null, map50: null, map50_95: null },
    ),
    { label: "신규 클래스", tone: "new" },
  );
  assert.deepEqual(classComparisonStatus(null, null), { label: "미지원", tone: "missing" });
});

test("model comparison current deployed label is safe when deployment is not confirmed", () => {
  const models = [
    { id: "old", display_name: "기존 모델" },
    { id: "new", display_name: "신규 HAT 모델" },
  ];

  assert.equal(currentModelLabel(models, null, "확인 필요"), "확인 필요");
  assert.equal(currentModelLabel(models, "new", null), "신규 HAT 모델");
});

test("model comparison page is admin guarded and linked from operations analysis menu", () => {
  const page = readFileSync("src/app/admin/model-comparison/page.tsx", "utf8");
  const header = readFileSync("src/components/layout/Header.tsx", "utf8");
  const client = readFileSync("src/components/admin/model-comparison/AdminModelComparisonClient.tsx", "utf8");

  assert.match(page, /AdminRouteGuard/);
  assert.match(page, /AdminModelComparisonClient/);
  assert.match(header, /\/admin\/model-comparison/);
  assert.match(client, /getAdminModelComparison/);
  assert.match(client, /실시간 모델 전환 화면이 아닙니다/);
  assert.match(client, /mAP@50:95/);
  assert.match(client, /metric\.map50_95/);
});
