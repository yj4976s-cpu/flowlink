import type { IconName } from "@/components/common/Icon";
import type { NotificationResponse } from "@/lib/notificationsApi";

export type NotificationDestination = {
  label: string;
  icon: IconName;
  href: string;
  action: string;
};

export function getNotificationDestination(notification: NotificationResponse): NotificationDestination | null {
  if (notification.notification_type === "MATCH_FOUND" && notification.related_type === "LOST_REPORT" && notification.related_id !== null) {
    return { label: "매칭", icon: "match", href: `/matches?reportId=${notification.related_id}`, action: "매칭 후보 확인하기" };
  }
  if (notification.notification_type === "MATCH_FOUND" && notification.related_type === "MATCH_CANDIDATE") {
    return { label: "매칭", icon: "match", href: "/matches", action: "매칭 후보 확인하기" };
  }
  if (notification.notification_type === "STATUS_CHANGED" && notification.related_type === "OWNERSHIP_CLAIM") {
    return { label: "소유권 상태 변경", icon: "check", href: "/matches", action: "매칭 현황 확인하기" };
  }
  if (notification.notification_type === "CITIZEN_REPORT_STATUS" && notification.related_type === "CITIZEN_REPORT") {
    return { label: "발견 제보 상태", icon: "document", href: "/mypage#my-activity", action: "내 제보 확인하기" };
  }
  if (notification.notification_type === "DETECTION_COMPLETED" && notification.related_type === "DETECTION_EVENT" && notification.related_id !== null) {
    return { label: "AI 분석 완료", icon: "scan", href: `/mypage/analysis-report?eventId=${notification.related_id}`, action: "분석 보고서 보기" };
  }
  if (notification.notification_type === "DETECTION_FAILED" && notification.related_type === "DETECTION_EVENT" && notification.related_id !== null) {
    return { label: "AI 분석 실패", icon: "info", href: `/mypage/analysis-report?eventId=${notification.related_id}`, action: "분석 결과 확인하기" };
  }
  return null;
}
