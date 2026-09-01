import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource = readFileSync(new URL("../src/lib/detectionApi.ts", import.meta.url), "utf8");
const workbenchSource = readFileSync(new URL("../src/components/detection/DetectionWorkbench.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/components/detection/DetectionWorkbench.module.css", import.meta.url), "utf8");

test("detection API exposes upload policy and storage usage contracts", () => {
  assert.match(apiSource, /DetectionUploadPolicy/);
  assert.match(apiSource, /DetectionStorageUsage/);
  assert.match(apiSource, /\/api\/detections\/upload-policy/);
  assert.match(apiSource, /\/api\/detections\/me\/storage-usage/);
  assert.match(apiSource, /original_media_bytes: number \| null/);
  assert.match(apiSource, /result_media_bytes: number \| null/);
});

test("detect page shows policy, quota usage, and actual progressbar values", () => {
  assert.match(workbenchSource, /fallbackUploadPolicy/);
  assert.match(workbenchSource, /getDetectionUploadPolicy/);
  assert.match(workbenchSource, /getDetectionStorageUsage/);
  assert.match(workbenchSource, /aria-label="사용자 업로드 정책과 저장 공간"/);
  assert.match(workbenchSource, /role="progressbar"/);
  assert.match(workbenchSource, /aria-valuenow=\{storagePercent\}/);
  assert.match(workbenchSource, /storageRatio >= 0\.8/);
  assert.match(workbenchSource, /storageRatio >= 1/);
  assert.match(workbenchSource, /저장 공간이 가득 찼습니다/);
});

test("upload validation uses server policy values and refreshes usage after mutations", () => {
  assert.match(workbenchSource, /validateFile\(nextFile, tab, uploadPolicy\)/);
  assert.match(workbenchSource, /validateFile\(file, tab, uploadPolicy\)/);
  assert.match(workbenchSource, /policy\.image\.source_max_bytes/);
  assert.match(workbenchSource, /policy\.video\.max_bytes/);
  assert.match(workbenchSource, /uploadDisabled/);
  assert.match(workbenchSource, /await refreshStorageUsage\(\)/);
});

test("detection errors expose only safe upload details", () => {
  const safeSection = apiSource.slice(apiSource.indexOf("function safeErrorMessageFromBody"));
  assert.match(apiSource, /readSafeDetectionErrorMessage/);
  assert.match(apiSource, /readSafeXhrDetectionErrorMessage/);
  assert.match(apiSource, /MODEL_UNAVAILABLE_DETAILS/);
  assert.match(apiSource, /SAFE_UPLOAD_ERROR_DETAILS/);
  assert.match(apiSource, /SAFE_UPLOAD_ERROR_DETAILS\.has\(detail\)/);
  assert.doesNotMatch(safeSection, /if \(typeof detail === "string"\) return detail/);
});

test("policy card keeps mobile-friendly wrapping styles", () => {
  assert.match(cssSource, /\.policyCard/);
  assert.match(cssSource, /\.policyStats[\s\S]*flex-wrap: wrap/);
  assert.match(cssSource, /\.policyMeter/);
});
