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

test("game-safe desktop and mobile sizes stay compact in the viewport corner", () => {
  assert.match(mascotCss, /\.stage\[data-game-safe\][\s\S]+right: max\(18px, env\(safe-area-inset-right\)\)[\s\S]+width: 112px/);
  assert.match(mascotCss, /@media \(max-width: 600px\)[\s\S]+\.stage\[data-game-safe\][\s\S]+right: max\(8px, env\(safe-area-inset-right\)\)[\s\S]+width: 72px/);
});
