"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  AdminNotificationsApiError,
  listAdminNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  type AdminNotificationFilter,
  type AdminNotificationItem,
} from "@/lib/adminNotificationsApi";
import { getAdminNotificationDestination, getAdminNotificationStatus } from "@/lib/adminNotificationRouting";
import styles from "./AdminNotificationsClient.module.css";

const PAGE_SIZE = 20;
const filters: readonly { key: AdminNotificationFilter; label: string; empty: string }[] = [
  { key: "all", label: "전체", empty: "아직 관리자 알림이 없습니다." },
  { key: "unread", label: "미확인", empty: "미확인 관리자 알림이 없습니다." },
  { key: "actionable", label: "처리 필요", empty: "지금 처리할 관리자 업무가 없습니다." },
  { key: "resolved", label: "처리 완료", empty: "처리 완료된 관리자 알림 기록이 없습니다." },
];
const dateFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "시간 확인 중" : dateFormatter.format(date);
}

function isAbortError(caught: unknown) {
  return caught instanceof DOMException && caught.name === "AbortError";
}

export function AdminNotificationsClient() {
  const [filter, setFilter] = useState<AdminNotificationFilter>("all");
  const [items, setItems] = useState<AdminNotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [actionableCount, setActionableCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    Promise.resolve().then(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await listAdminNotifications(filter, controller.signal, PAGE_SIZE, 0);
        if (requestId !== requestSeqRef.current) return;
        setItems(response.items);
        setTotal(response.total);
        setUnreadCount(response.unread_count);
        setActionableCount(response.actionable_count);
      } catch (caught) {
        if (isAbortError(caught) || requestId !== requestSeqRef.current) return;
        setError(caught instanceof AdminNotificationsApiError ? caught.message : "관리자 알림을 불러오지 못했습니다.");
        setItems([]);
        setTotal(0);
      } finally {
        if (!controller.signal.aborted && requestId === requestSeqRef.current) setLoading(false);
      }
    });
    return () => controller.abort();
  }, [filter]);

  const loadMore = async () => {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    try {
      const response = await listAdminNotifications(filter, undefined, PAGE_SIZE, items.length);
      setItems((current) => [...current, ...response.items]);
      setTotal(response.total);
      setUnreadCount(response.unread_count);
      setActionableCount(response.actionable_count);
    } catch (caught) {
      setLiveMessage(caught instanceof AdminNotificationsApiError ? caught.message : "다음 알림을 불러오지 못했습니다.");
    } finally {
      setLoadingMore(false);
    }
  };

  const markRead = async (item: AdminNotificationItem) => {
    if (item.is_read) return;
    try {
      const updated = await markAdminNotificationRead(item.id);
      setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
      setUnreadCount((current) => Math.max(0, current - 1));
      setLiveMessage("관리자 알림을 읽음 처리했습니다.");
    } catch (caught) {
      setLiveMessage(caught instanceof AdminNotificationsApiError ? caught.message : "읽음 처리에 실패했습니다.");
    }
  };

  const readAll = async () => {
    try {
      const result = await markAllAdminNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, is_read: true, read_at: item.read_at ?? new Date().toISOString() })));
      setUnreadCount(0);
      setLiveMessage(`관리자 알림 ${result.marked_read_count}건을 읽음 처리했습니다.`);
    } catch {
      setLiveMessage("전체 읽음 처리에 실패했습니다.");
    }
  };

  const empty = filters.find((entry) => entry.key === filter)?.empty ?? "관리자 알림이 없습니다.";

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="admin-notifications-title">
        <div>
          <p className={styles.eyebrow}>ADMIN NOTIFICATIONS</p>
          <h1 id="admin-notifications-title">관리자 운영 알림</h1>
          <p>모든 관리자가 함께 보는 운영 업무 알림입니다. 읽음 상태는 관리자 계정별로 따로 저장됩니다.</p>
        </div>
        <div className={styles.summaryGrid} aria-label="관리자 알림 요약">
          <div><span>전체</span><strong>{total}</strong></div>
          <div><span>미확인</span><strong>{unreadCount}</strong></div>
          <div><span>처리 필요</span><strong>{actionableCount}</strong></div>
        </div>
      </section>

      <section className={styles.toolbar} aria-label="관리자 알림 필터">
        <div className={styles.segmentedControl}>
          {filters.map((entry) => (
            <button key={entry.key} type="button" aria-pressed={filter === entry.key} onClick={() => setFilter(entry.key)}>
              {entry.label}
            </button>
          ))}
        </div>
        <button className="button button-secondary" type="button" onClick={() => void readAll()} disabled={unreadCount === 0}>전체 읽음</button>
      </section>

      <p className={styles.liveRegion} role="status" aria-live="polite">{liveMessage}</p>

      <section className={styles.listSection} aria-busy={loading}>
        {loading && <div className={styles.stateCard}><Icon name="bell" size={28} /><strong>관리자 알림을 불러오는 중입니다.</strong></div>}
        {!loading && error && <div className={styles.stateCard} role="alert"><Icon name="info" size={28} /><strong>{error}</strong></div>}
        {!loading && !error && items.length === 0 && <div className={styles.stateCard}><Icon name="check" size={28} /><strong>{empty}</strong></div>}
        {!loading && !error && items.length > 0 && (
          <div className={styles.notificationList} role="list">
            {items.map((item) => {
              const destination = getAdminNotificationDestination(item);
              const status = getAdminNotificationStatus(item);
              return (
                <article className={styles.card} data-status={status.tone} key={item.id} role="listitem" aria-labelledby={`admin-notification-${item.id}`}>
                  <span className={styles.cardIcon} aria-hidden="true"><Icon name={destination.icon} size={22} /></span>
                  <div className={styles.cardBody}>
                    <div className={styles.cardMeta}>
                      <span>{destination.label}</span>
                      <em>{status.label}</em>
                      <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
                    </div>
                    <h2 id={`admin-notification-${item.id}`}>{item.title}</h2>
                    <p>{item.message}</p>
                    {item.resolved_at && <small>처리 완료: {formatDate(item.resolved_at)}</small>}
                  </div>
                  <div className={styles.cardActions}>
                    {!item.is_read && <button className="button button-secondary" type="button" onClick={() => void markRead(item)}>읽음 처리</button>}
                    <Link className="button button-primary" href={destination.href} onClick={() => void markRead(item)}>{destination.action}<Icon name="arrow" size={15} /></Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!loading && !error && items.length < total && (
          <button className={styles.moreButton} type="button" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "불러오는 중..." : "더 보기"}
          </button>
        )}
      </section>
    </main>
  );
}
