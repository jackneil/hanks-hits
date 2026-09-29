/**
 * Asteroids sound goes through the shared game-audio bus (design/ARCHITECTURE.md,
 * section "Audio"), so a gameplay clip records it:
 * - every sound reaches the bus's tap point (the clip) and the speakers;
 * - the sound switch is the game's speaker gain: it mutes the speakers only;
 * - with no Web Audio, a sound does nothing and throws nothing.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installAudioMock, pathExists, removeAudioMock, type AudioMock, type FakeAudioNode, type FakeOscillatorNode } from "@/__tests__/audio-mock";
import { getGameAudio, getGameAudioTapPoint, isGameSpeakerEnabled } from "@/shared/lib/audio";

import { AsteroidsGame } from "../Game";
import { playSound, releaseSounds, type AsteroidsSound } from "../lib/sounds";
import { useAsteroidsStore } from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

let mock: AudioMock;

beforeEach(() => {
  mock = installAudioMock();
  localStorage.clear();
  useAsteroidsStore.setState({ status: "ready" });
});

afterEach(() => {
  releaseSounds();
  removeAudioMock();
});

/** The newest oscillator the game made. */
function lastOscillator(): FakeOscillatorNode {
  const created = mock.lastContext().createOscillator.mock.results;
  return created[created.length - 1].value as FakeOscillatorNode;
}

describe("Asteroids sounds on the game-audio bus", () => {
  const SOUNDS: AsteroidsSound[] = ["shoot", "thrust", "explode", "hyperspace", "death", "wave"];

  it.each(SOUNDS)("%s reaches the clip tap point and the speakers", (sound) => {
    // A channel exists only after a tap made the bus.
    expect(getGameAudio()).not.toBeNull();
    playSound(sound);
    const oscillator = lastOscillator();
    expect(oscillator.started).toBe(true);
    const tap = getGameAudioTapPoint() as unknown as FakeAudioNode;
    expect(tap).not.toBeNull();
    expect(pathExists(oscillator, tap)).toBe(true);
    expect(pathExists(oscillator, mock.lastContext().destination)).toBe(true);
    // Never straight to the speakers: that path would skip the tap and the sound switch.
    expect(oscillator.context).toBe(mock.lastContext());
  });

  it("uses one channel for every sound, and a new one after the game lets go", () => {
    playSound("shoot");
    const first = lastOscillator();
    playSound("explode");
    const second = lastOscillator();
    const tap = getGameAudioTapPoint() as unknown as FakeAudioNode;
    expect(pathExists(first, tap) && pathExists(second, tap)).toBe(true);
    const channels = mock.lastContext().createGain.mock.results.length;
    playSound("death");
    // Each sound makes one gain of its own; no new channel gain.
    expect(mock.lastContext().createGain.mock.results.length).toBe(channels + 1);
    releaseSounds();
    playSound("wave");
    expect(pathExists(lastOscillator(), getGameAudioTapPoint() as unknown as FakeAudioNode)).toBe(true);
  });

  it("does nothing, and throws nothing, in a browser with no Web Audio", () => {
    removeAudioMock();
    expect(() => playSound("shoot")).not.toThrow();
    expect(getGameAudio()).toBeNull();
  });

  it("the sound switch turns this game's speakers off and on, and the clip still hears the sound", () => {
    render(<AsteroidsGame />);
    expect(isGameSpeakerEnabled("asteroids")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "🔊" }));
    expect(useAsteroidsStore.getState().progress.soundEnabled).toBe(false);
    expect(isGameSpeakerEnabled("asteroids")).toBe(false);
    // Muted: the sound still reaches the tap point (plan 6.3: a clip of a quiet run has the game's sound).
    playSound("shoot");
    expect(pathExists(lastOscillator(), getGameAudioTapPoint() as unknown as FakeAudioNode)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "🔇" }));
    expect(isGameSpeakerEnabled("asteroids")).toBe(true);
  });
});
