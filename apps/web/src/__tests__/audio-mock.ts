import { vi } from "vitest";

import { __unsafeResetGameAudioForTests } from "@/shared/lib/audio/gameAudio";

/**
 * Shared Web Audio API test double.
 *
 * jsdom ships no AudioContext, so every test that touches game sound needs
 * a fake one. Keep this the single copy. Older game tests still carry
 * their own small fakes; each game's audio-bus migration PR moves its tests
 * onto this file.
 *
 * The fake follows the real API where a bug could hide:
 * - The context has a state machine: "suspended", "running",
 *   "interrupted" (WebKit only) and "closed". resume(), suspend() and
 *   close() change the state on a later microtask and fire "statechange",
 *   the same as a browser. Call `await mock.flush()` to let them land.
 * - `destination` is a getter on the prototype, the same as a browser.
 * - Nodes record every connect() and disconnect(), so a test can prove a
 *   path through the graph with `pathExists(from, to)`.
 * - The real API throws on some misuse, and so does the fake: a connect
 *   across two contexts, a disconnect from a node that is not connected,
 *   start() twice, an exponential ramp to 0, and a non-finite param value.
 *
 * AudioParam automation is not simulated in time: every scheduled value is
 * applied to `value` at once, and the call is logged in `events`.
 */

type FakeEdgeTarget = FakeAudioNode | FakeAudioParam;

function domError(name: string, message: string): Error {
  // jsdom provides DOMException; fall back to a named Error elsewhere.
  if (typeof DOMException === "function") return new DOMException(message, name);
  const error = new Error(message);
  error.name = name;
  return error;
}

function assertFinite(method: string, ...values: number[]): void {
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`${method}: the provided value is non-finite.`);
    }
  }
}

/** A fake AudioParam. Scheduled values apply to `value` at once. */
export class FakeAudioParam {
  value: number;
  readonly defaultValue: number;
  readonly minValue = -3.4028234663852886e38;
  readonly maxValue = 3.4028234663852886e38;
  automationRate: "a-rate" | "k-rate" = "a-rate";
  /** Every automation call, in call order. */
  readonly events: Array<{ type: string; args: number[] }> = [];
  /** Nodes connected into this param (node.connect(param)). */
  readonly inputs = new Set<FakeAudioNode>();

  constructor(
    readonly context: FakeAudioContext,
    defaultValue: number
  ) {
    this.value = defaultValue;
    this.defaultValue = defaultValue;
  }

  setValueAtTime = vi.fn((value: number, startTime: number): FakeAudioParam => {
    assertFinite("setValueAtTime", value, startTime);
    this.value = value;
    this.events.push({ type: "setValueAtTime", args: [value, startTime] });
    return this;
  });

  linearRampToValueAtTime = vi.fn((value: number, endTime: number): FakeAudioParam => {
    assertFinite("linearRampToValueAtTime", value, endTime);
    this.value = value;
    this.events.push({ type: "linearRampToValueAtTime", args: [value, endTime] });
    return this;
  });

  exponentialRampToValueAtTime = vi.fn((value: number, endTime: number): FakeAudioParam => {
    assertFinite("exponentialRampToValueAtTime", value, endTime);
    if (value === 0) {
      // The real API throws here; games must ramp to a small value instead.
      throw new RangeError("exponentialRampToValueAtTime: the value must not be 0.");
    }
    this.value = value;
    this.events.push({ type: "exponentialRampToValueAtTime", args: [value, endTime] });
    return this;
  });

  setTargetAtTime = vi.fn(
    (target: number, startTime: number, timeConstant: number): FakeAudioParam => {
      assertFinite("setTargetAtTime", target, startTime, timeConstant);
      if (timeConstant < 0) {
        throw new RangeError("setTargetAtTime: the time constant must not be negative.");
      }
      this.value = target;
      this.events.push({ type: "setTargetAtTime", args: [target, startTime, timeConstant] });
      return this;
    }
  );

  setValueCurveAtTime = vi.fn(
    (values: ArrayLike<number>, startTime: number, duration: number): FakeAudioParam => {
      assertFinite("setValueCurveAtTime", startTime, duration);
      if (values.length < 2) {
        throw domError("InvalidStateError", "setValueCurveAtTime: the curve needs 2 or more values.");
      }
      this.value = values[values.length - 1];
      this.events.push({ type: "setValueCurveAtTime", args: [startTime, duration] });
      return this;
    }
  );

  cancelScheduledValues = vi.fn((cancelTime: number): FakeAudioParam => {
    assertFinite("cancelScheduledValues", cancelTime);
    this.events.push({ type: "cancelScheduledValues", args: [cancelTime] });
    return this;
  });

  cancelAndHoldAtTime = vi.fn((cancelTime: number): FakeAudioParam => {
    assertFinite("cancelAndHoldAtTime", cancelTime);
    this.events.push({ type: "cancelAndHoldAtTime", args: [cancelTime] });
    return this;
  });
}

/** A fake AudioNode that records its connections. */
export class FakeAudioNode extends EventTarget {
  readonly numberOfInputs: number;
  readonly numberOfOutputs: number;
  channelCount = 2;
  channelCountMode: "max" | "clamped-max" | "explicit" = "max";
  channelInterpretation: "speakers" | "discrete" = "speakers";
  /** Where this node sends its output. */
  readonly outputs = new Set<FakeEdgeTarget>();
  /** Nodes that send their output into this node. */
  readonly inputs = new Set<FakeAudioNode>();

  constructor(
    readonly context: FakeAudioContext,
    numberOfInputs = 1,
    numberOfOutputs = 1
  ) {
    super();
    this.numberOfInputs = numberOfInputs;
    this.numberOfOutputs = numberOfOutputs;
  }

  connect = vi.fn((destination: FakeEdgeTarget): FakeAudioNode | undefined => {
    if (!(destination instanceof FakeAudioNode) && !(destination instanceof FakeAudioParam)) {
      throw new TypeError("connect: the destination is not an AudioNode or an AudioParam.");
    }
    if (destination.context !== this.context) {
      // The real API refuses to join two contexts (or two iframe realms).
      throw domError("InvalidAccessError", "connect: the nodes belong to different contexts.");
    }
    if (this.numberOfOutputs === 0) {
      throw domError("IndexSizeError", "connect: this node has no outputs.");
    }
    this.outputs.add(destination);
    destination.inputs.add(this);
    return destination instanceof FakeAudioNode ? destination : undefined;
  });

  disconnect = vi.fn((destination?: FakeEdgeTarget): void => {
    if (destination === undefined) {
      for (const target of this.outputs) target.inputs.delete(this);
      this.outputs.clear();
      return;
    }
    if (!this.outputs.has(destination)) {
      // The real API throws when the node is not connected to `destination`.
      throw domError("InvalidAccessError", "disconnect: the nodes are not connected.");
    }
    this.outputs.delete(destination);
    destination.inputs.delete(this);
  });
}

/** The speakers. */
export class FakeAudioDestinationNode extends FakeAudioNode {
  readonly maxChannelCount = 2;
  constructor(context: FakeAudioContext) {
    super(context, 1, 0);
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain: FakeAudioParam;
  constructor(context: FakeAudioContext) {
    super(context);
    this.gain = new FakeAudioParam(context, 1);
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency: FakeAudioParam;
  readonly Q: FakeAudioParam;
  readonly gain: FakeAudioParam;
  readonly detune: FakeAudioParam;
  constructor(context: FakeAudioContext) {
    super(context);
    this.frequency = new FakeAudioParam(context, 350);
    this.Q = new FakeAudioParam(context, 1);
    this.gain = new FakeAudioParam(context, 0);
    this.detune = new FakeAudioParam(context, 0);
  }
}

export class FakeDynamicsCompressorNode extends FakeAudioNode {
  readonly threshold: FakeAudioParam;
  readonly knee: FakeAudioParam;
  readonly ratio: FakeAudioParam;
  readonly attack: FakeAudioParam;
  readonly release: FakeAudioParam;
  readonly reduction = 0;
  constructor(context: FakeAudioContext) {
    super(context);
    this.threshold = new FakeAudioParam(context, -24);
    this.knee = new FakeAudioParam(context, 30);
    this.ratio = new FakeAudioParam(context, 12);
    this.attack = new FakeAudioParam(context, 0.003);
    this.release = new FakeAudioParam(context, 0.25);
  }
}

export class FakeWaveShaperNode extends FakeAudioNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = "none";
}

export class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan: FakeAudioParam;
  constructor(context: FakeAudioContext) {
    super(context);
    this.pan = new FakeAudioParam(context, 0);
  }
}

/**
 * Base for sources that start and stop (oscillator, buffer source).
 * Call `end()` to make the source finish and fire `onended`.
 */
export class FakeScheduledSourceNode extends FakeAudioNode {
  onended: ((event: Event) => void) | null = null;
  started = false;
  stopped = false;
  startTime: number | null = null;
  stopTime: number | null = null;

  constructor(context: FakeAudioContext) {
    super(context, 0, 1);
  }

  start = vi.fn((when = 0): void => {
    assertFinite("start", when);
    if (this.started) {
      throw domError("InvalidStateError", "start: the source has already started.");
    }
    this.started = true;
    this.startTime = when;
  });

  stop = vi.fn((when = 0): void => {
    assertFinite("stop", when);
    if (!this.started) {
      throw domError("InvalidStateError", "stop: the source has not started.");
    }
    this.stopped = true;
    this.stopTime = when;
  });

  /** Test control: finish the source now and fire "ended". */
  end(): void {
    const event = new Event("ended");
    this.dispatchEvent(event);
    this.onended?.(event);
  }
}

export class FakeOscillatorNode extends FakeScheduledSourceNode {
  type: OscillatorType = "sine";
  readonly frequency: FakeAudioParam;
  readonly detune: FakeAudioParam;
  setPeriodicWave = vi.fn();
  constructor(context: FakeAudioContext) {
    super(context);
    this.frequency = new FakeAudioParam(context, 440);
    this.detune = new FakeAudioParam(context, 0);
  }
}

export class FakeAudioBufferSourceNode extends FakeScheduledSourceNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate: FakeAudioParam;
  readonly detune: FakeAudioParam;
  constructor(context: FakeAudioContext) {
    super(context);
    this.playbackRate = new FakeAudioParam(context, 1);
    this.detune = new FakeAudioParam(context, 0);
  }
}

export class FakeAudioBuffer {
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number
  ) {
    if (numberOfChannels < 1 || numberOfChannels > 32) {
      throw domError("NotSupportedError", "createBuffer: bad channel count.");
    }
    if (length < 1) {
      throw domError("NotSupportedError", "createBuffer: the length must be 1 or more.");
    }
    if (sampleRate < 3000 || sampleRate > 768000) {
      throw domError("NotSupportedError", "createBuffer: bad sample rate.");
    }
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw domError("IndexSizeError", "getChannelData: bad channel.");
    return data;
  }

  copyToChannel(source: Float32Array, channel: number, offset = 0): void {
    this.getChannelData(channel).set(source.subarray(0, this.length - offset), offset);
  }

  copyFromChannel(target: Float32Array, channel: number, offset = 0): void {
    target.set(this.getChannelData(channel).subarray(offset, offset + target.length));
  }
}

/** The WebKit-only "interrupted" state is part of the union on purpose. */
export type FakeAudioContextState = "suspended" | "running" | "interrupted" | "closed";

export type FakeAudioContextOptions = {
  /** The state the context starts in. A browser starts "suspended". */
  initialState?: FakeAudioContextState;
  /** When false, resume() rejects with NotAllowedError (no user gesture). */
  resumeAllowed?: boolean;
  sampleRate?: number;
};

/**
 * A fake AudioContext. `new FakeAudioContext()` works on its own; use
 * installAudioMock() to put it on window so code under test finds it.
 */
export class FakeAudioContext extends EventTarget {
  readonly sampleRate: number;
  readonly baseLatency = 0.005;
  readonly outputLatency = 0.02;
  onstatechange: ((event: Event) => void) | null = null;
  /** Test control: when false, resume() rejects with NotAllowedError. */
  resumeAllowed: boolean;
  readonly audioWorklet = {
    /** URLs passed to addModule(), in call order. */
    modules: [] as string[],
    addModule: vi.fn(async (url: string | URL): Promise<void> => {
      this.audioWorklet.modules.push(String(url));
    }),
  };

  private currentState: FakeAudioContextState;
  private time = 0;
  private readonly speakers: FakeAudioDestinationNode;

  constructor(options: FakeAudioContextOptions = {}) {
    super();
    this.currentState = options.initialState ?? "suspended";
    this.resumeAllowed = options.resumeAllowed ?? true;
    this.sampleRate = options.sampleRate ?? 48000;
    this.speakers = new FakeAudioDestinationNode(this);
  }

  /** A prototype getter, the same shape as BaseAudioContext.destination. */
  get destination(): FakeAudioDestinationNode {
    return this.speakers;
  }

  get state(): FakeAudioContextState {
    return this.currentState;
  }

  get currentTime(): number {
    return this.time;
  }

  /** Test control: move the audio clock forward. */
  advanceTime(seconds: number): void {
    this.time += seconds;
  }

  /** Test control: set the state now and fire "statechange". */
  simulateState(state: FakeAudioContextState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    const event = new Event("statechange");
    this.dispatchEvent(event);
    this.onstatechange?.(event);
  }

  /** Test control: an iOS interruption (a phone call, Siri, the lock screen). */
  interrupt(): void {
    if (this.currentState !== "closed") this.simulateState("interrupted");
  }

  resume = vi.fn((): Promise<void> => {
    if (this.currentState === "closed") {
      return Promise.reject(domError("InvalidStateError", "resume: the context is closed."));
    }
    if (!this.resumeAllowed) {
      return Promise.reject(domError("NotAllowedError", "resume: a user gesture is needed."));
    }
    return Promise.resolve().then(() => {
      if (this.currentState !== "closed") this.simulateState("running");
    });
  });

  suspend = vi.fn((): Promise<void> => {
    if (this.currentState === "closed") {
      return Promise.reject(domError("InvalidStateError", "suspend: the context is closed."));
    }
    return Promise.resolve().then(() => {
      if (this.currentState !== "closed") this.simulateState("suspended");
    });
  });

  close = vi.fn((): Promise<void> => {
    return Promise.resolve().then(() => this.simulateState("closed"));
  });

  createGain = vi.fn(() => new FakeGainNode(this));
  createOscillator = vi.fn(() => new FakeOscillatorNode(this));
  createBufferSource = vi.fn(() => new FakeAudioBufferSourceNode(this));
  createBiquadFilter = vi.fn(() => new FakeBiquadFilterNode(this));
  createDynamicsCompressor = vi.fn(() => new FakeDynamicsCompressorNode(this));
  createWaveShaper = vi.fn(() => new FakeWaveShaperNode(this));
  createStereoPanner = vi.fn(() => new FakeStereoPannerNode(this));
  createBuffer = vi.fn(
    (numberOfChannels: number, length: number, sampleRate: number) =>
      new FakeAudioBuffer(numberOfChannels, length, sampleRate)
  );
  /** Every buffer passed to decodeAudioData(), in call order. */
  readonly decoded: ArrayBuffer[] = [];
  /** Resolves one second of stereo silence. */
  decodeAudioData = vi.fn(async (data: ArrayBuffer): Promise<FakeAudioBuffer> => {
    this.decoded.push(data);
    return new FakeAudioBuffer(2, this.sampleRate, this.sampleRate);
  });
  getOutputTimestamp = vi.fn(() => ({
    contextTime: this.time,
    performanceTime: typeof performance !== "undefined" ? performance.now() : 0,
  }));
}

/** True when `from` sends straight into `to`. */
export function isConnected(from: FakeAudioNode, to: FakeEdgeTarget): boolean {
  return from.outputs.has(to);
}

/** True when sound from `from` reaches `to` through any chain of nodes. */
export function pathExists(from: FakeAudioNode, to: FakeEdgeTarget): boolean {
  const seen = new Set<FakeEdgeTarget>();
  const queue: FakeEdgeTarget[] = [from];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === to) return true;
    if (seen.has(node) || !(node instanceof FakeAudioNode)) continue;
    seen.add(node);
    for (const next of node.outputs) queue.push(next);
  }
  return false;
}

export type AudioMock = {
  /** Every context that code under test created, in order. */
  contexts: FakeAudioContext[];
  /** The newest context. Throws when code under test made none. */
  lastContext(): FakeAudioContext;
  /** When false, resume() rejects on every context, now and later. */
  setResumeAllowed(allowed: boolean): void;
  /** Let pending resume()/suspend()/close() state changes land. */
  flush(): Promise<void>;
};

export type InstallAudioMockOptions = {
  /** The state a new context starts in. Default "suspended", as in a browser. */
  initialState?: FakeAudioContextState;
  /** Default true. When false, resume() rejects with NotAllowedError. */
  resumeAllowed?: boolean;
  /** Also install window.webkitAudioContext (old Safari). Default false. */
  webkit?: boolean;
  /** Install only window.webkitAudioContext, not window.AudioContext. */
  webkitOnly?: boolean;
  /** Make the constructor throw, the way a browser does at its context limit. */
  constructorThrows?: boolean;
};

/**
 * Install the fake Web Audio API on window. Returns the mock.
 *
 * It also resets the shared game-audio bus (getGameAudio), so each test
 * starts as a fresh page load: no bus, no recorded sound switch. Without
 * this, the second test in a file gets the bus of the first test, and its
 * `contexts` stays empty.
 */
export function installAudioMock(options: InstallAudioMockOptions = {}): AudioMock {
  __unsafeResetGameAudioForTests();
  const contexts: FakeAudioContext[] = [];
  let resumeAllowed = options.resumeAllowed ?? true;
  const initialState = options.initialState ?? "suspended";
  const constructorThrows = options.constructorThrows ?? false;

  class InstalledAudioContext extends FakeAudioContext {
    constructor(contextOptions: FakeAudioContextOptions = {}) {
      if (constructorThrows) {
        throw domError("NotSupportedError", "AudioContext: too many contexts.");
      }
      super({ initialState, resumeAllowed, ...contextOptions });
      contexts.push(this);
    }
  }

  const define = (name: string) =>
    Object.defineProperty(window, name, {
      configurable: true,
      writable: true,
      value: InstalledAudioContext,
    });
  if (!options.webkitOnly) define("AudioContext");
  if (options.webkit || options.webkitOnly) define("webkitAudioContext");

  return {
    contexts,
    lastContext(): FakeAudioContext {
      const last = contexts[contexts.length - 1];
      if (!last) throw new Error("installAudioMock: no AudioContext was created.");
      return last;
    },
    setResumeAllowed(allowed: boolean): void {
      resumeAllowed = allowed;
      for (const context of contexts) context.resumeAllowed = allowed;
    },
    async flush(): Promise<void> {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    },
  };
}

/**
 * Remove the fake API, so the browser looks like one with no Web Audio.
 * It also resets the shared game-audio bus, so no fake context outlives
 * the test.
 */
export function removeAudioMock(): void {
  __unsafeResetGameAudioForTests();
  // @ts-expect-error - removing the fake API to simulate a browser without it
  delete window.AudioContext;
  // @ts-expect-error - removing the fake API to simulate an old browser
  delete window.webkitAudioContext;
}
