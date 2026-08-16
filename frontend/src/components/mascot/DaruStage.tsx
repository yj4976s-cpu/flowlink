"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getCurrentUser, type AuthUser } from "@/lib/authApi";
import { DaruGuidePanel } from "./DaruGuidePanel";
import { DaruMascot } from "./DaruMascot";
import { useDaru } from "./DaruProvider";
import { DARU_ADMIN_IDLE_MULTIPLIER, DARU_IDLE_DELAY, DARU_MOBILE_IDLE_MULTIPLIER, pickNaturalIdle } from "./daru.motion.config";
import { DARU_GROUNDED_ROAMING_CONFIG, DARU_ROAMING_PAUSED_STORAGE_KEY, type DaruFacing } from "./daru.renderer.config";
import { behaviorForAction, normalizedMovementSpeed, tailEnergyFor, type DaruInteraction, type DaruLocomotion } from "./daru.animation.adapter";
import type { DaruGuideRole } from "./daru.guide.config";
import type { DaruIdleAction, DaruRhythm } from "./types";
import styles from "./DaruMascot.module.css";

function currentRhythm(): DaruRhythm {
  const theme = document.documentElement.dataset.theme;
  return theme === "dawn" || theme === "night" ? theme : "day";
}

const DARU_PERSONALITY = { walkEnergy: 1, tailEnergy: 0.96, curiosity: 1.02 } as const;

export function DaruStage() {
  const pathname = usePathname();
  const { action, cue, message, mode, occluded, reducedMotion } = useDaru();
  const previousIdle = useRef<DaruIdleAction | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const animationTimerRef = useRef<number | null>(null);
  const locomotionTimerRef = useRef<number | null>(null);
  const nextRoamDelayRef = useRef<number | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
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

  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    window.setTimeout(() => stageRef.current?.querySelector<HTMLButtonElement>(`.${styles.character}`)?.focus());
  }, []);

  useEffect(() => {
    if (!guideOpen) return;
    const closeOnOutside = (event: PointerEvent) => { if (!stageRef.current?.contains(event.target as Node)) closeGuide(); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closeGuide(); } };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    stageRef.current?.querySelector<HTMLElement>(`.${styles.guidePanel} a, .${styles.guidePanel} button`)?.focus();
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
    if (!stage) return position;
    const rect = stage.getBoundingClientRect();
    const baseLeft = rect.left - position.x;
    const baseTop = rect.top - position.y;
    const mobile = window.matchMedia("(max-width: 600px)").matches;
    const blockers = Array.from(document.querySelectorAll<HTMLElement>('header, [role="dialog"], [role="alert"], input, textarea, select, form, [class*="copilot"], [aria-label*="FlowLink AI"], a.button, button.button'))
      .filter((element) => !stage.contains(element) && element.offsetParent !== null)
      .map((element) => element.getBoundingClientRect());
    const overlaps = (left: number, top: number) => blockers.some((item) => left < item.right + 14 && left + rect.width > item.left - 14 && top < item.bottom + 14 && top + rect.height > item.top - 14);
    const horizontalRange = DARU_GROUNDED_ROAMING_CONFIG.mobileRange;
    const minLeft = mobile ? Math.max(12, rect.left - horizontalRange / 2) : 16;
    const maxLeft = mobile ? Math.min(window.innerWidth - rect.width - 12, rect.left + horizontalRange / 2) : window.innerWidth - rect.width - 16;
    const groundInset = mobile ? DARU_GROUNDED_ROAMING_CONFIG.mobileGroundInset : DARU_GROUNDED_ROAMING_CONFIG.desktopGroundInset;
    const groundTop = Math.max(88, window.innerHeight - rect.height - groundInset);
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const left = minLeft + Math.random() * Math.max(0, maxLeft - minLeft);
      if (!overlaps(left, groundTop)) return { x: left - baseLeft, y: groundTop - baseTop };
    }
    return position;
  }, [position]);

  const freezeRoaming = useCallback(() => {
    if (locomotionTimerRef.current !== null) {
      window.clearTimeout(locomotionTimerRef.current);
      locomotionTimerRef.current = null;
    }
    const stage = stageRef.current;
    if (stage && roaming) {
      const translated = getComputedStyle(stage).translate.split(" ");
      const x = Number.parseFloat(translated[0]);
      const y = Number.parseFloat(translated[1] ?? "0");
      if (Number.isFinite(x) && Number.isFinite(y)) setPosition({ x, y });
    }
    setRoaming(false);
    setMovementSpeed(0);
    setLocomotion("idle");
  }, [roaming]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (mode === "hidden" || window.matchMedia("(max-width: 600px)").matches) return;
    event.preventDefault();
    let dragOrigin = { x: position.x, y: position.y };
    const translated = stageRef.current ? getComputedStyle(stageRef.current).translate.split(" ") : [];
    const translatedX = Number.parseFloat(translated[0]);
    const translatedY = Number.parseFloat(translated[1] ?? "0");
    if (Number.isFinite(translatedX) && Number.isFinite(translatedY)) dragOrigin = { x: translatedX, y: translatedY };
    freezeRoaming();
    setGuideOpen(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: dragOrigin.x, originY: dragOrigin.y, moved: false };
    setInteraction("none");
    setDragging(true);
    setLocomotion("drag");
  }, [freezeRoaming, mode, position.x, position.y]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    setPosition(clampPosition(drag.originX + dx, drag.originY + dy));
  }, [clampPosition]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    setDragging(false);
    setLocomotion("land");
    if (locomotionTimerRef.current !== null) window.clearTimeout(locomotionTimerRef.current);
    locomotionTimerRef.current = window.setTimeout(() => { setLocomotion("idle"); locomotionTimerRef.current = null; }, DARU_GROUNDED_ROAMING_CONFIG.stopWalkMs);
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
    if (!pageVisible || reducedMotion || userPaused || mode !== "active" || occluded || guideOpen || dragging || roaming) return;
    const delay = nextRoamDelayRef.current ?? (3000 + Math.random() * 4000);
    nextRoamDelayRef.current = null;
    const timer = window.setTimeout(() => {
      const target = chooseSafeDestination();
      const distance = Math.abs(target.x - position.x);
      if (distance < 28) { setRoamRetry((current) => current + 1); return; }
      const mobile = window.matchMedia("(max-width: 600px)").matches;
      const speed = mobile ? DARU_GROUNDED_ROAMING_CONFIG.mobileSpeed : DARU_GROUNDED_ROAMING_CONFIG.desktopSpeed;
      const duration = Math.min(mobile ? 2800 : 4600, Math.max(mobile ? 1100 : 1500, distance / speed * 1000));
      const nextFacing = target.x < position.x ? "left" : "right";
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
      if (nextFacing !== facing) {
        setLocomotion("turn");
        locomotionTimerRef.current = window.setTimeout(startMovement, 230);
      } else {
        startMovement();
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [chooseSafeDestination, dragging, facing, guideOpen, mode, occluded, pageVisible, position.x, position.y, reducedMotion, roamRetry, roaming, userPaused]);

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
    return () => window.removeEventListener("resize", clamp);
  }, [clampPosition]);

  useEffect(() => () => {
    if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
    if (locomotionTimerRef.current !== null) window.clearTimeout(locomotionTimerRef.current);
  }, []);

  if (mode === "hidden") return null;
  const toggleGuide = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) { setPanelSide(rect.left < 330 ? "left" : "right"); setPanelVertical(rect.top < 430 ? "below" : "above"); }
    if (!guideOpen) freezeRoaming();
    setGuideOpen((open) => !open);
    playOneShot("CLICK", 520);
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

  return (
    <aside ref={stageRef} className={styles.stage} data-daru-stage="true" data-dragging={dragging || undefined} data-guide-open={guideOpen || undefined} data-roaming={roaming || undefined} data-panel-side={panelSide} data-panel-vertical={panelVertical} data-occluded={occluded || undefined} style={{ "--daru-x": `${position.x}px`, "--daru-y": `${position.y}px`, "--daru-roam-duration": `${roamDuration}ms` } as React.CSSProperties} aria-label="FlowLink 마스코트 다루">
      {guideOpen && <DaruGuidePanel role={guideRole} userPaused={userPaused} reducedMotion={reducedMotion} onClose={closeGuide} onToggleRoaming={toggleUserPaused} />}
      <DaruMascot action={action} mode={mode} message={message} reducedMotion={reducedMotion} dragging={dragging} guideOpen={guideOpen} rendererState={rendererState} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onHover={() => { if (!roaming) playOneShot("HOVER", 480); }} onInteract={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return; } toggleGuide(); }} onGuide={toggleGuide} />
    </aside>
  );
}
