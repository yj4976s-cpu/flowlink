import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calculateVideoUploadProgress } from "../src/lib/videoUploadProgress.ts";

const apiSource = readFileSync(new URL("../src/lib/detectionApi.ts", import.meta.url), "utf8");
const workbenchSource = readFileSync(new URL("../src/components/detection/DetectionWorkbench.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/components/detection/DetectionWorkbench.module.css", import.meta.url), "utf8");

test("video upload progress uses only computable browser bytes", () => {
  assert.equal(calculateVideoUploadProgress(72, 100, true), 72);
  assert.equal(calculateVideoUploadProgress(1, 0, true), null);
  assert.equal(calculateVideoUploadProgress(72, 100, false), null);
  assert.equal(calculateVideoUploadProgress(150, 100, true), 100);
});

test("video upload uses XHR while image upload keeps fetch", () => {
  assert.match(apiSource, /uploadDetectionImage[\s\S]+uploadDetection\("\/api\/detections\/images"/);
  assert.match(apiSource, /uploadDetectionVideo[\s\S]*new XMLHttpRequest\(\)/);
  assert.match(apiSource, /event\.loaded, event\.total, event\.lengthComputable/);
  assert.match(apiSource, /xhr\.withCredentials = true/);
  assert.match(apiSource, /new Promise<VideoDetectionAccepted>/);
});

test("workbench maps the durable server stages and polls once per second", () => {
  assert.match(workbenchSource, /"queued" \| "analyzing" \| "rendering" \| "saving"/);
  assert.match(workbenchSource, /getVideoProcessingStatus\(accepted\.detection_event_id/);
  assert.match(workbenchSource, /window\.setTimeout\(resolve, 1000\)/);
  assert.match(workbenchSource, /processingStateForStage/);
  assert.match(workbenchSource, /setVideoProcessingState\("completed"\)/);
  assert.match(workbenchSource, /setVideoProcessingState\("failed"\)/);
});

test("analysis shows only actual frame progress while rendering and saving remain indeterminate", () => {
  assert.match(workbenchSource, /serverStatus\?\.analysis_progress/);
  assert.match(workbenchSource, /serverStatus\.processed_frames[\s\S]+serverStatus\.total_frames[\s\S]+프레임/);
  assert.match(workbenchSource, /결과 영상을 준비하고 있어요/);
  assert.match(workbenchSource, /분석 결과를 안전하게 저장하고 있어요/);
  assert.match(workbenchSource, /videoProgressIndeterminate/);
  assert.doesNotMatch(workbenchSource, /setTimeout[\s\S]{0,120}setVideoUploadProgress/);
  assert.match(cssSource, /prefers-reduced-motion: reduce[\s\S]*videoProgressIndeterminate/);
});

test("failed video steps preserve the stage that actually failed", () => {
  assert.match(apiSource, /failed_stage: "QUEUED" \| "ANALYZING" \| "RENDERING" \| "SAVING" \| null/);
  assert.match(workbenchSource, /activeStageForServerStatus/);
  assert.match(workbenchSource, /getVideoStepState/);
  assert.match(workbenchSource, /setVideoFailedFromStage\("uploading"\)/);
  assert.match(workbenchSource, /영상 분석을 시작하지 못했어요/);
  assert.match(workbenchSource, /영상 분석을 완료하지 못했어요/);
  assert.match(workbenchSource, /결과 영상을 준비하지 못했어요/);
  assert.match(workbenchSource, /분석 결과를 저장하지 못했어요/);
  assert.match(workbenchSource, /data-failed/);
});

test("polling has retry bounds plus abort and stale request protection", () => {
  assert.match(workbenchSource, /transientFailures >= 3/);
  assert.match(workbenchSource, /videoRequestGenerationRef/);
  assert.match(workbenchSource, /videoAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(workbenchSource, /controller\.signal/);
  assert.match(workbenchSource, /getMyDetection\(accepted\.detection_event_id/);
});
