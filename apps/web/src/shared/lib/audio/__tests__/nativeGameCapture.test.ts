import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FakeAudioNode,
  installAudioMock,
  pathExists,
  removeAudioMock,
} from "@/__tests__/audio-mock";
import { SoundManager } from "@/games/monster-truck/lib/sounds";
import { FourWheelerSounds } from "@/games/four-wheeler-3d/lib/sounds";
import { startRadio } from "@/games/four-wheeler-3d/lib/radioAudio";
import { getGameAudioTapPoint, isGameSpeakerEnabled } from "../gameAudio";

afterEach(() => {
  removeAudioMock();
  vi.useRealTimers();
});

describe("native 3D game sound capture", () => {
  it.each([
    ["monster-truck", () => new SoundManager()],
    ["four-wheeler-3d", () => new FourWheelerSounds(undefined, async () => null)],
  ] as const)("routes %s horn to capture and one speaker path", (appId, make) => {
    const mock = installAudioMock({ initialState: "running" });
    const sound = make();
    sound.playHorn();
    const context = mock.lastContext();
    const tap = getGameAudioTapPoint() as unknown as FakeAudioNode;
    expect(context.createOscillator.mock.results.length).toBeGreaterThan(0);
    for (const result of context.createOscillator.mock.results) {
      expect(pathExists(result.value, tap)).toBe(true);
      expect(pathExists(result.value, context.destination)).toBe(true);
      expect(result.value.outputs.has(context.destination)).toBe(false);
    }
    // Only the shared limiter drives speakers, with no private-context duplicate.
    expect(context.destination.inputs.size).toBe(1);
    expect(mock.contexts).toHaveLength(1);
    sound.setEnabled(false);
    expect(isGameSpeakerEnabled(appId)).toBe(false);
    const count = context.createOscillator.mock.calls.length;
    sound.playHorn();
    expect(context.createOscillator).toHaveBeenCalledTimes(count);
    sound.dispose();
    expect(context.close).not.toHaveBeenCalled();
  });

  it("captures both engine sources using the same context", () => {
    const mock = installAudioMock({ initialState: "running" });
    const monster = new SoundManager();
    const atv = new FourWheelerSounds(undefined, async () => null);
    const stopMonster = monster.startEngine();
    atv.startEngine();
    const context = mock.lastContext();
    const tap = getGameAudioTapPoint() as unknown as FakeAudioNode;
    const engineOscillator = context.createOscillator.mock.results[0].value;
    const exhaust = context.createBufferSource.mock.results[0].value;
    expect(pathExists(engineOscillator, tap)).toBe(true);
    expect(pathExists(exhaust, tap)).toBe(true);
    expect(mock.contexts).toHaveLength(1);
    stopMonster();
    atv.dispose();
    monster.dispose();
    expect(context.close).not.toHaveBeenCalled();
  });

  it("captures radio notes and removes its sound route on stop", async () => {
    vi.useFakeTimers();
    const mock = installAudioMock({ initialState: "running" });
    const unavailable = vi.fn();
    const stop = startRadio([220], "sine", unavailable);
    await mock.flush();
    const context = mock.lastContext();
    const oscillator = context.createOscillator.mock.results[0].value;
    const tap = getGameAudioTapPoint() as unknown as FakeAudioNode;
    expect(pathExists(oscillator, tap)).toBe(true);
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(pathExists(oscillator, tap)).toBe(false);
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    expect(context.close).not.toHaveBeenCalled();
    expect(unavailable).not.toHaveBeenCalled();
  });
});
