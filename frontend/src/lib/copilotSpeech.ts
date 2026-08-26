const MAX_SPEECH_CHUNK_LENGTH = 160;

export function splitSpeechText(text: string, maxLength = MAX_SPEECH_CHUNK_LENGTH) {
  const chunks: string[] = [];
  const normalizedText = text.trim();
  let offset = 0;

  while (offset < normalizedText.length) {
    const remainingLength = normalizedText.length - offset;
    if (remainingLength <= maxLength) {
      chunks.push(normalizedText.slice(offset));
      break;
    }

    const windowEnd = offset + maxLength;
    let chunkEnd = -1;

    for (let index = windowEnd - 1; index >= offset; index -= 1) {
      if (".!?。\n\r".includes(normalizedText[index])) {
        chunkEnd = index + 1;
        break;
      }
    }

    if (chunkEnd < 0) {
      for (let index = windowEnd - 1; index >= offset; index -= 1) {
        if (",;:，、 \t".includes(normalizedText[index])) {
          chunkEnd = index + 1;
          break;
        }
      }
    }

    if (chunkEnd <= offset) chunkEnd = windowEnd;
    const lastCodeUnit = normalizedText.charCodeAt(chunkEnd - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) chunkEnd -= 1;

    chunks.push(normalizedText.slice(offset, chunkEnd));
    offset = chunkEnd;
  }

  return chunks;
}

export function resolveManualSpeechText(messageText: string) {
  return messageText;
}

export function resolveAutoSpeechText(messageText: string, speechText?: string | null) {
  return speechText?.trim() || messageText;
}
