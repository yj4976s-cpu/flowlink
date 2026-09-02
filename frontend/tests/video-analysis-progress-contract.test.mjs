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
  assert.match(workbenchSource, /"queued" \| "normalizing" \| "analyzing" \| "rendering" \| "saving"/);
  assert.match(workbenchSource, /stage === "NORMALIZING"/);
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
  assert.match(apiSource, /failed_stage: "QUEUED" \| "NORMALIZING" \| "ANALYZING" \| "RENDERING" \| "SAVING" \| null/);
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

test("FAILED is terminal immediately while only request failures consume retry budget", () => {
  const requestIndex = workbenchSource.indexOf("status = await getVideoProcessingStatus");
  const requestCatchIndex = workbenchSource.indexOf("} catch (pollError)", requestIndex);
  const failedIndex = workbenchSource.indexOf('if (status.status === "FAILED")', requestCatchIndex);
  assert.ok(requestIndex >= 0);
  assert.ok(requestCatchIndex > requestIndex);
  assert.ok(failedIndex > requestCatchIndex);
  assert.match(workbenchSource, /transientFailures \+= 1;[\s\S]+continue;[\s\S]+transientFailures = 0;/);
});

test("COMPLETED remains authoritative across result and history loading failures", () => {
  const completedIndex = workbenchSource.indexOf('if (status.status === "COMPLETED")');
  const completedStateIndex = workbenchSource.indexOf('setVideoProcessingState("completed")', completedIndex);
  const resultFetchIndex = workbenchSource.indexOf("result = await getMyDetection", completedStateIndex);
  const resultErrorIndex = workbenchSource.indexOf("영상 분석은 완료됐지만 결과를 불러오지 못했어요", resultFetchIndex);
  assert.ok(completedIndex >= 0);
  assert.ok(completedStateIndex > completedIndex);
  assert.ok(resultFetchIndex > completedStateIndex);
  assert.ok(resultErrorIndex > resultFetchIndex);
  assert.match(workbenchSource, /const refreshHistory = useCallback\(async[\s\S]+catch \(caught\)[\s\S]+setHistoryError/);
  assert.doesNotMatch(workbenchSource.slice(resultFetchIndex, resultErrorIndex + 80), /setVideoProcessingState\("failed"\)/);
});

test("video upload and processing copy states the actual constraints without a fixed ETA", () => {
  assert.match(workbenchSource, /MP4 · 100MB 이하 · 영상 30초 이내/);
  assert.match(workbenchSource, /영상 길이와 실행 환경에 따라 수 분이 소요될 수 있어요/);
  assert.doesNotMatch(workbenchSource, /MP4 \/ 100MB · 최대 30초 안내/);
  assert.doesNotMatch(workbenchSource, /1~2분 정도 소요될 수 있어요/);
  assert.match(workbenchSource, /영상은 30초 이내로 업로드해주세요/);
});
