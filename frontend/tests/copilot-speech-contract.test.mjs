import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAutoSpeechText,
  resolveManualSpeechText,
  splitSpeechText,
} from "../src/hooks/useSpeechSynthesis.ts";

test("manual listening always reads the full visible answer", () => {
  const message = "화면에 표시되는 자세한 답변입니다. 다음 행동도 함께 설명합니다.";
  const speechText = "핵심 안내입니다.";

  assert.equal(resolveManualSpeechText(message, speechText), message);
});

test("automatic USER guidance prefers concise speech_text", () => {
  const message = "화면에 표시되는 자세한 답변입니다.";
  const speechText = "매칭 후보가 1건 있습니다. 상세 화면에서 확인해 주세요.";

  assert.equal(resolveAutoSpeechText(message, speechText), speechText);
});

test("automatic guidance safely falls back to the visible answer", () => {
  const message = "현재 확인할 새 알림이 없습니다.";

  assert.equal(resolveAutoSpeechText(message, null), message);
  assert.equal(resolveAutoSpeechText(message, "   "), message);
});

test("long Korean speech is split without losing content", () => {
  const message = "첫 번째 안내 문장입니다. 두 번째 안내 문장은 조금 더 길게 작성합니다. 마지막 행동을 확인해 주세요.";
  const chunks = splitSpeechText(message, 30);

  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(""), message);
  assert.ok(chunks.every((chunk) => chunk.length <= 30));
});

test("empty speech text produces no utterance chunks", () => {
  assert.deepEqual(splitSpeechText("   "), []);
});
