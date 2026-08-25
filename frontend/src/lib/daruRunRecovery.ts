export const OUTDATED_DECK_ERROR_CODE = "OUTDATED_DECK_CONFIGURATION";

export function isOutdatedDeckError(error: unknown): error is { status: number; code: string } {
  return typeof error === "object" && error !== null
    && "status" in error && error.status === 409
    && "code" in error && error.code === OUTDATED_DECK_ERROR_CODE;
}
