import type { IconName } from "@/components/common/Icon";
import type { AdminNotificationItem } from "@/lib/adminNotificationsApi";

export type AdminNotificationDestination = {
  label: string;
  icon: IconName;
  href: string;
  action: string;
};

export function getAdminNotificationDestination(notification: Pick<AdminNotificationItem, "notification_type" | "related_type" | "related_id">): AdminNotificationDestination {
  const relatedId = Number.isSafeInteger(notification.related_id) && notification.related_id > 0 ? notification.related_id : null;
  if (notification.notification_type === "OPERATION_DETECTION_REVIEW_REQUIRED" && notification.related_type === "DETECTION_EVENT" && relatedId !== null) {
    return { label: "탐지 검토", icon: "scan", href: `/admin/detections?detection=${relatedId}`, action: "탐지 검토하기" };
  }
  if (notification.notification_type === "FOUND_ITEM_REGISTRATION_REQUIRED") {
    return { label: "공식 발견물", icon: "packageCheck", href: "/admin/detections", action: "발견물 등록하기" };
  }
  if (notification.notification_type === "WASTE_COLLECTION_REQUIRED") {
    return { label: "폐기물 수거", icon: "trash", href: "/admin/detections?followUp=WASTE_PENDING", action: "수거 확인하기" };
  }
  if (notification.notification_type === "CITIZEN_REPORT_REVIEW_REQUIRED") {
    return { label: "시민 제보", icon: "document", href: "/admin/citizen-reports?status=PENDING", action: "제보 검토하기" };
  }
  if (notification.notification_type === "OWNERSHIP_CLAIM_REVIEW_REQUIRED") {
    return { label: "소유권 요청", icon: "userSearch", href: "/admin/ownership-claims?status=PENDING", action: "소유권 검토하기" };
  }
  if (notification.notification_type === "OWNERSHIP_RETURN_REQUIRED") {
    return { label: "반환 대기", icon: "return", href: "/admin/ownership-claims?status=APPROVED", action: "반환 확인하기" };
  }
  return { label: "관리자 알림", icon: "bell", href: "/admin", action: "관리자 화면으로 이동" };
}

export function getAdminNotificationStatus(item: Pick<AdminNotificationItem, "is_read" | "is_actionable" | "resolved_at">) {
  if (item.resolved_at !== null || !item.is_actionable) {
    return { label: "처리 완료", tone: "resolved" as const };
  }
  if (!item.is_read) {
    return { label: "미확인", tone: "unread" as const };
  }
  return { label: "처리 필요", tone: "actionable" as const };
}

export function formatAdminNotificationBadge(count: number) {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

export function shouldPollAdminNotifications(role: string | undefined, visibilityState: DocumentVisibilityState = "visible") {
  return role === "ADMIN" && visibilityState === "visible";
}
