/**
 * The clip audio tap on the main thread (plan 6.3, 6.4).
 *
 * attach(port) puts an AudioWorkletNode (public/clips/tap-worklet.js) on the
 * game-audio bus's tap point: every game sound, before the sound switch, so a
 * kid who plays muted still gets a clip with the game's sound. The worklet
 * posts PcmBatch messages straight to the encode worker on `port`.
 *
 * - The bus may not exist yet (no game sound so far). The tap then waits on
 *   onGameAudioCreated and never makes an AudioContext itself.
 * - The node must be pulled by the audio graph, so it connects on to the
 *   speakers through a gain of 0 (silent).
 * - Clock anchors (ClockAnchor): performance.now() and ctx.currentTime, read
 *   one after the other in one task, at attach, every ANCHOR_INTERVAL_MS
 *   (plan 6.4: every 250 ms, which the mixer's clock filter expects) and at
 *   each context state change. Production time only: never
 *   getOutputTimestamp, because Bluetooth latency would leak into the clip.
 *   The page bus is in the page realm, so timeOriginOffsetMs is 0.
 * - The tap exists only while capture runs (the engine attaches it after arm
 *   and detaches it at disarm), so clips-off pages pay nothing.
 * - suspend() (the game went away and its ring is kept, engine park()): the
 *   worklet posts its part batch, and the node leaves the audio graph, so it
 *   renders nothing and no game sound goes to the encode worker. The node and
 *   its port stay. resume() puts the node back and starts the anchors again.
 *   The next batch has the stream clock of that moment, so the mixer sees the
 *   gap and starts over (it never places old samples at a new time).
 * - The port is transferred to the worklet, so one attach feeds one context.
 *   If the browser closes the bus context and the bus makes a new one, the
 *   old stream is marked closed and clips have no game sound until the next
 *   arm. The shared bus never closes its context itself.
 *
 * A game with no sound gives no bus: the encode worker's mixer then makes
 * silence, and the clip has a silent sound track.
 */

import { getGameAudioTapPoint, onGameAudioCreated, type GameAudio } from "@/shared/lib/audio/gameAudio";
import { startIframeGameAudioCapture, type IframeAudioCapture } from "@/shared/lib/audio/iframeCapture";
import type { ClockAnchor } from "../protocol";

export const TAP_WORKLET_URL = "/clips/tap-worklet.js";
export const TAP_PROCESSOR = "hh-clip-tap";
export const ANCHOR_INTERVAL_MS = 250;
export const PAGE_STREAM_ID = "page";

/** The parts of an AudioWorkletNode the tap uses. */
export interface TapNode {
  readonly port: { postMessage(message: unknown, transfer?: Transferable[]): void };
  connect(destination: AudioNode): unknown;
  disconnect(): void;
}

/** The parts of the shared bus the tap uses. */
export interface TapBusApi {
  getTapPoint(): AudioNode | null;
  onCreated(listener: (bus: Pick<GameAudio, "context" | "onStateChange">) => void): () => void;
}

export interface AudioTapDeps {
  bus?: TapBusApi;
  createNode?: (context: BaseAudioContext) => TapNode;
  workletUrl?: string;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  log?: (message: string) => void;
}

export interface AnchorSink {
  postAnchor(anchor: ClockAnchor): void;
}

const NODE_OPTIONS: AudioWorkletNodeOptions = {
  numberOfInputs: 1,
  numberOfOutputs: 1,
  outputChannelCount: [1],
  channelCount: 2,
  channelCountMode: "explicit",
  channelInterpretation: "speakers",
};

function anchorState(state: string): ClockAnchor["state"] {
  return state === "running" || state === "suspended" || state === "interrupted" || state === "closed" ? state : "suspended";
}

const defaultBus: TapBusApi = { getTapPoint: getGameAudioTapPoint, onCreated: onGameAudioCreated };

export class AudioTap {
  private readonly bus: TapBusApi;
  private readonly includeIframes: boolean;
  private iframeCapture: IframeAudioCapture | null = null;
  private readonly createNode: (context: BaseAudioContext) => TapNode;
  private readonly workletUrl: string;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly log: (message: string) => void;
  /** addModule runs once per context. */
  private readonly modules = new WeakMap<BaseAudioContext, Promise<void>>();

  private port: MessagePort | null = null;
  private sink: AnchorSink | null = null;
  private context: BaseAudioContext | null = null;
  private node: TapNode | null = null;
  private zero: GainNode | null = null;
  private tap: AudioNode | null = null;
  private timer: unknown = null;
  private unsubscribeCreated: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;
  private generation = 0;
  /** The port of this attach went to a worklet (it cannot be used again). */
  private portGiven = false;
  /** suspend(): the node is out of the graph until resume(). */
  private suspended = false;

  constructor(deps: AudioTapDeps = {}) {
    this.bus = deps.bus ?? defaultBus;
    this.includeIframes = deps.bus === undefined;
    this.createNode = deps.createNode ?? ((context) => new AudioWorkletNode(context, TAP_PROCESSOR, NODE_OPTIONS) as unknown as TapNode);
    this.workletUrl = deps.workletUrl ?? TAP_WORKLET_URL;
    this.now = deps.now ?? (() => performance.now());
    this.setTimer = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    this.log = deps.log ?? ((m) => console.warn(m));
  }

  /** True while the worklet feeds the encode worker. */
  get live(): boolean {
    return this.node !== null && !this.suspended;
  }

  /** Start: PCM goes on `port` (to the encode worker), anchors go to `sink`. */
  attach(port: MessagePort, sink: AnchorSink): void {
    this.detach();
    this.port = port;
    this.sink = sink;
    const generation = ++this.generation;
    this.unsubscribeCreated = this.bus.onCreated((bus) => {
      if (generation !== this.generation) return;
      void this.connect(bus, generation);
    });
    if (this.includeIframes) this.iframeCapture = startIframeGameAudioCapture();
  }

  /** Stop: the worklet posts its last part batch and ends; the nodes leave the graph. */
  detach(): void {
    this.generation++;
    this.iframeCapture?.dispose();
    this.iframeCapture = null;
    this.unsubscribeCreated?.();
    this.unsubscribeCreated = null;
    this.teardownNode(false);
    this.port = null;
    this.sink = null;
    this.portGiven = false;
    this.suspended = false;
  }

  /** Pause the tap: no rendering and no PCM until resume(). The node and its port stay (see the file comment). */
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.iframeCapture?.suspend();
    this.stopAnchors();
    const node = this.node;
    if (!node) return;
    try {
      // The part batch goes now, with its own first frame, before the gap.
      node.port.postMessage({ t: "flush" });
    } catch {
      // The worklet is gone with its context.
    }
    this.disconnectGraph(node);
  }

  /** Start the tap again after suspend(). */
  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.iframeCapture?.resume();
    const node = this.node;
    if (!node) return;
    if (!this.connectGraph(node)) return;
    this.startAnchors();
  }

  private async connect(bus: Pick<GameAudio, "context" | "onStateChange">, generation: number): Promise<void> {
    const context = bus.context;
    if (this.context === context) return;
    if (this.portGiven) {
      // A new bus context: the port went to the old worklet (see the file comment).
      if (this.node) {
        this.teardownNode(true);
        this.log("[clips] the game sound bus was replaced; clips have no game sound until capture starts again");
      }
      return;
    }
    const port = this.port;
    if (!port) return;
    this.context = context;
    try {
      let ready = this.modules.get(context);
      if (!ready) {
        ready = context.audioWorklet.addModule(this.workletUrl);
        this.modules.set(context, ready);
        ready.catch(() => this.modules.delete(context));
      }
      await ready;
    } catch (error) {
      this.log(`[clips] the audio tap could not load (${(error as { name?: string } | null)?.name ?? "Error"}); clips have no game sound`);
      if (generation === this.generation) this.context = null;
      return;
    }
    if (generation !== this.generation || this.context !== context) return;
    const tap = this.bus.getTapPoint();
    if (!tap || tap.context !== context) {
      this.context = null;
      return;
    }
    let node: TapNode;
    try {
      node = this.createNode(context);
      const zero = context.createGain();
      zero.gain.value = 0;
      this.zero = zero;
    } catch (error) {
      this.log(`[clips] the audio tap could not start (${(error as { name?: string } | null)?.name ?? "Error"})`);
      this.context = null;
      return;
    }
    this.tap = tap;
    // A suspended tap gets its node now, but joins the graph only at resume().
    if (!this.suspended && !this.connectGraph(node)) {
      this.tap = null;
      this.zero = null;
      this.context = null;
      return;
    }
    this.node = node;
    this.portGiven = true;
    node.port.postMessage({ t: "port", port, streamId: PAGE_STREAM_ID }, [port]);
    this.unsubscribeState = bus.onStateChange(() => this.postAnchor());
    if (!this.suspended) this.startAnchors();
  }

  /** Puts the node in the graph: the tap point feeds it, and it feeds the speakers through a gain of 0. */
  private connectGraph(node: TapNode): boolean {
    const zero = this.zero;
    const tap = this.tap;
    const context = this.context;
    if (!zero || !tap || !context) return false;
    try {
      node.connect(zero);
      zero.connect(context.destination);
      tap.connect(node as unknown as AudioNode);
      return true;
    } catch (error) {
      this.log(`[clips] the audio tap could not start (${(error as { name?: string } | null)?.name ?? "Error"})`);
      this.disconnectGraph(node);
      return false;
    }
  }

  /** Takes the node out of the graph, so the audio thread renders nothing for it. */
  private disconnectGraph(node: TapNode): void {
    try {
      this.tap?.disconnect(node as unknown as AudioNode);
    } catch {
      // Already disconnected.
    }
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      this.zero?.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  private startAnchors(): void {
    this.stopAnchors();
    this.postAnchor();
    this.timer = this.setTimer(() => this.postAnchor(), ANCHOR_INTERVAL_MS);
  }

  private stopAnchors(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  /** Reads the two clocks one after the other, in one task, and posts the pair. */
  private postAnchor(): void {
    const context = this.context;
    const sink = this.sink;
    if (!context || !sink || !this.node || this.suspended) return;
    const perfMs = this.now();
    const ctxTimeSec = context.currentTime;
    sink.postAnchor({
      t: "anchor",
      streamId: PAGE_STREAM_ID,
      perfMs,
      ctxTimeSec,
      timeOriginOffsetMs: 0,
      state: anchorState(context.state),
    });
  }

  private teardownNode(markClosed: boolean): void {
    this.stopAnchors();
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    const node = this.node;
    if (node && markClosed && this.sink && this.context) {
      this.sink.postAnchor({
        t: "anchor",
        streamId: PAGE_STREAM_ID,
        perfMs: this.now(),
        ctxTimeSec: this.context.currentTime,
        timeOriginOffsetMs: 0,
        state: "closed",
      });
    }
    if (node) {
      try {
        node.port.postMessage({ t: "stop" });
      } catch {
        // The worklet is gone with its context.
      }
      this.disconnectGraph(node);
    } else {
      try {
        this.zero?.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.node = null;
    this.zero = null;
    this.tap = null;
    this.context = null;
  }
}
