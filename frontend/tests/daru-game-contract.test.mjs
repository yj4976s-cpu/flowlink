import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BEST_RECORD_STORAGE_KEYS, isGuestBestEligible, resolveGuestBest } from "../src/components/daru-game/game.storage.ts";
import { bulkDeleteIncludesBest, getBulkSelectedCount, getLeaderboardPageRequest, isLeaderboardDifficulty, isLeaderboardScoreTie } from "../src/components/daru-game/leaderboard.utils.ts";
import { BOARD_SAFETY_PX, SUPPORTED_BOARD_COLUMNS, calculateMemoryBoardGeometry, memoryBoardGeometryEqual } from "../src/components/daru-game/memoryBoard.geometry.ts";
import { constrainedShuffleCards, hasAdjacentPair, hasAdjacentPairForColumns } from "../src/components/daru-game/deckShuffle.ts";
import { createActionId } from "../src/lib/daruActionId.ts";
import { isExpiredRunError, isOutdatedDeckError, OUTDATED_DECK_ERROR_CODE, RUN_EXPIRED_ERROR_CODE, terminalRunRecoveryReason } from "../src/lib/daruRunRecovery.ts";

const OLD_HARD_KEY = "flowlink:daru-game:v2:best-detection:hard";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const apiSource = readFileSync(new URL("../src/lib/daruGameApi.ts", import.meta.url), "utf8");
const gameSource = readFileSync(new URL("../src/components/daru-game/DaruGame.tsx", import.meta.url), "utf8");
const leaderboardSource = readFileSync(new URL("../src/components/daru-game/DaruLeaderboard.tsx", import.meta.url), "utf8");

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test("all difficulties generate one hundred non-adjacent randomized decks", () => {
  const cases = [["easy", 20, 10], ["normal", 32, 16], ["hard", 40, 20]];
  for (const [difficulty, cardCount, pairCount] of cases) {
    const supportedColumns = SUPPORTED_BOARD_COLUMNS[difficulty];
    const source = Array.from({ length: pairCount }, (_, pairId) => [{ id: `${pairId}-0`, pairId: String(pairId) }, { id: `${pairId}-1`, pairId: String(pairId) }]).flat();
    const decks = Array.from({ length: 100 }, (_, seed) => constrainedShuffleCards(source, supportedColumns, seededRandom(seed + 1)));
    assert.ok(decks.every((deck) => deck.length === cardCount));
    assert.ok(decks.every((deck) => new Set(deck.map((card) => card.pairId)).size === pairCount));
    assert.ok(decks.every((deck) => !hasAdjacentPairForColumns(deck, supportedColumns)), `${difficulty} produced a responsive adjacent pair`);
    assert.ok(decks.every((deck) => supportedColumns.every((columns) => !hasAdjacentPair(deck, columns))));
    assert.ok(new Set(decks.map((deck) => deck.map((card) => card.id).join(","))).size > 90);
  }
});

test("constrained shuffle fallback remains valid after repeated failed shuffles", () => {
  for (const [difficulty, pairCount, desktopColumns] of [["easy", 10, 5], ["normal", 16, 8], ["hard", 20, 10]]) {
    const supportedColumns = SUPPORTED_BOARD_COLUMNS[difficulty];
    const source = Array.from({ length: pairCount }, (_, pairId) => [{ pairId: String(pairId) }, { pairId: String(pairId) }]).flat();
    const decks = Array.from({ length: 20 }, (_, seed) => constrainedShuffleCards(source, supportedColumns, seededRandom(seed + 101), 0));
    for (const deck of decks) {
      assert.equal(deck.length, source.length);
      assert.equal(hasAdjacentPairForColumns(deck, supportedColumns), false);
      assert.ok(supportedColumns.every((columns) => !hasAdjacentPair(deck, columns)));
      assert.ok([...new Set(deck.map((card) => card.pairId))].every((pairId) => deck.filter((card) => card.pairId === pairId).length === 2));
      assert.notDeepEqual(deck.slice(0, deck.length / 2).map((card) => card.pairId), deck.slice(deck.length / 2).map((card) => card.pairId));
      const positions = new Map();
      deck.forEach((card, index) => positions.set(card.pairId, [...(positions.get(card.pairId) ?? []), index]));
      assert.equal([...positions.values()].every(([first, second]) => second - first === desktopColumns * 2), false);
    }
    assert.ok(new Set(decks.map((deck) => deck.map((card) => card.pairId).join(","))).size > 15);
  }
});

test("memory board geometry keeps desktop difficulty columns and fits without scrollbars", () => {
  const cases = [["easy", 20, 5], ["normal", 32, 8], ["hard", 40, 10]];
  for (const [difficulty, cardCount, columns] of cases) {
    const geometry = calculateMemoryBoardGeometry({ difficulty, cardCount, availableWidth: 1300, availableHeight: 530, viewportWidth: 1366, viewportHeight: 768 });
    assert.equal(geometry.columns, columns);
    assert.ok(geometry.boardWidth <= 1300 - BOARD_SAFETY_PX);
    assert.ok(geometry.boardHeight <= 530 - BOARD_SAFETY_PX);
  }
});

test("memory board cards shrink with available height and preserve mobile reflow", () => {
  const tall = calculateMemoryBoardGeometry({ difficulty: "hard", cardCount: 40, availableWidth: 1200, availableHeight: 530, viewportWidth: 1280, viewportHeight: 720 });
  const short = calculateMemoryBoardGeometry({ difficulty: "hard", cardCount: 40, availableWidth: 1200, availableHeight: 430, viewportWidth: 1280, viewportHeight: 620 });
  const mobile = calculateMemoryBoardGeometry({ difficulty: "hard", cardCount: 40, availableWidth: 370, availableHeight: 600, viewportWidth: 390, viewportHeight: 844 });
  assert.ok(short.cardWidth < tall.cardWidth);
  assert.equal(mobile.reflow, true);
  assert.equal(mobile.columns, 4);
  assert.ok(mobile.boardHeight <= 600 - BOARD_SAFETY_PX);
});

test("identical memory board geometry skips redundant DOM updates", () => {
  const geometry = calculateMemoryBoardGeometry({ difficulty: "normal", cardCount: 32, availableWidth: 1200, availableHeight: 500, viewportWidth: 1280, viewportHeight: 720 });
  assert.equal(memoryBoardGeometryEqual(null, geometry), false);
  assert.equal(memoryBoardGeometryEqual(geometry, { ...geometry }), true);
  assert.equal(memoryBoardGeometryEqual(geometry, { ...geometry, cardWidth: geometry.cardWidth - 0.1 }), false);
});

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

test("authoritative completion keeps pending and retry UI inside the board stage", () => {
  const css = readFileSync(new URL("../src/components/daru-game/DaruGame.module.css", import.meta.url), "utf8");
  assert.match(gameSource, /const RESULT_PENDING_DELAY_MS = 1500/);
  assert.match(gameSource, /setTimeout\([\s\S]*setShowResultPendingOverlay\(true\)[\s\S]*RESULT_PENDING_DELAY_MS/);
  assert.match(gameSource, /<div className=\{styles\.boardStage\}[\s\S]*<MemoryBoard[\s\S]*styles\.resultPendingOverlay/);
  assert.doesNotMatch(gameSource, /recordStatus === "saving" && <p className=\{styles\.authRecoveryNotice\}/);
  assert.match(gameSource, /recordStatus === "saving"[\s\S]*role="status" aria-live="polite"/);
  assert.match(gameSource, /recordStatus === "failed"[\s\S]*role="alert"[\s\S]*결과 다시 확인/);
  assert.match(css, /\.resultPendingOverlay \{ position: absolute;[^}]*inset: 0;/);
  assert.doesNotMatch(css, /\.resultPendingOverlay \{[^}]*grid-row/);
});

test("completion keeps authoritative USER results and direct guest or admin outcomes", () => {
  assert.match(gameSource, /submitDaruGameResult\(\{ run_id: runId, finish_partial: finishPartial \}\)/);
  assert.match(gameSource, /recoverRunState\(runId, difficulty\)/);
  assert.match(gameSource, /setLeaderboardRank\(response\.leaderboard_rank\)/);
  assert.match(gameSource, /setPersonalBestPower\(response\.record\.best_detection_power\)/);
  assert.match(gameSource, /isGuestBestEligible\(authResolved, currentUser\?\.role\)/);
  assert.match(gameSource, /currentUser\?\.role === "ADMIN" \? "admin" : "guest"/);
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
  assert.match(resultSource, /\{newBest \? newBestTitle : withinTimeLimit \? "다루와 전부 찾았어요!" : "클리어 완료!"\}/);
  assert.match(resultSource, /제한시간을 초과해 속도 점수는 0점으로 반영되었어요/);
  assert.match(resultSource, /이번 완주 기록이 현재 랭킹에 반영됩니다/);
  assert.match(resultSource, /완주 기록도 개인 최고기록 비교 대상에 포함됩니다/);
  assert.match(leaderboardSource, /제한시간을 초과해도 완주 기록은 등록되며, 속도 점수는 0점으로 계산됩니다/);
});

test("leaderboard uses latest-score fields and shows personal BEST separately", () => {
  assert.match(leaderboardSource, /entry\.detection_power/);
  assert.match(leaderboardSource, /visible\.my_best\.best_detection_power/);
  assert.match(leaderboardSource, /현재 랭킹/);
  assert.match(leaderboardSource, /개인 BEST/);
});

test("play history shares difficulty and resets its page", () => {
  assert.match(leaderboardSource, /getDaruGameHistory\(requestDifficulty, historyPage/);
  assert.match(leaderboardSource, /setHistoryPage\(1\)/);
  assert.doesNotMatch(leaderboardSource, /historyTabs/);
});

test("difficulty changes clear trash actions and reject stale history responses", () => {
  assert.match(leaderboardSource, /setTrash\(null\); setTrashPage\(1\); setTrashLoading\(true\)/);
  assert.match(leaderboardSource, /setHistoryView\("active"\); setManagementMode\(false\)/);
  assert.match(leaderboardSource, /setDeleteTarget\(null\); setBulkMenuOpen\(false\)/);
  assert.match(leaderboardSource, /setUndoRecord\(null\); setUndoError\(false\)/);
  assert.match(leaderboardSource, /getDaruGameTrash\(requestDifficulty, trashPage, controller\.signal\)[\s\S]*controller\.signal\.aborted \|\| !isLeaderboardDifficulty\(next\.difficulty, requestDifficulty\)/);
  assert.match(leaderboardSource, /getDaruGameHistory\(requestDifficulty, historyPage, controller\.signal\)[\s\S]*controller\.signal\.aborted \|\| !isLeaderboardDifficulty\(next\.difficulty, requestDifficulty\)/);
});

test("history is fixed to five records and corrects an invalid last page", () => {
  assert.match(apiSource, /getDaruGameHistory\([^)]*pageSize = 5\)/);
  assert.match(apiSource, /history\?difficulty=\$\{difficulty\}&page=\$\{page\}&page_size=\$\{pageSize\}/);
  assert.match(leaderboardSource, /if \(next\.page !== historyPage\) setHistoryPage\(next\.page\)/);
});

test("history exposes BEST ranking and partial labels with distinct icons", () => {
  assert.match(leaderboardSource, /<CrownIcon \/> BEST/);
  assert.match(leaderboardSource, /<PawIcon \/> 랭킹 반영/);
  assert.match(leaderboardSource, /<ClockIcon \/> 미완주/);
});

test("history management provides selection mode and accessible individual deletion", () => {
  assert.match(leaderboardSource, /setManagementMode\(true\)/);
  assert.match(leaderboardSource, /type="checkbox"/);
  assert.match(leaderboardSource, /개 선택/);
  assert.match(leaderboardSource, /선택한 플레이 기록을 휴지통으로 이동/);
  assert.match(leaderboardSource, /전체 선택/);
  assert.match(leaderboardSource, /!managementMode && <button type="button" aria-label="플레이 기록을 휴지통으로 이동"/);
});

test("ordinary individual deletion skips the dialog while BEST and multiple deletion keep confirmation", () => {
  assert.match(leaderboardSource, /item\.is_best \|\| item\.is_ranking_record \? openDeleteDialog\(item\) : void deleteSingleRecord\(item\)/);
  assert.match(leaderboardSource, /최고 기록을 휴지통으로 이동할까요/);
  assert.match(leaderboardSource, /현재 랭킹 기록을 휴지통으로 이동할까요/);
  assert.match(leaderboardSource, /선택한 플레이 기록/);
  assert.match(leaderboardSource, /selectedCount > 0 \? `\$\{selectedCount\}개 휴지통으로 이동` : "휴지통으로 이동"/);
  assert.match(leaderboardSource, /현재 ‘.*’ 기록을 휴지통으로 이동할까요/);
  assert.match(leaderboardSource, /모든 난이도의 기록을 정리할까요/);
});

test("ordinary deletion uses a real restore API and one six-second undo toast", () => {
  assert.match(apiSource, /restoreDaruGameHistoryRecord/);
  assert.match(apiSource, /history\/\$\{recordId\}\/restore/);
  assert.match(leaderboardSource, /window\.setTimeout[\s\S]*6000/);
  assert.match(leaderboardSource, /휴지통으로 이동했어요/);
  assert.match(leaderboardSource, /되돌리기/);
  assert.match(leaderboardSource, /await restoreDaruGameHistoryRecord\(item\.id\)/);
  assert.match(leaderboardSource, /if \(undoTimerRef\.current !== null\) window\.clearTimeout/);
});

test("history delete dialogs reset stale errors and stay open while deleting", () => {
  assert.match(leaderboardSource, /const openDeleteDialog = \(target: DeleteTarget\)/);
  assert.match(leaderboardSource, /if \(deleting\) return/);
  assert.match(leaderboardSource, /event\.target === event\.currentTarget && !deleting/);
  assert.match(leaderboardSource, /event\.key === "Escape" && !deleting/);
  assert.match(leaderboardSource, /autoFocus onClick=\{closeDeleteDialog\} disabled=\{deleting\}/);
  assert.match(leaderboardSource, /role="alertdialog"/);
  assert.match(leaderboardSource, /event\.key !== "Tab"/);
  assert.match(leaderboardSource, /catch \{ setDeleteError\(true\); \} finally \{ setDeleting\(false\); \}/);
});

test("history remains a full-width sibling after the ranking grid", () => {
  assert.match(leaderboardSource, /<\/div>\s*\{!preview && <section className=\{`\$\{styles\.playHistory\} \$\{styles\.historySummary\}`\}/);
  assert.match(leaderboardSource, /내 플레이 기록/);
});

test("history has an accessible delete control and empty state", () => {
  assert.match(leaderboardSource, /aria-label="플레이 기록을 휴지통으로 이동"/);
  assert.match(leaderboardSource, /기록 선택/);
  assert.match(leaderboardSource, /아직 플레이 기록이 없어요/);
});

test("main history expands from a three-record summary into an inline manager", () => {
  assert.match(leaderboardSource, /getDaruGameHistory\(requestDifficulty, 1, controller\.signal, 3\)/);
  assert.match(leaderboardSource, /recentHistory\.items\.slice\(0, 3\)/);
  assert.match(leaderboardSource, /전체 기록 \{recentHistory\?\.total \?\? 0\}개/);
  assert.match(leaderboardSource, /historyExpanded \? "간단히 보기"/);
  assert.match(leaderboardSource, /id="history-manager" className=\{styles\.historyManager\}/);
  assert.match(leaderboardSource, /role="tablist"[\s\S]*전체 기록[\s\S]*휴지통/);
  assert.match(leaderboardSource, /className=\{styles\.historyManagerPagination\} aria-label="전체 기록 페이지"/);
  assert.doesNotMatch(leaderboardSource, /historyDrawer|aria-haspopup="dialog"|role="dialog"/);
  assert.doesNotMatch(leaderboardSource, /historySummaryList[\s\S]{0,1200}deleteSingleRecord/);
});

test("history manager stays inline, responsive, and out of overlay document behavior", () => {
  const css = readFileSync(new URL("../src/components/daru-game/DaruGame.module.css", import.meta.url), "utf8");
  assert.match(leaderboardSource, /data-expanded=\{historyExpanded \|\| undefined\}/);
  assert.match(leaderboardSource, /aria-controls="history-manager"/);
  assert.match(leaderboardSource, /manageButtonRef\.current\?\.focus\(\)/);
  assert.match(css, /\.historyManager \{ min-width: 0;[^}]*animation: historyManagerIn/);
  assert.match(css, /\.historyManagerListViewport \{ min-height: 360px; \}/);
  assert.match(css, /@media \(max-width: 520px\)[^{]*\{ \.historyManagerListViewport \{ min-height: 320px/);
  assert.match(css, /prefers-reduced-motion[\s\S]*historyManager/);
  assert.doesNotMatch(leaderboardSource, /document\.body\.style\.overflow|aria-modal="true" aria-labelledby="history-drawer-title"/);
  assert.doesNotMatch(css, /historyDrawer|position: fixed; z-index: 110/);
});

test("trash view supports count, pagination, restore, permanent delete, and scoped emptying", () => {
  assert.match(apiSource, /getDaruGameTrash/);
  assert.match(apiSource, /history\/trash\?difficulty=\$\{difficulty\}&page=\$\{page\}&page_size=5/);
  assert.match(apiSource, /permanentlyDeleteDaruGameHistoryRecord/);
  assert.match(apiSource, /emptyDaruGameTrash/);
  assert.match(leaderboardSource, /휴지통에 보관된 기록은 복원하거나 영구 삭제할 수 있어요/);
  assert.match(leaderboardSource, /<TrashIcon \/> 휴지통 비우기/);
  assert.doesNotMatch(leaderboardSource, /DIFFICULTY_CONFIG\[difficulty\]\.label\} 휴지통 비우기/);
  assert.match(leaderboardSource, /휴지통이 비어 있어요/);
  assert.match(leaderboardSource, /<RestoreIcon \/> 복원/);
  assert.match(leaderboardSource, /<TrashIcon \/> 영구 삭제/);
  assert.match(leaderboardSource, /aria-label="휴지통 페이지"/);
});

test("ranking records are excluded from selection and retain a dedicated dialog", () => {
  assert.match(leaderboardSource, /managementMode && !item\.is_ranking_record/);
  assert.match(leaderboardSource, /현재 랭킹 기록을 휴지통으로 이동할까요/);
  assert.match(leaderboardSource, /이전 기록이 자동으로 등록되지는 않아요/);
  assert.match(leaderboardSource, /랭킹에서 제외하고 이동/);
});

test("history selection deletion uses one server request and supports whole-difficulty scope", () => {
  assert.match(apiSource, /deleteDaruGameHistorySelection/);
  assert.match(apiSource, /\/api\/daru-game\/history\/delete/);
  assert.match(leaderboardSource, /exclude_record_ids/);
  assert.match(leaderboardSource, /setRetryKey/);
});

test("history styles derive accents from the shared theme variables", () => {
  const css = readFileSync(new URL("../src/components/daru-game/DaruGame.module.css", import.meta.url), "utf8");
  assert.match(css, /\.playHistory[\s\S]*var\(--rank-accent\)/);
  assert.match(css, /html\[data-theme="dawn"\][\s\S]*html\[data-theme="day"\][\s\S]*html\[data-theme="night"\]/);
  assert.match(css, /\.historyUndoToast[\s\S]*html\[data-theme="dawn"\][\s\S]*html\[data-theme="night"\]/);
  assert.match(css, /prefers-reduced-motion/);
});

test("trash actions share one rounded icon and horizontal button alignment", () => {
  const css = readFileSync(new URL("../src/components/daru-game/DaruGame.module.css", import.meta.url), "utf8");
  assert.match(leaderboardSource, /function TrashIcon\(\)[\s\S]*viewBox="0 0 24 24"[\s\S]*M3 6h18/);
  assert.match(leaderboardSource, /aria-label="선택한 플레이 기록을 휴지통으로 이동"/);
  assert.match(leaderboardSource, /aria-label="기록 관리 옵션"/);
  assert.match(leaderboardSource, /현재 난이도 기록 정리/);
  assert.match(leaderboardSource, /모든 난이도 기록 정리/);
  assert.match(css, /\.playHistory \.trashIcon \{ width: 18px; height: 18px; stroke-width: 2;/);
  assert.match(css, /\.historyManagement button \{ display: inline-flex; align-items: center; justify-content: center; gap: 7px;/);
  assert.match(css, /\.historyManager \.historyManagement \{[^}]*grid-template-columns: auto minmax\(60px, 1fr\) auto/);
  assert.match(css, /\.historyManagement \.selectedDelete:disabled \{[^}]*opacity: \.58/);
  assert.match(leaderboardSource, /historyUndoToast[\s\S]*<TrashIcon \/>[\s\S]*되돌리기/);
  assert.doesNotMatch(leaderboardSource, /historyUndoToast[^\n]*<button[^>]*><RestoreIcon/);
});

test("history management is conditional and rare bulk actions stay in a confirmed menu", () => {
  assert.match(leaderboardSource, /managementMode && \(history\?\.total \?\? 0\) > 0 && <div className=\{styles\.historyManagement\}/);
  assert.match(leaderboardSource, /aria-haspopup="menu" aria-expanded=\{bulkMenuOpen\}/);
  assert.match(leaderboardSource, /openDeleteDialog\("difficulty"\)/);
  assert.match(leaderboardSource, /openDeleteDialog\("all"\)/);
  assert.match(leaderboardSource, /각 난이도의 현재 랭킹 반영 기록은 보호되며/);
  assert.match(leaderboardSource, /deleteTarget === "all" \? "기록 정리"/);
  assert.match(leaderboardSource, /setManagementMode\(false\); resetSelection\(\)/);
});

test("bulk cleanup copy explains ranking protection and uses the server deletion count", () => {
  assert.match(apiSource, /deleteAllDaruGameHistory[\s\S]*deleted_count/);
  assert.match(leaderboardSource, /현재 난이도 기록 정리/);
  assert.doesNotMatch(leaderboardSource, /현재 난이도 기록 전체 정리/);
  assert.match(leaderboardSource, /각 난이도의 현재 랭킹 반영 기록은 보호되며/);
  assert.match(leaderboardSource, /현재 랭킹에 반영 중인 기록은 보호되며/);
  assert.match(leaderboardSource, /deletedCount = result\.deleted_count/);
  assert.match(leaderboardSource, /정리할 수 있는 기록이 없어요\. 현재 랭킹 반영 기록은 유지됩니다\./);
  assert.match(leaderboardSource, /랭킹 반영 기록을 제외한 플레이 기록 \$\{deletedCount\}개/);
  assert.doesNotMatch(leaderboardSource, /기록이 모두 휴지통으로 이동합니다/);
});

test("bulk selection and BEST warnings use backend management metadata", () => {
  assert.equal(getBulkSelectedCount(5, 0), 5);
  assert.equal(getBulkSelectedCount(5, 2), 3);
  assert.equal(getBulkSelectedCount(0, 0), 0);
  assert.equal(getBulkSelectedCount(0, 1), 0);
  const options = {
    target: "selected",
    selectAllDifficulty: true,
    deletableBestRecordId: 101,
    excludedIds: new Set(),
    hasDeletableBest: true,
    hasDeletableBestAnyDifficulty: false,
    selectedItemsHaveBest: false,
  };
  assert.equal(bulkDeleteIncludesBest(options), true);
  assert.equal(bulkDeleteIncludesBest({ ...options, excludedIds: new Set([101]) }), false);
  assert.equal(bulkDeleteIncludesBest({ ...options, excludedIds: new Set([102]) }), true);
  assert.equal(bulkDeleteIncludesBest({ ...options, deletableBestRecordId: null }), false);
  assert.equal(bulkDeleteIncludesBest({ ...options, selectAllDifficulty: false, selectedItemsHaveBest: true }), true);
  assert.equal(bulkDeleteIncludesBest({ ...options, selectAllDifficulty: false, selectedItemsHaveBest: false }), false);
  assert.equal(bulkDeleteIncludesBest({ ...options, target: "difficulty", hasDeletableBest: true }), true);
  assert.equal(bulkDeleteIncludesBest({ ...options, target: "all", hasDeletableBestAnyDifficulty: true }), true);
  assert.doesNotMatch(leaderboardSource, /rankingSelectionOffset|myEntry \? 1 : 0/);
  assert.match(leaderboardSource, /history\?\.deletable_count/);
  assert.match(leaderboardSource, /history\?\.deletable_best_record_id/);
  assert.match(leaderboardSource, /disabled=\{selectedCount === 0 \|\| deleting\}/);
});

test("history typography keeps readable sizes and stable responsive rows", () => {
  const css = readFileSync(new URL("../src/components/daru-game/DaruGame.module.css", import.meta.url), "utf8");
  assert.match(css, /--record-section-title-size: 17px/);
  assert.match(css, /--record-primary-size: 13px/);
  assert.match(css, /--record-score-size: 22px/);
  assert.match(css, /--record-meta-size: 13px/);
  assert.match(css, /--record-badge-size: 12px/);
  assert.match(css, /--record-action-size: 13px/);
  assert.match(css, /\.playHistory li \{[^}]*min-height: 72px/);
  assert.match(css, /\.playHistory li > span \{[^}]*line-height: 1\.45/);
  assert.match(css, /\.historyDestructive button \{[^}]*font-size: 12px; font-weight: 600/);
  assert.match(css, /@media \(max-width: 720px\)[^{]*\{[^}]*\.playHistory li \{ grid-template-columns: 1fr auto/);
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
