import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getLayerToggleTransition,
  getMapMarkerSelectionTransition,
  getSearchClearTransition,
  getSearchSelectionTransition,
  isSearchRequestCurrent,
} from "../src/components/admin/operations-map/operationsMapState.ts";
import { createProgrammaticViewportGuard } from "../src/components/admin/operations-map/operationsMapViewport.ts";

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

test("programmatic viewport zooms stay clean while user zooms become dirty", () => {
  let dirty = false;
  let level = 8;
  const map = { getLevel: () => level };
  const guard = createProgrammaticViewportGuard(() => { dirty = true; });

  guard.run(map, () => { level = 5; guard.onZoomChanged(map); });
  assert.equal(dirty, false, "synchronous search zoom must stay clean");

  guard.run(map, () => { level = 6; });
  guard.onZoomChanged(map);
  assert.equal(dirty, false, "asynchronous spotlight zoom must stay clean");

  guard.run(map, () => { level = 4; });
  guard.onZoomChanged(map);
  assert.equal(dirty, false, "setBounds level changes must stay clean");

  guard.onZoomChanged(map);
  assert.equal(dirty, true, "wheel or pinch zoom must become dirty");

  dirty = false;
  guard.reset();
  guard.onZoomChanged(map);
  assert.equal(dirty, true, "cleanup must not leave zoom suppression behind");

  assert.match(mapSource, /const markDirty = \(\) => setDirty\(true\)/, "drag remains a user viewport change");
  assert.match(mapSource, /const zoom = \(delta: number\)[\s\S]*setDirty\(true\)/, "the custom zoom control is explicitly user initiated");
  assert.match(mapSource, /onQueryArea\(boundsOf\(map\)\); setDirty\(false\)/, "querying the visible area clears dirty state");
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

test("search selection only preserves spotlight for the same camera", () => {
  const sameCamera = getSearchSelectionTransition("CAM-03", { id: "CAM-03", kind: "camera" }, "CAM-03");
  assert.deepEqual(sameCamera, { selectedId: "CAM-03", spotlightCameraId: "CAM-03" });

  const otherCamera = getSearchSelectionTransition("CAM-01", { id: "CAM-01", kind: "camera" }, "CAM-03");
  assert.deepEqual(otherCamera, { selectedId: "CAM-01", spotlightCameraId: null });

  const detection = getSearchSelectionTransition("DET-2042", { id: "DET-2042", kind: "detection" }, "CAM-03");
  assert.deepEqual(detection, { selectedId: "DET-2042", spotlightCameraId: null });

  const found = getSearchSelectionTransition("ITEM-01", { id: "ITEM-01", kind: "found" }, "CAM-03");
  assert.deepEqual(found, { selectedId: "ITEM-01", spotlightCameraId: null });

  const place = getSearchSelectionTransition(undefined, null, "CAM-03");
  assert.deepEqual(place, { selectedId: null, spotlightCameraId: null });
});

test("direct map selection keeps spotlight context synchronized", () => {
  const sameCamera = getMapMarkerSelectionTransition("CAM-03", { id: "CAM-03", kind: "camera" }, "CAM-03");
  assert.deepEqual(sameCamera, { selectedId: "CAM-03", spotlightCameraId: "CAM-03" });

  const otherCamera = getMapMarkerSelectionTransition("CAM-01", { id: "CAM-01", kind: "camera" }, "CAM-03");
  assert.deepEqual(otherCamera, { selectedId: "CAM-01", spotlightCameraId: "CAM-01" });

  const found = getMapMarkerSelectionTransition("FI-1024", { id: "FI-1024", kind: "found" }, "CAM-03");
  assert.deepEqual(found, { selectedId: "FI-1024", spotlightCameraId: null });

  const citizen = getMapMarkerSelectionTransition("CR-12", { id: "CR-12", kind: "citizen" }, "CAM-03");
  assert.deepEqual(citizen, { selectedId: "CR-12", spotlightCameraId: null });

  const blankMap = getMapMarkerSelectionTransition(null, null, "CAM-03");
  assert.deepEqual(blankMap, { selectedId: null, spotlightCameraId: "CAM-03" });
});

test("clearing search resets local results and invalidates stale Kakao responses", () => {
  const requestId = 7;
  const cleared = getSearchClearTransition(requestId);

  assert.deepEqual(cleared, {
    query: "",
    places: [],
    placeState: "idle",
    active: 0,
    sequence: 8,
  });
  assert.equal(isSearchRequestCurrent(cleared.sequence, requestId), false);
  assert.match(screenSource, /if \(!isSearchRequestCurrent\(sequence\.current, requestId\)\) return;/);
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

test("expanded map restores dialog semantics and keyboard focus containment", () => {
  assert.match(screenSource, /role=\{expanded \? "dialog" : undefined\}/);
  assert.match(screenSource, /aria-modal=\{expanded \? true : undefined\}/);
  assert.match(screenSource, /aria-labelledby=\{expanded \? "admin-operations-map-dialog-title" : undefined\}/);
  assert.match(screenSource, /requestAnimationFrame\(\(\) => trigger\?\.focus\(\)\)/);
  assert.match(screenSource, /event\.key !== "Tab"/);
  assert.match(screenSource, /event\.shiftKey/);
  assert.match(screenSource, /document\.activeElement === first/);
  assert.match(screenSource, /document\.activeElement === last/);
  assert.match(screenSource, /event\.key === "Escape"/);
  assert.match(screenSource, /window\.setTimeout\(\(\) => trigger\?\.focus\(\)\)/);
});
