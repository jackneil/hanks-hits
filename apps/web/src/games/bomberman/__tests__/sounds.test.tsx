/**
 * Bomberman sound goes through the shared game-audio bus (design/ARCHITECTURE.md,
 * section "Audio"), so a gameplay clip records it:
 * - every sound reaches the bus's tap point (the clip) and the speakers;
 * - the sound switch is the game's speaker gain: it mutes the speakers only;
 * - with no Web Audio, a sound does nothing and throws nothing.
 * Before this, the store made its own AudioContext and played to its
 * destination, so no clip could hear the game.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
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
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

import BombermanGame, { SOUND_LABELS } from "../Game";
import { playSound, releaseSounds, type BombermanSound } from "../lib/sounds";
import { useBombermanStore } from "../lib/store";

let mock: AudioMock;

beforeEach(() => {
  mock = installAudioMock();
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useBombermanStore.getState().resetGame();
  });
});

afterEach(() => {
  releaseSounds();
  removeAudioMock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastOscillator(): FakeOscillatorNode {
  const created = mock.lastContext().createOscillator.mock.results;
  return created[created.length - 1].value as FakeOscillatorNode;
}

describe("Bomberman sounds on the game-audio bus", () => {
  const SOUNDS: BombermanSound[] = ["place", "explode", "powerup", "death", "win", "step"];

  it.each(SOUNDS)("%s reaches the clip tap point and the speakers, only through the game's channel", (sound) => {
    expect(getGameAudio()).not.toBeNull();
    const ctx = mock.lastContext();
    const oscillatorsBefore = ctx.createOscillator.mock.results.length;
    const gainsBefore = ctx.createGain.mock.results.length;
    playSound(sound);
    const oscillator = lastOscillator();
    expect(oscillator.started).toBe(true);
    const tap = getGameAudioTapPoint() as unknown as FakeAudioNode;
    expect(tap).not.toBeNull();
    expect(pathExists(oscillator, tap)).toBe(true);
    expect(pathExists(oscillator, ctx.destination)).toBe(true);
    const soundGain = ctx.createGain.mock.results.at(-1)!.value as FakeAudioNode;
    expect([...oscillator.outputs]).toEqual([soundGain]);
    const [channelInput] = [...soundGain.outputs] as FakeAudioNode[];
    expect(channelInput).not.toBe(ctx.destination);
    const made = [
      ...ctx.createOscillator.mock.results.slice(oscillatorsBefore),
      ...ctx.createGain.mock.results.slice(gainsBefore),
    ].map((result) => result.value as FakeAudioNode);
    for (const node of made) expect(isConnected(node, ctx.destination)).toBe(false);
  });

  it("the store's actions play through the bus (a bomb, an explosion)", () => {
    act(() => {
      useBombermanStore.getState().startGame();
    });
    // Starting a run makes no sound, so the first bomb makes the context.
    expect(mock.contexts.length).toBe(0);
    act(() => {
      useBombermanStore.getState().placeBomb();
    });
    const ctx = mock.lastContext();
    expect(ctx.createOscillator.mock.results.length).toBe(1);
    expect(pathExists(lastOscillator(), getGameAudioTapPoint() as unknown as FakeAudioNode)).toBe(true);
  });

  it("does nothing, and throws nothing, in a browser with no Web Audio", () => {
    removeAudioMock();
    expect(() => playSound("place")).not.toThrow();
    expect(getGameAudio()).toBeNull();
  });

  it("the sound switch turns this game's speakers off and on, and the clip still hears the sound", () => {
    act(() => {
      useBombermanStore.getState().startGame();
      useBombermanStore.setState({ gameState: "lost" });
    });
    // The result chip holds every button for a short grace after it shows
    // (a tap meant for the game must not hit it): wait that out first.
    let clock = 1_000_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    render(<BombermanGame />);
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    expect(isGameSpeakerEnabled("bomberman")).toBe(true);
    const toggle = screen.getByTestId("result-chip-sound");
    expect(toggle).toHaveTextContent(SOUND_LABELS.on);
    fireEvent.click(toggle);
    expect(isGameSpeakerEnabled("bomberman")).toBe(false);
    expect(toggle).toHaveTextContent(SOUND_LABELS.off);
    playSound("explode");
    expect(pathExists(lastOscillator(), getGameAudioTapPoint() as unknown as FakeAudioNode)).toBe(true);
    fireEvent.click(toggle);
    expect(isGameSpeakerEnabled("bomberman")).toBe(true);
  });
});
