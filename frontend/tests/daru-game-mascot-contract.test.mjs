import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stageSource = readFileSync(new URL("../src/components/mascot/DaruStage.tsx", import.meta.url), "utf8");
const mascotCss = readFileSync(new URL("../src/components/mascot/DaruMascot.module.css", import.meta.url), "utf8");

test("daru-game no longer hard-hides the global mascot while hidden mode still does", () => {
  assert.doesNotMatch(stageSource, /mode === "hidden"\s*\|\|\s*pathname === "\/daru-game"/);
  assert.match(stageSource, /if \(mode === "hidden"\) return null/);
});

test("daru-game applies a route-specific game-safe stage", () => {
  assert.match(stageSource, /const isDaruGame = pathname === "\/daru-game"/);
  assert.match(stageSource, /data-game-safe=\{isDaruGame \|\| undefined\}/);
  assert.match(mascotCss, /\.stage\[data-game-safe\][\s\S]+transform: none/);
});

test("game-safe mode prevents autonomous roaming and dragging while preserving interaction rendering", () => {
  assert.match(stageSource, /if \(isDaruGame\) return false/);
  assert.match(stageSource, /mode === "hidden" \|\| isDaruGame/);
  assert.match(stageSource, /isDaruGame \|\| !pageVisible/);
  assert.match(stageSource, /<DaruMascot[\s\S]+onInteract=\{handleCharacterClick\}/);
});

test("entering daru-game immediately freezes inherited roaming and locomotion", () => {
  assert.match(stageSource, /useEffect\(\(\) => \{\s*if \(!isDaruGame\) return;\s*nextRoamDelayRef\.current = null;\s*freezeRoaming\(\);\s*\}, \[freezeRoaming, isDaruGame\]\)/);
  assert.match(stageSource, /const freezeRoaming = useCallback\(\(\) => \{[\s\S]*window\.clearTimeout\(locomotionTimerRef\.current\)[\s\S]*setRoaming\(false\)[\s\S]*setMovementSpeed\(0\)[\s\S]*setLocomotion\("idle"\)/);
});

test("game-safe sizes stay compact without reusing the Copilot right-bottom slot", () => {
  const desktopGameSafe = mascotCss.match(/\.stage\[data-game-safe\] \{([^}]*)\}/)?.[1] ?? "";
  const mobileGameSafe = mascotCss.match(/@media \(max-width: 600px\) \{\s*\.stage\[data-game-safe\] \{([^}]*)\}/)?.[1] ?? "";

  assert.doesNotMatch(desktopGameSafe, /right:/);
  assert.doesNotMatch(mobileGameSafe, /right:/);
  assert.match(desktopGameSafe, /width: 112px/);
  assert.match(mobileGameSafe, /width: 72px/);
  assert.match(mascotCss, /\.stage \{[\s\S]*?right: 102px/);
  assert.match(mascotCss, /@media \(max-width: 1024px\) \{ \.stage \{ right: 91px/);
  assert.match(mascotCss, /@media \(max-width: 600px\) \{ \.stage \{ right: 76px/);
});
