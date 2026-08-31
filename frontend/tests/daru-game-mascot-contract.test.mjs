import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stageSource = readFileSync(new URL("../src/components/mascot/DaruStage.tsx", import.meta.url), "utf8");
const mascotCss = readFileSync(new URL("../src/components/mascot/DaruMascot.module.css", import.meta.url), "utf8");
const gameSource = readFileSync(new URL("../src/components/daru-game/DaruGame.tsx", import.meta.url), "utf8");
const gameStatusSource = readFileSync(new URL("../src/components/daru-game/GameStatus.tsx", import.meta.url), "utf8");

test("daru-game no longer hard-hides the global mascot while hidden mode still does", () => {
  assert.doesNotMatch(stageSource, /mode === "hidden"\s*\|\|\s*pathname === "\/daru-game"/);
  assert.match(stageSource, /if \(mode === "hidden"\) return null/);
});

test("daru-game applies a route-specific game-safe stage", () => {
  assert.match(stageSource, /const isDaruGame = pathname === "\/daru-game"/);
  assert.match(stageSource, /data-game-safe=\{isDaruGame \|\| undefined\}/);
  assert.match(mascotCss, /\.stage\[data-game-safe\][\s\S]+transform: none/);
});

test("game-safe active uses constrained autonomous movement while drag stays disabled", () => {
  assert.match(stageSource, /const chooseGameSafeDestination = useCallback/);
  assert.match(stageSource, /\[data-daru-game-blocker\]/);
  assert.match(stageSource, /if \(isDaruGame && !gameSafe\) return false/);
  assert.match(stageSource, /isDaruGame \? chooseGameSafeDestination\(\) : chooseSafeDestination\(\)/);
  assert.match(stageSource, /beginMovementTo\(target, isDaruGame\)/);
  assert.match(stageSource, /mode === "hidden" \|\| isDaruGame/);
  assert.match(stageSource, /<DaruMascot[\s\S]+onInteract=\{handleCharacterClick\}/);
  assert.match(gameSource, /data-daru-game-blocker/);
  assert.match(gameStatusSource, /data-daru-game-blocker/);
});

test("route entry resets inherited roaming before game-safe active movement can start", () => {
  assert.match(stageSource, /const resetGameSafePosition = useCallback\(\(\) => \{\s*setPosition\(\{ x: 0, y: 0 \}\)/);
  assert.match(stageSource, /useEffect\(\(\) => \{\s*if \(!isDaruGame\) return;\s*nextRoamDelayRef\.current = null;\s*freezeRoaming\(\);[\s\S]*?resetGameSafePosition\(\);\s*\}, \[freezeRoaming, isDaruGame, resetGameSafePosition\]\)/);
  assert.match(stageSource, /const freezeRoaming = useCallback\(\(\) => \{[\s\S]*window\.clearTimeout\(locomotionTimerRef\.current\)[\s\S]*setRoaming\(false\)[\s\S]*setMovementSpeed\(0\)[\s\S]*setLocomotion\("idle"\)/);
  assert.match(stageSource, /if \(!isDaruGame \|\| mode === "active"\) return;[\s\S]*freezeRoaming\(\);[\s\S]*resetGameSafePosition\(\)/);
});

test("game-safe destination keeps the current position when no safe candidate exists", () => {
  assert.match(stageSource, /const chooseGameSafeDestination = useCallback\(\(\) => \{[\s\S]*const currentPosition = positionRef\.current;[\s\S]*for \(const candidate of candidates\) \{[\s\S]*return currentPosition;\s*\}, \[\]\)/);
  assert.doesNotMatch(stageSource, /const chooseGameSafeDestination = useCallback\(\(\) => \{[\s\S]*return \{ x: 0, y: 0 \};\s*\}, \[\]\)/);
});

test("game-safe active and quiet have distinct sizes and transform policies", () => {
  const desktopGameSafe = mascotCss.match(/\.stage\[data-game-safe\] \{([^}]*)\}/)?.[1] ?? "";
  const mobileGameSafe = mascotCss.match(/@media \(max-width: 600px\) \{\s*\.stage\[data-game-safe\] \{([^}]*)\}/)?.[1] ?? "";

  assert.doesNotMatch(desktopGameSafe, /right:/);
  assert.doesNotMatch(mobileGameSafe, /right:/);
  assert.match(desktopGameSafe, /width: 112px/);
  assert.match(mobileGameSafe, /width: 72px/);
  assert.match(mascotCss, /\.stage\[data-game-safe\]\[data-mode="active"\][\s\S]*translate3d/);
  assert.match(mascotCss, /\.stage\[data-game-safe\]\[data-mode="quiet"\][\s\S]*transform: none/);
  assert.match(mascotCss, /\.stage\[data-game-safe\] \.character \{ width: 108px; height: 108px/);
  assert.match(mascotCss, /\.stage\[data-game-safe\] \.mascot\[data-mode="quiet"\] \.character \{ width: 88px; height: 88px/);
  assert.match(mascotCss, /@media \(max-width: 600px\)[\s\S]*\.stage\[data-game-safe\] \.character \{ width: 68px; height: 68px/);
  assert.match(mascotCss, /@media \(max-width: 600px\)[\s\S]*\.stage\[data-game-safe\] \.mascot\[data-mode="quiet"\] \.character \{ width: 56px; height: 56px/);
  assert.match(mascotCss, /\.stage \{[\s\S]*?right: 102px/);
  assert.match(mascotCss, /@media \(max-width: 1024px\) \{ \.stage \{ right: 91px/);
  assert.match(mascotCss, /@media \(max-width: 600px\) \{ \.stage \{ right: 76px/);
});

test("direct greeting moves only active game-safe Daru through the constrained policy", () => {
  assert.match(stageSource, /if \(isDaruGame && latest\.mode !== "active"\) return/);
  assert.match(stageSource, /const target = isDaruGame \? chooseGameSafeDestination\(\) : chooseSafeDestination\(\)/);
  assert.match(stageSource, /beginMovementTo\(target, isDaruGame\)/);
});
