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

test("video upload uses XHR progress while image upload keeps fetch", () => {
  assert.match(apiSource, /export function uploadDetectionImage\(file: File\) \{\s*return uploadDetection\("\/api\/detections\/images", file\)/);
  assert.match(apiSource, /export function uploadDetectionVideo[\s\S]*new XMLHttpRequest\(\)/);
  assert.match(apiSource, /xhr\.upload\.onprogress[\s\S]*event\.loaded, event\.total, event\.lengthComputable/);
  assert.match(apiSource, /xhr\.upload\.onload = \(\) => options\.onUploadComplete\?\.\(\)/);
  assert.match(apiSource, /xhr\.withCredentials = true/);
  assert.match(apiSource, /new DetectionApiError\(readXhrErrorMessage\(xhr\), xhr\.status\)/);
});

test("workbench separates upload, processing, completion, and failure truthfully", () => {
  assert.match(workbenchSource, /type VideoProcessingState = "idle" \| "uploading" \| "processing" \| "completed" \| "failed"/);
  assert.match(workbenchSource, /setVideoProcessingState\("uploading"\)/);
  assert.match(workbenchSource, /onUploadComplete:[\s\S]*setVideoUploadProgress\(null\); setVideoProcessingState\("processing"\)/);
  assert.match(workbenchSource, /setVideoProcessingState\("completed"\)/);
  assert.match(workbenchSource, /setVideoProcessingState\("failed"\)/);
  assert.doesNotMatch(workbenchSource, /setTimeout[\s\S]{0,120}setVideoUploadProgress/);
});

test("processing card has determinate upload and indeterminate AI states", () => {
  assert.match(workbenchSource, /aria-valuenow=\{uploadProgress\}/);
  assert.match(workbenchSource, /videoProgressIndeterminate[^>]+role="progressbar"/);
  assert.match(workbenchSource, /AI가 영상을 분석하고 있어요/);
  assert.match(workbenchSource, /경과 시간/);
  assert.match(workbenchSource, /1~2분 정도 소요될 수 있어요/);
  assert.doesNotMatch(workbenchSource, /분석[^\n]{0,40}\{uploadProgress\}%/);
  assert.match(cssSource, /prefers-reduced-motion: reduce[\s\S]*videoProgressIndeterminate/);
});

test("active video processing blocks replacement and cleans timers and stale requests", () => {
  assert.match(workbenchSource, /disabled=\{submitState === "analyzing"\}/);
  assert.match(workbenchSource, /submitState === "analyzing"\) return/);
  assert.match(workbenchSource, /window\.setInterval\(updateElapsed, 1000\)/);
  assert.match(workbenchSource, /window\.clearInterval\(interval\)/);
  assert.match(workbenchSource, /videoRequestGenerationRef/);
  assert.match(workbenchSource, /videoAbortControllerRef\.current\?\.abort\(\)/);
});
