/**
 * The shared game audio bus: one AudioContext for every game and app.
 *
 * Why one bus: a gameplay clip must record the game's own sound, and a
 * recorder can only hear a sound that passes through a node it can reach.
 * When each game makes its own AudioContext and plays straight to
 * `ctx.destination`, no recorder can hear it. Every game therefore gets a
 * channel on this bus and connects its sounds to `channel.input`.
 *
 * The graph:
 *
 *   channel.input (one per channel() call)
 *     -> master
 *     -> tap point   (a clip recorder listens here, in a later PR)
 *     -> speaker     (the game's sound switch turns this on and off)
 *     -> limiter     (a DynamicsCompressor that stops harsh clipping)
 *     -> destination (the speakers)
 *
 *   uiOutput -> limiter  (site sounds; never reach the tap point, so they
 *                         never land in a clip)
 *
 * The speaker gain sits AFTER the tap point. A kid who plays with the
 * sound off still gets a clip with the game's sound in it.
 *
 * Unlock: browsers keep a new AudioContext silent until a user gesture
 * calls resume(). This module adds one capture-phase listener set on the
 * document when it is first imported (pointerdown, pointerup, touchend,
 * keydown, click). The listener calls unlock() on the bus, so a game with
 * no start card also gets sound on the first tap. The listener comes off
 * when the context runs, and goes back on when the context stops running
 * (an iOS interruption, for example). GameStartOverlay also calls unlock()
 * inside the Play tap, so a game that starts its sound later (in an
 * effect, not in the tap) is not silent on an iPhone.
 *
 * Rules for callers:
 * - Never close the context. It is typed BaseAudioContext, which has no
 *   close(). Call channel.dispose() when the game unmounts.
 * - Do not keep the GameAudio object in a long-lived variable. Call
 *   getGameAudio() when you need it. It is cheap, and it replaces a bus
 *   whose context the browser closed.
 * - getGameAudio() returns null on the server, in a browser with no Web
 *   Audio, and in jsdom tests without the audio mock. Make every sound a
 *   no-op when it returns null.
 *
 * SSR: importing this module never creates an AudioContext, and the
 * document listener is installed only when `document` exists.
 */

/** "interrupted" is WebKit only: iOS paused the audio (a call, Siri). */
export type GameAudioState = AudioContextState;

/** One game's (or one sub-mix's) way into the bus. */
export interface GameAudioChannel {
  /** The app id given to channel(), for example "breakout". */
  readonly appId: string;
  /** Connect every sound of this channel here, never to ctx.destination. */
  readonly input: GainNode;
  /** The shared context, for making nodes. Never close it. */
  readonly context: BaseAudioContext;
  /** True after dispose(). */
  readonly disposed: boolean;
  /**
   * Take this channel off the bus: a short fade, then a disconnect.
   * Safe to call more than once. Call it when the game unmounts.
   */
  dispose(): void;
}

export type GameAudioStateListener = (state: GameAudioState) => void;

export interface GameAudio {
  /** The shared context. BaseAudioContext on purpose: callers cannot close it. */
  readonly context: BaseAudioContext;
  /** The context state: "suspended", "running", "interrupted" or "closed". */
  readonly state: GameAudioState;
  /**
   * Site sounds (a button click, a toast chime) connect here. This path
   * skips the tap point, so these sounds never land in a clip.
   */
  readonly uiOutput: AudioNode;
  /** True when game sound reaches the speakers right now. */
  readonly speakerEnabled: boolean;
  /**
   * Make a new channel for `appId`. Each call makes a new GainNode, so a
   * game can make one channel per sub-mix (engine, music, effects).
   */
  channel(appId: string): GameAudioChannel;
  /**
   * The game's sound switch. It turns the speakers on or off for `appId`
   * only. The newest live channel decides which app is on screen, so a
   * mute in one game never leaks into the next game. Clips still record
   * the sound.
   */
  setSpeakerEnabled(appId: string, enabled: boolean): void;
  /**
   * Start the sound. Call it synchronously inside a user gesture handler
   * (a tap or a key press), never from an effect or a timer.
   */
  unlock(): void;
  /** Listen for state changes. Returns a function that stops listening. */
  onStateChange(listener: GameAudioStateListener): () => void;
}

/**
 * Safety limiter settings. A hard knee at -1 dBFS with a 20:1 ratio stops
 * stacked sounds (multi-ball bounces, bomb chains) from clipping. The
 * Web Audio compressor adds a small make-up gain ((1 / full-range gain) ^
 * 0.6, about +0.6 dB here), so the threshold stays close to 0 dBFS to keep
 * every game at its old loudness.
 */
export const LIMITER_SETTINGS = Object.freeze({
  threshold: -1,
  knee: 0,
  ratio: 20,
  attack: 0.001,
  release: 0.1,
});

/** The gesture events that may start audio. See the HTML spec's list of
 * activation-triggering input events: a touch pointerdown does not count,
 * but a touch pointerup and a touchend do. "click" covers assistive tech
 * that sends only a click. */
export const UNLOCK_EVENTS = Object.freeze([
  "pointerdown",
  "pointerup",
  "touchend",
  "keydown",
  "click",
] as const);

/** Seconds: the speaker fade when a kid flips a sound switch (no click). */
const SPEAKER_FADE_TIME_CONSTANT = 0.012;
/** Seconds: the fade before a disposed channel disconnects. */
const DISPOSE_FADE_TIME_CONSTANT = 0.008;
/** Milliseconds: wait for the dispose fade to finish before the disconnect. */
const DISPOSE_DISCONNECT_DELAY_MS = 60;

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

function noop(): void {}

/** Call resume() and swallow its rejection. It can throw in old engines. */
function safeResume(context: AudioContext): void {
  try {
    const pending = context.resume();
    if (pending && typeof pending.catch === "function") pending.catch(noop);
  } catch {
    // An old engine can throw synchronously. The next gesture tries again.
  }
}

/** True when the page is handling a user gesture right now. Unknown = true. */
function inUserGesture(): boolean {
  if (typeof navigator === "undefined") return false;
  const activation = (navigator as Navigator & { userActivation?: UserActivation })
    .userActivation;
  return activation ? activation.isActive : true;
}

function findAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  return typeof candidate === "function" ? (candidate as AudioContextConstructor) : null;
}

/**
 * The error's type name only (for example "NotSupportedError"), never its
 * message. A DOMException is not always `instanceof Error` (jsdom), so
 * read the name directly, and accept a plain identifier only.
 */
function errorTypeName(error: unknown): string {
  const name =
    error !== null && typeof error === "object" ? (error as { name?: unknown }).name : undefined;
  return typeof name === "string" && /^[A-Za-z]{1,64}$/.test(name) ? name : "unknown error";
}

function assertAppId(appId: unknown): asserts appId is string {
  if (typeof appId !== "string" || appId.trim() === "") {
    throw new TypeError("getGameAudio(): the app id must be a non-empty string.");
  }
}

class Channel implements GameAudioChannel {
  private isDisposed = false;

  constructor(
    private readonly hub: GameAudioHub,
    readonly appId: string,
    readonly input: GainNode
  ) {}

  get context(): BaseAudioContext {
    return this.hub.context;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.hub.releaseChannel(this);
  }
}

class GameAudioHub implements GameAudio {
  private readonly audioContext: AudioContext;
  private readonly master: GainNode;
  private readonly tap: GainNode;
  private readonly speaker: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly ui: GainNode;
  /** Live channels, oldest first. The newest one decides the active app. */
  private readonly channels: Channel[] = [];
  private readonly mutedApps = new Set<string>();
  private readonly stateListeners = new Set<GameAudioStateListener>();
  private speakerOn = true;
  private primed = false;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.master = audioContext.createGain();
    this.tap = audioContext.createGain();
    this.speaker = audioContext.createGain();
    this.limiter = audioContext.createDynamicsCompressor();
    this.ui = audioContext.createGain();

    this.limiter.threshold.value = LIMITER_SETTINGS.threshold;
    this.limiter.knee.value = LIMITER_SETTINGS.knee;
    this.limiter.ratio.value = LIMITER_SETTINGS.ratio;
    this.limiter.attack.value = LIMITER_SETTINGS.attack;
    this.limiter.release.value = LIMITER_SETTINGS.release;

    this.master.connect(this.tap);
    this.tap.connect(this.speaker);
    this.speaker.connect(this.limiter);
    this.limiter.connect(audioContext.destination);
    this.ui.connect(this.limiter);

    audioContext.addEventListener("statechange", this.handleStateChange);
  }

  get context(): BaseAudioContext {
    return this.audioContext;
  }

  get state(): GameAudioState {
    return this.audioContext.state;
  }

  get uiOutput(): AudioNode {
    return this.ui;
  }

  get speakerEnabled(): boolean {
    return this.speakerOn;
  }

  /** The node a clip recorder connects to. Internal: see getGameAudioTapPoint(). */
  get tapPoint(): AudioNode {
    return this.tap;
  }

  channel(appId: string): GameAudioChannel {
    assertAppId(appId);
    const input = this.audioContext.createGain();
    input.connect(this.master);
    const channel = new Channel(this, appId, input);
    this.channels.push(channel);
    // A new game is on screen: apply its switch before its first sound.
    this.applySpeaker(false);
    return channel;
  }

  setSpeakerEnabled(appId: string, enabled: boolean): void {
    assertAppId(appId);
    if (enabled) this.mutedApps.delete(appId);
    else this.mutedApps.add(appId);
    this.applySpeaker(true);
  }

  unlock(): void {
    const context = this.audioContext;
    if (context.state === "running" || context.state === "closed") return;
    safeResume(context);
    if (!this.primed) {
      this.primed = true;
      this.startSilentPrimer();
    }
  }

  onStateChange(listener: GameAudioStateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** Called by Channel.dispose(). */
  releaseChannel(channel: Channel): void {
    const index = this.channels.indexOf(channel);
    if (index !== -1) this.channels.splice(index, 1);
    // An older channel may be playing now, so fade (a jump can click).
    this.applySpeaker(true);

    const { input } = channel;
    const disconnect = () => {
      try {
        input.disconnect();
      } catch {
        // Already disconnected.
      }
    };
    if (this.audioContext.state !== "running") {
      disconnect();
      return;
    }
    // Fade out first, so a sound that is still playing does not click.
    try {
      input.gain.cancelScheduledValues(this.audioContext.currentTime);
      input.gain.setTargetAtTime(0, this.audioContext.currentTime, DISPOSE_FADE_TIME_CONSTANT);
    } catch {
      disconnect();
      return;
    }
    setTimeout(disconnect, DISPOSE_DISCONNECT_DELAY_MS);
  }

  /**
   * Speaker on or off. The newest live channel names the app on screen;
   * with no live channel, the speaker is on. `fade` is true for a kid's
   * switch and for a disposed channel (no click), and false when a new
   * channel appears (its first sound must not leak through a fade).
   */
  private applySpeaker(fade: boolean): void {
    const active = this.channels[this.channels.length - 1];
    const on = active === undefined || !this.mutedApps.has(active.appId);
    if (on === this.speakerOn) return;
    this.speakerOn = on;
    const gain = this.speaker.gain;
    const now = this.audioContext.currentTime;
    const target = on ? 1 : 0;
    gain.cancelScheduledValues(now);
    if (fade) gain.setTargetAtTime(target, now, SPEAKER_FADE_TIME_CONSTANT);
    else gain.setValueAtTime(target, now);
  }

  /**
   * Old WebKit only started audio when a source played inside the gesture.
   * Play one silent sample through the UI path (never into a clip).
   */
  private startSilentPrimer(): void {
    try {
      const context = this.audioContext;
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, context.sampleRate);
      source.connect(this.ui);
      source.onended = () => {
        try {
          source.disconnect();
        } catch {
          // Already disconnected.
        }
      };
      source.start(0);
    } catch {
      // The primer is a best-effort extra. resume() already ran.
    }
  }

  private readonly handleStateChange = (): void => {
    const state = this.audioContext.state;
    if (state === "running") removeUnlockListeners();
    else if (state !== "closed") installUnlockListeners();
    if (state === "closed" && hub === this) hub = null;
    for (const listener of [...this.stateListeners]) {
      try {
        listener(state);
      } catch {
        // One bad listener must not stop the others.
      }
    }
  };
}

let hub: GameAudioHub | null = null;
/** Set when the browser refused to build a context. Stops a retry storm. */
let creationFailed = false;
let unlockListenersInstalled = false;

function onUnlockGesture(): void {
  // Only unlock a bus that exists. A page that imports this module but
  // plays no game sound (the home page, through a shared barrel) never
  // gets an AudioContext from a stray tap.
  hub?.unlock();
}

function installUnlockListeners(): void {
  if (unlockListenersInstalled || typeof document === "undefined") return;
  for (const type of UNLOCK_EVENTS) {
    document.addEventListener(type, onUnlockGesture, { capture: true, passive: true });
  }
  unlockListenersInstalled = true;
}

function removeUnlockListeners(): void {
  if (!unlockListenersInstalled || typeof document === "undefined") return;
  for (const type of UNLOCK_EVENTS) {
    document.removeEventListener(type, onUnlockGesture, { capture: true });
  }
  unlockListenersInstalled = false;
}

/**
 * The shared game audio bus. The first call makes the AudioContext.
 * Returns null on the server, in a browser with no Web Audio, or when the
 * browser refuses to make a context.
 */
export function getGameAudio(): GameAudio | null {
  if (hub && hub.state !== "closed") return hub;
  hub = null;
  if (creationFailed) return null;
  const AudioContextClass = findAudioContextConstructor();
  if (!AudioContextClass) return null;

  let context: AudioContext | null = null;
  try {
    context = new AudioContextClass();
    hub = new GameAudioHub(context);
  } catch (error) {
    creationFailed = true;
    hub = null;
    try {
      void context?.close().catch(noop);
    } catch {
      // Nothing more to clean up.
    }
    // Values-free: the error type name only, never page or player data.
    console.warn(
      `[game-audio] no shared AudioContext (${errorTypeName(error)}); game sound is off for this page.`
    );
    return null;
  }

  if (hub.state === "running") removeUnlockListeners();
  else installUnlockListeners();
  // Made inside a tap (a drum pad, for example)? Start it now, in the same
  // gesture, because the document listener already ran before the tap's
  // own handler made the context.
  if (inUserGesture()) hub.unlock();
  return hub;
}

/**
 * Start game sound from inside a user gesture. Never throws. Use it in a
 * Play or a "choose your level" button handler.
 */
export function unlockGameAudio(): void {
  try {
    getGameAudio()?.unlock();
  } catch {
    // Sound must never stop a game from starting.
  }
}

/**
 * The tap point: the node a clip recorder connects to. It carries every
 * game channel and no UI sound, before the speaker switch. For the clip
 * service only; a game must never connect to it or read from it.
 */
export function getGameAudioTapPoint(): AudioNode | null {
  const bus = getGameAudio();
  return bus instanceof GameAudioHub ? bus.tapPoint : null;
}

/**
 * Test-only escape hatch: forget the bus and put the document listener
 * back, as on a fresh page load. Never call in app code.
 */
export function __unsafeResetGameAudioForTests(): void {
  removeUnlockListeners();
  hub = null;
  creationFailed = false;
  installUnlockListeners();
}

// Installed once, on first import, so a module with no start card still
// unlocks on the first tap. Guarded for the server.
if (typeof document !== "undefined") installUnlockListeners();
