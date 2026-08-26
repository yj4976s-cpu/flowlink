const DEFAULT_MAX_SPEECH_CHUNK_LENGTH = 160;

const SENTENCE_BOUNDARIES = ".!?\u3002\uff01\uff1f\n\r";
const CLAUSE_BOUNDARIES = ",;:\uff0c\u3001 \t";

function normalizedSpeechText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function isHighSurrogate(value: string, index: number) {
  const code = value.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

function safeChunkEnd(value: string, end: number) {
  if (end <= 0) return end;
  return isHighSurrogate(value, end - 1) ? end - 1 : end;
}

export function resolveManualSpeechText(messageText: string) {
  return messageText;
}

export function resolveAutoSpeechText(messageText: string, speechText?: string | null) {
  const normalized = normalizedSpeechText(speechText);
  return normalized || messageText;
}

export function splitSpeechText(text: string, maxLength = DEFAULT_MAX_SPEECH_CHUNK_LENGTH) {
  const chunks: string[] = [];
  const normalizedText = text.trim();
  const safeMaxLength = Math.max(1, maxLength);
  let offset = 0;

  while (offset < normalizedText.length) {
    const remainingLength = normalizedText.length - offset;
    if (remainingLength <= safeMaxLength) {
      chunks.push(normalizedText.slice(offset));
      break;
    }

    const windowEnd = offset + safeMaxLength;
    let chunkEnd = -1;

    for (let index = windowEnd - 1; index >= offset; index -= 1) {
      if (SENTENCE_BOUNDARIES.includes(normalizedText[index])) {
        chunkEnd = index + 1;
        break;
      }
    }

    if (chunkEnd < 0) {
      for (let index = windowEnd - 1; index >= offset; index -= 1) {
        if (CLAUSE_BOUNDARIES.includes(normalizedText[index])) {
          chunkEnd = index + 1;
          break;
        }
      }
    }

    if (chunkEnd <= offset) chunkEnd = windowEnd;
    chunkEnd = safeChunkEnd(normalizedText, chunkEnd);
    if (chunkEnd <= offset) chunkEnd = Math.min(offset + 1, normalizedText.length);

    chunks.push(normalizedText.slice(offset, chunkEnd));
    offset = chunkEnd;
  }

  return chunks;
}
