import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { chooseOwnershipClaimId, parseCitizenReportStatusParam, parseOwnershipClaimStatusParam } from "../src/components/admin/adminQueryState.ts";
import {
  ADMIN_REPORT_PERIODS,
  adminOperationsBriefingFallbackTasks,
  buildSvgTrendPath,
  geminiBriefingLabel,
  getTrendChartMax,
  safePercent,
  shouldShowTrendLabel,
} from "../src/components/admin/ai-report/adminAiReportViewState.ts";

test("admin operations briefing uses deep links understood by admin screens", () => {
  assert.deepEqual(adminOperationsBriefingFallbackTasks.map((task) => task.href), [
    "/admin/detections",
    "/admin/detections?followUp=WASTE_PENDING",
    "/admin/citizen-reports?status=PENDING",
    "/admin/ownership-claims?status=PENDING",
    "/admin/ownership-claims?status=APPROVED",
  ]);
  const wasteUrl = new URL(adminOperationsBriefingFallbackTasks[1].href, "https://flowlink.example");
  assert.equal(wasteUrl.searchParams.get("followUp"), "WASTE_PENDING");
});

test("citizen report status query applies only supported initial filters", () => {
  assert.equal(parseCitizenReportStatusParam("PENDING"), "PENDING");
  assert.equal(parseCitizenReportStatusParam("pending"), "PENDING");
  assert.equal(parseCitizenReportStatusParam("UNDER_REVIEW"), "UNDER_REVIEW");
  assert.equal(parseCitizenReportStatusParam("LINKED"), "LINKED");
  assert.equal(parseCitizenReportStatusParam("CANCELLED"), "");
  assert.equal(parseCitizenReportStatusParam("WRONG"), "");
  assert.equal(parseCitizenReportStatusParam(null), "");
});

test("ownership claim status query prioritizes matching rows without hiding the list", () => {
  const claims = [
    { id: 10, status: "REJECTED" },
    { id: 20, status: "PENDING" },
    { id: 30, status: "APPROVED" },
  ];
  assert.equal(parseOwnershipClaimStatusParam("PENDING"), "PENDING");
  assert.equal(parseOwnershipClaimStatusParam("approved"), "APPROVED");
  assert.equal(parseOwnershipClaimStatusParam("WRONG"), null);
  assert.equal(chooseOwnershipClaimId(claims, null, "PENDING"), 20);
  assert.equal(chooseOwnershipClaimId(claims, null, "APPROVED"), 30);
  assert.equal(chooseOwnershipClaimId(claims, null, null), 10);
  assert.equal(chooseOwnershipClaimId(claims, 10, "APPROVED"), 10);
});

test("Gemini status label prefers successful connection and shows fallback after rule-based summary", () => {
  assert.equal(geminiBriefingLabel({ gemini_connected: true, gemini_configured: true, fallback_used: false }), "Gemini 연결됨");
  assert.equal(geminiBriefingLabel({ gemini_connected: false, gemini_configured: true, fallback_used: true }), "규칙 기반 요약");
  assert.equal(geminiBriefingLabel({ gemini_connected: false, gemini_configured: true, fallback_used: false }), "Gemini 설정됨");
  assert.equal(geminiBriefingLabel({ gemini_connected: false, gemini_configured: false, fallback_used: true }), "규칙 기반 요약");
});

test("admin operations report periods and chart math are deterministic", () => {
  const points = [
    { detection_count: 0, detected_object_count: 2, found_item_count: 1, match_count: 0, returned_count: 0 },
    { detection_count: 3, detected_object_count: 4, found_item_count: 0, match_count: 1, returned_count: 0 },
  ];

  assert.deepEqual([...ADMIN_REPORT_PERIODS], [7, 30, 90]);
  assert.equal(safePercent(2, 4), 50);
  assert.equal(safePercent(4, 0), 0);
  assert.equal(getTrendChartMax(points, ["detection_count", "detected_object_count", "returned_count"]), 4);
  assert.match(buildSvgTrendPath(points, "detected_object_count", 4), /^M 0\.0 110\.0 L 720\.0 0\.0$/);
  assert.equal(shouldShowTrendLabel(0, 90), true);
  assert.equal(shouldShowTrendLabel(14, 90), true);
  assert.equal(shouldShowTrendLabel(13, 90), false);
});

test("admin AI report page keeps report controls, charts, PDF print, and safe copy", () => {
  const client = readFileSync("src/components/admin/ai-report/AdminAiReportClient.tsx", "utf8");
  const css = readFileSync("src/components/admin/ai-report/AdminAiReportClient.module.css", "utf8");
  const api = readFileSync("src/lib/adminAiReportApi.ts", "utf8");
  const viewState = readFileSync("src/components/admin/ai-report/adminAiReportViewState.ts", "utf8");

  assert.match(api, /\/api\/admin\/ai-report\?days=\$\{days\}/);
  assert.match(client, /ADMIN_REPORT_PERIODS\.map/);
  assert.match(client, /AbortController/);
  assert.match(client, /requestSeqRef/);
  assert.match(client, /window\.print\(\)/);
  assert.match(client, /DailyTrendChart/);
  assert.match(client, /OperationFlow/);
  assert.match(client, /현재 대기 업무는 기간 집계가 아닌 지금 남아 있는 backlog/);
  assert.match(client, /동일 물건 집단의 정확한 전환율을 의미하지 않습니다/);
  assert.match(client, /물품 일치 확률이 아닌 모델 분류 신뢰도/);
  assert.match(viewState, /\/admin\/detections\?followUp=WASTE_PENDING/);
  assert.match(css, /@page \{ size: A4 portrait; margin: 10mm; \}/);
  assert.match(css, /:global\(\.site-header\)/);
  assert.match(css, /:global\(\[data-daru-stage="true"\]\)/);
  assert.match(css, /:global\(\[data-flow-copilot-root="true"\]\)/);
  assert.match(css, /:global\(\[data-notification-toast="true"\]\)/);
  assert.match(css, /print-color-adjust: exact/);
  assert.match(css, /break-inside: avoid-page/);
});
