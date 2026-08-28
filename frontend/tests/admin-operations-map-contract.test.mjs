import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getLayerToggleTransition } from "../src/components/admin/operations-map/operationsMapState.ts";

const pageSource = readFileSync(new URL("../src/app/admin/map/page.tsx", import.meta.url), "utf8");
const screenSource = readFileSync(new URL("../src/components/admin/operations-map/AdminOperationsMap.tsx", import.meta.url), "utf8");
const mapSource = readFileSync(new URL("../src/components/admin/operations-map/AdminKakaoOperationsMap.tsx", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("../src/components/admin/operations-map/mockOperationsMapData.ts", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/components/admin/operations-map/AdminOperationsMap.module.css", import.meta.url), "utf8");

test("the operations map remains protected by the admin route guard", () => {
  assert.match(pageSource, /<AdminRouteGuard>/);
  assert.match(pageSource, /<AdminOperationsMap \/>/);
});

test("the admin screen renders one reusable Kakao map instance", () => {
  assert.equal((screenSource.match(/<AdminKakaoOperationsMap/g) ?? []).length, 1);
  assert.equal((mapSource.match(/new kakao\.maps\.Map/g) ?? []).length, 1);
  assert.match(mapSource, /loadKakaoMaps/);
  assert.match(mapSource, /map\.relayout\(\)/);
});

test("operations use geographic coordinates and camera detection aggregation", () => {
  assert.match(dataSource, /latitude: number; longitude: number/);
  assert.doesNotMatch(dataSource, /\bx: number;|\by: number;/);
  assert.match(screenSource, /detectionCounts/);
  assert.match(mapSource, /AI 탐지 \$\{count\}건/);
});

test("mock positioning is removed and all three themes style the live map", () => {
  assert.doesNotMatch(cssSource, /\.mapGrid|data-zoom|\.cluster|--x|--y/);
  assert.match(cssSource, /data-theme="day"/);
  assert.match(cssSource, /data-theme="dawn"/);
  assert.match(cssSource, /data-theme="night"/);
});

test("focus mode keeps the same map and exposes synchronized operations controls", () => {
  assert.equal((screenSource.match(/<AdminKakaoOperationsMap/g) ?? []).length, 1);
  assert.match(screenSource, /className=\{styles\.statusDock\}/);
  assert.match(screenSource, /filter === item\.value \? "all" : item\.value/);
  assert.match(screenSource, /<LayerControl compact layers=\{layers\}/);
  assert.match(screenSource, /expanded && selected && <div className=\{styles\.detailDrawer\}/);
  assert.match(screenSource, /event\.key === "Escape"/);
  assert.match(cssSource, /\.mapCard\[data-expanded\][^{]*\{[^}]*position: fixed/);
  assert.match(cssSource, /\.detailDrawer/);
  assert.match(cssSource, /\.statusDock/);
});

test("camera spotlight preserves map context and updates overlay DOM state", () => {
  assert.match(screenSource, /spotlightCameraId/);
  assert.doesNotMatch(screenSource, /cameraOnly/);
  assert.match(screenSource, /marker\.id} 집중 보기/);
  assert.match(screenSource, /className=\{styles\.spotlightIndicator\}/);
  assert.match(screenSource, /spotlightDockItems/);
  assert.match(mapSource, /element\.dataset\.spotlight/);
  assert.match(mapSource, /element\.dataset\.dimmed/);
  assert.match(mapSource, /map\.panTo/);
  assert.equal((mapSource.match(/new kakao\.maps\.Map/g) ?? []).length, 1);
  assert.match(cssSource, /\.kakaoMarker\[data-spotlight\]/);
  assert.match(cssSource, /\.kakaoMarker\[data-dimmed\]/);
});

test("turning off the camera layer ends spotlight without restoring it on re-enable", () => {
  const layers = { detection: true, found: true, camera: true, citizen: false };
  const cameraOff = getLayerToggleTransition("camera", layers, "CAM-01", "camera");

  assert.equal(cameraOff.layers.camera, false);
  assert.equal(cameraOff.spotlightCameraId, null);
  assert.equal(cameraOff.clearSelection, true);
  assert.equal(Boolean(cameraOff.spotlightCameraId), false, "spotlight indicator and dock must return to their normal state");

  const cameraOn = getLayerToggleTransition("camera", cameraOff.layers, cameraOff.spotlightCameraId, null);
  assert.equal(cameraOn.layers.camera, true);
  assert.equal(cameraOn.spotlightCameraId, null);
  assert.equal(cameraOn.clearSelection, false);
});

test("selected detection drawer separates back navigation from close", () => {
  assert.match(screenSource, /returnToDetectionList/);
  assert.match(screenSource, /setSelectedId\(selected\.camera \?\? null\)/);
  assert.match(screenSource, /aria-label="탐지 목록으로 돌아가기"/);
  assert.match(screenSource, /<Icon name="chevronLeft" size=\{15\} \/>탐지 목록/);
  assert.match(screenSource, /aria-label="상세 패널 닫기"/);
  assert.match(cssSource, /\.detailPanelTopbar/);
  assert.match(cssSource, /\.detectionBack/);
});
