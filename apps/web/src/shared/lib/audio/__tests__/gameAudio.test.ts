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
  baseAppIdOf,
  getGameAudio,
  getGameAudioTapPoint,
  isGameSpeakerEnabled,
  LIMITER_SETTINGS,
  onGameAudioCreated,
  setGameSpeakerEnabled,
  unlockGameAudio,
  UNLOCK_EVENTS,
  wantGameAudio,
  type GameAudio,
  type GameAudioChannel,
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

function node(value: unknown): FakeGainNode {
  return value as FakeGainNode;
}

/** The shared nodes of the hub graph, found by walking the fake graph. */
function graphOf(bus: GameAudio) {
  const context = fake(bus);
  const limiter = [...context.destination.inputs][0] as FakeDynamicsCompressorNode;
  const tap = node(getGameAudioTapPoint());
  const master = [...tap.inputs][0] as FakeGainNode;
  return { context, limiter, tap, master };
}

/** The speaker gain that a channel feeds: its output that is not master. */
function speakerOf(channel: GameAudioChannel, master: FakeGainNode): FakeGainNode {
  const outputs = [...node(channel.input).outputs].filter((target) => target !== master);
  expect(outputs).toHaveLength(1);
  return outputs[0] as FakeGainNode;
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
  it("sends each channel to the tap point (through master) and to the speakers (through its app's speaker gain)", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { context, limiter, tap, master } = graphOf(bus);

    const channel = bus.channel("breakout");
    const input = node(channel.input);
    const speaker = speakerOf(channel, master);

    // The recording branch: every game sound, before any switch.
    expect(isConnected(input, master)).toBe(true);
    expect(isConnected(master, tap)).toBe(true);
    // The speaker branch: the app's switch, then the limiter.
    expect(isConnected(input, speaker)).toBe(true);
    expect(isConnected(speaker, limiter)).toBe(true);
    expect(isConnected(limiter, context.destination)).toBe(true);
    expect(limiter).toBeInstanceOf(FakeDynamicsCompressorNode);
    expect(pathExists(input, tap)).toBe(true);
    expect(pathExists(input, context.destination)).toBe(true);
    // Nothing pulls the tap branch until a recorder attaches (no cost, and
    // no second copy of the sound in the speakers).
    expect(tap.outputs.size).toBe(0);
    expect(pathExists(master, context.destination)).toBe(false);
  });

  it("sends UI sounds to the limiter and never through the tap point", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { context, limiter, tap } = graphOf(bus);
    const ui = node(bus.uiOutput);

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

  it("gives each channel() call its own input, and each sub-mix of one app shares that app's speaker gain", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { master } = graphOf(bus);
    const engine = bus.channel("monster-truck:engine");
    const music = bus.channel("monster-truck:music");
    const plain = bus.channel("monster-truck");
    const other = bus.channel("breakout");

    expect(engine.input).not.toBe(music.input);
    expect(engine.appId).toBe("monster-truck:engine");
    expect(engine.baseAppId).toBe("monster-truck");
    expect(engine.context).toBe(bus.context);
    expect(speakerOf(engine, master)).toBe(speakerOf(music, master));
    expect(speakerOf(plain, master)).toBe(speakerOf(engine, master));
    expect(speakerOf(other, master)).not.toBe(speakerOf(engine, master));
  });

  it("rejects an empty app id", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    expect(() => bus.channel("")).toThrow(TypeError);
    expect(() => bus.channel("   ")).toThrow(TypeError);
    expect(() => bus.channel(":sfx")).toThrow(TypeError);
    expect(() => bus.setSpeakerEnabled("", true)).toThrow(TypeError);
    expect(() => setGameSpeakerEnabled(" :music", true)).toThrow(TypeError);
    expect(() => isGameSpeakerEnabled("")).toThrow(TypeError);
  });

  it("names the app of a sub-mix id", () => {
    expect(baseAppIdOf("monster-truck:engine")).toBe("monster-truck");
    expect(baseAppIdOf("four-wheeler-3d:music")).toBe("four-wheeler-3d");
    expect(baseAppIdOf(" breakout ")).toBe("breakout");
  });
});

describe("channel.dispose()", () => {
  it("disconnects at once when the context is not running, and is safe to repeat", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { master } = graphOf(bus);
    const channel = bus.channel("snake");
    const speaker = speakerOf(channel, master);
    const input = node(channel.input);

    channel.dispose();
    expect(channel.disposed).toBe(true);
    expect(isConnected(input, master)).toBe(false);
    expect(isConnected(input, speaker)).toBe(false);
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
    const input = node(channel.input);
    channel.dispose();

    expect(input.gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, expect.any(Number));
    expect(isConnected(input, master)).toBe(true);
    vi.advanceTimersByTime(100);
    expect(isConnected(input, master)).toBe(false);
  });

  it("marks a kept channel disposed when the browser closes the context", async () => {
    const mock = installAudioMock();
    const bus = busOutsideGesture();
    // A game kept this channel in a module-level variable.
    const kept = bus.channel("breakout");
    await fake(bus).close();
    await mock.flush();

    expect(kept.disposed).toBe(true);
    expect(() => kept.dispose()).not.toThrow();
    // The game asks again and gets a live channel on a new bus.
    const fresh = getGameAudio()?.channel("breakout");
    expect(fresh?.disposed).toBe(false);
    expect(fresh?.context).not.toBe(bus.context);
  });
});

describe("the speaker switch", () => {
  it("fades only that app's speakers while sound plays, and clips keep the sound", () => {
    installAudioMock({ initialState: "running" });
    const bus = busOutsideGesture();
    const { master, tap } = graphOf(bus);
    const channel = bus.channel("breakout");
    const speaker = speakerOf(channel, master);

    setGameSpeakerEnabled("breakout", false);
    expect(isGameSpeakerEnabled("breakout")).toBe(false);
    expect(bus.isSpeakerEnabled("breakout")).toBe(false);
    expect(speaker.gain.value).toBe(0);
    // A kid's switch fades while sound plays, so it never clicks.
    expect(speaker.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));
    // The sound still reaches the tap point, so a clip still hears it.
    expect(pathExists(node(channel.input), tap)).toBe(true);

    bus.setSpeakerEnabled("breakout", true);
    expect(isGameSpeakerEnabled("breakout")).toBe(true);
    expect(speaker.gain.value).toBe(1);
  });

  it("jumps (no fade) while the sound is stopped, so the first sound after resume() cannot leak", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const { master } = graphOf(bus);
    const speaker = speakerOf(bus.channel("breakout"), master);

    setGameSpeakerEnabled("breakout", false);
    expect(speaker.gain.value).toBe(0);
    expect(speaker.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0);
    expect(speaker.gain.setTargetAtTime).not.toHaveBeenCalled();
  });

  it("does nothing when the switch does not change", () => {
    installAudioMock({ initialState: "running" });
    const bus = busOutsideGesture();
    const { master } = graphOf(bus);
    const speaker = speakerOf(bus.channel("breakout"), master);

    setGameSpeakerEnabled("breakout", true);
    expect(speaker.gain.cancelScheduledValues).not.toHaveBeenCalled();
  });

  it("mutes every sub-mix of an app, from any of its ids", () => {
    installAudioMock({ initialState: "running" });
    const bus = busOutsideGesture();
    const { master, tap } = graphOf(bus);
    const engine = bus.channel("monster-truck:engine");
    const music = bus.channel("monster-truck:music");
    const speaker = speakerOf(engine, master);

    setGameSpeakerEnabled("monster-truck", false);
    expect(speaker.gain.value).toBe(0);
    expect(speakerOf(music, master).gain.value).toBe(0);
    expect(isGameSpeakerEnabled("monster-truck:sfx")).toBe(false);
    expect(pathExists(node(engine.input), tap)).toBe(true);

    // A sub-mix id works the same as the app id.
    setGameSpeakerEnabled("monster-truck:music", true);
    expect(speaker.gain.value).toBe(1);
    expect(isGameSpeakerEnabled("monster-truck")).toBe(true);
  });

  it("never lets one game's mute reach another game, even when a game keeps its channel", () => {
    installAudioMock({ initialState: "running" });
    const bus = busOutsideGesture();
    const { master } = graphOf(bus);

    // The kid plays Breakout. Its sound module keeps the channel for the
    // whole page and never disposes it.
    const breakout = bus.channel("breakout");
    // Then Asteroids (also kept), then Breakout again.
    const asteroids = bus.channel("asteroids");
    const breakoutAgain = bus.channel("breakout");

    setGameSpeakerEnabled("breakout", false);
    expect(speakerOf(breakout, master).gain.value).toBe(0);
    expect(speakerOf(breakoutAgain, master).gain.value).toBe(0);
    expect(speakerOf(asteroids, master).gain.value).toBe(1);

    // Asteroids' own switch touches only Asteroids.
    setGameSpeakerEnabled("asteroids", false);
    setGameSpeakerEnabled("breakout", true);
    expect(speakerOf(asteroids, master).gain.value).toBe(0);
    expect(speakerOf(breakout, master).gain.value).toBe(1);
  });

  it("records a saved mute before the bus exists, makes no AudioContext, and holds it from the first sound", () => {
    const mock = installAudioMock();

    // The game loads its saved switch on page load, before any tap.
    setGameSpeakerEnabled("dino-runner", false);
    expect(mock.contexts).toHaveLength(0);
    expect(isGameSpeakerEnabled("dino-runner")).toBe(false);

    const bus = busOutsideGesture();
    const { master } = graphOf(bus);
    const speaker = speakerOf(bus.channel("dino-runner"), master);
    // Silent from the start: no automation that could let a sound through.
    expect(speaker.gain.value).toBe(0);
    expect(speaker.gain.setTargetAtTime).not.toHaveBeenCalled();
    expect(speaker.gain.setValueAtTime).not.toHaveBeenCalled();
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
    expect(isConnected(primer, node(bus.uiOutput))).toBe(true);
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
    setUserActivation(true);
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

describe("wantGameAudio: a game with no start card", () => {
  it("makes the bus inside the first tap and starts it", async () => {
    const mock = installAudioMock();
    // The game mounts (useEffect(() => wantGameAudio(), [])). No context yet.
    const release = wantGameAudio();
    expect(mock.contexts).toHaveLength(0);

    setUserActivation(true);
    document.dispatchEvent(new Event("pointerup"));
    expect(mock.contexts).toHaveLength(1);
    expect(mock.lastContext().resume).toHaveBeenCalledTimes(1);
    await mock.flush();
    expect(mock.lastContext().state).toBe("running");

    // The game makes its first channel later, from a timer: it plays at once.
    const channel = getGameAudio()?.channel("drum-machine");
    expect(channel?.context.state).toBe("running");
    expect(mock.contexts).toHaveLength(1);
    release();
  });

  it("waits for a tap that can start sound (a touch pointerdown cannot)", () => {
    const mock = installAudioMock();
    wantGameAudio();

    setUserActivation(false);
    document.dispatchEvent(new Event("pointerdown"));
    expect(mock.contexts).toHaveLength(0);

    setUserActivation(true);
    document.dispatchEvent(new Event("touchend"));
    expect(mock.contexts).toHaveLength(1);
    expect(mock.lastContext().resume).toHaveBeenCalledTimes(1);
  });

  it("lets go when the game unmounts, and counts each mounted game", () => {
    const mock = installAudioMock();
    setUserActivation(true);
    const first = wantGameAudio();
    const second = wantGameAudio();

    first();
    first(); // A second call does nothing: the other game still wants sound.
    document.dispatchEvent(new Event("click"));
    expect(mock.contexts).toHaveLength(1);
    second();

    // A fresh page: the only game mounts and unmounts before any tap.
    const fresh = installAudioMock();
    const release = wantGameAudio();
    release();
    document.dispatchEvent(new Event("click"));
    expect(fresh.contexts).toHaveLength(0);
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
  it("returns the node every game channel reaches, before any sound switch", () => {
    installAudioMock();
    const bus = busOutsideGesture();
    const tap = node(getGameAudioTapPoint());
    const channel = bus.channel("flappy-bird");
    setGameSpeakerEnabled("flappy-bird", false);
    expect(tap).toBeInstanceOf(FakeGainNode);
    expect(pathExists(node(channel.input), tap)).toBe(true);
    expect(pathExists(node(bus.uiOutput), tap)).toBe(false);
  });

  it("never makes an AudioContext (a game with no sound stays silent)", () => {
    const mock = installAudioMock();
    expect(getGameAudioTapPoint()).toBeNull();
    expect(mock.contexts).toHaveLength(0);
  });

  it("returns null after the browser closes the context, until a new bus exists", async () => {
    const mock = installAudioMock();
    const bus = busOutsideGesture();
    const oldTap = getGameAudioTapPoint();
    await fake(bus).close();
    await mock.flush();
    expect(getGameAudioTapPoint()).toBeNull();
    getGameAudio();
    expect(getGameAudioTapPoint()).not.toBeNull();
    expect(getGameAudioTapPoint()).not.toBe(oldTap);
  });
});

describe("onGameAudioCreated", () => {
  it("reports the bus that exists now and each new one, and never makes a context", async () => {
    const mock = installAudioMock();
    const seen: GameAudio[] = [];
    const stop = onGameAudioCreated((bus) => seen.push(bus));
    expect(mock.contexts).toHaveLength(0);
    expect(seen).toHaveLength(0);

    const first = busOutsideGesture();
    expect(seen).toEqual([first]);

    // A late subscriber gets the live bus at once.
    const late: GameAudio[] = [];
    onGameAudioCreated((bus) => late.push(bus));
    expect(late).toEqual([first]);

    // The browser closes the context; the next bus is reported too.
    await fake(first).close();
    await mock.flush();
    const second = getGameAudio();
    expect(seen).toEqual([first, second]);

    stop();
    await fake(second as GameAudio).close();
    await mock.flush();
    getGameAudio();
    expect(seen).toHaveLength(2);
  });

  it("still returns the bus when a listener throws", () => {
    installAudioMock();
    onGameAudioCreated(() => {
      throw new Error("bad listener");
    });
    expect(busOutsideGesture()).not.toBeNull();
  });
});
