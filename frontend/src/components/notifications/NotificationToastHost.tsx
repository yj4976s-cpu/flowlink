"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/common/Icon";
import { useDaru } from "@/components/mascot";
import type { AuthUser } from "@/lib/authApi";
import { listNotifications, markNotificationRead, NotificationsApiError, type NotificationResponse } from "@/lib/notificationsApi";
import styles from "./NotificationToastHost.module.css";

export const NOTIFICATION_POLL_INTERVAL_MS = 5000;
const TOAST_VISIBLE_MS = 10000;
const TOAST_LIMIT = 3;

function toastMeta(notification: NotificationResponse): { label: string; icon: IconName; href: string; action: string } | null {
  if (notification.notification_type === "MATCH_FOUND" && notification.related_type === "MATCH_CANDIDATE") {
    return { label: "매칭", icon: "match", href: "/matches", action: "매칭 후보 확인하기" };
  }
  if (notification.notification_type === "STATUS_CHANGED" && notification.related_type === "OWNERSHIP_CLAIM") {
    return { label: "소유권 상태 변경", icon: "check", href: "/matches", action: "매칭 현황 확인하기" };
  }
  if (notification.notification_type === "CITIZEN_REPORT_STATUS" && notification.related_type === "CITIZEN_REPORT") {
    return { label: "발견 제보 상태", icon: "document", href: "/mypage#my-activity", action: "내 제보 확인하기" };
  }
  return null;
}

function Toast({ notification, onClose, onAction }: { notification: NotificationResponse; onClose: () => void; onAction: () => void }) {
  const meta = toastMeta(notification);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(onClose, TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [onClose, paused]);
  if (!meta) return null;
  return <article className={styles.toast} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <span className={styles.icon}><Icon name={meta.icon} size={20} /></span>
    <div><small>{meta.label}</small><strong>{notification.title}</strong><p>{notification.message}</p><button type="button" onClick={onAction}>{meta.action}<Icon name="arrow" size={14} /></button></div>
    <button className={styles.close} type="button" aria-label="알림 닫기" onClick={onClose}><Icon name="close" size={15} /></button>
  </article>;
}

export function NotificationToastHost({ user }: { user: AuthUser | null }) {
  const { cue: cueDaru } = useDaru();
  const router = useRouter();
  const [toasts, setToasts] = useState<NotificationResponse[]>([]);
  const baselineReadyRef = useRef(false);
  const shownIdsRef = useRef(new Set<number>());

  const close = useCallback((id: number) => setToasts((current) => current.filter((item) => item.id !== id)), []);

  useEffect(() => {
    baselineReadyRef.current = false;
    shownIdsRef.current = new Set();
    if (!user || user.role !== "USER") return;

    let active = true;
    let controller: AbortController | null = null;
    let intervalId: number | null = null;
    const poll = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const notifications = await listNotifications("unread", controller.signal);
        if (!active) return;
        if (!baselineReadyRef.current) {
          notifications.forEach((item) => shownIdsRef.current.add(item.id));
          baselineReadyRef.current = true;
          return;
        }
        const fresh = notifications.filter((item) => toastMeta(item) && !shownIdsRef.current.has(item.id));
        fresh.forEach((item) => shownIdsRef.current.add(item.id));
        if (fresh.length) {
          setToasts((current) => [...fresh, ...current].slice(0, TOAST_LIMIT));
          if (fresh.some((item) => item.notification_type === "MATCH_FOUND")) cueDaru("match", { source: "service" });
          else if (fresh.some((item) => item.notification_type === "STATUS_CHANGED")) cueDaru("happy", { source: "service" });
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (caught instanceof NotificationsApiError && caught.status === 401 && intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }
    };
    void poll();
    intervalId = window.setInterval(() => void poll(), NOTIFICATION_POLL_INTERVAL_MS);
    return () => {
      active = false;
      controller?.abort();
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [cueDaru, user]);

  const act = async (notification: NotificationResponse) => {
    const meta = toastMeta(notification);
    if (!meta) return;
    try { await markNotificationRead(notification.id); } catch { /* Navigation remains available if read marking fails. */ }
    close(notification.id);
    router.push(meta.href);
  };

  if (!toasts.length) return null;
  return <aside className={styles.host} aria-label="새 알림" aria-live="polite">{toasts.map((notification) => <Toast key={notification.id} notification={notification} onClose={() => close(notification.id)} onAction={() => void act(notification)} />)}</aside>;
}
