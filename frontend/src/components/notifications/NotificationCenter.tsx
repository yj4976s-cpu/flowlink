"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { getNotificationDestination } from "@/lib/notificationRouting";
import { listNotifications, markNotificationRead, type NotificationResponse } from "@/lib/notificationsApi";
import { NOTIFICATION_POLL_INTERVAL_MS } from "./NotificationToastHost";
import styles from "./NotificationCenter.module.css";

const PREVIEW_LIMIT = 5;
const UNREAD_BADGE_LIMIT = 10;
const relativeTime = new Intl.RelativeTimeFormat("ko-KR", { numeric: "auto" });

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "시간 확인 중";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "방금 전";
  if (elapsedSeconds < 3600) return relativeTime.format(-Math.floor(elapsedSeconds / 60), "minute");
  if (elapsedSeconds < 86400) return relativeTime.format(-Math.floor(elapsedSeconds / 3600), "hour");
  if (elapsedSeconds < 604800) return relativeTime.format(-Math.floor(elapsedSeconds / 86400), "day");
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

export function NotificationCenter({ userId, open, onOpenChange }: { userId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<NotificationResponse[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal, showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [recent, unread] = await Promise.all([
        listNotifications("all", signal, PREVIEW_LIMIT),
        listNotifications("unread", signal, UNREAD_BADGE_LIMIT),
      ]);
      setItems(recent);
      setUnreadCount(unread.length);
      setError(false);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(true);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialTimer = window.setTimeout(() => void refresh(controller.signal, true), 0);
    const intervalId = window.setInterval(() => void refresh(), NOTIFICATION_POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [refresh, userId]);

  useEffect(() => {
    if (!open) return;
    const refreshTimer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(refreshTimer);
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onOpenChange, open]);

  const activate = async (notification: NotificationResponse) => {
    const destination = getNotificationDestination(notification);
    if (!notification.read_at) {
      setUnreadCount((current) => current >= UNREAD_BADGE_LIMIT ? current : Math.max(0, current - 1));
      setItems((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
      try {
        const updated = await markNotificationRead(notification.id);
        setItems((current) => current.map((item) => item.id === notification.id ? updated : item));
        void refresh();
      } catch {
        void refresh();
      }
    }
    onOpenChange(false);
    router.push(destination?.href ?? "/notifications");
  };

  const badge = unreadCount >= UNREAD_BADGE_LIMIT ? "9+" : String(unreadCount);
  const accessibleLabel = unreadCount > 0 ? `알림, 읽지 않은 알림 ${unreadCount >= UNREAD_BADGE_LIMIT ? "10개 이상" : `${unreadCount}개`}` : "알림";

  return (
    <div className={styles.root} ref={rootRef}>
      <button ref={triggerRef} className={styles.trigger} type="button" aria-label={accessibleLabel} aria-haspopup="dialog" aria-expanded={open} aria-controls="header-notification-panel" onClick={() => onOpenChange(!open)}>
        <Icon name="bell" size={19} />
        {unreadCount > 0 && <span className={styles.badge} aria-hidden="true">{badge}</span>}
      </button>
      {open && (
        <section className={styles.panel} id="header-notification-panel" role="dialog" aria-label="알림 미리보기">
          <div className={styles.heading}>
            <strong>알림{unreadCount > 0 ? ` ${badge}` : ""}</strong>
            <Link href="/notifications" onClick={() => onOpenChange(false)}>전체 알림 보기</Link>
          </div>
          <div className={styles.list} aria-busy={loading}>
            {loading && <p className={styles.state}>알림을 불러오는 중이에요</p>}
            {!loading && error && <button className={styles.retry} type="button" onClick={() => void refresh(undefined, true)}>알림을 불러오지 못했어요 · 다시 시도</button>}
            {!loading && !error && items.length === 0 && <p className={styles.state}>아직 받은 알림이 없어요</p>}
            {!loading && !error && items.map((notification) => {
              const unread = notification.read_at === null;
              return (
                <button className={styles.item} type="button" data-unread={unread || undefined} key={notification.id} onClick={() => void activate(notification)}>
                  <span className={styles.indicator} aria-hidden="true" />
                  <span className={styles.content}>
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <time dateTime={notification.created_at}>{formatRelativeTime(notification.created_at)}</time>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
