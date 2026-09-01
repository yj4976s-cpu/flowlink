import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildClassDonutGradient,
  formatCompletionRate,
  formatMilliseconds,
  formatPercentValue,
  getDetectionReportState,
  getPrimaryClass,
  getProcessingFrameProgress,
  getReportHref,
  getTrackTimelineView,
  getVideoDurationMs,
  parseAnalysisPeriod,
  parseReportEventQuery,
  parseReportEventId,
  shouldPollVideoProcessing,
  summarizeEventObjects,
} from "../src/components/mypage/analysis-report/analysisReportViewState.ts";

const root = process.cwd();

function source(path) {
  const normalized = root.endsWith("frontend") ? path.replace(/^frontend\//, "") : path;
  return readFileSync(join(root, normalized), "utf8");
}

const summary = {
  period_days: 30,
  period_start: "2026-08-02T00:00:00Z",
  period_end: "2026-09-01T00:00:00Z",
  generated_at: "2026-09-01T00:00:00Z",
  total_analyses: 3,
  completed_count: 1,
  failed_count: 1,
  in_progress_count: 1,
  completion_rate: 33.3,
  image_count: 1,
  video_count: 2,
  total_detected_objects: 4,
  average_confidence: 0.82,
  class_distribution: [
    { class_code: "BALL", class_name_ko: "공", count: 2, ratio: 0.5 },
    { class_code: "FOOTWEAR", class_name_ko: "신발", count: 1, ratio: 0.25 },
    { class_code: "TRASH", class_name_ko: "폐기물", count: 0, ratio: 0 },
    { class_code: "HAT", class_name_ko: "모자", count: 1, ratio: 0.25 },
  ],
  confidence_distribution: [],
  daily_trend: [],
  recent_events: [],
};

const completedEvent = {
  id: 12,
  source_type: "IMAGE",
  status: "COMPLETED",
  purpose: "USER_ANALYSIS",
  original_media_url: "detections/user/1/image.jpg",
  original_media_bytes: 1200,
  result_media_url: null,
  result_media_bytes: null,
  ai_model_id: "model-a",
  media_width: 100,
  media_height: 80,
  video_duration_seconds: null,
  created_at: "2026-09-01T00:00:00Z",
  processing_started_at: "2026-09-01T00:00:00Z",
  processing_completed_at: "2026-09-01T00:00:03Z",
  detected_objects: [
    {
      id: 1,
      class_code: "BALL",
      class_name_ko: "공",
      group_code: "PERSONAL_ITEM",
      confidence: 0.91,
      bbox: { x: 1, y: 2, width: 30, height: 40 },
      track_id: null,
      first_seen_ms: null,
      last_seen_ms: null,
      appearance_count: 1,
    },
    {
      id: 2,
      class_code: "HAT",
      class_name_ko: "모자",
      group_code: "PERSONAL_ITEM",
      confidence: 0.51,
      bbox: { x: 3, y: 4, width: 20, height: 25 },
      track_id: null,
      first_seen_ms: null,
      last_seen_ms: null,
      appearance_count: 1,
    },
  ],
};

test("analysis report query parsing and hrefs are safe", () => {
  assert.equal(parseAnalysisPeriod("7"), 7);
  assert.equal(parseAnalysisPeriod("90"), 90);
  assert.equal(parseAnalysisPeriod("14"), 30);
  assert.equal(parseAnalysisPeriod(null), 30);
  assert.equal(parseReportEventId("12"), 12);
  assert.equal(parseReportEventId("0"), null);
  assert.equal(parseReportEventId("abc"), null);
  assert.deepEqual(parseReportEventQuery(new URLSearchParams("")), { kind: "summary", eventId: null });
  assert.deepEqual(parseReportEventQuery(new URLSearchParams("eventId=12")), { kind: "detail", eventId: 12 });
  assert.deepEqual(parseReportEventQuery(new URLSearchParams("eventId=abc")), { kind: "invalid", eventId: null });
  assert.deepEqual(parseReportEventQuery(new URLSearchParams("eventId=0")), { kind: "invalid", eventId: null });
  assert.deepEqual(parseReportEventQuery(new URLSearchParams("eventId=-1")), { kind: "invalid", eventId: null });
  assert.deepEqual(parseReportEventQuery(new URLSearchParams("eventId=1.5")), { kind: "invalid", eventId: null });
  assert.deepEqual(parseReportEventQuery(new URLSearchParams("eventId=1&eventId=2")), { kind: "invalid", eventId: null });
  assert.equal(getReportHref(12), "/mypage/analysis-report?eventId=12");
});

test("analysis report state uses real event status", () => {
  assert.equal(getDetectionReportState(null, null), "summary");
  assert.equal(getDetectionReportState(null, 12), "not-found");
  assert.equal(getDetectionReportState({ ...completedEvent, status: "PROCESSING" }, 12), "processing");
  assert.equal(getDetectionReportState({ ...completedEvent, status: "FAILED" }, 12), "failed");
  assert.equal(getDetectionReportState(completedEvent, 12), "completed");
  assert.equal(getDetectionReportState(null, null, true), "not-found");
});

test("analysis report object summary and percentage formatting are deterministic", () => {
  const objectSummary = summarizeEventObjects(completedEvent);

  assert.equal(objectSummary.total, 2);
  assert.equal(Math.round((objectSummary.averageConfidence ?? 0) * 100), 71);
  assert.equal(objectSummary.maxConfidence, 0.91);
  assert.deepEqual(objectSummary.classes.map((item) => [item.code, item.count]), [["BALL", 1], ["HAT", 1]]);
  assert.equal(getPrimaryClass(completedEvent)?.class_code, "BALL");
  assert.equal(formatPercentValue(null), "탐지 객체 없음");
  assert.equal(formatPercentValue(0.82), "82%");
  assert.equal(formatCompletionRate(33.333), "33.3%");
});

test("class donut chart uses real class ratios instead of fixed segments", () => {
  const gradient = buildClassDonutGradient(summary);

  assert.match(gradient, /^conic-gradient\(/);
  assert.match(gradient, /var\(--color-primary\) 0% 50%/);
  assert.match(gradient, /var\(--color-secondary\) 50% 75%/);
  assert.doesNotMatch(gradient, /TRASH/);
  assert.match(gradient, /var\(--color-success\) 75% 100%/);
  assert.equal(buildClassDonutGradient({ ...summary, total_detected_objects: 0 }), "");
});

test("video report timeline and processing progress use measured values only", () => {
  assert.equal(getVideoDurationMs({ video_duration_seconds: null }), null);
  assert.equal(getVideoDurationMs({ video_duration_seconds: 4.5 }), 4500);
  assert.deepEqual(getTrackTimelineView({ first_seen_ms: 1000, last_seen_ms: 3000, appearance_count: 12 }, 5000), {
    left: 20,
    width: 40,
    appearanceCount: 12,
  });
  assert.deepEqual(getTrackTimelineView({ first_seen_ms: -500, last_seen_ms: 6000, appearance_count: 2 }, 5000), {
    left: 0,
    width: 100,
    appearanceCount: 2,
  });
  assert.equal(getTrackTimelineView({ first_seen_ms: null, last_seen_ms: 1000, appearance_count: 1 }, 5000), null);
  assert.equal(formatMilliseconds(null), "기록 없음");
  assert.equal(formatMilliseconds(850), "850ms");
  assert.equal(formatMilliseconds(2100), "2.1초");
  assert.equal(getProcessingFrameProgress(null), null);
  assert.equal(getProcessingFrameProgress({ processed_frames: 45, total_frames: 90 }), 50);
  assert.equal(getProcessingFrameProgress({ processed_frames: 120, total_frames: 90 }), 100);
  assert.equal(shouldPollVideoProcessing({ ...completedEvent, source_type: "VIDEO", status: "PROCESSING" }, 12), true);
  assert.equal(shouldPollVideoProcessing({ ...completedEvent, source_type: "VIDEO", status: "COMPLETED" }, 12), false);
  assert.equal(shouldPollVideoProcessing({ ...completedEvent, source_type: "VIDEO", status: "PROCESSING" }, 12, true), false);
});

test("analysis report page keeps route guard, print, stale request protection, and safe video fallback", () => {
  const page = source("frontend/src/app/mypage/analysis-report/page.tsx");
  const client = source("frontend/src/components/mypage/analysis-report/AnalysisReportClient.tsx");
  const css = source("frontend/src/components/mypage/analysis-report/AnalysisReportClient.module.css");

  assert.match(page, /UserRouteGuard/);
  assert.match(client, /window\.print\(\)/);
  assert.match(client, /data-print-report="analysis-report"/);
  assert.match(client, /AbortController/);
  assert.match(client, /requestSeq/);
  assert.match(client, /result_media_url \?/);
  assert.doesNotMatch(client, /result_media_url \|\| currentEvent\.original_media_url/);
  assert.match(css, /@page \{ size: A4; margin: 10mm; \}/);
  assert.match(css, /data-daru-stage="true"/);
  assert.match(css, /data-flow-copilot-root="true"/);
  assert.match(css, /data-notification-toast="true"/);
  assert.match(css, /print-color-adjust: exact/);
  assert.match(css, /chartGrid \{ grid-template-columns: repeat\(2/);
  assert.doesNotMatch(css, /@media print[\s\S]*\\.chartPanel\\s*\\{[^}]*display:\\s*none/);
});

test("notifications, detect result, and mypage link to private analysis reports", () => {
  const routing = source("frontend/src/lib/notificationRouting.ts");
  const workbench = source("frontend/src/components/detection/DetectionWorkbench.tsx");
  const mypage = source("frontend/src/components/mypage/MyPageClient.tsx");

  assert.match(routing, /DETECTION_COMPLETED/);
  assert.match(routing, /DETECTION_FAILED/);
  assert.match(routing, /\/mypage\/analysis-report\?eventId=/);
  assert.match(workbench, /AI 요약보고서 보기/);
  assert.match(workbench, /실패 내용 확인/);
  assert.match(mypage, /getMyDetectionSummary\(30/);
  assert.match(mypage, /AI 분석 요약/);
});
