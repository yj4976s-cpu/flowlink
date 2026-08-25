import assert from "node:assert/strict";
import test from "node:test";

import { BEST_RECORD_STORAGE_KEYS, resolveGuestBest } from "../src/components/daru-game/game.storage.ts";
import { isExpiredRunError, isOutdatedDeckError, OUTDATED_DECK_ERROR_CODE, RUN_EXPIRED_ERROR_CODE, terminalRunRecoveryReason } from "../src/lib/daruRunRecovery.ts";

const OLD_HARD_KEY = "flowlink:daru-game:v2:best-detection:hard";

test("HARD40 uses a new guest best key while EASY and NORMAL keep their keys", () => {
  assert.equal(BEST_RECORD_STORAGE_KEYS.easy, "flowlink:daru-game:v2:best-detection:easy");
  assert.equal(BEST_RECORD_STORAGE_KEYS.normal, "flowlink:daru-game:v2:best-detection:normal");
  assert.equal(BEST_RECORD_STORAGE_KEYS.hard, "flowlink:daru-game:v2:hard40:best-detection:hard");
  assert.notEqual(BEST_RECORD_STORAGE_KEYS.hard, OLD_HARD_KEY);
});

test("old HARD guest best is ignored and HARD40 establishes its own first and subsequent best", () => {
  const storage = new Map([[OLD_HARD_KEY, "95"]]);
  const first = resolveGuestBest(storage.get(BEST_RECORD_STORAGE_KEYS.hard) ?? null, 80, true);
  assert.deepEqual(first, { previousBest: null, isNewBest: true });
  storage.set(BEST_RECORD_STORAGE_KEYS.hard, "80");

  const second = resolveGuestBest(storage.get(BEST_RECORD_STORAGE_KEYS.hard) ?? null, 82, true);
  assert.deepEqual(second, { previousBest: 80, isNewBest: true });
  assert.equal(storage.get(OLD_HARD_KEY), "95");
});

test("ineligible and lower HARD40 scores do not replace the current best", () => {
  assert.deepEqual(resolveGuestBest("82", 81, true), { previousBest: 82, isNewBest: false });
  assert.deepEqual(resolveGuestBest("82", 90, false), { previousBest: 82, isNewBest: false });
});

test("only the explicit outdated deck 409 is treated as a legacy run", () => {
  assert.equal(isOutdatedDeckError({ status: 409, code: OUTDATED_DECK_ERROR_CODE }), true);
  assert.equal(isOutdatedDeckError({ status: 409, code: "OTHER_CONFLICT" }), false);
  assert.equal(isOutdatedDeckError({ status: 404, code: OUTDATED_DECK_ERROR_CODE }), false);
});

test("only RUN_EXPIRED 409 is treated as an expired run", () => {
  assert.equal(isExpiredRunError({ status: 409, code: RUN_EXPIRED_ERROR_CODE }), true);
  assert.equal(isExpiredRunError({ status: 409, code: "OTHER_CONFLICT" }), false);
  assert.equal(isExpiredRunError({ status: 404, code: RUN_EXPIRED_ERROR_CODE }), false);
});

test("terminal recovery is limited to outdated and expired run codes", () => {
  assert.equal(terminalRunRecoveryReason({ status: 409, code: OUTDATED_DECK_ERROR_CODE }), "outdated-deck");
  assert.equal(terminalRunRecoveryReason({ status: 409, code: RUN_EXPIRED_ERROR_CODE }), "expired");
  assert.equal(terminalRunRecoveryReason({ status: 409, code: "OTHER_CONFLICT" }), null);
  assert.equal(terminalRunRecoveryReason({ status: 404, code: RUN_EXPIRED_ERROR_CODE }), null);
});
