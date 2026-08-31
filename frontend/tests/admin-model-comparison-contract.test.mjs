import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classComparisonStatus,
  currentModelLabel,
  fileSizeLabel,
  hasMeasuredModelComparison,
  isMeasuredNumber,
  metricBarViewState,
  metricDelta,
  metricLabel,
  modelComparisonStatusView,
} from "../src/components/admin/model-comparison/modelComparisonViewState.ts";

test("model comparison metric labels keep unknown values explicit", () => {
  assert.equal(metricLabel(null, { percent: true }), "측정 전");
  assert.equal(metricLabel(Number.NaN, { suffix: "ms" }), "측정 전");
  assert.equal(metricLabel(Number.POSITIVE_INFINITY, { suffix: "fps" }), "측정 전");
  assert.equal(metricLabel(0, { percent: true }), "0.0%");
  assert.equal(metricLabel(0, { suffix: "ms" }), "0.0ms");
  assert.equal(metricLabel(0.912, { percent: true }), "91.2%");
  assert.equal(fileSizeLabel(null), "측정 전");
});

test("model comparison metric bar state separates zero from empty values", () => {
  assert.equal(isMeasuredNumber(null), false);
  assert.equal(isMeasuredNumber(undefined), false);
  assert.equal(isMeasuredNumber(Number.NaN), false);
  assert.equal(isMeasuredNumber(Number.POSITIVE_INFINITY), false);
  assert.equal(isMeasuredNumber(Number.NEGATIVE_INFINITY), false);
  assert.equal(isMeasuredNumber(0), true);
  assert.deepEqual(metricBarViewState(null, 1), { measured: false, zero: false, width: 0 });
  assert.deepEqual(metricBarViewState(Number.NaN, 1), { measured: false, zero: false, width: 0 });
  assert.deepEqual(metricBarViewState(0, 1), { measured: true, zero: true, width: 0 });
  assert.deepEqual(metricBarViewState(0.5, 1), { measured: true, zero: false, width: 50 });
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

test("model comparison status separates deployed model from missing evaluation metrics", () => {
  const comparison = {
    current_deployed_model_id: "flowlink-4class-hat-v7",
    current_deployed_model_status: "신규 HAT 모델 배포 확인",
    models: [
      {
        id: "flowlink-3class-v6",
        display_name: "기존 3클래스 모델",
        precision: null,
        recall: null,
        map50: null,
        map50_95: null,
        average_inference_ms: null,
        fps: null,
        class_metrics: [],
      },
      {
        id: "flowlink-4class-hat-v7",
        display_name: "신규 HAT 4클래스 모델",
        precision: null,
        recall: null,
        map50: null,
        map50_95: null,
        average_inference_ms: null,
        fps: null,
        class_metrics: [
          { code: "HAT", label: "모자", supported: true, precision: null, recall: null, map50: null, map50_95: null },
        ],
      },
    ],
  };

  assert.equal(hasMeasuredModelComparison(comparison), false);
  assert.deepEqual(modelComparisonStatusView(comparison), {
    title: "신규 HAT 4클래스 모델이 서비스에 연결되어 있습니다.",
    description: "현재 배포 모델 상태는 확인됐지만, 동일 테스트셋 기반 Precision, Recall, mAP 평가는 아직 등록되지 않았습니다.",
    actionLabel: "모델 비교 현황 보기",
    tone: "deployed",
  });
});

test("model comparison status reports measured and error states explicitly", () => {
  const measured = {
    current_deployed_model_id: "new",
    current_deployed_model_status: null,
    models: [
      { id: "old", display_name: "기존 모델", precision: null, recall: null, map50: null, map50_95: null, average_inference_ms: null, fps: null, class_metrics: [] },
      { id: "new", display_name: "신규 모델", precision: 0.81, recall: null, map50: null, map50_95: null, average_inference_ms: null, fps: null, class_metrics: [] },
    ],
  };

  assert.equal(hasMeasuredModelComparison(measured), true);
  assert.equal(modelComparisonStatusView(measured).title, "모델 비교 평가 결과가 등록되어 있습니다.");
  assert.equal(modelComparisonStatusView(measured).actionLabel, "평가 결과 확인하기");
  assert.equal(modelComparisonStatusView(null, { error: true }).title, "모델 비교 정보를 불러오지 못했습니다.");
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

test("model comparison dashboard keeps zero bars measured and empty bars visually distinct", () => {
  const client = readFileSync("src/components/admin/model-comparison/AdminModelComparisonClient.tsx", "utf8");
  const css = readFileSync("src/components/admin/model-comparison/AdminModelComparisonClient.module.css", "utf8");

  assert.match(client, /metricBarViewState\(before, max\)/);
  assert.match(client, /data-empty=\{!state\.measured \|\| undefined\}/);
  assert.match(client, /data-zero=\{state\.zero \|\| undefined\}/);
  assert.doesNotMatch(client, /const measured = width > 0/);
  assert.match(css, /\.metricBar\[data-zero\] i b/);
  assert.match(css, /min-width: 0/);
});

test("class performance uses accessible cards instead of stale table cells", () => {
  const client = readFileSync("src/components/admin/model-comparison/AdminModelComparisonClient.tsx", "utf8");
  const css = readFileSync("src/components/admin/model-comparison/AdminModelComparisonClient.module.css", "utf8");

  assert.match(client, /className=\{styles\.classCards\} role="list"/);
  assert.match(client, /role="listitem"/);
  assert.doesNotMatch(client, /role="cell"/);
  assert.doesNotMatch(client, /role="table"/);
  assert.match(client, /신규 클래스/);
  assert.match(client, /미지원/);
  assert.match(css, /\.classCards/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("AI report reads model comparison status instead of hardcoding missing evaluation copy", () => {
  const aiReport = readFileSync("src/components/admin/ai-report/AdminAiReportClient.tsx", "utf8");

  assert.doesNotMatch(aiReport, /모델 평가 데이터는 아직 별도로 연결되지 않았어요/);
  assert.match(aiReport, /getAdminModelComparison/);
  assert.match(aiReport, /ModelComparisonStatus/);
  assert.match(aiReport, /modelComparisonStatusView/);
  assert.match(aiReport, /\/admin\/model-comparison/);
});
