/**
 * The game sound of tiers M and V in the io worker (plan 5, 6.3).
 *
 * The rotating video recorders on the main thread record video only. The game
 * sound comes from one audio-only MediaRecorder that does not restart while
 * capture runs: one "run". A run ends only at a pause (capture time stands
 * still then) or when the sound bus changes, so the sound of a clip has no
 * splice at a video hand-off. (Two encoder streams joined packet by packet
 * give a click or a drop-out at each join: each new encoder starts with its
 * own priming and decoder state.)
 *
 * Each run's bytes come in order ("audioAppend"). A streaming reader
 * (soundParse.ts) takes the packets out as they arrive, and this store puts
 * each packet on the capture timeline: the run's first packet is at the
 * run's start (the capture time of its recorder's start() call), and the
 * other packets keep their distance from it.
 *
 * - The store keeps `keepSeconds` of sound (the ring length) for clips.
 * - A clip takes the packets of its span (take()), from one decoder config:
 *   the config of the newest packet in the span. A packet of another config
 *   is left out (a gap in the sound, never a failure).
 * - Record gets every packet of its timeline as it arrives (subscribe()) and
 *   keeps its own copy, so the ring length does not limit a recording.
 * - A new run cuts the older runs of its timeline at its start: two runs
 *   never give sound for the same moment.
 * - A run of a new timeline (a new engine session) makes the older timelines
 *   old: their runs are dropped when their readers finish.
 */

import type { AudioCodec } from "mediabunny";
import type { SegmentContainer } from "../../protocol";
import { audioConfigKey } from "./concat";
import { createSoundParser, type SoundHeader, type SoundParser, type StreamPacket } from "./soundParse";

/** The decoder config of the packets of one run. */
export interface SoundFormat {
  codec: AudioCodec;
  config: AudioDecoderConfig;
  /** Equal keys can share one track. */
  key: string;
}

/** One sound packet on the capture timeline. */
export interface SoundPacket {
  capUs: number;
  durUs: number;
  data: Uint8Array;
  key: boolean;
  format: SoundFormat;
}

/** The sound of a span, in one decoder config. */
export interface GameSound {
  codec: AudioCodec;
  config: AudioDecoderConfig;
  /** Sorted by capUs. */
  packets: SoundPacket[];
}

interface Run {
  id: number;
  timeline: number;
  startUs: number;
  parser: SoundParser;
  format: SoundFormat | null;
  firstTsUs: number | null;
  packets: SoundPacket[];
  /** Packets at or after this time belong to a later run. */
  cutUs: number;
  /** The end of the newest packet, on the capture timeline. */
  reachedUs: number;
  /** The reader stopped: no more packets come. */
  done: boolean;
}

export interface SoundStoreDeps {
  log?: (message: string) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

type Listener = (timeline: number, packet: SoundPacket) => void;

/**
 * The sound packets of `list` in [fromUs, toUs), sorted, in the config of the
 * newest one; other configs and equal times are left out. null: no packet.
 */
export function pickSound(list: readonly SoundPacket[], fromUs: number, toUs: number): GameSound | null {
  const inSpan = list.filter((p) => p.capUs >= fromUs && p.capUs < toUs).sort((a, b) => a.capUs - b.capUs);
  if (inSpan.length === 0) return null;
  const format = inSpan[inSpan.length - 1].format;
  const packets: SoundPacket[] = [];
  let lastUs = Number.NaN;
  for (const p of inSpan) {
    if (p.format.key !== format.key || p.capUs === lastUs) continue;
    lastUs = p.capUs;
    packets.push(p);
  }
  return { codec: format.codec, config: format.config, packets };
}

export class SoundStore {
  private readonly runs = new Map<number, Run>();
  private timeline: number | null = null;
  private keepUs = 60e6;
  private readonly waiters = new Set<() => void>();
  private readonly listeners = new Set<Listener>();
  private readonly log: (message: string) => void;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(deps: SoundStoreDeps = {}) {
    this.log = deps.log ?? (() => undefined);
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Opens a run. A run id that is open already is ignored. */
  open(runId: number, timeline: number, container: SegmentContainer, startUs: number, keepSeconds: number): void {
    if (this.runs.has(runId) || !Number.isFinite(startUs) || !Number.isFinite(timeline)) return;
    if (this.timeline !== timeline) {
      this.timeline = timeline;
      // Older timelines: no clip uses them any more. Their readers finish, then they go.
      this.dropOld();
    }
    if (Number.isFinite(keepSeconds) && keepSeconds > 0) this.keepUs = keepSeconds * 1e6;
    for (const run of this.runs.values()) {
      if (run.timeline === timeline) run.cutUs = Math.min(run.cutUs, startUs);
    }
    const run: Run = {
      id: runId,
      timeline,
      startUs,
      parser: null as unknown as SoundParser,
      format: null,
      firstTsUs: null,
      packets: [],
      cutUs: Infinity,
      reachedUs: startUs,
      done: false,
    };
    run.parser = createSoundParser(container, {
      onHeader: (header) => this.onHeader(run, header),
      onPacket: (packet) => this.onPacket(run, packet),
      onError: (message) => this.log(`[clips] the game sound could not be read (${message}); clips have no sound from here`),
    });
    void run.parser.done.then(() => {
      run.done = true;
      this.dropOld();
      this.wake();
    });
    this.runs.set(runId, run);
  }

  append(runId: number, bytes: ArrayBuffer | Uint8Array): void {
    const run = this.runs.get(runId);
    // A run this worker does not know (it started again): no sound for it.
    if (!run || run.done) return;
    run.parser.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }

  end(runId: number): void {
    this.runs.get(runId)?.parser.end();
  }

  /** Stops every reader and drops every packet (the worker closes). */
  clear(): void {
    for (const run of this.runs.values()) run.parser.cancel();
    this.runs.clear();
    this.timeline = null;
    this.wake();
  }

  /**
   * Settles when the sound of `timeline` reaches untilUs, or when no more
   * sound of it can come (no run is open), or after timeoutMs.
   */
  ready(timeline: number, untilUs: number, timeoutMs: number): Promise<void> {
    if (this.reached(timeline, untilUs)) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: unknown = null;
      const check = () => {
        if (!this.reached(timeline, untilUs)) return;
        finish();
      };
      const finish = () => {
        this.waiters.delete(check);
        if (timer !== null) this.clearTimer(timer);
        resolve();
      };
      this.waiters.add(check);
      timer = this.setTimer(() => {
        this.log(`[clips] the game sound did not arrive in time; the clip has less sound`);
        finish();
      }, timeoutMs);
    });
  }

  /** The sound of `timeline` in [fromUs, toUs), or null. */
  take(timeline: number, fromUs: number, toUs: number): GameSound | null {
    const list: SoundPacket[] = [];
    for (const run of this.runs.values()) {
      if (run.timeline !== timeline) continue;
      for (const p of run.packets) if (p.capUs < run.cutUs) list.push(p);
    }
    return pickSound(list, fromUs, toUs);
  }

  /** Every packet of `timeline` that the store holds now (Record copies them at its start). */
  held(timeline: number): SoundPacket[] {
    const list: SoundPacket[] = [];
    for (const run of this.runs.values()) {
      if (run.timeline !== timeline) continue;
      for (const p of run.packets) if (p.capUs < run.cutUs) list.push(p);
    }
    return list.sort((a, b) => a.capUs - b.capUs);
  }

  /** Hears every new packet (Record). Returns the stop function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------------------------------------------------------------------------

  private reached(timeline: number, untilUs: number): boolean {
    let open = false;
    let reached = -Infinity;
    for (const run of this.runs.values()) {
      if (run.timeline !== timeline) continue;
      if (!run.done) open = true;
      reached = Math.max(reached, Math.min(run.reachedUs, run.cutUs));
    }
    return !open || reached >= untilUs;
  }

  private onHeader(run: Run, header: SoundHeader): void {
    run.format = { codec: header.codec, config: header.config, key: audioConfigKey(header.config) };
  }

  private onPacket(run: Run, packet: StreamPacket): void {
    const format = run.format;
    if (!format) return;
    run.firstTsUs ??= packet.tsUs;
    const capUs = run.startUs + (packet.tsUs - run.firstTsUs);
    run.reachedUs = Math.max(run.reachedUs, capUs + packet.durUs);
    if (capUs >= run.cutUs) {
      this.wake();
      return;
    }
    const sound: SoundPacket = { capUs, durUs: packet.durUs, data: packet.data, key: packet.key, format };
    run.packets.push(sound);
    this.evict(run.timeline);
    for (const listener of [...this.listeners]) {
      try {
        listener(run.timeline, sound);
      } catch {
        // One bad listener must not stop the others.
      }
    }
    this.wake();
  }

  /** Keeps keepUs of sound back from the newest packet of the timeline. */
  private evict(timeline: number): void {
    let newest = -Infinity;
    for (const run of this.runs.values()) if (run.timeline === timeline && run.packets.length > 0) newest = Math.max(newest, run.packets[run.packets.length - 1].capUs);
    const oldest = newest - this.keepUs;
    for (const run of this.runs.values()) {
      if (run.timeline !== timeline) continue;
      let drop = 0;
      while (drop < run.packets.length && run.packets[drop].capUs < oldest) drop++;
      if (drop > 0) run.packets.splice(0, drop);
      if (run.done && run.packets.length === 0) this.runs.delete(run.id);
    }
  }

  /**
   * Drops the runs of older timelines whose readers finished, and ends the
   * others: the main thread sends all sound commands in one ordered chain, so
   * every byte of an older run came before the first run of the new timeline.
   */
  private dropOld(): void {
    for (const run of [...this.runs.values()]) {
      if (run.timeline === this.timeline) continue;
      if (run.done) this.runs.delete(run.id);
      else run.parser.end();
    }
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}
