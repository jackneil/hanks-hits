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
 *     |-> master -> tap point   (the recording branch: every game sound,
 *     |                          before any mute; a clip recorder
 *     |                          connects here, in a later PR)
 *     |-> app speaker           (one GainNode per app; that game's sound
 *           |                    switch turns it on and off)
 *           -> limiter          (a DynamicsCompressor that stops clipping)
 *           -> destination      (the speakers)
 *
 *   uiOutput -> limiter  (site sounds; never reach the tap point, so they
 *                         never land in a clip)
 *
 * The speaker switch is AFTER the split to the tap point, so a kid who
 * plays with the sound off still gets a clip with the game's sound in it.
 * Each app has its own speaker gain, keyed by the app id before any ":"
 * ("monster-truck:engine" and "monster-truck:music" share the
 * "monster-truck" switch). A mute in one game can therefore never reach
 * another game, even when a game keeps its channel for the whole page.
 *
 * The tap point connects to nothing yet. Nothing pulls it, so it costs
 * nothing until a recorder attaches. A recorder must be a node that the
 * browser pulls (an AudioWorkletNode or a MediaStreamAudioDestinationNode),
 * or it must connect on to the destination through a zero gain.
 *
 * Unlock: browsers keep a new AudioContext silent until a user gesture
 * calls resume(). This module adds one capture-phase listener set on the
 * document when it is first imported (pointerdown, pointerup, touchend,
 * keydown, click). On a gesture, the listener unlocks the bus. When no bus
 * exists yet, it makes one (inside the gesture) only if a mounted game
 * called wantGameAudio(), so a page with no game sound never gets an
 * AudioContext. The listener comes off when the context runs, and goes
 * back on when the context stops running (an iOS interruption, for
 * example). GameStartOverlay also calls unlock() inside the Play tap.
 *
 * Rules for callers:
 * - Get a channel when the game plays its first sound, not on page load:
 *   a context made before a gesture makes the browser log a warning.
 *   Call useEffect(() => wantGameAudio(), []) so the first tap makes and
 *   starts the bus.
 * - Never close the context. It is typed BaseAudioContext, which has no
 *   close(). Call channel.dispose() when the game unmounts.
 * - Do not keep the GameAudio object in a long-lived variable. Call
 *   getGameAudio() when you need it. It is cheap, and it replaces a bus
 *   whose context the browser closed. A kept channel reads
 *   `disposed === true` after that, so get a new one.
 * - getGameAudio() returns null on the server, in a browser with no Web
 *   Audio, and in jsdom tests without the audio mock. Make every sound a
 *   no-op when it returns null.
 * - Record the sound switch with setGameSpeakerEnabled(). It makes no
 *   AudioContext, so it is safe on page load.
 *
 * SSR: importing this module never creates an AudioContext, and the
 * document listener is installed only when `document` exists.
 */

/** "interrupted" is WebKit only: iOS paused the audio (a call, Siri). */
export type GameAudioState = AudioContextState;

/** One game's (or one sub-mix's) way into the bus. */
export interface GameAudioChannel {
  /** The id given to channel(), for example "breakout" or "monster-truck:engine". */
  readonly appId: string;
  /** The app the channel belongs to: the id before any ":", for example "monster-truck". */
  readonly baseAppId: string;
  /** Connect every sound of this channel here, never to ctx.destination. */
  readonly input: GainNode;
  /** The shared context, for making nodes. Never close it. */
  readonly context: BaseAudioContext;
  /**
   * True after dispose(), and after the browser closed the shared context.
   * A disposed channel makes no sound: get a new one from getGameAudio().
   */
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
  /**
   * Make a new channel for `appId`. Each call makes a new GainNode, so a
   * game can make one channel per sub-mix: "monster-truck:engine",
   * "monster-truck:music". Every sub-mix obeys the switch of its app
   * (the id before the ":").
   */
  channel(appId: string): GameAudioChannel;
  /** The same as setGameSpeakerEnabled(appId, enabled). */
  setSpeakerEnabled(appId: string, enabled: boolean): void;
  /** The same as isGameSpeakerEnabled(appId). */
  isSpeakerEnabled(appId: string): boolean;
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

/**
 * The app that owns `appId`: the text before the first ":", trimmed.
 * "monster-truck:engine" -> "monster-truck". Throws on an empty id.
 */
export function baseAppIdOf(appId: string): string {
  if (typeof appId !== "string") {
    throw new TypeError("getGameAudio(): the app id must be a non-empty string.");
  }
  const colon = appId.indexOf(":");
  const base = (colon === -1 ? appId : appId.slice(0, colon)).trim();
  if (base === "") {
    throw new TypeError("getGameAudio(): the app id must be a non-empty string.");
  }
  return base;
}

// ---------------------------------------------------------------------------
// Page-level state. It lives outside the bus, so a game can record its saved
// sound switch, and say that it wants sound, before any AudioContext exists.
// ---------------------------------------------------------------------------

/** Base app ids whose sound switch is off. */
const mutedApps = new Set<string>();
/** How many mounted games called wantGameAudio() and have not let go. */
let wantCount = 0;
type GameAudioCreatedListener = (bus: GameAudio) => void;
const createdListeners = new Set<GameAudioCreatedListener>();

class Channel implements GameAudioChannel {
  private isDisposed = false;

  constructor(
    private readonly hub: GameAudioHub,
    readonly appId: string,
    readonly baseAppId: string,
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

  /** The browser closed the context: the nodes are dead, so only mark it. */
  markClosed(): void {
    this.isDisposed = true;
  }
}

class GameAudioHub implements GameAudio {
  private readonly audioContext: AudioContext;
  private readonly master: GainNode;
  private readonly tap: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly ui: GainNode;
  /**
   * One speaker gain per base app id, made with the app's first channel.
   * A page has a small, fixed set of apps, so these stay for the life of
   * the context. An idle gain with no input costs almost nothing.
   */
  private readonly appSpeakers = new Map<string, GainNode>();
  private readonly channels = new Set<Channel>();
  private readonly stateListeners = new Set<GameAudioStateListener>();
  private primed = false;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.master = audioContext.createGain();
    this.tap = audioContext.createGain();
    this.limiter = audioContext.createDynamicsCompressor();
    this.ui = audioContext.createGain();

    this.limiter.threshold.value = LIMITER_SETTINGS.threshold;
    this.limiter.knee.value = LIMITER_SETTINGS.knee;
    this.limiter.ratio.value = LIMITER_SETTINGS.ratio;
    this.limiter.attack.value = LIMITER_SETTINGS.attack;
    this.limiter.release.value = LIMITER_SETTINGS.release;

    // The recording branch ends at the tap point (see the file comment).
    this.master.connect(this.tap);
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

  /** The node a clip recorder connects to. Internal: see getGameAudioTapPoint(). */
  get tapPoint(): AudioNode {
    return this.tap;
  }

  channel(appId: string): GameAudioChannel {
    const base = baseAppIdOf(appId);
    const input = this.audioContext.createGain();
    input.connect(this.master);
    input.connect(this.speakerFor(base));
    const channel = new Channel(this, appId, base, input);
    this.channels.add(channel);
    return channel;
  }

  setSpeakerEnabled(appId: string, enabled: boolean): void {
    setGameSpeakerEnabled(appId, enabled);
  }

  isSpeakerEnabled(appId: string): boolean {
    return isGameSpeakerEnabled(appId);
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
    this.channels.delete(channel);
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
   * Apply the recorded switch of `base` to its speaker gain, if the app has
   * one yet. While sound plays, fade (a jump clicks). While the context is
   * not running, jump: nothing plays, and a fade would let the first
   * sound after resume() leak through.
   */
  applySpeaker(base: string): void {
    const speaker = this.appSpeakers.get(base);
    if (!speaker) return;
    const target = mutedApps.has(base) ? 0 : 1;
    const gain = speaker.gain;
    const now = this.audioContext.currentTime;
    gain.cancelScheduledValues(now);
    if (this.audioContext.state === "running") {
      gain.setTargetAtTime(target, now, SPEAKER_FADE_TIME_CONSTANT);
    } else {
      gain.setValueAtTime(target, now);
    }
  }

  /** The speaker gain of `base`. A new one starts at the recorded switch. */
  private speakerFor(base: string): GainNode {
    const existing = this.appSpeakers.get(base);
    if (existing) return existing;
    const speaker = this.audioContext.createGain();
    // Set before any sound, so a saved mute holds from the first sound.
    speaker.gain.value = mutedApps.has(base) ? 0 : 1;
    speaker.connect(this.limiter);
    this.appSpeakers.set(base, speaker);
    return speaker;
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
    else installUnlockListeners();
    if (state === "closed") {
      // Every node of a closed context is dead. Mark each kept channel, so
      // a game that keeps one knows to get a new channel.
      for (const channel of this.channels) channel.markClosed();
      this.channels.clear();
      if (hub === this) hub = null;
    }
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
  if (hub) {
    hub.unlock();
    return;
  }
  // No bus yet. Make one only when a mounted game wants sound, and only
  // while the gesture can start it. A page that imports this module but
  // plays no game sound (the home page, through a shared barrel) never
  // gets an AudioContext from a stray tap. getGameAudio() starts a bus
  // that it makes inside a gesture.
  if (wantCount > 0 && inUserGesture()) getGameAudio();
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
  let created: GameAudioHub;
  try {
    context = new AudioContextClass();
    created = new GameAudioHub(context);
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
  hub = created;

  if (created.state === "running") removeUnlockListeners();
  else installUnlockListeners();
  // Made inside a tap (a drum pad, for example)? Start it now, in the same
  // gesture, because the document listener already ran before the tap's
  // own handler made the context.
  if (inUserGesture()) created.unlock();
  for (const listener of [...createdListeners]) {
    try {
      listener(created);
    } catch {
      // One bad listener must not stop the others, or the game.
    }
  }
  return created;
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
 * Say that this page plays game sound. Call it when the game mounts:
 *
 *   useEffect(() => wantGameAudio(), []);
 *
 * It makes no AudioContext. The next tap anywhere on the page makes the
 * bus and starts it inside that tap, so a game with no start card (or one
 * that makes its first channel later, in an effect or a timer) is not
 * silent at the first tap. Returns the function that lets go (the effect
 * cleanup). It is safe to call that function more than once.
 */
export function wantGameAudio(): () => void {
  wantCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    wantCount = Math.max(0, wantCount - 1);
  };
}

/**
 * The game's sound switch. It turns the speakers on or off for one app:
 * the id before any ":" ("monster-truck:engine" -> "monster-truck").
 * Clips still record the sound. It makes no AudioContext, so call it on
 * page load with the saved setting, and again on each tap of the switch.
 * A mute in one game never reaches another game.
 */
export function setGameSpeakerEnabled(appId: string, enabled: boolean): void {
  const base = baseAppIdOf(appId);
  const wasMuted = mutedApps.has(base);
  if (enabled) mutedApps.delete(base);
  else mutedApps.add(base);
  if (wasMuted === !enabled) return;
  if (hub && hub.state !== "closed") hub.applySpeaker(base);
}

/** True when the sound switch of `appId`'s app is on (the default). */
export function isGameSpeakerEnabled(appId: string): boolean {
  return !mutedApps.has(baseAppIdOf(appId));
}

/**
 * The tap point: the node a clip recorder connects to. It carries every
 * game channel and no UI sound, before any sound switch. For the clip
 * service only; a game must never connect to it or read from it.
 *
 * It never makes an AudioContext: it returns null until a game makes the
 * bus. Use onGameAudioCreated() to learn when the bus appears.
 */
export function getGameAudioTapPoint(): AudioNode | null {
  return hub && hub.state !== "closed" ? hub.tapPoint : null;
}

/**
 * Call `listener` with each new bus: now, if a bus exists, and again each
 * time getGameAudio() makes one (also after the browser closed the old
 * context). It never makes an AudioContext. For the clip service, which
 * attaches its recorder to getGameAudioTapPoint(). Returns a function that
 * stops listening.
 */
export function onGameAudioCreated(listener: (bus: GameAudio) => void): () => void {
  createdListeners.add(listener);
  if (hub && hub.state !== "closed") {
    try {
      listener(hub);
    } catch {
      // Same rule as a later call: a bad listener must not break the caller.
    }
  }
  return () => {
    createdListeners.delete(listener);
  };
}

/**
 * Test-only escape hatch: forget the bus, every sound switch, every
 * wantGameAudio() and every onGameAudioCreated() listener, and put the
 * document listener back, as on a fresh page load. installAudioMock()
 * calls it. Never call in app code.
 */
export function __unsafeResetGameAudioForTests(): void {
  removeUnlockListeners();
  hub = null;
  creationFailed = false;
  mutedApps.clear();
  wantCount = 0;
  createdListeners.clear();
  installUnlockListeners();
}

// Installed once, on first import, so a module with no start card still
// unlocks on the first tap. Guarded for the server.
if (typeof document !== "undefined") installUnlockListeners();
