import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useReadAloud } from "../useReadAloud";

type MockUtterance = {
  text: string;
  rate?: number;
  pitch?: number;
  lang?: string;
  voice?: unknown;
  onend?: (() => void) | null;
  onerror?: (() => void) | null;
};

type SpeechMock = {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
};

/** jsdom has no Web Speech API — install a fake one. */
function installSpeechMock(voices: Array<Partial<SpeechSynthesisVoice>> = []) {
  const calls: string[] = [];
  const synth: SpeechMock = {
    speak: vi.fn(() => calls.push("speak")),
    cancel: vi.fn(() => calls.push("cancel")),
    getVoices: vi.fn(() => voices),
  };
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    writable: true,
    value: { ...synth, speaking: false, paused: false, pending: false },
  });
  class FakeUtterance {
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
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });
  return {
    calls,
    get speak() {
      return window.speechSynthesis.speak as unknown as SpeechMock["speak"];
    },
    get cancel() {
      return window.speechSynthesis.cancel as unknown as SpeechMock["cancel"];
    },
    lastUtterance(): MockUtterance {
      const speak = window.speechSynthesis.speak as unknown as SpeechMock["speak"];
      const last = speak.mock.calls[speak.mock.calls.length - 1];
      return last[0] as MockUtterance;
    },
  };
}

function removeSpeechMock() {
  // @ts-expect-error - removing the fake API to simulate an old browser
  delete window.speechSynthesis;
  // @ts-expect-error - removing the fake API to simulate an old browser
  delete window.SpeechSynthesisUtterance;
}

afterEach(() => {
  removeSpeechMock();
  vi.restoreAllMocks();
});

describe("useReadAloud", () => {
  it("reports no support and does nothing when the browser cannot speak", async () => {
    removeSpeechMock();
    const { result } = renderHook(() => useReadAloud());

    await waitFor(() => expect(result.current.isSupported).toBe(false));
    expect(() => act(() => result.current.speak("hello"))).not.toThrow();
    expect(result.current.isSpeaking).toBe(false);
  });

  it("speaks the text, cancelling anything already in flight", async () => {
    const mock = installSpeechMock();
    const { result } = renderHook(() => useReadAloud());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.speak("hi"));

    expect(mock.cancel).toHaveBeenCalled();
    expect(mock.speak).toHaveBeenCalledTimes(1);
    expect(mock.calls).toEqual(["cancel", "speak"]);
    const utterance = mock.lastUtterance();
    expect(utterance.text).toBe("hi");
    expect(utterance.rate).toBe(0.9);
    expect(utterance.pitch).toBe(1);
    expect(utterance.lang).toBe("en-US");
    expect(result.current.isSpeaking).toBe(true);

    act(() => utterance.onend?.());
    expect(result.current.isSpeaking).toBe(false);
  });

  it("clears the speaking flag when the utterance errors", async () => {
    const mock = installSpeechMock();
    const { result } = renderHook(() => useReadAloud());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.speak("hi"));
    expect(result.current.isSpeaking).toBe(true);
    act(() => mock.lastUtterance().onerror?.());
    expect(result.current.isSpeaking).toBe(false);
  });

  it("prefers the default English voice", async () => {
    const french = { lang: "fr-FR", name: "Amelie" };
    const british = { lang: "en-GB", name: "Daniel", default: false };
    const american = { lang: "en-US", name: "Samantha", default: true };
    const mock = installSpeechMock([french, british, american]);
    const { result } = renderHook(() => useReadAloud());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.speak("hi"));
    expect(mock.lastUtterance().voice).toBe(american);
  });

  it("falls back to the first English voice when none is the default", async () => {
    const british = { lang: "en-GB", name: "Daniel", default: false };
    const mock = installSpeechMock([{ lang: "fr-FR", name: "Amelie" }, british]);
    const { result } = renderHook(() => useReadAloud());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.speak("hi"));
    expect(mock.lastUtterance().voice).toBe(british);
  });

  it("leaves the voice unset when no English voice exists", async () => {
    const mock = installSpeechMock([{ lang: "fr-FR", name: "Amelie" }]);
    const { result } = renderHook(() => useReadAloud());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.speak("hi"));
    expect(mock.lastUtterance().voice).toBeUndefined();
  });

  it("cancels the first utterance when asked to speak again", async () => {
    const mock = installSpeechMock();
    const { result } = renderHook(() => useReadAloud());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.speak("one"));
    act(() => result.current.speak("two"));

    expect(mock.calls).toEqual(["cancel", "speak", "cancel", "speak"]);
    expect(mock.lastUtterance().text).toBe("two");
  });

  it("stop() cancels the voice and clears the speaking flag", async () => {
    const mock = installSpeechMock();
    const { result } = renderHook(() => useReadAloud());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.speak("hi"));
    mock.cancel.mockClear();
    act(() => result.current.stop());

    expect(mock.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.isSpeaking).toBe(false);
  });

  it("cancels on unmount while speaking", async () => {
    const mock = installSpeechMock();
    const { result, unmount } = renderHook(() => useReadAloud());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.speak("hi"));
    mock.cancel.mockClear();
    unmount();

    expect(mock.cancel).toHaveBeenCalledTimes(1);
  });

  it("stops when the page is hidden", async () => {
    const mock = installSpeechMock();
    const { result } = renderHook(() => useReadAloud());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.speak("hi"));
    mock.cancel.mockClear();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mock.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.isSpeaking).toBe(false);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  it("ignores empty or blank text", async () => {
    const mock = installSpeechMock();
    const { result } = renderHook(() => useReadAloud());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.speak("   "));
    act(() => result.current.speak(""));

    expect(mock.speak).not.toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });
});
