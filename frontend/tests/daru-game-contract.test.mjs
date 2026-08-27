import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BEST_RECORD_STORAGE_KEYS, resolveGuestBest } from "../src/components/daru-game/game.storage.ts";
import { getLeaderboardPageRequest, isLeaderboardDifficulty, isLeaderboardScoreTie } from "../src/components/daru-game/leaderboard.utils.ts";
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

test("an overtime guest completion can replace the local best", () => {
  assert.deepEqual(resolveGuestBest("70", 75, true), { previousBest: 70, isNewBest: true });
  assert.deepEqual(resolveGuestBest("90", 75, true), { previousBest: 90, isNewBest: false });
});

test("overtime completion and leaderboard copy describe the new ranking policy", () => {
  const resultSource = readFileSync(new URL("../src/components/daru-game/GameResult.tsx", import.meta.url), "utf8");
  const leaderboardSource = readFileSync(new URL("../src/components/daru-game/DaruLeaderboard.tsx", import.meta.url), "utf8");
  assert.match(resultSource, /제한시간을 초과해 속도 점수는 0점으로 반영되었어요/);
  assert.match(resultSource, /완주 기록은 랭킹에 정상 반영됩니다/);
  assert.match(resultSource, /완주 기록은 개인 최고기록에 반영됩니다/);
  assert.match(leaderboardSource, /제한시간을 초과해도 완주 기록은 등록되며, 속도 점수는 0점으로 계산됩니다/);
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

test("a leaderboard response is visible only for the selected difficulty", () => {
  assert.equal(isLeaderboardDifficulty("EASY", "EASY"), true);
  assert.equal(isLeaderboardDifficulty("EASY", "NORMAL"), false);
});

test("a failed next-page request retries the displayed next page without skipping", () => {
  assert.deepEqual(getLeaderboardPageRequest(1, 2, 1, 4), { page: 2, retry: true });
  assert.deepEqual(getLeaderboardPageRequest(2, 2, 1, 4), { page: 3, retry: false });
});

test("equal scores explain the ranking tie-break instead of showing a zero-point gap", () => {
  assert.equal(isLeaderboardScoreTie(5, 0), true);
  assert.equal(isLeaderboardScoreTie(1, 0), false);
  assert.equal(isLeaderboardScoreTie(5, 0.1), false);
});
