"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { getCurrentUser, type AuthUser } from "@/lib/authApi";
import { DaruGuidePanel } from "./DaruGuidePanel";
import { DaruMascot } from "./DaruMascot";
import { useDaru } from "./DaruProvider";
import { DARU_ADMIN_IDLE_MULTIPLIER, DARU_IDLE_DELAY, DARU_MOBILE_IDLE_MULTIPLIER, pickNaturalIdle } from "./daru.motion.config";
import { DARU_GROUNDED_ROAMING_CONFIG, DARU_ROAMING_PAUSED_STORAGE_KEY, type DaruFacing } from "./daru.renderer.config";
import { mobileDestinationCandidates, resolveMobileRoamBounds } from "./daru.mobile-roaming";
import { behaviorForAction, normalizedMovementSpeed, tailEnergyFor, type DaruInteraction, type DaruLocomotion } from "./daru.animation.adapter";
import type { DaruGuideRole } from "./daru.guide.config";
import type { DaruIdleAction, DaruRhythm } from "./types";
import styles from "./DaruMascot.module.css";

function currentRhythm(): DaruRhythm {
  const theme = document.documentElement.dataset.theme;
  return theme === "dawn" || theme === "night" ? theme : "day";
}

const DARU_PERSONALITY = { walkEnergy: 1, tailEnergy: 0.96, curiosity: 1.02 } as const;
const DARU_DIRECT_GREETING_MESSAGE = "안녕하세요! 같이 둘러볼까요?";
const DARU_DIRECT_GREETING_MS = 880;

function numericTranslate(element: HTMLElement) {
  const translated = getComputedStyle(element).translate.split(" ");
  const x = Number.parseFloat(translated[0]);
  const y = Number.parseFloat(translated[1] ?? "0");
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function DaruStage() {
  const pathname = usePathname();
  const { action, cue, message, mode, occluded, reducedMotion } = useDaru();
  const previousIdle = useRef<DaruIdleAction | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const guidePanelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const animationTimerRef = useRef<number | null>(null);
  const locomotionTimerRef = useRef<number | null>(null);
  const directGreetingTimerRef = useRef<number | null>(null);
  const nextRoamDelayRef = useRef<number | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const positionRef = useRef(position);
  const [dragging, setDragging] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideRole, setGuideRole] = useState<DaruGuideRole>("GUEST");
  const [panelSide, setPanelSide] = useState<"left" | "right">("right");
  const [panelVertical, setPanelVertical] = useState<"above" | "below">("above");
  const [interaction, setInteraction] = useState<DaruInteraction>("none");
  const [locomotion, setLocomotion] = useState<DaruLocomotion>("idle");
  const [movementSpeed, setMovementSpeed] = useState(0);
  const [facing, setFacing] = useState<DaruFacing>("left");
  const [roaming, setRoaming] = useState(false);
  const [roamDuration, setRoamDuration] = useState(2200);
  const [userPaused, setUserPaused] = useState(false);
  const [roamRetry, setRoamRetry] = useState(0);
  const [rhythm, setRhythm] = useState<DaruRhythm>("day");
  const [pageVisible, setPageVisible] = useState(true);
  const [mobileViewport, setMobileViewport] = useState(false);
  const [directGreeting, setDirectGreeting] = useState(false);
  const [bubbleSide, setBubbleSide] = useState<"left" | "right">("left");
  const [mobileBubbleStyle, setMobileBubbleStyle] = useState<React.CSSProperties | undefined>(undefined);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const sync = () => setMobileViewport(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(DARU_ROAMING_PAUSED_STORAGE_KEY);
    const timer = window.setTimeout(() => setUserPaused(stored === "true"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setRhythm(currentRhythm());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    let active = true;
    const applyUser = (user: AuthUser | null) => { if (active) setGuideRole(user?.role ?? "GUEST"); };
    getCurrentUser().then(applyUser).catch(() => applyUser(null));
    const authChanged = (event: Event) => applyUser((event as CustomEvent<AuthUser | null>).detail ?? null);
    window.addEventListener("flowlink:auth-changed", authChanged);
    return () => { active = false; window.removeEventListener("flowlink:auth-changed", authChanged); };
  }, []);

  const playOneShot = useCallback((state: "HOVER" | "CLICK", duration: number) => {
    if (reducedMotion) return;
    if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
    setInteraction(state === "HOVER" ? "hover" : "click");
    animationTimerRef.current = window.setTimeout(() => { setInteraction("none"); animationTimerRef.current = null; }, duration);
  }, [reducedMotion]);

  const closeGuide = useCallback(({ restoreFocus = false }: { restoreFocus?: boolean } = {}) => {
    setGuideOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => stageRef.current?.querySelector<HTMLButtonElement>(`.${styles.guideTrigger}`)?.focus());
    }
  }, []);

  const clearDirectGreetingTimer = useCallback(() => {
    if (directGreetingTimerRef.current !== null) window.clearTimeout(directGreetingTimerRef.current);
    directGreetingTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (!guideOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!stageRef.current?.contains(target) && !guidePanelRef.current?.contains(target)) setGuideOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closeGuide({ restoreFocus: true }); } };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    guidePanelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => { document.removeEventListener("pointerdown", closeOnOutside); window.removeEventListener("keydown", closeOnEscape); };
  }, [closeGuide, guideOpen]);

  const clampPosition = useCallback((x: number, y: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x, y };
    const baseLeft = rect.left - position.x;
    const baseTop = rect.top - position.y;
    return { x: Math.min(window.innerWidth - 12 - rect.width - baseLeft, Math.max(12 - baseLeft, x)), y: Math.min(window.innerHeight - 12 - rect.height - baseTop, Math.max(88 - baseTop, y)) };
  }, [position.x, position.y]);

  const chooseSafeDestination = useCallback(() => {
    const stage = stageRef.current;
    const currentPosition = positionRef.current;
    if (!stage) return currentPosition;
    const rect = stage.getBoundingClientRect();
    const baseLeft = rect.left - currentPosition.x;
    const baseTop = rect.top - currentPosition.y;
    const mobile = window.matchMedia("(max-width: 600px)").matches;
    const visibleRects = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => !stage.contains(element) && element.offsetParent !== null)
      .map((element) => element.getBoundingClientRect());
    const strongBlockers = visibleRects('[role="dialog"], [role="alert"], [aria-modal="true"], [class*="copilot"], [aria-label*="FlowLink AI"]');
    const softBlockers = visibleRects('header, input, textarea, select, form, a.button, button.button');
    const overlaps = (left: number, top: number, blockers: DOMRect[]) => blockers.some((item) => left < item.right + 14 && left + rect.width > item.left - 14 && top < item.bottom + 14 && top + rect.height > item.top - 14);
    const viewportMargin = mobile ? 12 : 16;
    const desktopRange = DARU_GROUNDED_ROAMING_CONFIG.desktopRange;
    const mobileBounds = resolveMobileRoamBounds({
      viewportWidth: window.innerWidth,
      stageWidth: rect.width,
      margin: viewportMargin,
      configuredMinTravelDistance: DARU_GROUNDED_ROAMING_CONFIG.mobileMinTravelDistance,
    });
    const minLeft = mobile ? mobileBounds.minLeft : Math.max(viewportMargin, rect.left - desktopRange / 2);
    const maxLeft = mobile ? mobileBounds.maxLeft : Math.min(window.innerWidth - rect.width - viewportMargin, rect.left + desktopRange / 2);
    const minTravelDistance = mobile ? DARU_GROUNDED_ROAMING_CONFIG.mobileMinTravelDistance : DARU_GROUNDED_ROAMING_CONFIG.desktopMinTravelDistance;
    const effectiveMinTravelDistance = mobile ? mobileBounds.minTravelDistance : minTravelDistance;
    const groundInset = mobile ? DARU_GROUNDED_ROAMING_CONFIG.mobileGroundInset : DARU_GROUNDED_ROAMING_CONFIG.desktopGroundInset;
    const primaryGround = Math.max(88, window.innerHeight - rect.height - groundInset);
    const groundLanes = mobile ? [primaryGround, Math.max(88, primaryGround - 56), Math.max(88, primaryGround - 112)] : [primaryGround];
    const blockerSets = mobile ? [[...strongBlockers, ...softBlockers], strongBlockers] : [[...strongBlockers, ...softBlockers]];
    for (const groundTop of groundLanes) {
      for (const blockers of blockerSets) {
        for (let attempt = 0; attempt < 28; attempt += 1) {
          const left = minLeft + Math.random() * Math.max(0, maxLeft - minLeft);
          if (Math.abs(left - rect.left) < effectiveMinTravelDistance) continue;
          if (!overlaps(left, groundTop, blockers)) return { x: left - baseLeft, y: groundTop - baseTop };
        }
      }
    }
    if (mobile) {
      const fallbackLefts = mobileDestinationCandidates(mobileBounds, rect.left);
      for (const groundTop of groundLanes) {
        for (const blockers of blockerSets) {
          for (const left of fallbackLefts) {
            if (!overlaps(left, groundTop, blockers)) return { x: left - baseLeft, y: groundTop - baseTop };
          }
        }
      }
    }
    return currentPosition;
  }, []);

  const freezeRoaming = useCallback(() => {
    if (locomotionTimerRef.current !== null) {
      window.clearTimeout(locomotionTimerRef.current);
      locomotionTimerRef.current = null;
    }
    const stage = stageRef.current;
    const translated = stage && roaming ? numericTranslate(stage) : null;
    if (translated) setPosition(translated);
    setRoaming(false);
    setMovementSpeed(0);
    setLocomotion("idle");
  }, [roaming]);

  const beginMovementTo = useCallback((target: { x: number; y: number }) => {
    if (reducedMotion || mode !== "active" || occluded || guideOpen || dragging) return false;
    const currentPosition = positionRef.current;
    const stage = stageRef.current;
    const rect = stage?.getBoundingClientRect();
    const mobile = window.matchMedia("(max-width: 600px)").matches;
    const speed = mobile ? DARU_GROUNDED_ROAMING_CONFIG.mobileSpeed : DARU_GROUNDED_ROAMING_CONFIG.desktopSpeed;
    const distance = Math.abs(target.x - currentPosition.x);
    const minTravelDistance = mobile
      ? resolveMobileRoamBounds({
        viewportWidth: window.innerWidth,
        stageWidth: rect?.width ?? 88,
        margin: 12,
        configuredMinTravelDistance: DARU_GROUNDED_ROAMING_CONFIG.mobileMinTravelDistance,
      }).minTravelDistance
      : DARU_GROUNDED_ROAMING_CONFIG.desktopMinTravelDistance;
    if (distance < minTravelDistance) return false;
    const duration = Math.min(12000, Math.max(mobile ? 1600 : 2600, distance / speed * 1000));
    const nextFacing = target.x < currentPosition.x ? "left" : "right";
    const normalizedSpeed = normalizedMovementSpeed(distance / (duration / 1000), speed) * DARU_PERSONALITY.walkEnergy;
    const startMovement = () => {
      setFacing(nextFacing);
      setRoamDuration(duration);
      setMovementSpeed(normalizedSpeed);
      setLocomotion("start_walk");
      setRoaming(true);
      setPosition(target);
      locomotionTimerRef.current = window.setTimeout(() => { setLocomotion("walk"); locomotionTimerRef.current = null; }, DARU_GROUNDED_ROAMING_CONFIG.startWalkMs);
    };
    if (locomotionTimerRef.current !== null) window.clearTimeout(locomotionTimerRef.current);
    if (nextFacing !== facing) {
      setLocomotion("turn");
      locomotionTimerRef.current = window.setTimeout(startMovement, 230);
    } else {
      startMovement();
    }
    return true;
  }, [dragging, facing, guideOpen, mode, occluded, reducedMotion]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (mode === "hidden") return;
    let dragOrigin = { x: position.x, y: position.y };
    const translated = stageRef.current ? numericTranslate(stageRef.current) : null;
    if (translated) dragOrigin = translated;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: dragOrigin.x, originY: dragOrigin.y, moved: false };
  }, [mode, position.x, position.y]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 5) {
      drag.moved = true;
      clearDirectGreetingTimer();
      freezeRoaming();
      setDirectGreeting(false);
      setMobileBubbleStyle(undefined);
      setInteraction("none");
      setDragging(true);
      setLocomotion("drag");
      setGuideOpen(false);
    }
    if (!drag.moved) return;
    event.preventDefault();
    setPosition(clampPosition(drag.originX + dx, drag.originY + dy));
  }, [clampPosition, clearDirectGreetingTimer, freezeRoaming]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    if (!drag.moved) return;
    setDragging(false);
    setLocomotion("land");
    if (locomotionTimerRef.current !== null) window.clearTimeout(locomotionTimerRef.current);
    locomotionTimerRef.current = window.setTimeout(() => { setLocomotion("idle"); locomotionTimerRef.current = null; }, DARU_GROUNDED_ROAMING_CONFIG.stopWalkMs);
  }, []);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    suppressClickRef.current = false;
    dragRef.current = null;
    if (drag.moved) {
      setDragging(false);
      if (locomotionTimerRef.current !== null) window.clearTimeout(locomotionTimerRef.current);
      locomotionTimerRef.current = null;
      setLocomotion("idle");
    }
  }, []);

  useEffect(() => {
    if (mode === "hidden") return;
    const timer = window.setTimeout(() => cue(pathname === "/detect" ? "alert" : "look", { source: "page" }), 650);
    return () => window.clearTimeout(timer);
  }, [cue, mode, pathname]);

  useEffect(() => {
    if (!pageVisible || mode !== "active" || reducedMotion || occluded || roaming || guideOpen || dragging) return;
    const rhythm = currentRhythm();
    const [minimum, maximum] = DARU_IDLE_DELAY[rhythm];
    const multiplier = (pathname.startsWith("/admin") ? DARU_ADMIN_IDLE_MULTIPLIER : 1) * (window.matchMedia("(max-width: 600px)").matches ? DARU_MOBILE_IDLE_MULTIPLIER : 1);
    const timer = window.setTimeout(() => { const next = pickNaturalIdle(rhythm, previousIdle.current); previousIdle.current = next; cue(next, { source: "idle" }); }, (minimum + Math.random() * (maximum - minimum)) * multiplier);
    return () => window.clearTimeout(timer);
  }, [action, cue, dragging, guideOpen, mode, occluded, pageVisible, pathname, reducedMotion, roaming]);

  useEffect(() => {
    if (!pageVisible || reducedMotion || userPaused || mode !== "active" || occluded || guideOpen || dragging || roaming || directGreeting || action === "wave") return;
    const delay = nextRoamDelayRef.current ?? (3000 + Math.random() * 4000);
    nextRoamDelayRef.current = null;
    const timer = window.setTimeout(() => {
      const target = chooseSafeDestination();
      const mobile = window.matchMedia("(max-width: 600px)").matches;
      if (!beginMovementTo(target)) {
        nextRoamDelayRef.current = mobile ? 900 : null;
        setRoamRetry((current) => current + 1);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [action, beginMovementTo, chooseSafeDestination, directGreeting, dragging, guideOpen, mode, occluded, pageVisible, reducedMotion, roamRetry, roaming, userPaused]);

  useEffect(() => {
    if (!roaming) return;
    const timer = window.setTimeout(() => {
      setRoaming(false);
      setMovementSpeed(0);
      setLocomotion("stop_walk");
      if (locomotionTimerRef.current !== null) window.clearTimeout(locomotionTimerRef.current);
      locomotionTimerRef.current = window.setTimeout(() => { setLocomotion("idle"); locomotionTimerRef.current = null; }, DARU_GROUNDED_ROAMING_CONFIG.stopWalkMs);
    }, roamDuration + DARU_GROUNDED_ROAMING_CONFIG.arrivalSlackMs);
    return () => window.clearTimeout(timer);
  }, [roamDuration, roaming]);

  useEffect(() => {
    if ((!pageVisible || reducedMotion || userPaused || occluded || mode !== "active") && (roaming || locomotion !== "idle")) freezeRoaming();
  }, [freezeRoaming, locomotion, mode, occluded, pageVisible, reducedMotion, roaming, userPaused]);

  useEffect(() => {
    const clamp = () => setPosition((current) => clampPosition(current.x, current.y));
    window.addEventListener("resize", clamp);
    window.visualViewport?.addEventListener("resize", clamp);
    return () => {
      window.removeEventListener("resize", clamp);
      window.visualViewport?.removeEventListener("resize", clamp);
    };
  }, [clampPosition]);

  useEffect(() => () => {
    if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
    if (locomotionTimerRef.current !== null) window.clearTimeout(locomotionTimerRef.current);
    if (directGreetingTimerRef.current !== null) window.clearTimeout(directGreetingTimerRef.current);
  }, []);

  if (mode === "hidden" || pathname === "/daru-game") return null;
  const handleGuideToggle = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) { setPanelSide(rect.left < 330 ? "left" : "right"); setPanelVertical(rect.top < 430 ? "below" : "above"); }
    if (!guideOpen) freezeRoaming();
    setGuideOpen((open) => !open);
  };

  const handleCharacterClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const stage = stageRef.current;
    const rect = stage?.getBoundingClientRect();
    if (roaming || locomotion === "turn" || locomotion === "start_walk" || locomotion === "walk") freezeRoaming();
    clearDirectGreetingTimer();
    if (rect && window.matchMedia("(max-width: 600px)").matches) {
      const width = Math.min(220, Math.max(180, window.innerWidth - 24));
      const opensRight = rect.left + rect.width / 2 < window.innerWidth / 2;
      const preferredLeft = opensRight ? rect.right - 22 : rect.left - width + 22;
      const left = Math.min(window.innerWidth - width - 12, Math.max(12, preferredLeft));
      setBubbleSide(opensRight ? "right" : "left");
      setMobileBubbleStyle({
        "--daru-mobile-bubble-left": `${left}px`,
        "--daru-mobile-bubble-bottom": `${Math.max(104, window.innerHeight - rect.top + 8)}px`,
        "--daru-mobile-bubble-width": `${width}px`,
      } as React.CSSProperties);
    } else {
      setBubbleSide("left");
      setMobileBubbleStyle(undefined);
    }
    setDirectGreeting(true);
    cue("wave", { source: "direct", message: DARU_DIRECT_GREETING_MESSAGE, duration: DARU_DIRECT_GREETING_MS });
    playOneShot("CLICK", 520);
    directGreetingTimerRef.current = window.setTimeout(() => {
      setDirectGreeting(false);
      setMobileBubbleStyle(undefined);
      directGreetingTimerRef.current = null;
      if (reducedMotion || mode !== "active") return;
      const target = chooseSafeDestination();
      beginMovementTo(target);
    }, DARU_DIRECT_GREETING_MS);
  };

  const toggleUserPaused = () => {
    const next = !userPaused;
    setUserPaused(next);
    localStorage.setItem(DARU_ROAMING_PAUSED_STORAGE_KEY, String(next));
    if (next) {
      nextRoamDelayRef.current = null;
      freezeRoaming();
    } else {
      nextRoamDelayRef.current = 1000 + Math.random() * 1000;
    }
  };

  const behavior = behaviorForAction(action);
  const themeTailMultiplier = rhythm === "night" ? 0.58 : rhythm === "dawn" ? 0.82 : 1;
  const rendererState = {
    locomotion,
    behavior,
    interaction,
    facing,
    movementSpeed: reducedMotion ? 0 : movementSpeed,
    dragging,
    reducedMotion,
    lookX: behavior === "look" ? (facing === "left" ? -0.35 : 0.35) * DARU_PERSONALITY.curiosity : 0,
    lookY: behavior === "sniff" ? -0.18 : behavior === "alert" ? 0.16 : 0,
    tailEnergy: tailEnergyFor(behavior, movementSpeed, dragging) * DARU_PERSONALITY.tailEnergy * themeTailMultiplier,
  };
  const guidePanel = guideOpen ? <DaruGuidePanel role={guideRole} userPaused={userPaused} reducedMotion={reducedMotion} viewportLayer={mobileViewport} panelRef={guidePanelRef} onClose={closeGuide} onToggleRoaming={toggleUserPaused} /> : null;

  return (
    <aside ref={stageRef} className={styles.stage} data-daru-stage="true" data-dragging={dragging || undefined} data-guide-open={guideOpen || undefined} data-roaming={roaming || undefined} data-panel-side={panelSide} data-panel-vertical={panelVertical} data-occluded={occluded || undefined} style={{ "--daru-x": `${position.x}px`, "--daru-y": `${position.y}px`, "--daru-roam-duration": `${roamDuration}ms` } as React.CSSProperties} aria-label="FlowLink 마스코트 다루">
      {guidePanel && (mobileViewport ? createPortal(guidePanel, document.body) : guidePanel)}
      <DaruMascot action={action} mode={mode} message={message} reducedMotion={reducedMotion} dragging={dragging} guideOpen={guideOpen} directGreeting={directGreeting} bubbleSide={bubbleSide} mobileBubbleStyle={mobileBubbleStyle} rendererState={rendererState} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} onHover={() => { if (!roaming) playOneShot("HOVER", 480); }} onInteract={handleCharacterClick} onGuide={handleGuideToggle} />
    </aside>
  );
}
