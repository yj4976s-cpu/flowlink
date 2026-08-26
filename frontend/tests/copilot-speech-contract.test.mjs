import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAutoSpeechText,
  resolveManualSpeechText,
  splitSpeechText,
} from "../src/lib/copilotSpeech.ts";

const fullKoreanMessage =
  "\ud654\uba74\uc5d0 \ubcf4\uc774\ub294 \uc804\uccb4 \ub2f5\ubcc0\uc785\ub2c8\ub2e4. \uc790\uc138\ud55c \uc548\ub0b4\uc640 \ubc84\ud2bc \uc124\uba85\uae4c\uc9c0 \ud3ec\ud568\ud569\ub2c8\ub2e4.";
const conciseKoreanSpeech = "\ub4e3\uae30\ub9cc \uc9e7\uac8c \uc77d\uc2b5\ub2c8\ub2e4.";
const koreanSentence = "\uccab \ubc88\uc9f8 \uc548\ub0b4 \ubb38\uc7a5\uc785\ub2c8\ub2e4. ";

test("manual speech always reads the full visible message text", () => {
  assert.equal(resolveManualSpeechText(fullKoreanMessage), fullKoreanMessage);
  assert.notEqual(resolveManualSpeechText(fullKoreanMessage), conciseKoreanSpeech);
});

test("automatic speech prefers concise speech text", () => {
  assert.equal(
    resolveAutoSpeechText(fullKoreanMessage, conciseKoreanSpeech),
    conciseKoreanSpeech,
  );
});

test("automatic speech falls back to message text when speech text is null", () => {
  assert.equal(resolveAutoSpeechText(fullKoreanMessage, null), fullKoreanMessage);
});

test("automatic speech falls back to message text when speech text is blank", () => {
  assert.equal(resolveAutoSpeechText(fullKoreanMessage, "   \n\t  "), fullKoreanMessage);
});

test("long Korean speech text is split into multiple chunks", () => {
  const text = koreanSentence.repeat(12);
  const chunks = splitSpeechText(text, 80);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 80));
});

test("joining chunks preserves the original trimmed text", () => {
  const text = `${koreanSentence}\ub450 \ubc88\uc9f8 \uc548\ub0b4 \ubb38\uc7a5\uc785\ub2c8\ub2e4. \uc138 \ubc88\uc9f8 \uc548\ub0b4 \ubb38\uc7a5\uc785\ub2c8\ub2e4.`;
  const chunks = splitSpeechText(text, 24);

  assert.equal(chunks.join(""), text.trim());
});

test("empty text returns an empty chunk list", () => {
  assert.deepEqual(splitSpeechText("   \n\t  "), []);
});

test("emoji surrogate pairs are not split in the middle", () => {
  const text = `\uc548\ub0b4 ${"\uac00".repeat(7)}\ud83e\udd8a \ub2e4\uc74c \ubb38\uc7a5\uc785\ub2c8\ub2e4.`;
  const chunks = splitSpeechText(text, 13);

  assert.equal(chunks.join(""), text.trim());
  assert.ok(chunks.every((chunk) => !Number.isNaN(chunk.codePointAt(chunk.length - 1))));
  assert.ok(chunks.every((chunk) => {
    const last = chunk.charCodeAt(chunk.length - 1);
    return !(last >= 0xd800 && last <= 0xdbff);
  }));
});
