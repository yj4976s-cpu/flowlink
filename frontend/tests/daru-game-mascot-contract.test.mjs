import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stageSource = readFileSync(new URL("../src/components/mascot/DaruStage.tsx", import.meta.url), "utf8");
const mascotCss = readFileSync(new URL("../src/components/mascot/DaruMascot.module.css", import.meta.url), "utf8");
const gameSource = readFileSync(new URL("../src/components/daru-game/DaruGame.tsx", import.meta.url), "utf8");
const gameStatusSource = readFileSync(new URL("../src/components/daru-game/GameStatus.tsx", import.meta.url), "utf8");
const copilotSource = readFileSync(new URL("../src/components/copilot/FlowCopilot.tsx", import.meta.url), "utf8");
const difficultySource = readFileSync(new URL("../src/components/daru-game/DifficultySelector.tsx", import.meta.url), "utf8");

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
  assert.match(copilotSource, /data-flow-copilot-root="true"/);
  assert.match(stageSource, /'\[data-daru-game-blocker\], \[data-flow-copilot-root\]'/);
  assert.match(stageSource, /element\.getClientRects\(\)\.length > 0 && getComputedStyle\(element\)\.visibility !== "hidden"/);
  assert.doesNotMatch(stageSource, /const chooseGameSafeDestination[\s\S]*\[class\*="copilot" i\]/);
  assert.doesNotMatch(stageSource, /const chooseGameSafeDestination[\s\S]*\[aria-label\*="FlowLink AI"\]/);
  assert.match(stageSource, /const maxTravelX = mobile \? Math\.min\(96, window\.innerWidth \* 0\.22\) : tablet \? Math\.min\(220, window\.innerWidth \* 0\.26\) : Math\.min\(360, window\.innerWidth \* 0\.32\)/);
  assert.match(stageSource, /const safeCandidates = candidates\.filter/);
  assert.match(stageSource, /const maximumRightOffset = Math\.max\(0, Math\.min\(maxTravelX \* 0\.45/);
  assert.match(stageSource, /y: currentPosition\.y/);
  assert.match(stageSource, /Math\.abs\(candidate\.x - currentPosition\.x\) >= minimumTravel/);
  assert.match(stageSource, /const pathOverlaps = blockers\.some/);
  assert.match(stageSource, /pathLeft < item\.right && pathRight > item\.left && baselineTop < item\.bottom && baselineTop \+ rect\.height > item\.top/);
  assert.match(stageSource, /!overlaps\(left, baselineTop\) && !pathOverlaps/);
  assert.match(stageSource, /if \(safeCandidates\.length > 0\) return safeCandidates\[Math\.floor\(Math\.random\(\) \* safeCandidates\.length\)\]/);
  assert.doesNotMatch(stageSource, /const chooseGameSafeDestination[\s\S]*maxTravelY/);
  assert.match(stageSource, /const distance = Math\.abs\(target\.x - currentPosition\.x\)/);
  assert.doesNotMatch(stageSource, /const distance = gameSafe/);
  assert.match(stageSource, /const speed = mobile \? DARU_GROUNDED_ROAMING_CONFIG\.mobileSpeed : DARU_GROUNDED_ROAMING_CONFIG\.desktopSpeed/);
  assert.match(stageSource, /distance \/ speed \* 1000/);
  assert.match(stageSource, /setLocomotion\("start_walk"\)[\s\S]*setLocomotion\("walk"\)/);
  assert.match(stageSource, /setLocomotion\("stop_walk"\)/);
});

test("route entry resets inherited roaming before game-safe active movement can start", () => {
  assert.match(stageSource, /const resetGameSafePosition = useCallback\(\(\) => \{\s*setPosition\(\{ x: 0, y: 0 \}\)/);
  assert.match(stageSource, /useEffect\(\(\) => \{\s*if \(!isDaruGame\) return;\s*nextRoamDelayRef\.current = null;\s*freezeRoaming\(\);[\s\S]*?resetGameSafePosition\(\);\s*\}, \[freezeRoaming, isDaruGame, resetGameSafePosition\]\)/);
  assert.match(stageSource, /const freezeRoaming = useCallback\(\(\) => \{[\s\S]*window\.clearTimeout\(locomotionTimerRef\.current\)[\s\S]*setRoaming\(false\)[\s\S]*setMovementSpeed\(0\)[\s\S]*setLocomotion\("idle"\)/);
  assert.match(stageSource, /if \(!isDaruGame \|\| mode === "active"\) return;[\s\S]*freezeRoaming\(\);[\s\S]*resetGameSafePosition\(\)/);
});

test("game-safe destination rejects blockers and keeps the current position when no safe candidate exists", () => {
  assert.match(stageSource, /const chooseGameSafeDestination = useCallback\(\(\) => \{[\s\S]*const currentPosition = positionRef\.current;[\s\S]*const safeCandidates = candidates\.filter[\s\S]*!overlaps\(left, baselineTop\) && !pathOverlaps[\s\S]*return currentPosition;\s*\}, \[\]\)/);
  assert.doesNotMatch(stageSource, /const chooseGameSafeDestination = useCallback\(\(\) => \{[\s\S]*return \{ x: 0, y: 0 \};\s*\}, \[\]\)/);
});

test("game-safe active and quiet inherit the general route sizes", () => {
  const desktopGameSafe = mascotCss.match(/\.stage\[data-game-safe\] \{([^}]*)\}/)?.[1] ?? "";
  const mobileGameSafe = mascotCss.match(/@media \(max-width: 600px\) \{\s*\.stage\[data-game-safe\] \{([^}]*)\}/)?.[1] ?? "";

  assert.doesNotMatch(desktopGameSafe, /right:/);
  assert.doesNotMatch(mobileGameSafe, /right:/);
  assert.doesNotMatch(desktopGameSafe, /width:/);
  assert.doesNotMatch(mobileGameSafe, /width:/);
  assert.match(mascotCss, /\.stage\[data-game-safe\]\[data-mode="active"\][\s\S]*translate3d/);
  assert.match(mascotCss, /\.stage\[data-game-safe\]\[data-mode="quiet"\][\s\S]*transform: none/);
  assert.match(mascotCss, /\.stage\[data-game-safe\]\[data-mode="quiet"\][\s\S]*transition: opacity 180ms ease, transform 0s/);
  assert.doesNotMatch(mascotCss, /\.stage\[data-game-safe\] \.character \{[^}]*width:/);
  assert.match(mascotCss, /\.character \{[\s\S]*?width: 148px;[\s\S]*?height: 148px/);
  assert.match(mascotCss, /@media \(max-width: 1024px\) \{ \.stage \{ right: 91px; width: 122px; \}\.character \{ width: 112px; height: 112px/);
  assert.match(mascotCss, /@media \(max-width: 600px\) \{ \.stage \{ right: 76px;[\s\S]*?\.character, \.mascot\[data-mode="quiet"\] \.character \{ width: 88px; height: 88px/);
  assert.doesNotMatch(mascotCss, /\.stage\[data-game-safe\] \.mascot\[data-mode="quiet"\] \.character \{[^}]*width:/);
  assert.match(mascotCss, /\.mascot\[data-mode="quiet"\] \.character \{ width: 118px; height: 118px/);
  assert.match(mascotCss, /@media \(max-width: 600px\)[\s\S]*\.character, \.mascot\[data-mode="quiet"\] \.character \{ width: 88px; height: 88px/);
  assert.match(mascotCss, /\.stage \{[\s\S]*?right: 102px/);
  assert.match(mascotCss, /@media \(max-width: 1024px\) \{ \.stage \{ right: 91px/);
  assert.match(mascotCss, /@media \(max-width: 600px\) \{ \.stage \{ right: 76px/);
});

test("mobile memory hero gives the ready bubble a card-free centered area below Daru", () => {
  assert.match(mascotCss, /@media \(max-width: 600px\)/);
  const gameCss = readFileSync(new URL("../src/components/daru-game/DaruGame.module.css", import.meta.url), "utf8");
  assert.match(gameCss, /@media \(max-width: 720px\)[\s\S]*\.previewBoard \{ height: 300px/);
  assert.match(gameCss, /\.previewBubble \{ left: 50%; top: 198px;[\s\S]*transform: translateX\(-50%\)/);
  assert.match(gameCss, /\.previewBubble::before \{ top: -6px; bottom: auto; left: calc\(50% - 5px\)/);
  assert.match(difficultySource, /data-memory-preview-card="true"/);
  assert.match(difficultySource, /data-memory-preview-daru="true"/);
  assert.match(difficultySource, /data-memory-preview-bubble="true"/);
});

test("direct greeting moves only active game-safe Daru through the constrained policy", () => {
  assert.match(stageSource, /if \(isDaruGame && latest\.mode !== "active"\) return/);
  assert.match(stageSource, /const target = isDaruGame \? chooseGameSafeDestination\(\) : chooseSafeDestination\(\)/);
  assert.match(stageSource, /beginMovementTo\(target, isDaruGame\)/);
});
