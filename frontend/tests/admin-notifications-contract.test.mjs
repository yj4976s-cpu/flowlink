import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  formatAdminNotificationBadge,
  getAdminNotificationDestination,
  getAdminNotificationStatus,
  shouldPollAdminNotifications,
} from "../src/lib/adminNotificationRouting.ts";

const headerSource = readFileSync(new URL("../src/components/layout/Header.tsx", import.meta.url), "utf8");
const centerSource = readFileSync(new URL("../src/components/notifications/AdminNotificationCenter.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/components/notifications/AdminNotificationsClient.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/lib/adminNotificationsApi.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../../database/migrations/20260901_05_add_admin_notifications.sql", import.meta.url), "utf8");

test("admin notification routing is derived from safe type and related id only", () => {
  assert.equal(getAdminNotificationDestination({
    notification_type: "OPERATION_DETECTION_REVIEW_REQUIRED",
    related_type: "DETECTION_EVENT",
    related_id: 11,
  }).href, "/admin/detections?detection=11");
  assert.equal(getAdminNotificationDestination({
    notification_type: "WASTE_COLLECTION_REQUIRED",
    related_type: "DETECTED_OBJECT",
    related_id: 12,
  }).href, "/admin/detections?followUp=WASTE_PENDING");
  assert.equal(getAdminNotificationDestination({
    notification_type: "CITIZEN_REPORT_REVIEW_REQUIRED",
    related_type: "CITIZEN_REPORT",
    related_id: 13,
  }).href, "/admin/citizen-reports?status=PENDING");
  assert.equal(getAdminNotificationDestination({
    notification_type: "OWNERSHIP_CLAIM_REVIEW_REQUIRED",
    related_type: "OWNERSHIP_CLAIM",
    related_id: 14,
  }).href, "/admin/ownership-claims?status=PENDING");
  assert.equal(getAdminNotificationDestination({
    notification_type: "OWNERSHIP_RETURN_REQUIRED",
    related_type: "OWNERSHIP_CLAIM",
    related_id: 15,
  }).href, "/admin/ownership-claims?status=APPROVED");
  assert.equal(getAdminNotificationDestination({
    notification_type: "UNKNOWN",
    related_type: "https://example.com",
    related_id: 16,
  }).href, "/admin");
});

test("admin notification badge and statuses separate read from resolved", () => {
  assert.equal(formatAdminNotificationBadge(0), "");
  assert.equal(formatAdminNotificationBadge(8), "8");
  assert.equal(formatAdminNotificationBadge(120), "99+");
  assert.deepEqual(getAdminNotificationStatus({ is_read: false, is_actionable: true, resolved_at: null }), {
    label: "미확인",
    tone: "unread",
  });
  assert.deepEqual(getAdminNotificationStatus({ is_read: true, is_actionable: true, resolved_at: null }), {
    label: "처리 필요",
    tone: "actionable",
  });
  assert.deepEqual(getAdminNotificationStatus({ is_read: false, is_actionable: false, resolved_at: "2026-09-01T00:00:00Z" }), {
    label: "처리 완료",
    tone: "resolved",
  });
});

test("admin notification polling is admin-only and pauses while hidden", () => {
  assert.equal(shouldPollAdminNotifications("ADMIN", "visible"), true);
  assert.equal(shouldPollAdminNotifications("ADMIN", "hidden"), false);
  assert.equal(shouldPollAdminNotifications("USER", "visible"), false);
  assert.equal(shouldPollAdminNotifications(undefined, "visible"), false);
});

test("admin notification frontend uses separate API, header branch, route guard, and safe polling contracts", () => {
  assert.match(apiSource, /\/api\/admin\/notifications/);
  assert.match(headerSource, /AdminNotificationCenter/);
  assert.match(headerSource, /isAdmin \? <AdminNotificationCenter/);
  assert.match(headerSource, /<NotificationToastHost key=\{currentUser\?\.id/);
  assert.match(centerSource, /POLL_INTERVAL_MS = 30_000/);
  assert.match(centerSource, /visibilitychange/);
  assert.match(centerSource, /AbortController/);
  assert.match(centerSource, /baselineReadyRef/);
  assert.match(centerSource, /TOAST_LIMIT = 3/);
  assert.match(centerSource, /data-admin-notification-toast/);
  assert.match(pageSource, /관리자 운영 알림/);
  assert.match(pageSource, /전체 읽음/);
});

test("admin notification migration creates isolated tables, unique constraints, and backlog backfill", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS admin_notifications/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS admin_notification_reads/);
  assert.match(migrationSource, /ON CONFLICT \(notification_type, related_type, related_id\) DO NOTHING/);
  assert.match(migrationSource, /PRIMARY KEY \(admin_notification_id, admin_user_id\)/);
  assert.match(migrationSource, /ON DELETE CASCADE/);
  assert.match(migrationSource, /OPERATION_DETECTION_REVIEW_REQUIRED/);
  assert.match(migrationSource, /FOUND_ITEM_REGISTRATION_REQUIRED/);
  assert.match(migrationSource, /WASTE_COLLECTION_REQUIRED/);
  assert.match(migrationSource, /CITIZEN_REPORT_REVIEW_REQUIRED/);
  assert.match(migrationSource, /OWNERSHIP_CLAIM_REVIEW_REQUIRED/);
  assert.match(migrationSource, /OWNERSHIP_RETURN_REQUIRED/);
  assert.doesNotMatch(migrationSource, /INSERT INTO notifications/);
});
