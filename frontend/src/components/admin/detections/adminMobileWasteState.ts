export type AdminMobileWasteStatus =
  | "idle"
  | "requesting"
  | "ready"
  | "running"
  | "selected"
  | "registering"
  | "registered"
  | "collecting"
  | "completed";

export type AdminMobileWastePermissionInput = {
  status: AdminMobileWasteStatus;
  hasFrozen: boolean;
  hasRegistered: boolean;
  hasCamera: boolean;
  isOnline: boolean;
};

export type AdminMobileWastePermissions = {
  canOperateCamera: boolean;
  canChangeCamera: boolean;
  canRestartCamera: boolean;
  canSwitchFacing: boolean;
  canSelectCandidate: boolean;
  canReselect: boolean;
  canRegister: boolean;
  canCollect: boolean;
  canStartDetection: boolean;
  canPauseDetection: boolean;
  canStartNewDetection: boolean;
};

export type AdminMobileWasteCameraSnapshot = {
  cameraId: number;
  cameraName: string;
  cameraAreaName: string;
  capturedAt: string;
};

const BUSY_STATUSES = new Set<AdminMobileWasteStatus>(["requesting", "registering", "collecting"]);

export function getAdminMobileWastePermissions({
  status,
  hasFrozen,
  hasRegistered,
  hasCamera,
  isOnline,
}: AdminMobileWastePermissionInput): AdminMobileWastePermissions {
  const isBusy = BUSY_STATUSES.has(status);
  const isCompleted = status === "completed";
  const hasLockedRecord = hasRegistered || status === "registered" || status === "collecting";
  const canOperateCamera = isOnline && !isBusy && !hasFrozen && !hasLockedRecord && !isCompleted;
  const canUseSelectedFrame = isOnline && hasFrozen && !isBusy && !isCompleted;

  return {
    canOperateCamera,
    canChangeCamera: canOperateCamera,
    canRestartCamera: canOperateCamera,
    canSwitchFacing: canOperateCamera,
    canSelectCandidate: isOnline && !isBusy && !hasFrozen && !hasLockedRecord && !isCompleted && hasCamera,
    canReselect: isOnline && hasFrozen && !hasLockedRecord && !isBusy && !isCompleted,
    canRegister: canUseSelectedFrame && !hasRegistered && hasCamera,
    canCollect: isOnline && hasRegistered && !isBusy && !isCompleted,
    canStartDetection: canOperateCamera && hasCamera,
    canPauseDetection: isOnline && status === "running" && !hasFrozen && !hasLockedRecord,
    canStartNewDetection: isCompleted,
  };
}

export function shouldScheduleNextWasteDetection({
  running,
  isOnline,
  hasFrozen,
  hasRegistered,
}: {
  running: boolean;
  isOnline: boolean;
  hasFrozen: boolean;
  hasRegistered: boolean;
}) {
  return running && isOnline && !hasFrozen && !hasRegistered;
}

export function getAdminMobileWasteStatusAfterOffline(status: AdminMobileWasteStatus): AdminMobileWasteStatus {
  if (status === "running") return "ready";
  if (status === "registering") return "selected";
  if (status === "collecting") return "registered";
  return status;
}

export function createAdminMobileWasteCameraSnapshot(
  camera: { id: number; name: string; area_name: string } | null | undefined,
  capturedAt: string,
): AdminMobileWasteCameraSnapshot | null {
  if (!camera || !Number.isFinite(camera.id)) return null;
  return {
    cameraId: camera.id,
    cameraName: camera.name,
    cameraAreaName: camera.area_name,
    capturedAt,
  };
}
