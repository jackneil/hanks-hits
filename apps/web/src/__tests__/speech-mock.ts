import { vi } from "vitest";

/**
 * Shared Web Speech API test double.
 *
 * jsdom ships no speechSynthesis and no SpeechSynthesisUtterance, so every
 * test that touches the read-aloud button needs a fake one. Keep this the
 * single copy: five test files used to carry their own.
 */

/** The shape of the fake utterance objects handed to speak(). */
export type MockUtterance = {
  text: string;
  rate?: number;
  pitch?: number;
  lang?: string;
  voice?: unknown;
  onend?: (() => void) | null;
  onerror?: (() => void) | null;
};

export type SpeechMock = {
  speak: ReturnType<typeof vi.fn<(utterance: MockUtterance) => void>>;
  cancel: ReturnType<typeof vi.fn<() => void>>;
  getVoices: ReturnType<typeof vi.fn<() => Array<Partial<SpeechSynthesisVoice>>>>;
  /** Ordered log of "speak"/"cancel" calls, for order assertions. */
  calls: string[];
  /** The utterance given to the most recent speak() call. */
  lastUtterance(): MockUtterance;
};

class FakeUtterance implements MockUtterance {
  text: string;
  rate?: number;
  pitch?: number;
  lang?: string;
  voice?: unknown;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

/** Install the fake Web Speech API on window. Returns the mock. */
export function installSpeechMock(
  voices: Array<Partial<SpeechSynthesisVoice>> = []
): SpeechMock {
  const calls: string[] = [];
  const speak = vi.fn<(utterance: MockUtterance) => void>(() => {
    calls.push("speak");
  });
  const cancel = vi.fn(() => {
    calls.push("cancel");
  });
  const getVoices = vi.fn(() => voices);

  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    writable: true,
    value: { speak, cancel, getVoices, speaking: false, paused: false, pending: false },
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });

  return {
    speak,
    cancel,
    getVoices,
    calls,
    lastUtterance(): MockUtterance {
      const last = speak.mock.calls[speak.mock.calls.length - 1];
      return last[0];
    },
  };
}

/** Remove the fake API, so the browser looks like one with no voice. */
export function removeSpeechMock(): void {
  // @ts-expect-error - removing the fake API to simulate an old browser
  delete window.speechSynthesis;
  // @ts-expect-error - removing the fake API to simulate an old browser
  delete window.SpeechSynthesisUtterance;
}
