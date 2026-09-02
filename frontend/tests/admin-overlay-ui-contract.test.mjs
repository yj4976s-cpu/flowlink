import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const foundItemsCss = readFileSync("src/components/admin/found-items/AdminFoundItemsClient.module.css", "utf8");
const modelComparisonCss = readFileSync("src/components/admin/model-comparison/AdminModelComparisonClient.module.css", "utf8");
const aiReportCss = readFileSync("src/components/admin/ai-report/AdminAiReportClient.module.css", "utf8");

test("admin drawers and model switch modal stay above the floating copilot launcher", () => {
  assert.match(foundItemsCss, /\.drawerBackdrop \{[^}]*z-index: 230;/);
  assert.match(foundItemsCss, /\.confirmBackdrop \{[^}]*z-index: 250;/);
  assert.match(modelComparisonCss, /\.modalBackdrop \{[\s\S]*?z-index: 240;/);
  assert.match(foundItemsCss, /\.drawerFooter \{[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(foundItemsCss, /@media \(max-width: 520px\) \{[\s\S]*?\.drawerFooter \{[^}]*position: sticky;[^}]*bottom: 0;[\s\S]*?env\(safe-area-inset-bottom\)/);
});

test("admin AI report class rows contain progress bars inside their own card", () => {
  assert.match(aiReportCss, /\.classGrid \{[^}]*overflow: hidden;/);
  assert.match(aiReportCss, /\.classCard \{[^}]*overflow: hidden;[^}]*contain: paint;/);
  assert.match(aiReportCss, /\.classCard \{[^}]*grid-template-columns: minmax\(120px, \.7fr\) minmax\(0, \.62fr\) minmax\(0, 1fr\) minmax\(82px, \.45fr\);/);
  assert.match(aiReportCss, /\.classCard > i \{[^}]*max-width: 100%;/);
  assert.match(aiReportCss, /\.classCard meter \{[^}]*max-width: 100%;/);
});
