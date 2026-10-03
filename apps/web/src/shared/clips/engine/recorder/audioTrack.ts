/**
 * The game sound for the MediaRecorder engine (tiers M and V, plan 5, 6.3).
 *
 * The recorders take a MediaStream audio track, so the tap is a
 * MediaStreamAudioDestinationNode on the game-audio bus's tap point: every
 * game sound, before the sound switch, so a kid who plays muted still gets a
 * clip with the game's sound. A destination node is pulled by the audio
 * graph, so it needs no silent path to the speakers.
 *
 * - The bus may not exist yet (no game sound so far). The tap then waits on
 *   onGameAudioCreated and never makes an AudioContext itself. The segments
 *   before the bus have no sound track; the io worker joins them with a gap
 *   in the sound (engine/io/concat.ts).
 * - When the bus appears, or the browser closes its context and the bus
 *   makes a new one, the track changes: onChange tells the engine, which
 *   starts a new segment at once, so the new track is recorded from then on.
 * - suspend() takes the tap out of the graph (the game went away and its ring
 *   is kept): no game sound is recorded. resume() puts it back.
 */

import { startIframeGameAudioCapture, type IframeAudioCapture } from "@/shared/lib/audio/iframeCapture";
import { getGameAudioTapPoint, onGameAudioCreated } from "@/shared/lib/audio/gameAudio";

/** The parts of the shared bus that the tap uses. */
export interface RecorderAudioBus {
  getTapPoint(): AudioNode | null;
  onCreated(listener: (bus: { context: BaseAudioContext }) => void): () => void;
}

export interface RecorderAudioDeps {
  bus?: RecorderAudioBus;
  log?: (message: string) => void;
}

const defaultBus: RecorderAudioBus = { getTapPoint: getGameAudioTapPoint, onCreated: onGameAudioCreated };

type DestinationContext = BaseAudioContext & { createMediaStreamDestination?: () => MediaStreamAudioDestinationNode };

export class RecorderAudio {
  private readonly bus: RecorderAudioBus;
  private readonly includeIframes: boolean;
  private iframeCapture: IframeAudioCapture | null = null;
  private readonly log: (message: string) => void;
  private context: BaseAudioContext | null = null;
  private tap: AudioNode | null = null;
  private node: MediaStreamAudioDestinationNode | null = null;
  private onChange: ((track: MediaStreamTrack | null) => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private suspended = false;
  private connected = false;

  constructor(deps: RecorderAudioDeps = {}) {
    this.bus = deps.bus ?? defaultBus;
    this.includeIframes = deps.bus === undefined;
    this.log = deps.log ?? ((m) => console.warn(m));
  }

  /** The audio track for the next recorder, or null (no bus yet, or no Web Audio). */
  get track(): MediaStreamTrack | null {
    return this.node?.stream.getAudioTracks()[0] ?? null;
  }

  /** Starts the tap. onChange hears each new track (a new bus). */
  attach(onChange: (track: MediaStreamTrack | null) => void): void {
    this.detach();
    this.onChange = onChange;
    this.unsubscribe = this.bus.onCreated((bus) => this.connect(bus.context));
    if (this.includeIframes) this.iframeCapture = startIframeGameAudioCapture();
  }

  /** Stops the tap: the node leaves the graph and its track ends. */
  detach(): void {
    this.iframeCapture?.dispose();
    this.iframeCapture = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.onChange = null;
    this.teardown();
    this.suspended = false;
  }

  /** No game sound is recorded until resume(). The track stays. */
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.iframeCapture?.suspend();
    this.disconnectGraph();
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.iframeCapture?.resume();
    this.connectGraph();
  }

  private connect(context: BaseAudioContext): void {
    if (this.context === context) return;
    const hadTrack = this.node !== null;
    this.teardown();
    const make = (context as DestinationContext).createMediaStreamDestination;
    const tap = this.bus.getTapPoint();
    if (typeof make !== "function" || !tap || tap.context !== context) {
      if (hadTrack) this.onChange?.(null);
      return;
    }
    try {
      this.node = make.call(context);
    } catch (error) {
      this.log(`[clips] the sound tap could not start (${(error as { name?: string } | null)?.name ?? "Error"}); clips have no game sound`);
      if (hadTrack) this.onChange?.(null);
      return;
    }
    this.context = context;
    this.tap = tap;
    if (!this.suspended) this.connectGraph();
    this.onChange?.(this.track);
  }

  private connectGraph(): void {
    if (!this.tap || !this.node || this.connected) return;
    try {
      this.tap.connect(this.node);
      this.connected = true;
    } catch (error) {
      this.log(`[clips] the sound tap could not connect (${(error as { name?: string } | null)?.name ?? "Error"})`);
    }
  }

  private disconnectGraph(): void {
    if (!this.tap || !this.node || !this.connected) return;
    try {
      this.tap.disconnect(this.node);
    } catch {
      // Already disconnected.
    }
    this.connected = false;
  }

  private teardown(): void {
    this.disconnectGraph();
    for (const track of this.node?.stream.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // Already ended.
      }
    }
    this.node = null;
    this.tap = null;
    this.context = null;
  }
}
