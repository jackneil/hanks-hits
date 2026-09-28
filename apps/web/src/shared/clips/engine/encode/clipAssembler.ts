/**
 * Clip assembly (plan 6.6) and the Record tee (plan 8.3, 8.4).
 *
 * assembleClip, on EncodeCmd "clip":
 * - The video end is the end of the newest video packet (or endAtUs, if it
 *   is earlier).
 * - When the AAC watermark (the end of the newest AAC packet) is within
 *   AUDIO_END_TOLERANCE_US of the video end, the clip ends at the watermark:
 *   end = min(video end, AAC watermark), plan 6.4. That is the normal case,
 *   where audio lags video by the mixer latency and the encoder lookahead.
 * - When the audio is further behind (the AAC encoder is still loading, is
 *   catching up, or is stalled), the clip ends at the video end and takes the
 *   audio that exists. The kid's moment is never cut for missing sound. With
 *   no audio packets in range, audioConfig is null, so the clip says it has
 *   no game sounds.
 * - Video starts at the last keyframe at or before (end - seconds), so a clip
 *   is at most one GOP (1 s) longer than asked. With less history, it starts
 *   at the oldest keyframe and coveredSec says so.
 * - Epochs: each older GOP is compared with the newest GOP's epoch (codec,
 *   coded size, avcC bytes and color space). Identical epochs splice by packet
 *   copy. At the first different epoch, the clip starts after it:
 *   cutToNewestEpoch is true and coveredSec is the real length.
 * - Audio starts at the packet nearest the video start, plus one pre-roll
 *   packet before it (AAC needs the previous frame to decode the first one).
 * - Every data buffer is a fresh copy, so the caller can transfer it.
 *
 * Timestamps stay on the capture timeline. The io worker rebases them to
 * startUs. Audio timestamps already include the -P priming shift, so an edit
 * list from them trims the priming (plan 6.4). The encode worker is the only
 * owner of that shift, because P can change from one AAC stream to the next.
 *
 * The Record tee posts the same packets to a port as they are made, one chunk
 * per closed GOP, so the io worker can journal them. The last chunk holds the
 * open GOP and its audio, and is posted when both are complete.
 */

import type { ClipPackets, EpochInfo, PacketDTO, RecordTeeMsg } from "../../protocol";
import { AAC_FRAME, AAC_FRAME_US, clipAudioConfig, frameToUs, type AudioPacket } from "./audio/aac";
import type { GopRing } from "./gopRing";
import { copyEpochInfo, sameDecoderConfig, type VideoPacket } from "./videoSession";

/**
 * The largest audio lag that still trims the clip end to the AAC watermark.
 * Normal lag is about 100-250 ms (mixer latency, tap batch, mix block, encoder
 * lookahead and output delivery). A larger lag means the AAC encoder is not
 * delivering, and the clip keeps its video instead.
 */
export const AUDIO_END_TOLERANCE_US = 500_000;

export interface ClipRequest {
  requestId: string;
  seconds: number;
  endAtUs?: number;
}

export interface AudioSource {
  /** AAC packets, oldest first, contiguous. */
  packets: readonly AudioPacket[];
  /** End frame of the newest packet (-Infinity when empty). */
  endFrame: number;
}

export interface ClipSources {
  ring: GopRing;
  epochInfo: (epoch: number) => EpochInfo | undefined;
  /** null when the session has no audio pipeline (no AAC encoder at all). */
  audio: AudioSource | null;
  primingSamples: number;
}

export interface BuiltClip {
  packets: ClipPackets;
  /** Every ArrayBuffer inside packets, for postMessage transfer. */
  transfer: ArrayBuffer[];
}

export function videoDto(p: VideoPacket): PacketDTO {
  return { kind: "video", type: p.type, tsUs: p.tsUs, durUs: p.durUs, data: p.data.slice(0), epoch: p.epoch };
}

export function audioDto(p: AudioPacket): PacketDTO {
  return { kind: "audio", type: "key", tsUs: frameToUs(p.tsFrames), durUs: AAC_FRAME_US, data: p.data.slice(0), epoch: p.stream };
}

/** Index of the audio packet nearest to tsUs, or -1 when there are none. */
export function nearestAudioIndex(packets: readonly AudioPacket[], tsUs: number): number {
  if (packets.length === 0) return -1;
  let lo = 0;
  let hi = packets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frameToUs(packets[mid].tsFrames) < tsUs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(frameToUs(packets[lo - 1].tsFrames) - tsUs) <= Math.abs(frameToUs(packets[lo].tsFrames) - tsUs)) lo--;
  return lo;
}

/**
 * Audio packets from one pre-roll packet before the one nearest startUs, up
 * to (not including) endUs. Returns none when every packet ends at or before
 * startUs: that audio is older than the clip.
 */
export function selectAudio(packets: readonly AudioPacket[], startUs: number, endUs: number): AudioPacket[] {
  const i = nearestAudioIndex(packets, startUs);
  if (i < 0) return [];
  const last = packets[packets.length - 1];
  if (frameToUs(last.tsFrames + AAC_FRAME) <= startUs) return [];
  const out: AudioPacket[] = [];
  for (let k = Math.max(0, i - 1); k < packets.length; k++) {
    if (frameToUs(packets[k].tsFrames) >= endUs) break;
    out.push(packets[k]);
  }
  return out;
}

function collectTransfers(packets: ClipPackets): ArrayBuffer[] {
  const t: ArrayBuffer[] = [];
  for (const p of packets.video) t.push(p.data);
  for (const p of packets.audio) t.push(p.data);
  for (const e of packets.videoEpochs) t.push(e.description);
  if (packets.audioConfig) t.push(packets.audioConfig.description);
  return t;
}

/** Where a clip ends: at the AAC watermark when audio is close behind, else at the video end. */
export function clipEndUs(videoEndUs: number, audio: AudioSource | null): number {
  if (!audio || !Number.isFinite(videoEndUs) || !Number.isFinite(audio.endFrame)) return videoEndUs;
  const audioEndUs = frameToUs(audio.endFrame);
  return audioEndUs >= videoEndUs - AUDIO_END_TOLERANCE_US ? Math.min(videoEndUs, audioEndUs) : videoEndUs;
}

export function assembleClip(req: ClipRequest, src: ClipSources): BuiltClip {
  const end = clipEndUs(Math.min(src.ring.endUs, req.endAtUs ?? Infinity), src.audio);
  const empty = (): BuiltClip => {
    const packets: ClipPackets = {
      requestId: req.requestId,
      video: [],
      audio: [],
      videoEpochs: [],
      audioConfig: null,
      primingSamples: src.primingSamples,
      startUs: Number.isFinite(end) ? end : 0,
      endUs: Number.isFinite(end) ? end : 0,
      cutToNewestEpoch: false,
      coveredSec: 0,
    };
    return { packets, transfer: collectTransfers(packets) };
  };

  const gops = src.ring.gops;
  if (!Number.isFinite(end) || gops.length === 0) return empty();
  let last = gops.length - 1;
  while (last >= 0 && gops[last].startUs >= end) last--;
  if (last < 0) return empty();

  const target = end - Math.max(0, req.seconds) * 1e6;
  let first = last;
  while (first > 0 && gops[first].startUs > target) first--;

  const newest = src.epochInfo(gops[last].epoch);
  let cut = false;
  for (let i = last - 1; i >= first; i--) {
    const info = src.epochInfo(gops[i].epoch);
    if (!info || !newest || !sameDecoderConfig(info, newest)) {
      first = i + 1;
      cut = true;
      break;
    }
  }

  const video: PacketDTO[] = [];
  const epochs = new Map<number, EpochInfo>();
  outer: for (let g = first; g <= last; g++) {
    for (const p of gops[g].packets) {
      // Decode order: stop at the first packet at or after the end, so no kept frame loses a reference.
      if (p.tsUs >= end) break outer;
      video.push(videoDto(p));
      if (!epochs.has(p.epoch)) {
        const info = src.epochInfo(p.epoch);
        if (info) epochs.set(p.epoch, copyEpochInfo(info));
      }
    }
  }
  const startUs = gops[first].startUs;
  const audio = src.audio ? selectAudio(src.audio.packets, startUs, end).map(audioDto) : [];

  const packets: ClipPackets = {
    requestId: req.requestId,
    video,
    audio,
    videoEpochs: [...epochs.values()],
    // No audio packets: the clip has no game sounds, and says so with a null config.
    audioConfig: audio.length > 0 ? clipAudioConfig() : null,
    primingSamples: src.primingSamples,
    startUs,
    endUs: end,
    cutToNewestEpoch: cut,
    coveredSec: Math.max(0, (end - startUs) / 1e6),
  };
  return { packets, transfer: collectTransfers(packets) };
}

// ---------------------------------------------------------------------------
// Record tee
// ---------------------------------------------------------------------------

/** The part of MessagePort the tee uses. */
export interface TeePort {
  postMessage(message: RecordTeeMsg, transfer: Transferable[]): void;
}

export interface RecordTeeOptions {
  recordingId: string;
  port: TeePort;
  epochInfo: (epoch: number) => EpochInfo | undefined;
  /** Read at each post: the audio setup can finish after the recording starts. */
  primingSamples: () => number;
  /** The audio ring, or null when the session has no audio. */
  audio: AudioSource | null;
  /** The newest GOP in the ring (the open one), so the recording starts at its keyframe. */
  seed: readonly VideoPacket[] | null;
  now: () => number;
  /**
   * True while the capture timeline is live. While paused, the mixer renders
   * whole blocks only and the AAC encoder keeps its lookahead, so the last
   * audio before the stop stays inside until play resumes.
   */
  live?: () => boolean;
}

export interface RecordStopOptions {
  /** Wait for the video tail and the audio of the last frames. Default true. */
  wait?: boolean;
  /**
   * True when every frame before the stop point is out of the encoder. The
   * tee keeps taking video packets before the stop point until then.
   */
  videoTailDone?: () => boolean;
}

/** How long a stopped recording waits for its video tail and the audio of its last frames. */
export const TEE_TAIL_WAIT_MS = 2000;

export class RecordTee {
  readonly recordingId: string;
  private readonly o: RecordTeeOptions;
  private video: VideoPacket[] = [];
  private audio: AudioPacket[] = [];
  /** True once the audio has reached the recording start (the first audio packet is chosen). */
  private audioStarted = false;
  /** Newest packet before the start while waiting: the pre-roll candidate. */
  private preRoll: AudioPacket | null = null;
  private lastAudioTs = -Infinity;
  private started = false;
  private startUs = 0;
  private stopAtUs: number | null = null;
  private stopAtMs = 0;
  private videoTailDone: (() => boolean) | null = null;
  private done = false;
  private chunks = 0;

  constructor(options: RecordTeeOptions) {
    this.o = options;
    this.recordingId = options.recordingId;
    for (const p of options.seed ?? []) this.onVideo(p);
  }

  get finished(): boolean {
    return this.done;
  }

  get chunkCount(): number {
    return this.chunks;
  }

  /**
   * A committed video packet. A keyframe closes the GOP before it and posts
   * it. After Stop, only packets before the stop point are taken.
   */
  onVideo(p: VideoPacket): void {
    if (this.done) return;
    if (this.stopAtUs !== null && p.tsUs >= this.stopAtUs) return;
    if (!this.started) {
      if (p.type !== "key") return;
      this.started = true;
      this.startUs = p.tsUs;
      if (this.o.audio) {
        // Audio made before the start is already in the ring. Take it from one packet before the nearest.
        const ring = this.o.audio.packets;
        const i = nearestAudioIndex(ring, p.tsUs);
        for (let k = Math.max(0, i - 1); i >= 0 && k < ring.length; k++) this.acceptAudio(ring[k]);
      }
    } else if (p.type === "key" && this.video.length > 0) {
      this.post();
    }
    this.video.push(p);
  }

  /** A new AAC packet. */
  onAudio(p: AudioPacket): void {
    if (this.done || !this.started) return;
    this.acceptAudio(p);
  }

  /**
   * Audio starts at the packet nearest the recording start, with one pre-roll
   * packet before it (the same rule as a clip). AAC lags video, so at the
   * start the ring may not reach the keyframe yet. Until it does, keep only
   * the newest packet as the pre-roll candidate.
   */
  private acceptAudio(p: AudioPacket): void {
    if (p.tsFrames <= this.lastAudioTs) return;
    const ts = frameToUs(p.tsFrames);
    if (this.stopAtUs !== null && ts >= this.stopAtUs) return;
    this.lastAudioTs = p.tsFrames;
    if (!this.audioStarted) {
      // The first packet that starts no more than half a packet before the start is the nearest one.
      if (ts < this.startUs - AAC_FRAME_US / 2) {
        this.preRoll = p;
        return;
      }
      this.audioStarted = true;
      if (this.preRoll) this.audio.push(this.preRoll);
      this.preRoll = null;
    }
    this.audio.push(p);
  }

  /**
   * Stops the recording at stopAtUs (the end of the newest frame the encoder
   * took). With wait (the default), the tee keeps taking video packets before
   * that point until the encoder has put them out, and audio until the AAC
   * watermark reaches it. Then it posts the open GOP with its audio as one
   * chunk (never an audio-only chunk), then "end". tick() checks again, and
   * TEE_TAIL_WAIT_MS caps the wait. Without wait, it posts what it has at once.
   */
  stop(stopAtUs: number, options: RecordStopOptions = {}): void {
    if (this.done) return;
    if (!this.started) {
      this.finish(stopAtUs);
      return;
    }
    if (this.stopAtUs === null) {
      this.stopAtUs = stopAtUs;
      this.stopAtMs = this.o.now();
      this.videoTailDone = options.videoTailDone ?? null;
    }
    if (options.wait === false) this.finish(this.stopAtUs);
    else this.tick();
  }

  /** Checks a stopped recording for its video tail and last audio. Returns true when the tee is finished. */
  tick(): boolean {
    if (this.done || this.stopAtUs === null) return this.done;
    const complete = (this.videoTailDone?.() ?? true) && this.audioComplete(this.stopAtUs);
    if (complete || this.o.now() - this.stopAtMs >= TEE_TAIL_WAIT_MS) this.finish(this.stopAtUs);
    return this.done;
  }

  private audioComplete(stopAtUs: number): boolean {
    const a = this.o.audio;
    if (!a) return true;
    const end = Number.isFinite(a.endFrame) ? frameToUs(a.endFrame) : -Infinity;
    if (end >= stopAtUs) return true;
    if (this.o.live && !this.o.live()) {
      // Paused: the last block and the encoder lookahead (about P + 2048 frames) stay inside until play resumes.
      return end >= stopAtUs - frameToUs(this.o.primingSamples() + 2 * AAC_FRAME);
    }
    return false;
  }

  private finish(endUs: number): void {
    if (this.done) return;
    // The open GOP carries the audio that is left. A recording with no video posts no chunk.
    if (this.video.length > 0) this.post();
    this.done = true;
    this.o.port.postMessage({ t: "end", recordingId: this.recordingId, endUs }, []);
  }

  private post(): void {
    const video = this.video.map(videoDto);
    const audio = this.audio.map(audioDto);
    this.video = [];
    this.audio = [];
    const epochs = new Map<number, EpochInfo>();
    for (const p of video) {
      if (epochs.has(p.epoch)) continue;
      const info = this.o.epochInfo(p.epoch);
      if (info) epochs.set(p.epoch, copyEpochInfo(info));
    }
    const startUs = video[0].tsUs;
    const endUs = Math.max(...video.map((p) => p.tsUs + p.durUs));
    const packets: ClipPackets = {
      requestId: this.recordingId,
      video,
      audio,
      videoEpochs: [...epochs.values()],
      audioConfig: this.o.audio ? clipAudioConfig() : null,
      primingSamples: this.o.primingSamples(),
      startUs,
      endUs,
      cutToNewestEpoch: false,
      coveredSec: Math.max(0, (endUs - startUs) / 1e6),
    };
    this.chunks++;
    this.o.port.postMessage({ t: "chunk", recordingId: this.recordingId, packets }, collectTransfers(packets));
  }
}
