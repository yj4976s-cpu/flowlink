import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminMobileWasteCameraSnapshot,
  getAdminMobileWastePermissions,
  getAdminMobileWasteStatusAfterOffline,
  shouldScheduleNextWasteDetection,
} from "../src/components/admin/detections/adminMobileWasteState.ts";
import { isMobileWasteCandidate } from "../src/components/admin/detections/mobileWasteFilters.ts";

const baseState = {
  status: "ready",
  hasFrozen: false,
  hasRegistered: false,
  hasCamera: true,
  isOnline: true,
};

test("mobile waste candidates require both TRASH class and WASTE group", () => {
  assert.equal(isMobileWasteCandidate({ class_code: "TRASH", group_code: "WASTE" }), true);
  assert.equal(isMobileWasteCandidate({ class_code: "trash", group_code: "waste" }), true);
  assert.equal(isMobileWasteCandidate({ class_code: "TRASH", group_code: "PERSONAL_ITEM" }), false);
  assert.equal(isMobileWasteCandidate({ class_code: "BAG", group_code: "WASTE" }), false);
  assert.equal(isMobileWasteCandidate({ class_code: null, group_code: "WASTE" }), false);
  assert.equal(isMobileWasteCandidate({ class_code: "TRASH", group_code: null }), false);
  assert.equal(isMobileWasteCandidate({}), false);
});

test("camera operations are allowed before a candidate is frozen", () => {
  const permissions = getAdminMobileWastePermissions(baseState);

  assert.equal(permissions.canChangeCamera, true);
  assert.equal(permissions.canRestartCamera, true);
  assert.equal(permissions.canSwitchFacing, true);
  assert.equal(permissions.canStartDetection, true);
});

test("frozen candidate keeps the selected camera id and blocks camera changes", () => {
  const snapshot = createAdminMobileWasteCameraSnapshot(
    { id: 7, name: "현장 카메라 A", area_name: "수원역" },
    "2026-08-31T10:00:00.000Z",
  );
  const permissions = getAdminMobileWastePermissions({
    ...baseState,
    status: "selected",
    hasFrozen: true,
    hasCamera: Boolean(snapshot?.cameraId),
  });

  assert.deepEqual(snapshot, {
    cameraId: 7,
    cameraName: "현장 카메라 A",
    cameraAreaName: "수원역",
    capturedAt: "2026-08-31T10:00:00.000Z",
  });
  assert.equal(permissions.canChangeCamera, false);
  assert.equal(permissions.canRestartCamera, false);
  assert.equal(permissions.canSwitchFacing, false);
  assert.equal(permissions.canRegister, true);
  assert.equal(permissions.canReselect, true);
});

test("registered and busy states block duplicate or destructive actions", () => {
  const registered = getAdminMobileWastePermissions({
    ...baseState,
    status: "registered",
    hasFrozen: true,
    hasRegistered: true,
  });
  const registering = getAdminMobileWastePermissions({
    ...baseState,
    status: "registering",
    hasFrozen: true,
  });
  const collecting = getAdminMobileWastePermissions({
    ...baseState,
    status: "collecting",
    hasFrozen: true,
    hasRegistered: true,
  });

  assert.equal(registered.canReselect, false);
  assert.equal(registered.canChangeCamera, false);
  assert.equal(registered.canCollect, true);
  assert.equal(registering.canRegister, false);
  assert.equal(registering.canReselect, false);
  assert.equal(collecting.canCollect, false);
  assert.equal(collecting.canRestartCamera, false);
});

test("offline pauses detection loop and blocks server mutations until manual resume", () => {
  const offline = getAdminMobileWastePermissions({
    ...baseState,
    status: "running",
    isOnline: false,
  });

  assert.equal(offline.canStartDetection, false);
  assert.equal(offline.canRegister, false);
  assert.equal(offline.canCollect, false);
  assert.equal(getAdminMobileWasteStatusAfterOffline("running"), "ready");
  assert.equal(getAdminMobileWasteStatusAfterOffline("registering"), "selected");
  assert.equal(getAdminMobileWasteStatusAfterOffline("collecting"), "registered");
  assert.equal(shouldScheduleNextWasteDetection({ running: true, isOnline: false, hasFrozen: false, hasRegistered: false }), false);
  assert.equal(shouldScheduleNextWasteDetection({ running: true, isOnline: true, hasFrozen: true, hasRegistered: false }), false);
  assert.equal(shouldScheduleNextWasteDetection({ running: true, isOnline: true, hasFrozen: false, hasRegistered: true }), false);
  assert.equal(shouldScheduleNextWasteDetection({ running: true, isOnline: true, hasFrozen: false, hasRegistered: false }), true);

  const resumed = getAdminMobileWastePermissions({
    ...baseState,
    status: "ready",
    isOnline: true,
  });
  assert.equal(resumed.canStartDetection, true);
});

test("completed state only allows starting a new waste detection flow", () => {
  const permissions = getAdminMobileWastePermissions({
    ...baseState,
    status: "completed",
    hasFrozen: true,
    hasRegistered: true,
  });

  assert.equal(permissions.canStartNewDetection, true);
  assert.equal(permissions.canRegister, false);
  assert.equal(permissions.canCollect, false);
  assert.equal(permissions.canRestartCamera, false);
});
