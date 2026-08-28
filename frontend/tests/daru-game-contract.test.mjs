import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BEST_RECORD_STORAGE_KEYS, isGuestBestEligible, resolveGuestBest } from "../src/components/daru-game/game.storage.ts";
import { getLeaderboardPageRequest, isLeaderboardDifficulty, isLeaderboardScoreTie } from "../src/components/daru-game/leaderboard.utils.ts";
import { createActionId } from "../src/lib/daruActionId.ts";
import { isExpiredRunError, isOutdatedDeckError, OUTDATED_DECK_ERROR_CODE, RUN_EXPIRED_ERROR_CODE, terminalRunRecoveryReason } from "../src/lib/daruRunRecovery.ts";

const OLD_HARD_KEY = "flowlink:daru-game:v2:best-detection:hard";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const apiSource = readFileSync(new URL("../src/lib/daruGameApi.ts", import.meta.url), "utf8");
const gameSource = readFileSync(new URL("../src/components/daru-game/DaruGame.tsx", import.meta.url), "utf8");

test("action IDs prefer native randomUUID when available", () => {
  const nativeId = "123e4567-e89b-42d3-a456-426614174000";
  let fallbackCalled = false;
  const actionId = createActionId({
    randomUUID: () => nativeId,
    getRandomValues: (array) => { fallbackCalled = true; return array; },
  });
  assert.equal(actionId, nativeId);
  assert.equal(fallbackCalled, false);
});

test("action IDs use secure random bytes for an RFC 4122 UUID v4 fallback", () => {
  const actionId = createActionId({
    getRandomValues: (array) => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      bytes.forEach((_byte, index) => { bytes[index] = index; });
      return array;
    },
  });
  assert.match(actionId, UUID_V4_PATTERN);
  assert.equal(actionId, "00010203-0405-4607-8809-0a0b0c0d0e0f");
});

test("all authoritative game actions share the compatible action ID helper", () => {
  assert.match(apiSource, /const actionId = createActionId\(\)/);
  assert.doesNotMatch(apiSource, /crypto\.randomUUID\(\)/);
  for (const action of ["startDaruGameRun", "flipDaruGameCard", "requestDaruGameHint", "submitDaruGameResult"]) {
    assert.match(apiSource, new RegExp(`function ${action}[^\\n]+actionRequest`));
  }
});

test("a failed authoritative READY start recovers instead of remaining in READY", () => {
  assert.match(gameSource, /startDaruGameRun\(runId\)/);
  assert.match(gameSource, /setReadyCue\("GO!"\); setStartedAt\(authoritativeStart \?\? Date\.now\(\)\); setPhase\("playing"\)/);
  assert.match(gameSource, /setRunRecoveryNotice\("게임 시작을 확인하지 못했어요\./);
  assert.match(gameSource, /setDifficulty\(null\); setCards\(\[\]\); setPhase\("lobby"\)/);
});

test("a READY 401 recovery preserves auth expiry and blocks silent guest restart", () => {
  assert.match(gameSource, /error instanceof DaruGameApiError && error\.status === 401/);
  assert.match(gameSource, /recoveryError instanceof DaruGameApiError && recoveryError\.status === 401/);
  assert.match(gameSource, /authExpiredRef\.current = true; setAuthExpired\(true\); setLocked\(true\); setRunRecoveryNotice\(null\)/);
  assert.match(gameSource, /startDisabled=\{!authResolved \|\| authExpired \|\| Boolean\(previewRetry\)\}/);
  assert.match(gameSource, /로그인 세션이 만료되었습니다[\s\S]+\/login\?next=%2Fdaru-game[\s\S]+다시 로그인/);
});

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
  assert.equal(isGuestBestEligible(true, null), true);
  assert.deepEqual(resolveGuestBest("70", 75, true), { previousBest: 70, isNewBest: true });
  assert.deepEqual(resolveGuestBest("90", 75, true), { previousBest: 90, isNewBest: false });
});

test("unresolved auth and ADMIN games cannot use the guest local best", () => {
  assert.equal(isGuestBestEligible(false, null), false);
  assert.equal(isGuestBestEligible(true, "ADMIN"), false);
  assert.equal(isGuestBestEligible(true, "USER"), false);
});

test("overtime completion and leaderboard copy describe the new ranking policy", () => {
  const resultSource = readFileSync(new URL("../src/components/daru-game/GameResult.tsx", import.meta.url), "utf8");
  const leaderboardSource = readFileSync(new URL("../src/components/daru-game/DaruLeaderboard.tsx", import.meta.url), "utf8");
  assert.match(resultSource, /\{newBest \? newBestTitle : withinTimeLimit \? "다루와 전부 찾았어요!" : "클리어 완료!"\}/);
  assert.match(resultSource, /제한시간을 초과해 속도 점수는 0점으로 반영되었어요/);
  assert.match(resultSource, /완주 기록도 랭킹 최고기록 비교 대상에 포함됩니다/);
  assert.match(resultSource, /완주 기록도 개인 최고기록 비교 대상에 포함됩니다/);
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
