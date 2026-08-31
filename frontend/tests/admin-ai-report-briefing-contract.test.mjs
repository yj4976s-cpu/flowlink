import assert from "node:assert/strict";
import test from "node:test";

import { chooseOwnershipClaimId, parseCitizenReportStatusParam, parseOwnershipClaimStatusParam } from "../src/components/admin/adminQueryState.ts";
import { adminOperationsBriefingFallbackTasks, geminiBriefingLabel } from "../src/components/admin/ai-report/adminAiReportViewState.ts";

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
