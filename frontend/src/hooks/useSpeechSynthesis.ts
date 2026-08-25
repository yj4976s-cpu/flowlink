"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const VOICE_STORAGE_KEY = "flowlink:copilot:voice";

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

export function useSpeechSynthesis({ voiceSelectionEnabled = false } = {}) {
  const [supported, setSupported] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const selectedVoiceIdRef = useRef<string | null>(null);
  const savedVoiceIdRef = useRef<string | null>(null);
  const voiceSelectionEnabledRef = useRef(voiceSelectionEnabled);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
    utteranceRef.current = null;
    if (speechAvailable()) window.speechSynthesis.cancel();
    setSpeakingMessageId(null);
    setPaused(false);
  }, []);

  const speak = useCallback((messageId: string, text: string) => {
    if (!speechAvailable() || !text.trim()) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    window.speechSynthesis.cancel();

    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.rate = 1;
    utterance.pitch = 1;
    const selectedVoice = voiceSelectionEnabledRef.current && selectedVoiceIdRef.current
      ? voicesRef.current.find((voice) => speechVoiceId(voice) === selectedVoiceIdRef.current)
      : null;
    const resolvedVoice = selectedVoice ?? preferredKoreanVoice(voicesRef.current);
    if (resolvedVoice) utterance.voice = resolvedVoice;
    utteranceRef.current = utterance;
    setSpeakingMessageId(messageId);
    setPaused(false);

    const finish = () => {
      if (generationRef.current !== generation || utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setSpeakingMessageId(null);
      setPaused(false);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    utterance.onpause = () => {
      if (generationRef.current === generation && utteranceRef.current === utterance) setPaused(true);
    };
    utterance.onresume = () => {
      if (generationRef.current === generation && utteranceRef.current === utterance) setPaused(false);
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      finish();
    }
  }, []);

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
      if (nextId) window.localStorage.setItem(VOICE_STORAGE_KEY, nextId);
      else window.localStorage.removeItem(VOICE_STORAGE_KEY);
    } catch {
      // The in-memory selection remains usable when storage is unavailable.
    }
  }, [stop]);

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
    if (!voiceSelectionEnabled) {
      selectedVoiceIdRef.current = null;
      const resetFrame = window.requestAnimationFrame(() => {
        stop();
        setSelectedVoiceId(null);
      });
      return () => window.cancelAnimationFrame(resetFrame);
    }
    let savedVoiceId: string | null = null;
    try {
      savedVoiceId = window.localStorage.getItem(VOICE_STORAGE_KEY);
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
  }, [stop, voiceSelectionEnabled]);

  useEffect(() => stop, [stop]);

  return { supported, speakingMessageId, paused, voices, selectedVoiceId, setSelectedVoice, speak, stop, toggle };
}
