import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stageSource = readFileSync(new URL("../src/components/mascot/DaruStage.tsx", import.meta.url), "utf8");
const spriteSource = readFileSync(new URL("../src/components/mascot/DaruSpriteRenderer.tsx", import.meta.url), "utf8");
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

test("game-safe active constrains automatic movement while reusing manual drag", () => {
  assert.match(stageSource, /const chooseGameSafeDestination = useCallback/);
  assert.match(stageSource, /\[data-daru-game-blocker\]/);
  assert.match(stageSource, /if \(isDaruGame && !gameSafe\) return false/);
  assert.match(stageSource, /isDaruGame \? chooseGameSafeDestination\(\) : chooseSafeDestination\(\)/);
  assert.match(stageSource, /beginMovementTo\(target, isDaruGame\)/);
  assert.match(stageSource, /if \(mode === "hidden"\) return;[\s\S]*setPointerCapture/);
  assert.doesNotMatch(stageSource, /if \(mode === "hidden" \|\| isDaruGame\) return/);
  assert.match(stageSource, /Math\.hypot\(dx, dy\) > 5[\s\S]*freezeRoaming\(\)[\s\S]*setLocomotion\("drag"\)/);
  assert.match(stageSource, /setPosition\(clampPosition\(drag\.originX \+ dx, drag\.originY \+ dy\)\)/);
  assert.match(stageSource, /releasePointerCapture[\s\S]*setLocomotion\("land"\)[\s\S]*setLocomotion\("idle"\)/);
  assert.match(stageSource, /<DaruMascot[\s\S]+onInteract=\{handleCharacterClick\}/);
  assert.match(gameSource, /data-daru-game-blocker/);
  assert.match(gameStatusSource, /data-daru-game-blocker/);
  assert.match(copilotSource, /data-flow-copilot-root="true"/);
  assert.match(stageSource, /'\[data-daru-game-blocker\], \[data-flow-copilot-root\]'/);
  assert.match(stageSource, /element\.getClientRects\(\)\.length > 0 && getComputedStyle\(element\)\.visibility !== "hidden"/);
  assert.doesNotMatch(stageSource, /const chooseGameSafeDestination[\s\S]*\[class\*="copilot" i\]/);
  assert.doesNotMatch(stageSource, /const chooseGameSafeDestination[\s\S]*\[aria-label\*="FlowLink AI"\]/);
  assert.match(stageSource, /const maxTravelX = mobile \? Math\.min\(150, Math\.max\(120, window\.innerWidth \* 0\.38\)\) : tablet \? Math\.min\(220, window\.innerWidth \* 0\.26\) : Math\.min\(360, window\.innerWidth \* 0\.32\)/);
  assert.match(stageSource, /const safeCandidates = candidates\.filter/);
  assert.match(stageSource, /const maximumRightOffset = Math\.max\(0, Math\.min\(maxTravelX \* 0\.45/);
  assert.match(stageSource, /const groundY = gameSafeGroundYRef\.current/);
  assert.match(stageSource, /y: groundY/);
  assert.doesNotMatch(stageSource, /const chooseGameSafeDestination[\s\S]*y: currentPosition\.y/);
  assert.match(stageSource, /const gameMinimumTravel = Math\.min\(minimumTravel, 32\)/);
  assert.match(stageSource, /Math\.abs\(candidate\.x - currentPosition\.x\) >= gameMinimumTravel/);
  assert.match(stageSource, /const pathIsClear = \(endLeft: number, endTop: number\) => \{[\s\S]*const steps = 16;[\s\S]*for \(let step = 1; step <= steps; step \+= 1\)[\s\S]*const area = intersectionArea\(left, top, blockers\[index\]\)/);
  assert.match(stageSource, /pathIsClear\(left, baselineTop\)/);
  assert.match(stageSource, /const preferredCandidates = mobile \? safeCandidates\.filter/);
  assert.match(stageSource, /DARU_GAME_MOBILE_PREFERRED_MIN_TRAVEL[\s\S]*DARU_GAME_MOBILE_PREFERRED_MAX_TRAVEL/);
  assert.match(stageSource, /if \(preferredCandidates\.length > 0\) return preferredCandidates\[Math\.floor\(Math\.random\(\) \* preferredCandidates\.length\)\]/);
  assert.match(stageSource, /safeCandidates\.sort\(\(first, second\) => hasStartOverlap[\s\S]*: Math\.abs\(second\.x - currentPosition\.x\) - Math\.abs\(first\.x - currentPosition\.x\)\)\[0\]/);
  assert.doesNotMatch(stageSource, /const chooseGameSafeDestination[\s\S]*maxTravelY/);
  assert.match(stageSource, /const returningToGround = gameSafe && Math\.abs\(currentPosition\.y - gameSafeGroundYRef\.current\) >= 1/);
  assert.match(stageSource, /const distance = returningToGround[\s\S]*Math\.hypot\(target\.x - currentPosition\.x, target\.y - currentPosition\.y\)[\s\S]*Math\.abs\(target\.x - currentPosition\.x\)/);
  assert.match(stageSource, /const homeSpeed = mobile \? DARU_GROUNDED_ROAMING_CONFIG\.mobileSpeed : DARU_GROUNDED_ROAMING_CONFIG\.desktopSpeed/);
  assert.match(stageSource, /const speed = gameSafe \? homeSpeed \* DARU_GAME_AUTONOMOUS_SPEED_RATIO : homeSpeed/);
  assert.match(stageSource, /const DARU_GAME_AUTONOMOUS_SPEED_RATIO = 0\.88/);
  assert.match(stageSource, /distance \/ speed \* 1000/);
  assert.match(stageSource, /const requiredTravelDistance = gameSafe \? Math\.min\(minTravelDistance, 32\) : minTravelDistance/);
  assert.match(stageSource, /setLocomotion\("start_walk"\)[\s\S]*setLocomotion\("walk"\)/);
  assert.match(stageSource, /setLocomotion\("stop_walk"\)/);
});

test("route entry resets inherited roaming before game-safe active movement can start", () => {
  assert.match(stageSource, /const resetGameSafePosition = useCallback\(\(\) => \{\s*gameSafeGroundYRef\.current = 0;\s*setPosition\(\{ x: 0, y: 0 \}\)/);
  assert.match(stageSource, /useEffect\(\(\) => \{\s*if \(!isDaruGame\) return;\s*nextRoamDelayRef\.current = null;\s*freezeRoaming\(\);[\s\S]*?resetGameSafePosition\(\);\s*\}, \[freezeRoaming, isDaruGame, resetGameSafePosition\]\)/);
  assert.match(stageSource, /const freezeRoaming = useCallback\(\(\) => \{[\s\S]*window\.clearTimeout\(locomotionTimerRef\.current\)[\s\S]*setRoaming\(false\)[\s\S]*setMovementSpeed\(0\)[\s\S]*setLocomotion\("idle"\)/);
  assert.match(stageSource, /if \(!isDaruGame \|\| mode === "active"\) return;[\s\S]*freezeRoaming\(\);\s*\}, \[freezeRoaming, isDaruGame, mode\]\)/);
  assert.doesNotMatch(stageSource, /if \(!isDaruGame \|\| mode === "active"\) return;[\s\S]*resetGameSafePosition\(\)/);
});

test("route exit freezes game locomotion before handing off to general roaming", () => {
  assert.match(stageSource, /const previousIsDaruGameRef = useRef\(isDaruGame\)/);
  assert.match(stageSource, /useLayoutEffect\(\(\) => \{\s*const wasDaruGame/);
  assert.match(stageSource, /const wasDaruGame = previousIsDaruGameRef\.current;\s*previousIsDaruGameRef\.current = isDaruGame;\s*if \(!wasDaruGame \|\| isDaruGame\) return;\s*nextRoamDelayRef\.current = null;\s*freezeRoaming\(\)/);
  assert.match(stageSource, /const freezeRoaming = useCallback[\s\S]*setReturningToGameGround\(false\)[\s\S]*setRoaming\(false\)[\s\S]*setMovementSpeed\(0\)[\s\S]*setLocomotion\("idle"\)/);
  assert.doesNotMatch(stageSource, /if \(!wasDaruGame \|\| isDaruGame\) return;[\s\S]*resetGameSafePosition\(\)/);
});

test("airborne game-safe Daru walks diagonally to a safe grounded destination", () => {
  assert.match(stageSource, /const gameSafeGroundYRef = useRef\(0\)/);
  assert.doesNotMatch(stageSource, /DARU_GAME_GROUND_SETTLE_MS|settleToGameSafeGround|data-game-ground-settling/);
  assert.match(stageSource, /setReturningToGameGround\(returningToGround\)[\s\S]*setRoaming\(true\)[\s\S]*setPosition\(target\)/);
  assert.match(stageSource, /data-game-returning=\{returningToGameGround \|\| undefined\}/);
  assert.match(stageSource, /setLocomotion\("start_walk"\)[\s\S]*setLocomotion\("walk"\)[\s\S]*setLocomotion\("stop_walk"\)/);
  assert.match(spriteSource, /stage\.dataset\.gameReturning === "true" \? Math\.hypot\(deltaX, deltaY\) : Math\.abs\(deltaX\)/);
});

test("quiet preserves manual position and never enables autonomous game roaming", () => {
  assert.match(stageSource, /if \(!isDaruGame \|\| mode === "active"\) return;\s*nextRoamDelayRef\.current = null;\s*freezeRoaming\(\)/);
  assert.match(stageSource, /mode !== "active"[\s\S]*return;/);
  assert.doesNotMatch(stageSource, /if \(!isDaruGame \|\| mode === "active"\) return;[\s\S]*resetGameSafePosition/);
});

test("game speed reduction applies only to autonomous movement", () => {
  assert.match(stageSource, /const speed = gameSafe \? homeSpeed \* DARU_GAME_AUTONOMOUS_SPEED_RATIO : homeSpeed/);
  assert.match(stageSource, /distance \/ speed \* 1000/);
  assert.doesNotMatch(stageSource, /handlePointer(?:Down|Move|Up)[\s\S]*DARU_GAME_AUTONOMOUS_SPEED_RATIO/);
  assert.doesNotMatch(stageSource, /DARU_GROUNDED_ROAMING_CONFIG\.(?:desktopSpeed|mobileSpeed) \* DARU_GAME_AUTONOMOUS_SPEED_RATIO/);
});

test("game-safe destination rejects blockers and keeps the current position when no safe candidate exists", () => {
  assert.match(stageSource, /const chooseGameSafeDestination = useCallback\(\(\) => \{[\s\S]*const currentPosition = positionRef\.current;[\s\S]*const safeCandidates = candidates\.filter[\s\S]*pathIsClear\(left, baselineTop\)[\s\S]*return currentPosition;\s*\}, \[\]\)/);
  assert.doesNotMatch(stageSource, /const chooseGameSafeDestination = useCallback\(\(\) => \{[\s\S]*return \{ x: 0, y: 0 \};\s*\}, \[\]\)/);
});

test("game-safe destination can escape a start-overlapped blocker without crossing blockers", () => {
  assert.match(stageSource, /const startOverlapAreas = blockers\.map[\s\S]*const hasStartOverlap = startOverlapAreas\.some/);
  assert.match(stageSource, /const previousAreas = \[\.\.\.startOverlapAreas\];[\s\S]*const escaped = startOverlapAreas\.map/);
  assert.match(stageSource, /if \(startOverlapAreas\[index\] === 0 \|\| escaped\[index\]\)[\s\S]*if \(area > 0\) return false/);
  assert.match(stageSource, /if \(area > previousAreas\[index\]\) return false;[\s\S]*if \(area === 0\) escaped\[index\] = true/);
  assert.match(stageSource, /return escaped\.every\(Boolean\)/);
  assert.match(stageSource, /hasStartOverlap[\s\S]*Math\.abs\(first\.x - currentPosition\.x\) - Math\.abs\(second\.x - currentPosition\.x\)/);
  assert.match(stageSource, /return currentPosition;\s*\}, \[\]\)/);
});

test("game-safe active and quiet inherit general route size and drag transforms", () => {
  const desktopGameSafe = mascotCss.match(/\.stage\[data-game-safe\] \{([^}]*)\}/)?.[1] ?? "";
  const mobileGameSafe = mascotCss.match(/@media \(max-width: 600px\) \{\s*\.stage\[data-game-safe\] \{([^}]*)\}/)?.[1] ?? "";

  assert.doesNotMatch(desktopGameSafe, /right:/);
  assert.doesNotMatch(mobileGameSafe, /right:/);
  assert.doesNotMatch(desktopGameSafe, /width:/);
  assert.doesNotMatch(mobileGameSafe, /width:/);
  assert.match(mascotCss, /\.stage\[data-game-safe\]\[data-mode="active"\][\s\S]*translate3d/);
  assert.doesNotMatch(mascotCss, /\.stage\[data-game-safe\]\[data-mode="quiet"\][^{]*\{[^}]*transform: none/);
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
