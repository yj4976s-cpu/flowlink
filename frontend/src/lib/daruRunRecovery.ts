export const OUTDATED_DECK_ERROR_CODE = "OUTDATED_DECK_CONFIGURATION";
export const RUN_EXPIRED_ERROR_CODE = "RUN_EXPIRED";

type CodedRunError = { status: number; code: string };

function hasRunErrorCode(error: unknown, code: string): error is CodedRunError {
  return typeof error === "object" && error !== null
    && "status" in error && error.status === 409
    && "code" in error && error.code === code;
}

export function isOutdatedDeckError(error: unknown): error is CodedRunError {
  return hasRunErrorCode(error, OUTDATED_DECK_ERROR_CODE);
}

export function isExpiredRunError(error: unknown): error is CodedRunError {
  return hasRunErrorCode(error, RUN_EXPIRED_ERROR_CODE);
}

export function terminalRunRecoveryReason(error: unknown): "outdated-deck" | "expired" | null {
  if (isOutdatedDeckError(error)) return "outdated-deck";
  if (isExpiredRunError(error)) return "expired";
  return null;
}
