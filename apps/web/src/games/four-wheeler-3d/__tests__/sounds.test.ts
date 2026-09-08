import { describe, it, expect, vi } from "vitest";

import {
  ENGINE_MAX_HZ,
  ENGINE_MIN_HZ,
  FourWheelerSounds,
} from "../lib/sounds";

/** A stand-in for the browser audio engine, so no sound is ever made. */
function makeMockContext() {
  const oscillators: { frequency: { value: number } }[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });

  const context = {
    currentTime: 0,
    sampleRate: 8000,
    state: "running" as AudioContextState,
    destination: {},
    resume: vi.fn(),
    createOscillator: vi.fn(() => {
      const osc = {
        ...node(),
        type: "sine",
        frequency: param(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: vi.fn(() => ({
      ...node(),
      buffer: null,
      loop: false,
      start: vi.fn(),
      stop: vi.fn(),
    })),
  };

  return { context, oscillators };
}

function makeManager() {
  const mock = makeMockContext();
  const manager = new FourWheelerSounds(
    () => mock.context as unknown as AudioContext
  );
  return { manager, ...mock };
}

describe("the engine note", () => {
  it("keeps the level between nothing and flat out", () => {
    const { manager } = makeManager();
    manager.setEngine(-4);
    expect(manager.getEngineLevel()).toBe(0);
    manager.setEngine(9);
    expect(manager.getEngineLevel()).toBe(1);
    manager.setEngine(0.42);
    expect(manager.getEngineLevel()).toBeCloseTo(0.42, 6);
    manager.setEngine(Number.NaN);
    expect(manager.getEngineLevel()).toBe(0);
  });

  it("pitches from the idle note up to the top note", () => {
    const { manager, oscillators } = makeManager();
    manager.startEngine();
    expect(manager.isEngineRunning()).toBe(true);
    manager.setEngine(0);
    expect(oscillators[0].frequency.value).toBeCloseTo(ENGINE_MIN_HZ, 6);
    manager.setEngine(1);
    expect(oscillators[0].frequency.value).toBeCloseTo(ENGINE_MAX_HZ, 6);
  });

  it("starts once, however many times it is asked", () => {
    const { manager, context } = makeManager();
    manager.startEngine();
    manager.startEngine();
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    manager.stopEngine();
    expect(manager.isEngineRunning()).toBe(false);
  });
});

describe("sound can be turned off", () => {
  it("makes no horn at all when sound is off", () => {
    const { manager, context } = makeManager();
    manager.setEnabled(false);
    manager.playHorn();
    expect(context.createOscillator).not.toHaveBeenCalled();
  });

  it("honks when sound is on", () => {
    const { manager, context } = makeManager();
    manager.playHorn();
    expect(context.createOscillator).toHaveBeenCalled();
  });

  it("stops the engine when sound is turned off", () => {
    const { manager } = makeManager();
    manager.startEngine();
    manager.setEnabled(false);
    expect(manager.isEngineRunning()).toBe(false);
    manager.startEngine();
    expect(manager.isEngineRunning()).toBe(false);
  });

  it("makes no thump when sound is off", () => {
    const { manager, context } = makeManager();
    manager.setEnabled(false);
    manager.playThud(1);
    expect(context.createOscillator).not.toHaveBeenCalled();
  });

  it("thumps harder for a bigger drop, and never louder than that", () => {
    const { manager, context } = makeManager();
    manager.playThud(4);
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    manager.playThud(-1);
    expect(context.createOscillator).toHaveBeenCalledTimes(2);
  });

  it("wakes the audio engine up when it was asleep", () => {
    const { manager, context } = makeManager();
    manager.playHorn();
    context.state = "suspended";
    manager.resume();
    expect(context.resume).toHaveBeenCalled();
  });
});
