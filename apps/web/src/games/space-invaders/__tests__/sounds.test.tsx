/**
 * Space Invaders sound goes through the shared game-audio bus
 * (design/ARCHITECTURE.md, section "Audio"), so a gameplay clip records it:
 * - every sound reaches the bus's tap point (the clip) and the speakers;
 * - the sound switch is the game's speaker gain: it mutes the speakers only;
 * - with no Web Audio, a sound does nothing and throws nothing;
 * - no AudioContext is made at page load (the old SoundManager made one at
 *   import, before any tap).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installAudioMock,
  isConnected,
  pathExists,
  removeAudioMock,
  type AudioMock,
  type FakeAudioNode,
  type FakeOscillatorNode,
} from "@/__tests__/audio-mock";
import { getGameAudio, getGameAudioTapPoint, isGameSpeakerEnabled } from "@/shared/lib/audio";

import { SOUND_LABELS, SpaceInvadersGame } from "../Game";
import { playSound, releaseSounds, type SpaceInvadersSound } from "../lib/sounds";
import { useSpaceInvadersStore } from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

let mock: AudioMock;

beforeEach(() => {
  mock = installAudioMock();
  localStorage.clear();
  vi.useFakeTimers();
  useSpaceInvadersStore.setState({ gameState: "ready" });
});

afterEach(() => {
  releaseSounds();
  vi.useRealTimers();
  removeAudioMock();
});

/** The newest oscillator the game made. */
function lastOscillator(): FakeOscillatorNode {
  const created = mock.lastContext().createOscillator.mock.results;
  return created[created.length - 1].value as FakeOscillatorNode;
}

describe("Space Invaders sounds on the game-audio bus", () => {
  const SOUNDS: SpaceInvadersSound[] = ["shoot", "explosion", "playerDeath", "mystery", "march", "waveClear"];

  it.each(SOUNDS)("%s reaches the clip tap point and the speakers, only through the game's channel", (sound) => {
    expect(getGameAudio()).not.toBeNull();
    const ctx = mock.lastContext();
    const oscillatorsBefore = ctx.createOscillator.mock.results.length;
    const gainsBefore = ctx.createGain.mock.results.length;
    playSound(sound, 1);
    // The sounds with parts play them on timers.
    vi.advanceTimersByTime(500);
    const oscillator = lastOscillator();
    expect(oscillator.started).toBe(true);
    const tap = getGameAudioTapPoint() as unknown as FakeAudioNode;
    expect(tap).not.toBeNull();
    expect(pathExists(oscillator, tap)).toBe(true);
    expect(pathExists(oscillator, ctx.destination)).toBe(true);

    // Never straight to the speakers: every node this sound made feeds the
    // channel, never the destination itself.
    const made = [
      ...ctx.createOscillator.mock.results.slice(oscillatorsBefore),
      ...ctx.createGain.mock.results.slice(gainsBefore),
    ].map((result) => result.value as FakeAudioNode);
    expect(made.length).toBeGreaterThanOrEqual(2);
    for (const node of made) expect(isConnected(node, ctx.destination)).toBe(false);
  });

  it("makes no AudioContext at page load: the bus starts at the first tap", () => {
    removeAudioMock();
    mock = installAudioMock();
    // The bus (and its context) exists only once something asks for it.
    render(<SpaceInvadersGame />);
    expect(mock.contexts.length).toBe(0);
  });

  it("does nothing, and throws nothing, in a browser with no Web Audio", () => {
    removeAudioMock();
    expect(() => playSound("shoot")).not.toThrow();
    expect(() => playSound("waveClear")).not.toThrow();
    expect(getGameAudio()).toBeNull();
  });

  it("the sound switch turns this game's speakers off and on, and the clip still hears the sound", () => {
    render(<SpaceInvadersGame />);
    expect(isGameSpeakerEnabled("space-invaders")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: SOUND_LABELS.on }));
    expect(useSpaceInvadersStore.getState().progress.settings.soundEnabled).toBe(false);
    expect(isGameSpeakerEnabled("space-invaders")).toBe(false);
    // Muted: the sound still reaches the tap point (a clip of a quiet run has the game's sound).
    playSound("shoot");
    expect(pathExists(lastOscillator(), getGameAudioTapPoint() as unknown as FakeAudioNode)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: SOUND_LABELS.off }));
    expect(isGameSpeakerEnabled("space-invaders")).toBe(true);
  });

  it("releaseSounds drops the parts of a sound that were still to play", () => {
    expect(getGameAudio()).not.toBeNull();
    const ctx = mock.lastContext();
    const before = ctx.createOscillator.mock.results.length;
    playSound("waveClear");
    releaseSounds();
    vi.advanceTimersByTime(1000);
    // The first part played at once; the three later parts were dropped.
    expect(ctx.createOscillator.mock.results.length).toBe(before + 1);
  });
});
