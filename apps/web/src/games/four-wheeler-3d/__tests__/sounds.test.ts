import { describe, it, expect, vi } from "vitest";

import { FourWheelerSounds } from "../lib/sounds";

/** A stand-in for the browser audio engine, so no sound is ever made. */
function makeMockContext() {
  const oscillators: { frequency: { value: number } }[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });

  const context = {
    currentTime: 0,
    sampleRate: 8000,
    state: "running" as AudioContextState,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
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
    createBiquadFilter: vi.fn(() => ({
      ...node(),
      frequency: param(),
      Q: param(),
      type: "lowpass",
    })),
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: vi.fn(() => ({
      ...node(),
      buffer: null,
      playbackRate: param(),
      onended: null as (() => void) | null,
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
    () => mock.context as unknown as AudioContext,
    async () => null,
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

  it("smooths throttle and speed changes instead of stepping a musical oscillator", () => {
    const { manager, context } = makeManager();
    manager.startEngine();
    manager.setEngine(0.5, 1);
    expect(context.createOscillator).not.toHaveBeenCalled();
    const source = context.createBufferSource.mock.results[0].value;
    expect(source.playbackRate.setTargetAtTime).toHaveBeenLastCalledWith(
      expect.any(Number),
      0,
      0.16,
    );
    const filter = context.createBiquadFilter.mock.results[0].value;
    expect(filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(
      expect.any(Number),
      0,
      0.12,
    );
  });

  it("starts once, however many times it is asked", () => {
    const { manager, context } = makeManager();
    manager.startEngine();
    manager.startEngine();
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
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

describe("recording ownership and node cleanup", () => {
  function delayedManager() {
    const mock = makeMockContext();
    let resolve!: (buffer: AudioBuffer | null) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<AudioBuffer | null>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const load = vi.fn(() => pending);
    const manager = new FourWheelerSounds(
      () => mock.context as unknown as AudioContext,
      load,
    );
    const settle = async () => {
      await pending.catch(() => null);
      await Promise.resolve();
    };
    return { ...mock, manager, load, resolve, reject, settle };
  }
  it("never revives a muted engine when its recording finishes loading", async () => {
    const { manager, context, resolve, settle } = delayedManager();
    manager.startEngine();
    manager.setEnabled(false);
    resolve({} as AudioBuffer);
    await settle();
    expect(manager.isEngineRunning()).toBe(false);
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    const exhaust = context.createBufferSource.mock.results[0].value;
    expect(exhaust.stop).toHaveBeenCalledOnce();
    exhaust.onended?.();
    expect(exhaust.disconnect).toHaveBeenCalledOnce();
    expect(
      context.createBiquadFilter.mock.results[0].value.disconnect,
    ).toHaveBeenCalledOnce();
    expect(
      context.createGain.mock.results[0].value.disconnect,
    ).toHaveBeenCalledOnce();
  });
  it("attaches a delayed recording only to the replacement engine", async () => {
    const { manager, context, load, resolve, settle } = delayedManager();
    manager.startEngine();
    const first = context.createBufferSource.mock.results[0].value;
    manager.stopEngine();
    manager.startEngine();
    const replacement = context.createBufferSource.mock.results[1].value;
    resolve({} as AudioBuffer);
    await settle();
    expect(load).toHaveBeenCalledOnce();
    expect(context.createBufferSource).toHaveBeenCalledTimes(3);
    const recording = context.createBufferSource.mock.results[2].value;
    expect(recording.start).toHaveBeenCalledOnce();
    first.onended?.();
    expect(recording.disconnect).not.toHaveBeenCalled();
    expect(replacement.disconnect).not.toHaveBeenCalled();
    manager.stopEngine();
    replacement.onended?.();
    expect(recording.stop).toHaveBeenCalledOnce();
    expect(recording.disconnect).toHaveBeenCalledOnce();
    expect(
      context.createGain.mock.results[2].value.disconnect,
    ).toHaveBeenCalledOnce();
  });
  it("reuses decoded recording data but creates fresh nodes after a pause", async () => {
    const { manager, context, load, resolve, settle } = delayedManager();
    manager.startEngine();
    resolve({} as AudioBuffer);
    await settle();
    const first = context.createBufferSource.mock.results[0].value;
    const previousRecording = context.createBufferSource.mock.results[1].value;
    manager.stopEngine();
    first.onended?.();
    manager.startEngine();
    await settle();
    expect(load).toHaveBeenCalledOnce();
    expect(context.createBufferSource).toHaveBeenCalledTimes(4);
    expect(previousRecording.disconnect).toHaveBeenCalledOnce();
    const fresh = context.createBufferSource.mock.results[3].value;
    expect(fresh).not.toBe(previousRecording);
    expect(fresh.start).toHaveBeenCalledOnce();
    expect(manager.isEngineRunning()).toBe(true);
  });
  it("keeps synthesized exhaust running after a recording load failure", async () => {
    const { manager, context, reject, settle } = delayedManager();
    manager.startEngine();
    reject(new Error("decode failed"));
    await settle();
    expect(manager.isEngineRunning()).toBe(true);
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    manager.stopEngine();
    expect(manager.isEngineRunning()).toBe(false);
  });
});
