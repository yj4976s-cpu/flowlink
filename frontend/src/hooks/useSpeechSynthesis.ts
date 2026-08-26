"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const VOICE_STORAGE_KEY = "flowlink:copilot:voice";
const SPEECH_RATE_STORAGE_KEY = "flowlink:copilot:speech-rate";
const MAX_SPEECH_CHUNK_LENGTH = 160;

export const SPEECH_RATES = [0.8, 1, 1.2, 1.4] as const;
export type SpeechRate = (typeof SPEECH_RATES)[number];

type ActiveSpeech = {
  messageId: string;
  text: string;
};

function voiceStorageKey(userId: string | number) {
  return `${VOICE_STORAGE_KEY}:${userId}`;
}

function speechRateStorageKey(userId: string | number) {
  return `${SPEECH_RATE_STORAGE_KEY}:${userId}`;
}

function validSpeechRate(value: unknown): value is SpeechRate {
  return typeof value === "number" && SPEECH_RATES.some((rate) => rate === value);
}

function speechAvailable() {
  return typeof window !== "undefined"
    && "speechSynthesis" in window
    && typeof window.SpeechSynthesisUtterance === "function";
}

function preferredKoreanVoice(voices: SpeechSynthesisVoice[]) {
  return voices.find((voice) => voice.lang.toLowerCase() === "ko-kr")
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("ko"))
    ?? null;
}

export function speechVoiceId(voice: SpeechSynthesisVoice) {
  return voice.voiceURI || `${voice.name}::${voice.lang}`;
}

function koreanVoices(voices: SpeechSynthesisVoice[]) {
  const seen = new Set<string>();
  const orderedVoices = [
    ...voices.filter((voice) => voice.lang.toLowerCase() === "ko-kr"),
    ...voices.filter((voice) => voice.lang.toLowerCase() !== "ko-kr" && voice.lang.toLowerCase().startsWith("ko")),
  ];
  return orderedVoices.filter((voice) => {
    const id = speechVoiceId(voice);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

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

    // Prefer the latest natural sentence or line boundary within the safe window.
    for (let index = windowEnd - 1; index >= offset; index -= 1) {
      if (".!?。\n\r".includes(normalizedText[index])) {
        chunkEnd = index + 1;
        break;
      }
    }

    // A long sentence is split at a clause/word boundary where possible.
    if (chunkEnd < 0) {
      for (let index = windowEnd - 1; index >= offset; index -= 1) {
        if (",;:，、 \t".includes(normalizedText[index])) {
          chunkEnd = index + 1;
          break;
        }
      }
    }

    if (chunkEnd <= offset) chunkEnd = windowEnd;
    // Do not split an emoji or another UTF-16 surrogate pair at the hard limit.
    const lastCodeUnit = normalizedText.charCodeAt(chunkEnd - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) chunkEnd -= 1;

    chunks.push(normalizedText.slice(offset, chunkEnd));
    offset = chunkEnd;
  }

  return chunks;
}

export function useSpeechSynthesis({
  voiceSelectionEnabled = false,
  voiceStorageUserId = null,
  speechRateStorageUserId = null,
}: {
  voiceSelectionEnabled?: boolean;
  voiceStorageUserId?: string | number | null;
  speechRateStorageUserId?: string | number | null;
} = {}) {
  const [supported, setSupported] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [speechRate, setSpeechRateState] = useState<SpeechRate>(1);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const selectedVoiceIdRef = useRef<string | null>(null);
  const savedVoiceIdRef = useRef<string | null>(null);
  const voiceSelectionEnabledRef = useRef(voiceSelectionEnabled);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const activeSpeechRef = useRef<ActiveSpeech | null>(null);
  const pausedRef = useRef(false);
  const speechRateRef = useRef<SpeechRate>(1);
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
    utteranceRef.current = null;
    activeSpeechRef.current = null;
    pausedRef.current = false;
    if (speechAvailable()) window.speechSynthesis.cancel();
    setSpeakingMessageId(null);
    setPaused(false);
  }, []);

  const speak = useCallback((messageId: string, text: string) => {
    if (!speechAvailable() || !text.trim()) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    window.speechSynthesis.cancel();

    const chunks = splitSpeechText(text);
    const rate = speechRateRef.current;
    const selectedVoice = voiceSelectionEnabledRef.current && selectedVoiceIdRef.current
      ? voicesRef.current.find((voice) => speechVoiceId(voice) === selectedVoiceIdRef.current)
      : null;
    const resolvedVoice = selectedVoice ?? preferredKoreanVoice(voicesRef.current);
    activeSpeechRef.current = { messageId, text };
    pausedRef.current = false;
    setSpeakingMessageId(messageId);
    setPaused(false);

    const finish = (utterance: SpeechSynthesisUtterance) => {
      if (generationRef.current !== generation || utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      activeSpeechRef.current = null;
      pausedRef.current = false;
      setSpeakingMessageId(null);
      setPaused(false);
    };

    const playChunk = (chunkIndex: number) => {
      if (generationRef.current !== generation) return;
      const utterance = new window.SpeechSynthesisUtterance(chunks[chunkIndex]);
      utterance.lang = "ko-KR";
      utterance.rate = rate;
      utterance.pitch = 1;
      if (resolvedVoice) utterance.voice = resolvedVoice;
      utteranceRef.current = utterance;

      utterance.onend = () => {
        if (generationRef.current !== generation || utteranceRef.current !== utterance) return;
        if (pausedRef.current) return;
        if (chunkIndex + 1 < chunks.length) playChunk(chunkIndex + 1);
        else finish(utterance);
      };
      utterance.onerror = () => finish(utterance);
      utterance.onpause = () => {
        if (generationRef.current === generation && utteranceRef.current === utterance) {
          pausedRef.current = true;
          setPaused(true);
        }
      };
      utterance.onresume = () => {
        if (generationRef.current === generation && utteranceRef.current === utterance) {
          pausedRef.current = false;
          setPaused(false);
        }
      };

      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        finish(utterance);
      }
    };

    playChunk(0);
  }, []);

  const pause = useCallback(() => {
    if (!speechAvailable() || !utteranceRef.current || pausedRef.current) return;
    try {
      window.speechSynthesis.pause();
      pausedRef.current = true;
      setPaused(true);
    } catch {
      // Keep the current playback state when the browser rejects pause().
    }
  }, []);

  const resume = useCallback(() => {
    if (!speechAvailable() || !utteranceRef.current || !pausedRef.current) return;
    try {
      window.speechSynthesis.resume();
      pausedRef.current = false;
      setPaused(false);
    } catch {
      // Keep the paused state when the browser rejects resume().
    }
  }, []);

  const setSpeechRate = useCallback((value: number) => {
    const nextRate: SpeechRate = validSpeechRate(value) ? value : 1;
    const activeSpeech = activeSpeechRef.current;
    speechRateRef.current = nextRate;
    setSpeechRateState(nextRate);
    try {
      if (speechRateStorageUserId !== null) {
        window.localStorage.setItem(speechRateStorageKey(speechRateStorageUserId), String(nextRate));
      }
    } catch {
      // The in-memory rate remains usable when storage is unavailable.
    }
    if (activeSpeech) speak(activeSpeech.messageId, activeSpeech.text);
  }, [speak, speechRateStorageUserId]);

  const toggle = useCallback((messageId: string, text: string) => {
    if (speakingMessageId === messageId) stop();
    else speak(messageId, text);
  }, [speak, speakingMessageId, stop]);

  const setSelectedVoice = useCallback((id: string | null) => {
    stop();
    const nextId = id && voicesRef.current.some((voice) => speechVoiceId(voice) === id) ? id : null;
    savedVoiceIdRef.current = nextId;
    selectedVoiceIdRef.current = nextId;
    setSelectedVoiceId(nextId);
    try {
      if (voiceStorageUserId === null) return;
      const storageKey = voiceStorageKey(voiceStorageUserId);
      if (nextId) window.localStorage.setItem(storageKey, nextId);
      else window.localStorage.removeItem(storageKey);
    } catch {
      // The in-memory selection remains usable when storage is unavailable.
    }
  }, [stop, voiceStorageUserId]);

  useEffect(() => {
    if (!speechAvailable()) return;
    const synthesis = window.speechSynthesis;
    const updateVoices = () => {
      const nextVoices = koreanVoices(synthesis.getVoices());
      voicesRef.current = nextVoices;
      setVoices(nextVoices);
      if (!voiceSelectionEnabledRef.current) return;
      const nextSelectedId = savedVoiceIdRef.current
        && nextVoices.some((voice) => speechVoiceId(voice) === savedVoiceIdRef.current)
        ? savedVoiceIdRef.current
        : null;
      selectedVoiceIdRef.current = nextSelectedId;
      setSelectedVoiceId(nextSelectedId);
    };
    const supportFrame = window.requestAnimationFrame(() => setSupported(true));
    updateVoices();
    synthesis.addEventListener("voiceschanged", updateVoices);
    return () => {
      window.cancelAnimationFrame(supportFrame);
      synthesis.removeEventListener("voiceschanged", updateVoices);
    };
  }, []);

  useEffect(() => {
    voiceSelectionEnabledRef.current = voiceSelectionEnabled;
    if (!voiceSelectionEnabled || voiceStorageUserId === null) {
      savedVoiceIdRef.current = null;
      selectedVoiceIdRef.current = null;
      const resetFrame = window.requestAnimationFrame(() => {
        stop();
        setSelectedVoiceId(null);
      });
      return () => window.cancelAnimationFrame(resetFrame);
    }
    let savedVoiceId: string | null = null;
    try {
      savedVoiceId = window.localStorage.getItem(voiceStorageKey(voiceStorageUserId));
    } catch {
      // Fall back to the browser's Korean voice when storage is unavailable.
    }
    savedVoiceIdRef.current = savedVoiceId;
    const nextSelectedId = savedVoiceId
      && voicesRef.current.some((voice) => speechVoiceId(voice) === savedVoiceId)
      ? savedVoiceId
      : null;
    selectedVoiceIdRef.current = nextSelectedId;
    const restoreFrame = window.requestAnimationFrame(() => {
      stop();
      setSelectedVoiceId(nextSelectedId);
    });
    return () => window.cancelAnimationFrame(restoreFrame);
  }, [stop, voiceSelectionEnabled, voiceStorageUserId]);

  useEffect(() => {
    let nextRate: SpeechRate = 1;
    if (speechRateStorageUserId !== null) {
      try {
        const savedRate = Number(window.localStorage.getItem(speechRateStorageKey(speechRateStorageUserId)));
        if (validSpeechRate(savedRate)) nextRate = savedRate;
      } catch {
        // Use the safe default when storage is unavailable.
      }
    }
    speechRateRef.current = nextRate;
    const restoreFrame = window.requestAnimationFrame(() => {
      stop();
      setSpeechRateState(nextRate);
    });
    return () => window.cancelAnimationFrame(restoreFrame);
  }, [speechRateStorageUserId, stop]);

  useEffect(() => stop, [stop]);

  return {
    supported,
    speakingMessageId,
    paused,
    voices,
    selectedVoiceId,
    speechRate,
    setSelectedVoice,
    setSpeechRate,
    speak,
    pause,
    resume,
    stop,
    toggle,
  };
}
