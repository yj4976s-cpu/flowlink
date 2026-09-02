"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import type { AuthUser } from "@/lib/authApi";
import {
  AdminNotificationsApiError,
  listAdminNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  type AdminNotificationFilter,
  type AdminNotificationItem,
} from "@/lib/adminNotificationsApi";
import {
  formatAdminNotificationBadge,
  getAdminNotificationDestination,
  getAdminNotificationStatus,
  shouldPollAdminNotifications,
} from "@/lib/adminNotificationRouting";
import styles from "./AdminNotificationCenter.module.css";

const PREVIEW_LIMIT = 5;
const POLL_INTERVAL_MS = 30_000;
const TOAST_LIMIT = 3;
const TOAST_VISIBLE_MS = 9000;
const filters: readonly { key: AdminNotificationFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "unread", label: "미확인" },
  { key: "actionable", label: "처리 필요" },
  { key: "resolved", label: "처리 완료" },
];

const timeFormatter = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "시간 확인 중" : timeFormatter.format(date);
}

function isAbortError(caught: unknown) {
  return caught instanceof DOMException && caught.name === "AbortError";
}

function AdminToast({ item, onClose, onAction }: { item: AdminNotificationItem; onClose: () => void; onAction: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  const destination = getAdminNotificationDestination(item);
  return (
    <article className={styles.toast}>
      <span className={styles.toastIcon}><Icon name={destination.icon} size={18} /></span>
      <div>
        <small>{destination.label}</small>
        <strong>{item.title}</strong>
        <p>{item.message}</p>
        <button type="button" onClick={onAction}>{destination.action}<Icon name="arrow" size={13} /></button>
      </div>
      <button className={styles.toastClose} type="button" aria-label="관리자 알림 닫기" onClick={onClose}><Icon name="close" size={14} /></button>
    </article>
  );
}

export function AdminNotificationCenter({ user, open, onOpenChange }: { user: AuthUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const baselineReadyRef = useRef(false);
  const seenToastIdsRef = useRef<Set<number>>(new Set());
  const requestSeqRef = useRef(0);
  const [filter, setFilter] = useState<AdminNotificationFilter>("all");
  const [items, setItems] = useState<AdminNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [actionableCount, setActionableCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<AdminNotificationItem[]>([]);
  const [liveMessage, setLiveMessage] = useState("");

  const closeToast = useCallback((id: number) => setToasts((current) => current.filter((item) => item.id !== id)), []);

  const load = useCallback(async ({ targetFilter = filter, showLoading = false, allowToast = false }: { targetFilter?: AdminNotificationFilter; showLoading?: boolean; allowToast?: boolean } = {}) => {
    if (inFlightRef.current) return;
    if (!shouldPollAdminNotifications(user.role, document.visibilityState)) return;
    inFlightRef.current = true;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    if (showLoading) setLoading(true);
    try {
      const response = await listAdminNotifications(targetFilter, controller.signal, PREVIEW_LIMIT);
      if (requestId !== requestSeqRef.current) return;
      setItems(response.items);
      setUnreadCount(response.unread_count);
      setActionableCount(response.actionable_count);
      setError("");
      const unreadItems = response.items.filter((item) => !item.is_read);
      if (!baselineReadyRef.current) {
        unreadItems.forEach((item) => seenToastIdsRef.current.add(item.id));
        baselineReadyRef.current = true;
      } else if (allowToast) {
        const fresh = unreadItems.filter((item) => !seenToastIdsRef.current.has(item.id));
        fresh.forEach((item) => seenToastIdsRef.current.add(item.id));
        if (fresh.length) {
          setToasts((current) => [...fresh.slice(0, TOAST_LIMIT), ...current].slice(0, TOAST_LIMIT));
        }
      }
    } catch (caught) {
      if (isAbortError(caught) || requestId !== requestSeqRef.current) return;
      setError(caught instanceof AdminNotificationsApiError ? caught.message : "관리자 알림 상태를 확인하지 못했습니다.");
    } finally {
      if (requestId === requestSeqRef.current) {
        inFlightRef.current = false;
        if (showLoading) setLoading(false);
      }
    }
  }, [filter, user.role]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      baselineReadyRef.current = false;
      seenToastIdsRef.current = new Set();
      setToasts([]);
      setItems([]);
      setUnreadCount(0);
      setActionableCount(0);
      void load({ showLoading: true });
    }, 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load({ allowToast: true });
      else requestRef.current?.abort();
    };
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = window.setInterval(() => void load({ allowToast: true }), POLL_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
      requestRef.current?.abort();
    };
  }, [load, user.id]);

  useEffect(() => {
    if (!open) return;
    const refreshTimer = window.setTimeout(() => void load({ showLoading: false }), 0);
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
      window.clearTimeout(refreshTimer);
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [load, onOpenChange, open]);

  const activate = async (item: AdminNotificationItem) => {
    const destination = getAdminNotificationDestination(item);
    if (!item.is_read) {
      setUnreadCount((current) => Math.max(0, current - 1));
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true, read_at: new Date().toISOString() } : entry));
      try {
        const updated = await markAdminNotificationRead(item.id);
        setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
      } catch {
        void load();
      }
    }
    onOpenChange(false);
    closeToast(item.id);
    router.push(destination.href);
  };

  const readAll = async () => {
    try {
      const result = await markAllAdminNotificationsRead();
      setLiveMessage(`관리자 알림 ${result.marked_read_count}건을 읽음 처리했습니다.`);
      await load({ showLoading: false });
    } catch {
      setLiveMessage("전체 읽음 처리에 실패했습니다.");
    }
  };

  const badge = formatAdminNotificationBadge(unreadCount);
  const accessibleLabel = unreadCount > 0 ? `관리자 알림, 미확인 ${badge}건` : "관리자 알림";

  return (
    <>
      <div className={styles.root} ref={rootRef}>
        <button ref={triggerRef} className={styles.trigger} type="button" aria-label={accessibleLabel} aria-haspopup="dialog" aria-expanded={open} aria-controls="admin-notification-panel" onClick={() => onOpenChange(!open)}>
          <Icon name="bell" size={19} />
          {badge && <span className={styles.badge} aria-hidden="true">{badge}</span>}
        </button>
        {open && (
          <section className={styles.panel} id="admin-notification-panel" role="dialog" aria-label="관리자 알림 미리보기">
            <div className={styles.heading}>
              <div><strong>관리자 알림</strong><span>{actionableCount}건 처리 필요</span></div>
              <Link href="/admin/notifications" onClick={() => onOpenChange(false)}>전체보기</Link>
            </div>
            <div className={styles.filters} role="group" aria-label="관리자 알림 필터">
              {filters.map((entry) => (
                <button key={entry.key} type="button" aria-pressed={filter === entry.key} onClick={() => setFilter(entry.key)}>
                  {entry.label}
                </button>
              ))}
            </div>
            <div className={styles.list} aria-busy={loading}>
              {loading && <p className={styles.state}>관리자 알림을 불러오는 중입니다.</p>}
              {!loading && error && <button className={styles.retry} type="button" onClick={() => void load({ showLoading: true })}>{error} · 다시 시도</button>}
              {!loading && !error && items.length === 0 && <p className={styles.state}>현재 조건에 맞는 관리자 알림이 없습니다.</p>}
              {!loading && !error && items.map((item) => {
                const destination = getAdminNotificationDestination(item);
                const status = getAdminNotificationStatus(item);
                return (
                  <button className={styles.item} type="button" data-status={status.tone} key={item.id} onClick={() => void activate(item)}>
                    <span className={styles.itemIcon} aria-hidden="true"><Icon name={destination.icon} size={17} /></span>
                    <span className={styles.content}>
                      <span><strong>{item.title}</strong><em>{status.label}</em></span>
                      <small>{item.message}</small>
                      <time dateTime={item.created_at}>{formatTime(item.created_at)}</time>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className={styles.panelFooter}>
              <button type="button" onClick={() => void readAll()} disabled={unreadCount === 0}>전체 읽음</button>
              <span role="status" aria-live="polite">{liveMessage}</span>
            </div>
          </section>
        )}
      </div>
      {toasts.length > 0 && (
        <aside className={styles.toastHost} data-admin-notification-toast="true" aria-label="새 관리자 알림" aria-live="polite">
          {toasts.map((item) => (
            <AdminToast key={item.id} item={item} onClose={() => closeToast(item.id)} onAction={() => void activate(item)} />
          ))}
        </aside>
      )}
    </>
  );
}
