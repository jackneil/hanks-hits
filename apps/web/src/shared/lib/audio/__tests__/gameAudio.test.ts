import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FakeAudioBufferSourceNode,
  FakeAudioContext,
  FakeDynamicsCompressorNode,
  FakeGainNode,
  installAudioMock,
  isConnected,
  pathExists,
  removeAudioMock,
} from "@/__tests__/audio-mock";

import {
  __unsafeResetGameAudioForTests,
  getGameAudio,
  getGameAudioTapPoint,
  LIMITER_SETTINGS,
  unlockGameAudio,
  UNLOCK_EVENTS,
  type GameAudio,
} from "../gameAudio";

/** Make navigator.userActivation say whether a gesture is running now. */
function setUserActivation(isActive: boolean | undefined): void {
  if (isActive === undefined) {
    // @ts-expect-error - removing the property to simulate a browser without it
    delete navigator.userActivation;
    return;
  }
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { isActive, hasBeenActive: isActive },
  });
}

/** The bus, built outside a gesture so the context stays suspended. */
function busOutsideGesture(): GameAudio {
  setUserActivation(false);
  const bus = getGameAudio();
  if (!bus) throw new Error("expected a bus");
  return bus;
}

function fake(bus: GameAudio): FakeAudioContext {
  return bus.context as unknown as FakeAudioContext;
}

/** The nodes of the hub graph, found by walking from the destination. */
function graphOf(bus: GameAudio) {
  const context = fake(bus);
  const limiter = [...context.destination.inputs][0] as FakeDynamicsCompressorNode;
  const tap = getGameAudioTapPoint() as unknown as FakeGainNode;
  const channel = bus.channel("graph-probe");
  const input = channel.input as unknown as FakeGainNode;
  const master = [...input.outputs][0] as FakeGainNode;
  const speaker = [...tap.outputs][0] as FakeGainNode;
  channel.dispose();
  return { context, limiter, tap, master, speaker };
}

beforeEach(() => {
  __unsafeResetGameAudioForTests();
});

afterEach(() => {
  __unsafeResetGameAudioForTests();
  removeAudioMock();
  setUserActivation(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getGameAudio: creation", () => {
  it("makes no AudioContext when the module is imported", async () => {
    const mock = installAudioMock();
    vi.resetModules();
    const fresh = await import("../gameAudio");
    expect(mock.contexts).toHaveLength(0);
    // It makes one on the first real call.
    fresh.getGameAudio();
    expect(mock.contexts).toHaveLength(1);
  });

  it("returns null in a browser with no Web Audio", () => {
    removeAudioMock();
    expect(getGameAudio()).toBeNull();
    expect(getGameAudioTapPoint()).toBeNull();
    expect(() => unlockGameAudio()).not.toThrow();
  });

  it("returns one shared bus and makes one context", () => {
    const mock = installAudioMock();
    const first = getGameAudio();
    const second = getGameAudio();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(mock.contexts).toHaveLength(1);
  });

  it("works in old Safari, which only has webkitAudioContext", () => {
    const mock = installAudioMock({ webkitOnly: true });
    expect(window.AudioContext).toBeUndefined();
    expect(getGameAudio()).not.toBeNull();
    expect(mock.contexts).toHaveLength(1);
  });

  it("returns null and warns once, with no player data, when the browser refuses a context", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installAudioMock({ constructorThrows: true });
    expect(getGameAudio()).toBeNull();
    expect(getGameAudio()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe(
      "[game-audio] no shared AudioContext (NotSupportedError); game sound is off for this page."
    );
  });

  it("returns null (and never throws) when AudioContext is a hollow stub", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Some older game tests stub AudioContext with an empty class.
    class HollowAudioContext {}
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: HollowAudioContext,
    });
    expect(() => getGameAudio()).not.toThrow();
    expect(getGameAudio()).toBeNull();
    expect(() => unlockGameAudio()).not.toThrow();
  });

  it("makes a new bus when the browser closed the old context", async () => {
    const mock = installAudioMock();
    const first = busOutsideGesture();
    // A game must never do this; it simulates the browser ending the context.
    await (first.context as unknown as FakeAudioContext).close();
    await mock.flush();
    const second = getGameAudio();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(mock.contexts).toHaveLength(2);
  });

  it("types the context as BaseAudioContext, so a game cannot close it", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    // Compile-time check only; the function never runs.
    const neverRun = () => {
      // @ts-expect-error - close() is not on BaseAudioContext
      void bus.context.close();
    };
    expect(typeof neverRun).toBe("function");
  });
});

describe("the graph", () => {
  it("routes channels -> master -> tap point -> speaker -> limiter -> speakers", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { context, limiter, tap, master, speaker } = graphOf(bus);

    const channel = bus.channel("breakout");
    const input = channel.input as unknown as FakeGainNode;
    expect(isConnected(input, master)).toBe(true);
    expect(isConnected(master, tap)).toBe(true);
    expect(isConnected(tap, speaker)).toBe(true);
    expect(isConnected(speaker, limiter)).toBe(true);
    expect(isConnected(limiter, context.destination)).toBe(true);
    expect(limiter).toBeInstanceOf(FakeDynamicsCompressorNode);
    expect(pathExists(input, tap)).toBe(true);
    expect(pathExists(input, context.destination)).toBe(true);
  });

  it("sends UI sounds to the limiter and never through the tap point", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { context, limiter, tap } = graphOf(bus);
    const ui = bus.uiOutput as unknown as FakeGainNode;

    expect(isConnected(ui, limiter)).toBe(true);
    expect(pathExists(ui, context.destination)).toBe(true);
    expect(pathExists(ui, tap)).toBe(false);
  });

  it("sets the limiter to a safety-limiter shape", () => {
    installAudioMock();
    const { limiter } = graphOf(busOutsideGesture());
    expect(limiter.threshold.value).toBe(LIMITER_SETTINGS.threshold);
    expect(limiter.knee.value).toBe(LIMITER_SETTINGS.knee);
    expect(limiter.ratio.value).toBe(LIMITER_SETTINGS.ratio);
    expect(limiter.attack.value).toBe(LIMITER_SETTINGS.attack);
    expect(limiter.release.value).toBe(LIMITER_SETTINGS.release);
  });

  it("gives each channel() call its own input", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const engine = bus.channel("monster-truck");
    const music = bus.channel("monster-truck");
    expect(engine.input).not.toBe(music.input);
    expect(engine.appId).toBe("monster-truck");
    expect(engine.context).toBe(bus.context);
  });

  it("rejects an empty app id", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    expect(() => bus.channel("")).toThrow(TypeError);
    expect(() => bus.channel("   ")).toThrow(TypeError);
    expect(() => bus.setSpeakerEnabled("", true)).toThrow(TypeError);
  });
});

describe("channel.dispose()", () => {
  it("disconnects at once when the context is not running, and is safe to repeat", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { master } = graphOf(bus);
    const channel = bus.channel("snake");
    const input = channel.input as unknown as FakeGainNode;

    channel.dispose();
    expect(channel.disposed).toBe(true);
    expect(isConnected(input, master)).toBe(false);
    expect(() => channel.dispose()).not.toThrow();
    expect(input.disconnect).toHaveBeenCalledTimes(1);
  });

  it("fades out first when sound is playing, then disconnects", async () => {
    const mock = installAudioMock({ initialState: "running" });
    const bus = busOutsideGesture();
    const { master } = graphOf(bus);
    expect(mock.lastContext().state).toBe("running");

    vi.useFakeTimers();
    const channel = bus.channel("snake");
    const input = channel.input as unknown as FakeGainNode;
    channel.dispose();

    expect(input.gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, expect.any(Number));
    expect(isConnected(input, master)).toBe(true);
    vi.advanceTimersByTime(100);
    expect(isConnected(input, master)).toBe(false);
  });
});

describe("the speaker switch", () => {
  it("mutes the speakers for the app on screen, and clips keep the sound", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { tap, speaker } = graphOf(bus);
    const channel = bus.channel("breakout");

    bus.setSpeakerEnabled("breakout", false);
    expect(bus.speakerEnabled).toBe(false);
    expect(speaker.gain.value).toBe(0);
    // A kid's switch fades, so it never clicks.
    expect(speaker.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));
    // The sound still reaches the tap point, so a clip still hears it.
    expect(pathExists(channel.input as unknown as FakeGainNode, tap)).toBe(true);

    bus.setSpeakerEnabled("breakout", true);
    expect(bus.speakerEnabled).toBe(true);
    expect(speaker.gain.value).toBe(1);
  });

  it("never lets one game's mute leak into the next game", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { speaker } = graphOf(bus);

    const breakout = bus.channel("breakout");
    bus.setSpeakerEnabled("breakout", false);
    expect(speaker.gain.value).toBe(0);

    // The kid goes to Asteroids. Its channel is newest, and it is not muted.
    const asteroids = bus.channel("asteroids");
    expect(bus.speakerEnabled).toBe(true);
    expect(speaker.gain.value).toBe(1);

    // Back to Breakout (Asteroids unmounts): Breakout's own switch applies,
    // with a fade, because Breakout may be playing a sound right now.
    asteroids.dispose();
    expect(bus.speakerEnabled).toBe(false);
    expect(speaker.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));

    // Nothing on screen: the speakers are on.
    breakout.dispose();
    expect(bus.speakerEnabled).toBe(true);
    expect(speaker.gain.value).toBe(1);
  });

  it("applies a saved mute before the game's first sound, with no fade", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { speaker } = graphOf(bus);

    // The game reads its saved switch before it makes a channel.
    bus.setSpeakerEnabled("dino-runner", false);
    expect(bus.speakerEnabled).toBe(true);

    speaker.gain.setTargetAtTime.mockClear();
    bus.channel("dino-runner");
    expect(bus.speakerEnabled).toBe(false);
    expect(speaker.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0);
    expect(speaker.gain.setTargetAtTime).not.toHaveBeenCalled();
  });
});

describe("unlock", () => {
  it("calls resume() synchronously, and starts one silent primer", () => {
    const mock = installAudioMock();
    const bus = busOutsideGesture();
    const context = mock.lastContext();
    expect(context.resume).not.toHaveBeenCalled();

    bus.unlock();
    expect(context.resume).toHaveBeenCalledTimes(1);
    const primer = context.createBufferSource.mock.results[0].value as FakeAudioBufferSourceNode;
    expect(primer.start).toHaveBeenCalledTimes(1);
    // The primer plays on the UI path, so it never reaches a clip.
    expect(isConnected(primer, bus.uiOutput as unknown as FakeGainNode)).toBe(true);
    primer.end();
    expect(primer.outputs.size).toBe(0);

    bus.unlock();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the sound already runs", async () => {
    const mock = installAudioMock();
    const bus = busOutsideGesture();
    bus.unlock();
    await mock.flush();
    expect(bus.state).toBe("running");
    bus.unlock();
    expect(mock.lastContext().resume).toHaveBeenCalledTimes(1);
  });

  it("swallows a refused resume() (no unhandled rejection)", async () => {
    const mock = installAudioMock({ resumeAllowed: false });
    const bus = busOutsideGesture();
    bus.unlock();
    await mock.flush();
    expect(bus.state).toBe("suspended");
  });

  it("starts at once when the bus is made inside a tap", () => {
    const mock = installAudioMock();
    setUserActivation(true);
    getGameAudio();
    expect(mock.lastContext().resume).toHaveBeenCalledTimes(1);
  });

  it("starts at once in a browser that cannot tell whether a tap is running", () => {
    const mock = installAudioMock();
    setUserActivation(undefined);
    getGameAudio();
    expect(mock.lastContext().resume).toHaveBeenCalledTimes(1);
  });

  it("unlockGameAudio() makes the bus inside the tap and starts it", () => {
    const mock = installAudioMock();
    setUserActivation(true);
    unlockGameAudio();
    expect(mock.contexts).toHaveLength(1);
    expect(mock.lastContext().resume).toHaveBeenCalled();
  });
});

describe("the document unlock listener", () => {
  it.each(UNLOCK_EVENTS)("resumes a suspended bus on %s", (type) => {
    const mock = installAudioMock();
    busOutsideGesture();
    document.dispatchEvent(new Event(type, { bubbles: true }));
    expect(mock.lastContext().resume).toHaveBeenCalledTimes(1);
  });

  it("listens in the capture phase, so a game that stops propagation cannot block it", () => {
    const mock = installAudioMock();
    busOutsideGesture();
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(mock.lastContext().resume).toHaveBeenCalledTimes(1);
    button.remove();
  });

  it("never makes an AudioContext on a page with no game sound", () => {
    const mock = installAudioMock();
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("keydown"));
    expect(mock.contexts).toHaveLength(0);
  });

  it("comes off once the sound runs, and comes back after an iOS interruption", async () => {
    const mock = installAudioMock();
    busOutsideGesture();
    const context = mock.lastContext();

    document.dispatchEvent(new Event("touchend"));
    await mock.flush();
    expect(context.state).toBe("running");
    expect(context.resume).toHaveBeenCalledTimes(1);

    // Running: the listener is gone, so a tap does nothing.
    document.dispatchEvent(new Event("touchend"));
    expect(context.resume).toHaveBeenCalledTimes(1);

    // A phone call interrupts the audio. The next tap starts it again.
    context.interrupt();
    document.dispatchEvent(new Event("keydown"));
    expect(context.resume).toHaveBeenCalledTimes(2);
    await mock.flush();
    expect(context.state).toBe("running");
  });

  it("keeps listening after a refused resume(), and the next tap works", async () => {
    const mock = installAudioMock({ resumeAllowed: false });
    busOutsideGesture();
    const context = mock.lastContext();

    document.dispatchEvent(new Event("pointerdown"));
    await mock.flush();
    expect(context.state).toBe("suspended");

    mock.setResumeAllowed(true);
    document.dispatchEvent(new Event("pointerup"));
    await mock.flush();
    expect(context.state).toBe("running");
  });
});

describe("state and onStateChange", () => {
  it("reports each state change until the caller stops listening", async () => {
    const mock = installAudioMock();
    const bus = busOutsideGesture();
    const seen: string[] = [];
    const stop = bus.onStateChange((state) => seen.push(state));

    expect(bus.state).toBe("suspended");
    bus.unlock();
    await mock.flush();
    mock.lastContext().interrupt();
    stop();
    mock.lastContext().simulateState("running");

    expect(seen).toEqual(["running", "interrupted"]);
    expect(bus.state).toBe("running");
  });

  it("keeps calling the other listeners when one throws", async () => {
    const mock = installAudioMock();
    const bus = busOutsideGesture();
    const good = vi.fn();
    bus.onStateChange(() => {
      throw new Error("bad listener");
    });
    bus.onStateChange(good);
    bus.unlock();
    await mock.flush();
    expect(good).toHaveBeenCalledWith("running");
  });
});

describe("getGameAudioTapPoint", () => {
  it("returns the node every game channel reaches, before the speaker switch", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const tap = getGameAudioTapPoint() as unknown as FakeGainNode;
    const channel = bus.channel("flappy-bird");
    bus.setSpeakerEnabled("flappy-bird", false);
    expect(tap).toBeInstanceOf(FakeGainNode);
    expect(pathExists(channel.input as unknown as FakeGainNode, tap)).toBe(true);
    expect(pathExists(bus.uiOutput as unknown as FakeGainNode, tap)).toBe(false);
  });
});
