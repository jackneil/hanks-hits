"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Reads a short piece of text out loud with the browser voice.
 *
 * Why: many of our players are 6 to 8 years old and cannot read yet.
 * A start screen, a pause menu or a restart question is useless to them
 * as text. This hook lets those screens speak themselves.
 *
 * Rule: never speak automatically. Sound must always start from a tap on
 * a button. A page that talks on its own is a surprise, it can be loud,
 * and browsers block it anyway. The hook also stops the voice when the
 * player leaves the page or the component goes away.
 *
 * The browser voice is optional. When the browser has no speech support,
 * `isSupported` stays false and the caller must hide its button.
 */
export interface UseReadAloudResult {
  /** Speak the text. Cancels anything already speaking. */
  speak: (text: string) => void;
  /** Stop the voice immediately. */
  stop: () => void;
  /** True while the voice is speaking. */
  isSpeaking: boolean;
  /** True when this browser can speak. */
  isSupported: boolean;
}

/** The speech engine, or null when the browser (or a test teardown) has none. */
function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

/** True when this browser can speak. */
function detectSupport(): boolean {
  return (
    getSynth() !== null && typeof window.SpeechSynthesisUtterance === "function"
  );
}

/** Speech support cannot change while the page is open, so nothing to watch. */
function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * Strip emoji and other pictographs before speaking. Voices read them as
 * their names ("backhand index pointing up"), which buries the words a kid
 * needs. Keeps letters, digits, and punctuation in every script.
 */
export function toSpeakable(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ([.,!?])/g, "$1")
    // "Restart game?. Cancel" -> "Restart game? Cancel": segments are joined
    // with ". " and some already end in punctuation.
    .replace(/([.!?])\s*\./g, "$1")
    .trim();
}

function pickEnglishVoice(): SpeechSynthesisVoice | null {
  const voices = getSynth()?.getVoices?.() ?? [];
  const english = voices.filter((voice) =>
    (voice?.lang ?? "").toLowerCase().startsWith("en")
  );
  if (english.length === 0) return null;
  return english.find((voice) => voice.default) ?? english[0];
}

export function useReadAloud(): UseReadAloudResult {
  // The server snapshot is always false, so the server markup and the first
  // client render agree and hydration never mismatches. React then re-reads
  // the real value on the client.
  const isSupported = useSyncExternalStore(
    subscribeToNothing,
    detectSupport,
    () => false
  );
  const [isSpeaking, setIsSpeaking] = useState(false);

  const speakingRef = useRef(false);
  const mountedRef = useRef(true);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const setSpeaking = useCallback((value: boolean) => {
    speakingRef.current = value;
    if (mountedRef.current) setIsSpeaking(value);
  }, []);

  const stop = useCallback(() => {
    const synth = getSynth();
    if (!synth || !detectSupport()) return;
    synth.cancel();
    utteranceRef.current = null;
    setSpeaking(false);
  }, [setSpeaking]);

  const speak = useCallback(
    (text: string) => {
      const synth = getSynth();
      if (!synth || !detectSupport()) return;
      if (!text || text.trim().length === 0) return;

      // Cancel anything in flight first, or the browser queues them up.
      synth.cancel();

      const utterance = new window.SpeechSynthesisUtterance(toSpeakable(text));
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.lang = "en-US";
      const voice = pickEnglishVoice();
      if (voice) utterance.voice = voice;

      // A cancelled utterance can still deliver its end/error event later.
      // Only the CURRENT utterance may change the speaking state, or a stale
      // callback would hide the Stop button while a newer reading plays.
      const finish = () => {
        if (utteranceRef.current !== utterance) return;
        utteranceRef.current = null;
        setSpeaking(false);
      };
      utterance.onend = finish;
      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        // "canceled" and "interrupted" are what stop() and a new speak()
        // produce on purpose. Anything else is a real failure worth a trace.
        const code = event?.error;
        if (code && code !== "canceled" && code !== "interrupted") {
          console.warn("[read-aloud] speech failed:", code);
        }
        finish();
      };

      utteranceRef.current = utterance;
      setSpeaking(true);
      synth.speak(utterance);
    },
    [setSpeaking]
  );

  useEffect(() => {
    mountedRef.current = true;
    const stopIfSpeaking = () => {
      const synth = getSynth();
      if (!synth || !speakingRef.current) return;
      synth.cancel();
      utteranceRef.current = null;
      setSpeaking(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") stopIfSpeaking();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", stopIfSpeaking);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", stopIfSpeaking);
      mountedRef.current = false;
      stopIfSpeaking();
    };
  }, [setSpeaking]);

  return { speak, stop, isSpeaking, isSupported };
}
