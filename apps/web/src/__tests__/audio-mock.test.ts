import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FakeAudioContext,
  FakeAudioDestinationNode,
  FakeGainNode,
  installAudioMock,
  isConnected,
  pathExists,
  removeAudioMock,
} from "./audio-mock";
import {
  getGameAudio,
  isGameSpeakerEnabled,
  setGameSpeakerEnabled,
} from "@/shared/lib/audio";

/**
 * The shared Web Audio double must behave like a browser where a bug could
 * hide, or tests built on it prove nothing. These tests pin that behavior.
 */

afterEach(() => {
  removeAudioMock();
});

describe("FakeAudioContext state machine", () => {
  it("starts suspended and runs after resume(), on a later microtask", async () => {
    const context = new FakeAudioContext();
    const onEvent = vi.fn();
    const onProperty = vi.fn();
    context.addEventListener("statechange", onEvent);
    context.onstatechange = onProperty;

    const pending = context.resume();
    // Like a browser: the state does not change in the same task.
    expect(context.state).toBe("suspended");
    await pending;
    expect(context.state).toBe("running");
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onProperty).toHaveBeenCalledTimes(1);
  });

  it("rejects resume() without a gesture when told to, and after close()", async () => {
    const blocked = new FakeAudioContext({ resumeAllowed: false });
    await expect(blocked.resume()).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(blocked.state).toBe("suspended");

    const closed = new FakeAudioContext({ initialState: "running" });
    await closed.close();
    expect(closed.state).toBe("closed");
    await expect(closed.resume()).rejects.toMatchObject({ name: "InvalidStateError" });
  });

  it("models an iOS interruption and suspend()", async () => {
    const context = new FakeAudioContext({ initialState: "running" });
    context.interrupt();
    expect(context.state).toBe("interrupted");
    await context.resume();
    expect(context.state).toBe("running");
    await context.suspend();
    expect(context.state).toBe("suspended");
  });

  it("keeps destination on the prototype, as a browser does", () => {
    const context = new FakeAudioContext();
    expect(Object.getOwnPropertyDescriptor(context, "destination")).toBeUndefined();
    expect(context.destination).toBeInstanceOf(FakeAudioDestinationNode);
    expect(context.destination).toBe(context.destination);
    expect(context.destination.maxChannelCount).toBe(2);
  });

  it("moves its clock only when the test says so", () => {
    const context = new FakeAudioContext();
    expect(context.currentTime).toBe(0);
    context.advanceTime(0.5);
    expect(context.currentTime).toBe(0.5);
  });

  it("records audioWorklet modules and decoded buffers", async () => {
    const context = new FakeAudioContext();
    await context.audioWorklet.addModule("/tap.worklet.js");
    expect(context.audioWorklet.modules).toEqual(["/tap.worklet.js"]);
    const data = new ArrayBuffer(8);
    const buffer = await context.decodeAudioData(data);
    expect(context.decoded).toEqual([data]);
    expect(buffer.numberOfChannels).toBe(2);
  });
});

describe("fake nodes", () => {
  it("tracks the graph and finds paths through it", () => {
    const context = new FakeAudioContext();
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.connect(gain);
    gain.connect(context.destination);

    expect(isConnected(osc, gain)).toBe(true);
    expect(isConnected(osc, context.destination)).toBe(false);
    expect(pathExists(osc, context.destination)).toBe(true);

    gain.disconnect();
    expect(pathExists(osc, context.destination)).toBe(false);
    expect(gain.outputs.size).toBe(0);
    expect(context.destination.inputs.size).toBe(0);
  });

  it("connects a node into a param and returns undefined, as a browser does", () => {
    const context = new FakeAudioContext();
    const lfo = context.createOscillator();
    const gain = context.createGain();
    expect(lfo.connect(gain.gain)).toBeUndefined();
    expect(gain.gain.inputs.has(lfo)).toBe(true);
    expect(lfo.connect(gain)).toBe(gain);
  });

  it("throws where the real API throws", () => {
    const one = new FakeAudioContext();
    const two = new FakeAudioContext();
    const gain = one.createGain();
    expect(() => gain.connect(two.createGain())).toThrow(/different contexts/);
    expect(() => gain.disconnect(one.createGain())).toThrow(/not connected/);
    expect(() => one.destination.connect(gain)).toThrow(/no outputs/);

    const osc = one.createOscillator();
    expect(() => osc.stop()).toThrow(/has not started/);
    osc.start();
    expect(() => osc.start()).toThrow(/already started/);

    expect(() => gain.gain.exponentialRampToValueAtTime(0, 1)).toThrow(RangeError);
    expect(() => gain.gain.setValueAtTime(Number.NaN, 0)).toThrow(TypeError);
    expect(() => gain.gain.setTargetAtTime(1, 0, -1)).toThrow(RangeError);
    expect(() => one.createBuffer(1, 0, 48000)).toThrow(/length/);
  });

  it("applies scheduled param values at once and logs them", () => {
    const context = new FakeAudioContext();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.5, 0);
    gain.gain.linearRampToValueAtTime(0.2, 1);
    expect(gain.gain.value).toBe(0.2);
    expect(gain.gain.events.map((event) => event.type)).toEqual([
      "setValueAtTime",
      "linearRampToValueAtTime",
    ]);
  });

  it("fires onended when a source ends", () => {
    const context = new FakeAudioContext();
    const source = context.createBufferSource();
    const ended = vi.fn();
    source.onended = ended;
    source.buffer = context.createBuffer(1, 1, 48000);
    source.start(0);
    source.end();
    expect(ended).toHaveBeenCalledTimes(1);
  });
});

describe("installAudioMock", () => {
  it("puts a tracked AudioContext on window and removes it again", async () => {
    const mock = installAudioMock();
    const context = new window.AudioContext();
    expect(mock.contexts).toEqual([context]);
    expect(mock.lastContext()).toBe(context);
    expect(context.state).toBe("suspended");

    mock.setResumeAllowed(false);
    await expect(context.resume()).rejects.toMatchObject({ name: "NotAllowedError" });
    mock.setResumeAllowed(true);
    void context.resume();
    await mock.flush();
    expect(context.state).toBe("running");

    removeAudioMock();
    expect(window.AudioContext).toBeUndefined();
  });

  it("can model old Safari and a browser at its context limit", () => {
    installAudioMock({ webkitOnly: true });
    expect(window.AudioContext).toBeUndefined();
    const webkit = (window as unknown as { webkitAudioContext: new () => FakeAudioContext })
      .webkitAudioContext;
    expect(new webkit().createGain()).toBeInstanceOf(FakeGainNode);

    installAudioMock({ constructorThrows: true });
    expect(() => new window.AudioContext()).toThrow(/too many contexts/);
  });

  it("throws a clear error when a test asks for a context nobody made", () => {
    const mock = installAudioMock({ initialState: "running" });
    expect(() => mock.lastContext()).toThrow(/no AudioContext was created/);
  });

  it("resets the shared game-audio bus, so the next test starts on a fresh page", () => {
    // Test 1 of a game's test file: it makes the bus and mutes the game.
    const first = installAudioMock();
    const firstBus = getGameAudio();
    setGameSpeakerEnabled("snake", false);
    expect(first.contexts).toHaveLength(1);

    // Test 2 of the same file: installAudioMock() alone gives it a new bus.
    const second = installAudioMock();
    const secondBus = getGameAudio();
    expect(second.contexts).toHaveLength(1);
    expect(secondBus).not.toBe(firstBus);
    expect(isGameSpeakerEnabled("snake")).toBe(true);

    // removeAudioMock() also forgets the bus.
    removeAudioMock();
    expect(getGameAudio()).toBeNull();
  });
});
