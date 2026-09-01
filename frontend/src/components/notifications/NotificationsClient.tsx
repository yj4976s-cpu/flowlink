"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { getNotificationDestination } from "@/lib/notificationRouting";
import {
  listNotifications,
  markNotificationRead,
  NotificationsApiError,
  type NotificationFilter,
  type NotificationResponse,
} from "@/lib/notificationsApi";
import styles from "./NotificationsClient.module.css";

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusLabels: Record<string, string> = {
  PENDING: "검토 중",
  APPROVED: "승인됨",
  REJECTED: "거절됨",
  RETURNED: "반환 완료",
};

type ReadError = {
  message: string;
  status: number | null;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "일시 확인 중" : dateTimeFormatter.format(date);
}

function getTypeMeta(notificationType: string) {
  if (notificationType === "MATCH_FOUND") {
    return {
      label: "매칭",
      icon: "match" as const,
    };
  }
  if (notificationType === "STATUS_CHANGED") {
    return {
      label: "상태 변경",
      icon: "check" as const,
    };
  }
  if (notificationType === "DETECTION_COMPLETED") {
    return {
      label: "AI 분석 완료",
      icon: "scan" as const,
    };
  }
  if (notificationType === "DETECTION_FAILED") {
    return {
      label: "AI 분석 실패",
      icon: "info" as const,
    };
  }
  return {
    label: "알림",
    icon: "document" as const,
  };
}

function formatNotificationMessage(notification: NotificationResponse) {
  if (notification.notification_type !== "STATUS_CHANGED") return notification.message;

  return notification.message.replace(
    /소유권 확인 요청 상태가 (PENDING|APPROVED|REJECTED|RETURNED)\(으\)로 변경되었습니다\./,
    (_, status: string) => `소유권 확인 요청 상태가 ${statusLabels[status] ?? status}(으)로 변경되었습니다.`,
  );
}

function getNotificationAction(notification: NotificationResponse) {
  const destination = getNotificationDestination(notification);
  if (destination) {
    return {
      href: destination.href,
      label: destination.action,
    };
  }
  if (notification.notification_type === "MATCH_FOUND" && notification.related_type === "LOST_REPORT" && notification.related_id !== null) {
    return {
      href: `/matches?reportId=${notification.related_id}`,
      label: "매칭 후보 확인하기",
    };
  }
  if (notification.notification_type === "MATCH_FOUND" && notification.related_type === "MATCH_CANDIDATE") {
    return {
      href: "/matches",
      label: "매칭 후보 확인하기",
    };
  }
  if (notification.notification_type === "STATUS_CHANGED" && notification.related_type === "OWNERSHIP_CLAIM") {
    return {
      href: "/matches",
      label: "매칭 현황 확인하기",
    };
  }
  return null;
}

function isAbortError(caught: unknown) {
  return caught instanceof DOMException && caught.name === "AbortError";
}

function NotificationStateCard({
  title,
  description,
  tone = "default",
  children,
}: {
  title: string;
  description: string;
  tone?: "default" | "error";
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`${styles.stateCard} ${tone === "error" ? styles.stateError : ""}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon name={tone === "error" ? "spark" : "document"} size={26} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {children}
      </div>
    </div>
  );
}

function NotificationCard({
  notification,
  readError,
  isProcessing,
  onMarkRead,
}: {
  notification: NotificationResponse;
  readError?: ReadError;
  isProcessing: boolean;
  onMarkRead: () => void;
}) {
  const unread = notification.read_at === null;
  const typeMeta = getTypeMeta(notification.notification_type);
  const action = getNotificationAction(notification);
  const titleId = `notification-${notification.id}-title`;

  return (
    <article className={`${styles.notificationCard} ${unread ? styles.unreadCard : ""}`} aria-labelledby={titleId}>
      <div className={styles.cardIcon} aria-hidden="true">
        <Icon name={typeMeta.icon} size={24} />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTopLine}>
          <span className={styles.typeBadge}>{typeMeta.label}</span>
          <span className={unread ? styles.unreadBadge : styles.readBadge}>
            {unread ? "안 읽음" : "읽음"}
          </span>
        </div>
        <h2 id={titleId}>{notification.title}</h2>
        <p>{formatNotificationMessage(notification)}</p>
        <dl className={styles.metaList}>
          <div>
            <dt>받은 시각</dt>
            <dd>
              <time dateTime={notification.created_at}>{formatDateTime(notification.created_at)}</time>
            </dd>
          </div>
          {notification.read_at && (
            <div>
              <dt>읽은 시각</dt>
              <dd>
                <time dateTime={notification.read_at}>{formatDateTime(notification.read_at)}</time>
              </dd>
            </div>
          )}
        </dl>
        {readError && (
          <div className={styles.readError} role="alert">
            <span>{readError.message}</span>
            {readError.status === 401 && <Link href="/login">로그인하러 가기</Link>}
          </div>
        )}
      </div>
      <div className={styles.cardActions}>
        {action && (
          <Link className="button button-secondary" href={action.href}>
            {action.label}
            <Icon name="arrow" size={16} />
          </Link>
        )}
        {unread && (
          <button className="button button-primary" type="button" onClick={onMarkRead} disabled={isProcessing}>
            {isProcessing ? "처리 중" : "읽음 처리"}
          </button>
        )}
      </div>
    </article>
  );
}

export function NotificationsClient() {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [notifications, setNotifications] = useState<NotificationResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [processingReadIds, setProcessingReadIds] = useState<Set<number>>(() => new Set());
  const [readErrors, setReadErrors] = useState<Record<number, ReadError>>({});
  const [liveMessage, setLiveMessage] = useState("");
  const currentFilterRef = useRef<NotificationFilter>("all");
  const processingReadIdsRef = useRef<Set<number>>(new Set());
  const requestSequence = useRef(0);

  useEffect(() => {
    currentFilterRef.current = filter;
    const controller = new AbortController();
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;

    const load = async () => {
      try {
        const data = await listNotifications(filter, controller.signal);
        if (requestId !== requestSequence.current) return;
        setNotifications(data);
        setError(null);
        setErrorStatus(null);
      } catch (caught) {
        if (isAbortError(caught) || requestId !== requestSequence.current) return;
        if (caught instanceof NotificationsApiError) {
          setError(caught.message);
          setErrorStatus(caught.status ?? null);
        } else {
          setError("알림을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
          setErrorStatus(null);
        }
        setNotifications([]);
      } finally {
        if (!controller.signal.aborted && requestId === requestSequence.current) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [filter]);

  const summaryText = useMemo(() => {
    if (loading) return "알림을 불러오는 중입니다.";
    if (error) return error;
    return filter === "unread"
      ? `현재 표시된 안 읽은 알림 ${notifications.length}개`
      : `현재 표시된 알림 ${notifications.length}개`;
  }, [error, filter, loading, notifications.length]);

  const refreshNotifications = async ({
    clearReadErrors = true,
    showLoading = true,
  }: {
    clearReadErrors?: boolean;
    showLoading?: boolean;
  } = {}) => {
    const targetFilter = currentFilterRef.current;
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    if (showLoading) {
      setLoading(true);
      setError(null);
      setErrorStatus(null);
    }
    if (clearReadErrors) setReadErrors({});

    try {
      const data = await listNotifications(targetFilter);
      if (requestId !== requestSequence.current) return;
      setNotifications(data);
      setError(null);
      setErrorStatus(null);
      setLiveMessage("알림 목록을 다시 불러왔습니다.");
    } catch (caught) {
      if (requestId !== requestSequence.current) return;
      if (!showLoading) {
        setLiveMessage("알림 목록을 최신 상태로 다시 불러오지 못했습니다.");
        if (caught instanceof NotificationsApiError) {
          setError(caught.message);
          setErrorStatus(caught.status ?? null);
        } else {
          setError("알림을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
          setErrorStatus(null);
        }
        return;
      }
      if (caught instanceof NotificationsApiError) {
        setError(caught.message);
        setErrorStatus(caught.status ?? null);
      } else {
        setError("알림을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
        setErrorStatus(null);
      }
      setNotifications([]);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  };

  const changeFilter = (nextFilter: NotificationFilter) => {
    if (nextFilter === filter) return;
    currentFilterRef.current = nextFilter;
    setFilter(nextFilter);
    setNotifications([]);
    setReadErrors({});
    setError(null);
    setErrorStatus(null);
    setLoading(true);
    setLiveMessage(nextFilter === "unread" ? "안 읽은 알림을 불러옵니다." : "전체 알림을 불러옵니다.");
  };

  const handleMarkRead = async (notificationId: number) => {
    if (processingReadIdsRef.current.has(notificationId)) return;
    const filterAtReadStart = currentFilterRef.current;
    const requestSequenceAtReadStart = requestSequence.current;

    const nextProcessingReadIds = new Set(processingReadIdsRef.current);
    nextProcessingReadIds.add(notificationId);
    processingReadIdsRef.current = nextProcessingReadIds;
    setProcessingReadIds(nextProcessingReadIds);
    setReadErrors((current) => {
      const next = { ...current };
      delete next[notificationId];
      return next;
    });

    try {
      const updatedNotification = await markNotificationRead(notificationId);
      const currentFilter = currentFilterRef.current;
      const listRequestChanged = requestSequence.current !== requestSequenceAtReadStart;
      if (currentFilter !== filterAtReadStart || listRequestChanged) {
        setLiveMessage("알림을 읽음 처리하고 현재 필터를 최신 상태로 확인합니다.");
        void refreshNotifications({ clearReadErrors: false, showLoading: false });
        return;
      }
      setNotifications((current) => {
        if (currentFilter === "unread" && updatedNotification.read_at !== null) {
          return current.filter((notification) => notification.id !== notificationId);
        }
        return current.map((notification) => (
          notification.id === notificationId ? updatedNotification : notification
        ));
      });
      setLiveMessage("알림을 읽음 처리했습니다.");
    } catch (caught) {
      const readError = caught instanceof NotificationsApiError
        ? { message: caught.message, status: caught.status ?? null }
        : { message: "알림을 읽음 처리하지 못했습니다. 잠시 후 다시 시도해주세요.", status: null };

      setReadErrors((current) => ({ ...current, [notificationId]: readError }));
      if (readError.status === 404) {
        setLiveMessage(readError.message);
        void refreshNotifications({ clearReadErrors: false });
      }
    } finally {
      const nextProcessingReadIds = new Set(processingReadIdsRef.current);
      nextProcessingReadIds.delete(notificationId);
      processingReadIdsRef.current = nextProcessingReadIds;
      setProcessingReadIds(nextProcessingReadIds);
    }
  };

  const emptyTitle = filter === "unread" ? "현재 확인하지 않은 알림이 없습니다." : "아직 받은 알림이 없습니다.";
  const emptyDescription = filter === "unread"
    ? "새로운 매칭 후보나 소유권 확인 상태 변경이 생기면 이곳에서 확인할 수 있습니다."
    : "매칭 후보와 소유권 확인 상태 알림이 생성되면 최신순으로 표시됩니다.";

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="notifications-title">
        <div>
          <p className={styles.eyebrow}>NOTIFICATIONS</p>
          <h1 id="notifications-title">내 알림을<br />한곳에서 확인해요</h1>
          <p>
            분실 신고와 연결된 매칭 후보, 소유권 확인 상태 변경처럼 시민 계정에 도착한 알림을
            최신순으로 보여줍니다.
          </p>
        </div>
        <div className={styles.heroCard} aria-label="알림 목록 요약">
          <Icon name="spark" size={34} />
          <strong>{summaryText}</strong>
          <span>알림은 계정 기준으로만 조회되며, 비공개 검증 정보나 관리자 메모는 표시하지 않습니다.</span>
        </div>
      </section>

      <section className={styles.toolbar} aria-label="알림 필터">
        <div className={styles.segmentedControl}>
          <button
            type="button"
            aria-pressed={filter === "all"}
            className={filter === "all" ? styles.activeSegment : undefined}
            onClick={() => changeFilter("all")}
          >
            전체
          </button>
          <button
            type="button"
            aria-pressed={filter === "unread"}
            className={filter === "unread" ? styles.activeSegment : undefined}
            onClick={() => changeFilter("unread")}
          >
            안 읽음
          </button>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void refreshNotifications()} disabled={loading}>
          새로고침
        </button>
      </section>

      <p className={styles.liveRegion} role="status" aria-live="polite">
        {liveMessage}
      </p>

      <section className={styles.results} aria-labelledby="notifications-list-title" aria-busy={loading}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>MY NOTIFICATIONS</p>
            <h2 id="notifications-list-title">알림 목록</h2>
          </div>
          {!loading && !error && <span>{summaryText}</span>}
        </div>

        {loading && (
          <NotificationStateCard
            title="알림을 불러오고 있습니다."
            description="현재 선택한 필터에 맞춰 알림 목록을 확인하는 중입니다."
          />
        )}

        {!loading && error && (
          <NotificationStateCard
            title={errorStatus === 401 ? "로그인이 필요합니다." : "알림을 불러오지 못했습니다."}
            description={error}
            tone="error"
          >
            <div className={styles.stateActions}>
              {errorStatus === 401 ? (
                <Link className="button button-primary" href="/login">로그인하러 가기</Link>
              ) : (
                <button className="button button-secondary" type="button" onClick={() => void refreshNotifications()}>
                  다시 시도
                </button>
              )}
            </div>
          </NotificationStateCard>
        )}

        {!loading && !error && notifications.length === 0 && (
          <NotificationStateCard title={emptyTitle} description={emptyDescription} />
        )}

        {!loading && !error && notifications.length > 0 && (
          <div className={styles.notificationList} role="list">
            {notifications.map((notification) => (
              <div key={notification.id} role="listitem">
                <NotificationCard
                  notification={notification}
                  readError={readErrors[notification.id]}
                  isProcessing={processingReadIds.has(notification.id)}
                  onMarkRead={() => void handleMarkRead(notification.id)}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
