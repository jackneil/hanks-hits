import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The server render. GameStartOverlay renders on the server and imports
 * the audio barrel, so the barrel must load, and every call must be a
 * safe no-op, when `window`, `document` and `navigator` do not exist.
 *
 * The shared test setup (src/__tests__/setup.ts) writes to `window`, so
 * this file cannot use the node environment. It takes the three globals
 * away inside jsdom instead. The module guards test exactly these three
 * names (`typeof window`, `typeof document`, `typeof navigator`).
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("the audio module on the server", () => {
  it("loads, makes no context, adds no listener, and every call is a safe no-op", async () => {
    const realDocument = document;
    const addListener = vi.spyOn(realDocument, "addEventListener");
    const AudioContextSpy = vi.fn();

    vi.resetModules();
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("navigator", undefined);
    // If a guard were missing, a context made from the global scope would show here.
    vi.stubGlobal("AudioContext", AudioContextSpy);
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");

    const audio = await import("@/shared/lib/audio");

    expect(audio.getGameAudio()).toBeNull();
    expect(audio.getGameAudioTapPoint()).toBeNull();
    expect(() => audio.unlockGameAudio()).not.toThrow();

    // The saved sound switch and a mounted game's wish for sound still record.
    expect(() => audio.setGameSpeakerEnabled("snake", false)).not.toThrow();
    expect(audio.isGameSpeakerEnabled("snake")).toBe(false);
    const release = audio.wantGameAudio();
    expect(() => release()).not.toThrow();

    const created = vi.fn();
    audio.onGameAudioCreated(created)();
    expect(created).not.toHaveBeenCalled();

    // The iframe shim builder is a pure string function.
    const shim = audio.buildAudioShimSource();
    expect(shim.startsWith(audio.AUDIO_SHIM_BEGIN_MARKER)).toBe(true);
    expect(shim.endsWith(audio.AUDIO_SHIM_END_MARKER)).toBe(true);

    expect(AudioContextSpy).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
  });
});
