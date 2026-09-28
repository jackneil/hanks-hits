import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installAudioMock,
  pathExists,
  removeAudioMock,
  type AudioMock,
  type FakeAudioNode,
  type FakeGainNode,
  type FakeOscillatorNode,
} from "@/__tests__/audio-mock";
import { getGameAudio, getGameAudioTapPoint, setGameSpeakerEnabled } from "@/shared/lib/audio";

import { BEEP_GAIN, BEEP_HZ, BEEP_SECONDS, LAB_AUDIO_APP_ID, playBeep } from "../labBeep";

let mock: AudioMock;

beforeEach(() => {
  mock = installAudioMock({ initialState: "running" });
});

afterEach(() => {
  removeAudioMock();
});

function lastOscillator(): FakeOscillatorNode {
  const results = mock.lastContext().createOscillator.mock.results;
  return results[results.length - 1].value as FakeOscillatorNode;
}

function lastGain(): FakeGainNode {
  const results = mock.lastContext().createGain.mock.results;
  return results[results.length - 1].value as FakeGainNode;
}

describe("playBeep", () => {
  it("plays a 1 kHz sine of BEEP_SECONDS at the given context time", () => {
    const channel = getGameAudio()!.channel(LAB_AUDIO_APP_ID);
    playBeep(channel, 2.5);
    const oscillator = lastOscillator();
    expect(oscillator.type).toBe("sine");
    expect(oscillator.frequency.value).toBe(BEEP_HZ);
    expect(BEEP_HZ).toBe(1000);
    expect(oscillator.start).toHaveBeenCalledWith(2.5);
    expect(oscillator.stop).toHaveBeenCalledWith(2.5 + BEEP_SECONDS);
    // A whole number of cycles (60), so the beep ends on a zero crossing.
    expect(BEEP_HZ * BEEP_SECONDS).toBeCloseTo(60, 9);
    expect(lastGain().gain.value).toBe(BEEP_GAIN);
  });

  it("reaches the clip tap point through the lab's channel, also with the lab's sound switch off", () => {
    const bus = getGameAudio()!;
    const channel = bus.channel(LAB_AUDIO_APP_ID);
    setGameSpeakerEnabled(LAB_AUDIO_APP_ID, false);
    playBeep(channel, 1);
    const oscillator = lastOscillator();
    const tap = getGameAudioTapPoint() as unknown as FakeAudioNode;
    expect(tap).toBeTruthy();
    expect(pathExists(oscillator, channel.input as unknown as FakeAudioNode)).toBe(true);
    expect(pathExists(oscillator, tap)).toBe(true);
    // Never straight to the speakers: the only way out is the bus.
    expect(oscillator.outputs.has(mock.lastContext().destination)).toBe(false);
  });

  it("takes its nodes off the graph when the beep ends", () => {
    const channel = getGameAudio()!.channel(LAB_AUDIO_APP_ID);
    playBeep(channel, 1);
    const oscillator = lastOscillator();
    const gain = lastGain();
    oscillator.end();
    expect(oscillator.outputs.size).toBe(0);
    expect(gain.outputs.size).toBe(0);
  });
});
