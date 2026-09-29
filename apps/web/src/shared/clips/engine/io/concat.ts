/**
 * Tiers M and V: joins MediaRecorder segments into one file (plan 5, 6.6).
 *
 * The rotating recorders on the main thread (engine/recorder/) make one
 * video segment every few seconds. Each segment is a whole file (MP4 on tier
 * M, WebM on tier V) with its own header and a keyframe first. Two recorders
 * run together only across a hand-off, so neighbor segments overlap by a
 * short time. The main thread sends the segments that cover a clip, each with
 * its window on the capture timeline, and this module:
 *
 * 1. Reads the video of each segment with mediabunny (MP4, or WebM and
 *    Matroska).
 * 2. Puts every packet on the capture timeline: the segment's first video
 *    packet is at segment.startUs, and the other packets keep their distance
 *    from it.
 * 3. Takes the video packets of each window. The first segment starts at its
 *    last keyframe at or before the window start (plan 6.6: a clip starts at a
 *    keyframe, at most one keyframe gap longer). A later segment starts at its
 *    first keyframe. Each window ends before the next segment's first packet,
 *    so a frame that both recorders made across a hand-off is used once.
 * 4. Splices (plan 5.1): every GOP before a splice has at least 2 frames, so
 *    two IDR frames of two encoders never come one after the other (H.264
 *    7.4.3: they could have the same idr_pic_id). A window that ends with a
 *    lone keyframe gives up that frame, and the frame before it is shown for
 *    its time.
 * 5. Takes the game sound of the file's span from the sound source (the io
 *    worker's sound runs, soundStore.ts). The segments hold no sound: one
 *    sound recorder that does not restart records it, so the sound has no
 *    splice at a hand-off.
 * 6. Writes one file: fast-start MP4 for tier M, WebM for tier V. No metadata
 *    tags (plan 10).
 *
 * One track is never written across two decoder configs (plan 6.6). The main
 * thread cuts a clip to the newest segments with the same config (the index
 * tells it the configs); a job that still mixes configs is refused here.
 *
 * Record parts (plan 8.4) use the same join: orderRecordSegments() puts a
 * recording's segments in order, and planRecordParts() splits them at a
 * config change and at the part size limit.
 */

import {
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MATROSKA,
  MP4,
  Mp4OutputFormat,
  Output,
  WEBM,
  WebMOutputFormat,
  type InputFormat,
  type VideoCodec,
} from "mediabunny";
import type { RecorderSegmentRef, SegmentContainer, SegmentIndex, SegmentJob } from "../../protocol";
import { sanitizeAacDescription } from "./aacConfig";
import type { GameSound, SoundPacket } from "./soundStore";

export type ConcatErrorCode =
  | "no-segments"
  | "bad-window"
  | "unreadable"
  | "no-video"
  | "no-keyframe"
  | "mixed-configs"
  | "container"
  | "empty"
  | "muxer";

/** The segments cannot make a valid file. */
export class ConcatError extends Error {
  readonly code: ConcatErrorCode;
  constructor(code: ConcatErrorCode, message: string) {
    super(message);
    this.name = "ConcatError";
    this.code = code;
  }
}

/**
 * Time slack for window checks, in microseconds. The main thread gets
 * keyframe times from indexSegment() and rounds them to whole microseconds,
 * so a keyframe it names can be up to half a microsecond away from the value
 * computed here.
 */
export const WINDOW_SLACK_US = 2;

/**
 * A packet this close before a window's end belongs to the next window. WebM
 * block times are whole milliseconds, so the frame that two recorders both
 * got across a hand-off can sit up to 0.5 ms before the next segment's first
 * frame in the old file. Two frames of one recorder are never this close: a
 * recorder gets at most one frame per display frame (8.3 ms at 120 Hz).
 */
export const FRAME_END_SLACK_US = 1000;

/**
 * AAC needs the packet before the first one that plays (roll distance -1);
 * the MP4 edit list hides it. A packet that ends more than this before the
 * file's start is too far away to be that packet.
 */
export const AAC_PRE_ROLL_US = 50_000;

/** The mediabunny readers for each container. Tier V files are WebM; a Matroska reader also accepts them. */
export const SEGMENT_FORMATS: Readonly<Record<SegmentContainer, InputFormat[]>> = {
  mp4: [MP4],
  webm: [WEBM, MATROSKA],
};

/** The stored mime type of each container. */
export const CONTAINER_MIME: Readonly<Record<SegmentContainer, "video/mp4" | "video/webm">> = {
  mp4: "video/mp4",
  webm: "video/webm",
};

function hex(bytes: AllowSharedBufferSource | undefined): string {
  if (!bytes) return "";
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes as ArrayBuffer);
  let out = "";
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
  return out;
}

/** One string for a video decoder config: equal strings can share one track. */
export function videoConfigKey(config: VideoDecoderConfig): string {
  return `${config.codec}|${config.codedWidth ?? 0}x${config.codedHeight ?? 0}|${hex(config.description)}`;
}

/** One string for an audio decoder config. */
export function audioConfigKey(config: AudioDecoderConfig): string {
  return `${config.codec}|${config.sampleRate}|${config.numberOfChannels}|${hex(config.description)}`;
}

function copyBytes(bytes: AllowSharedBufferSource | undefined): Uint8Array | undefined {
  if (!bytes) return undefined;
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes as ArrayBuffer);
  return view.slice();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** One packet with its time on the capture timeline. */
interface TimedPacket {
  packet: EncodedPacket;
  capUs: number;
  durUs: number;
}

interface ReadSegment {
  videoCodec: VideoCodec;
  videoConfig: VideoDecoderConfig;
  videoKey: string;
  /** Decode order. */
  video: TimedPacket[];
}

async function openSegment(blob: Blob, container: SegmentContainer): Promise<Input> {
  if (!(blob instanceof Blob) || blob.size === 0) throw new ConcatError("unreadable", "the segment has no bytes");
  return new Input({ formats: SEGMENT_FORMATS[container], source: new BlobSource(blob) });
}

/**
 * Reads the video of one segment. startUs: the capture time of its first
 * video packet (0 for an index: times are then measured from that packet).
 * A sound track in the segment is not read.
 */
async function readSegment(blob: Blob, container: SegmentContainer, startUs: number, withData: boolean): Promise<ReadSegment> {
  const input = await openSegment(blob, container);
  try {
    let videoTrack;
    try {
      videoTrack = await input.getPrimaryVideoTrack();
    } catch (error) {
      throw new ConcatError("unreadable", `the segment does not parse: ${describe(error)}`);
    }
    if (!videoTrack) throw new ConcatError("no-video", "the segment has no video track");
    const videoCodec = await videoTrack.getCodec();
    const videoConfig = await videoTrack.getDecoderConfig();
    if (!videoCodec || !videoConfig) throw new ConcatError("unreadable", "the segment's video codec is not known");

    const options = { metadataOnly: !withData };
    const rawVideo: EncodedPacket[] = [];
    for await (const packet of new EncodedPacketSink(videoTrack).packets(undefined, undefined, options)) rawVideo.push(packet);
    if (rawVideo.length === 0) throw new ConcatError("no-video", "the segment has no video packets");
    // The anchor: the first video packet in presentation order.
    let anchor = Infinity;
    for (const p of rawVideo) anchor = Math.min(anchor, p.timestamp);
    const at = (seconds: number) => startUs + Math.round((seconds - anchor) * 1e6);
    const timed = (p: EncodedPacket): TimedPacket => ({ packet: p, capUs: at(p.timestamp), durUs: Math.max(0, Math.round(p.duration * 1e6)) });
    return {
      videoCodec,
      videoConfig,
      videoKey: videoConfigKey(videoConfig),
      video: rawVideo.map(timed),
    };
  } catch (error) {
    if (error instanceof ConcatError) throw error;
    throw new ConcatError("unreadable", `the segment does not parse: ${describe(error)}`);
  } finally {
    input.dispose();
  }
}

/**
 * Reads the keyframes, the packet times and the decoder config of one
 * segment (the "index" command). Packet data is not read.
 */
export async function indexSegment(blob: Blob, container: SegmentContainer): Promise<SegmentIndex> {
  const read = await readSegment(blob, container, 0, false);
  let end = 0;
  for (const p of read.video) end = Math.max(end, p.capUs + p.durUs);
  const keyframesUs = read.video
    .filter((p) => p.packet.type === "key")
    .map((p) => p.capUs)
    .sort((a, b) => a - b);
  return {
    container,
    videoCodec: read.videoConfig.codec,
    videoConfigKey: read.videoKey,
    keyframesUs,
    packetTimesUs: read.video.map((p) => p.capUs).sort((a, b) => a - b),
    durationUs: end,
    videoPackets: read.video.length,
    firstIsKey: read.video[0].packet.type === "key",
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function checkJob(job: SegmentJob): void {
  if (job.container !== "mp4" && job.container !== "webm") {
    throw new ConcatError("container", `"${String(job.container)}" is not a segment container`);
  }
  if (!Array.isArray(job.segments) || job.segments.length === 0) throw new ConcatError("no-segments", "the job has no segments");
  let lastTo = -Infinity;
  job.segments.forEach((s: RecorderSegmentRef, i) => {
    const finite = [s?.startUs, s?.fromUs, s?.toUs].every((v) => typeof v === "number" && Number.isFinite(v));
    if (!finite || !(s.fromUs < s.toUs)) throw new ConcatError("bad-window", `segment ${i} has a bad window`);
    if (s.fromUs < lastTo - WINDOW_SLACK_US) throw new ConcatError("bad-window", `segment ${i} overlaps the window before it`);
    lastTo = s.toUs;
  });
}

/** The video packets of one window, in decode order. */
function pickVideo(read: ReadSegment, fromUs: number, toUs: number, first: boolean): TimedPacket[] {
  const packets = read.video;
  // A window that starts after the segment's last frame has nothing to show from it.
  if (!packets.some((p) => p.capUs + Math.max(1, p.durUs) > fromUs)) return [];
  let start = -1;
  if (first) {
    // The last keyframe at or before the window start; else the first keyframe.
    for (let i = 0; i < packets.length; i++) {
      const p = packets[i];
      if (p.packet.type !== "key") continue;
      if (p.capUs <= fromUs + WINDOW_SLACK_US) start = i;
      else if (start < 0) {
        start = i;
        break;
      } else break;
    }
  } else {
    start = packets.findIndex((p) => p.packet.type === "key" && p.capUs >= fromUs - WINDOW_SLACK_US);
  }
  if (start < 0) return [];
  const out: TimedPacket[] = [];
  for (let i = start; i < packets.length; i++) {
    const p = packets[i];
    if (p.capUs >= toUs - FRAME_END_SLACK_US) {
      // A later keyframe ends the window: nothing after it can be shown before toUs.
      if (p.packet.type === "key") break;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * Applies the splice rule to the windows' packets (plan 5.1): a window that
 * a later window follows must not end with a lone keyframe. That frame goes,
 * and the last frame of the window is then shown up to the next window's
 * first frame. Returns the number of frames that went.
 */
export function applySpliceRule<T extends { capUs: number; durUs: number; key: boolean }>(windows: T[][]): number {
  let dropped = 0;
  // The last window with frames is never changed, so the drops do not depend on each other.
  let lastFull = -1;
  windows.forEach((w, i) => {
    if (w.length > 0) lastFull = i;
  });
  for (let i = 0; i < lastFull; i++) {
    const list = windows[i];
    while (list.length > 0 && list[list.length - 1].key) {
      list.pop();
      dropped++;
    }
  }
  // Each window's last frame is shown up to the next window's first frame.
  for (let i = 0; i < lastFull; i++) {
    const last = windows[i][windows[i].length - 1];
    const next = windows.slice(i + 1).find((w) => w.length > 0);
    if (last && next) last.durUs = Math.max(last.durUs, next[0].capUs - last.capUs);
  }
  return dropped;
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

export interface ConcatResult {
  container: SegmentContainer;
  mime: "video/mp4" | "video/webm";
  bytes: Uint8Array;
  /** Capture time of the first video packet (a keyframe) of the file. */
  startUs: number;
  /** Capture time of the end of the last video packet. */
  endUs: number;
  /**
   * The video length a reader measures, from the packet plan (not from the
   * written file), for the write protocol's check: to the end of the last
   * frame in an MP4 (each sample has its length); to the start of the last
   * frame in a WebM (a block has no length, so the reader stops there). The
   * two differ by the last frame's length, which is long when the game drew
   * nothing for a while.
   */
  videoSec: number;
  hasAudio: boolean;
  /** True when the audio is AAC in MP4 (the roll-group patch applies). */
  aacInMp4: boolean;
  videoPackets: number;
  audioPackets: number;
  /** Frames that the splice rule took out. */
  spliceDrops: number;
  /** The first keyframe and its decoder config, for the poster. */
  firstKey: { data: Uint8Array; config: { codec: string; codedWidth: number; codedHeight: number; description?: Uint8Array } };
}

function supports<T extends string>(list: readonly T[], codec: T): boolean {
  return list.includes(codec);
}

/**
 * The game sound for a span of the capture timeline, or null (no sound).
 * The io worker gives its sound runs (soundStore.ts); Record gives its own
 * copy of the sound.
 */
export type SoundSource = (fromUs: number, toUs: number) => GameSound | null;

/** The sound packets for a file that starts at zeroUs and ends at endUs. */
function soundPlan(sound: GameSound | null, container: SegmentContainer, zeroUs: number, endUs: number): SoundPacket[] {
  if (!sound || sound.packets.length === 0) return [];
  // Sound never runs past the picture. WebM block times cannot be before the
  // first cluster: no sound before the first frame.
  const plan = sound.packets.filter((p) => p.capUs >= zeroUs && p.capUs < endUs);
  if (container === "mp4" && sound.codec === "aac") {
    let pre: SoundPacket | null = null;
    for (const p of sound.packets) if (p.capUs < zeroUs) pre = p;
    if (pre && pre.capUs + pre.durUs > zeroUs - AAC_PRE_ROLL_US) plan.unshift(pre);
  }
  return plan;
}

/**
 * Joins the job's segments into one file, with the sound that `sound` gives
 * for the file's span. Throws ConcatError when the segments cannot make a
 * valid file.
 */
export async function concatSegments(job: SegmentJob, sound: SoundSource | null = null): Promise<ConcatResult> {
  checkJob(job);
  let first: ReadSegment | null = null;
  const windows: TimedPacket[][] = [];

  for (let i = 0; i < job.segments.length; i++) {
    const ref = job.segments[i];
    const read = await readSegment(ref.blob, job.container, ref.startUs, true);
    if (!first) first = read;
    else if (read.videoKey !== first.videoKey) {
      throw new ConcatError("mixed-configs", `segment ${i} has another video config than segment 0`);
    }
    const picked = pickVideo(read, ref.fromUs, ref.toUs, i === 0);
    if (i === 0 && picked.length === 0) throw new ConcatError("no-keyframe", "the first segment has no keyframe in its window");
    // A frame that runs past the window would overlap the next segment's first frame.
    const last = picked[picked.length - 1];
    if (last && last.capUs + last.durUs > ref.toUs) last.durUs = Math.max(0, ref.toUs - last.capUs);
    windows.push(picked);
  }

  const keyed = windows.map((list) => list.map((p) => ({ capUs: p.capUs, durUs: p.durUs, key: p.packet.type === "key", p })));
  const spliceDrops = applySpliceRule(keyed);
  const video: TimedPacket[] = keyed.flat().map((k) => ({ packet: k.p.packet, capUs: k.capUs, durUs: k.durUs }));

  if (!first || video.length === 0) throw new ConcatError("empty", "the segments give no video");
  const zeroUs = video[0].capUs;
  let endUs = zeroUs;
  let lastStartUs = zeroUs;
  for (const p of video) {
    endUs = Math.max(endUs, p.capUs + p.durUs);
    lastStartUs = Math.max(lastStartUs, p.capUs);
  }
  const game = sound ? sound(zeroUs - AAC_PRE_ROLL_US, endUs) : null;
  const audioPlan = soundPlan(game, job.container, zeroUs, endUs);

  const format = job.container === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat();
  if (!supports(format.getSupportedVideoCodecs(), first.videoCodec)) {
    throw new ConcatError("container", `a ${job.container} file cannot hold ${first.videoCodec} video`);
  }
  const audioCodec = game?.codec ?? null;
  const withAudio = audioPlan.length > 0 && !!game && !!audioCodec && supports(format.getSupportedAudioCodecs(), audioCodec);

  const videoConfig: VideoDecoderConfig = {
    codec: first.videoConfig.codec,
    codedWidth: first.videoConfig.codedWidth,
    codedHeight: first.videoConfig.codedHeight,
    ...(first.videoConfig.description ? { description: copyBytes(first.videoConfig.description) } : {}),
    ...(first.videoConfig.colorSpace ? { colorSpace: first.videoConfig.colorSpace } : {}),
  };
  let audioConfig: AudioDecoderConfig | null = null;
  if (withAudio && game) {
    const source = game.config;
    let description = copyBytes(source.description);
    if (source.codec === "mp4a.40.2") {
      // WebKit 302253: an esds in place of the ASC gives a file with no sound. Check it again.
      description = sanitizeAacDescription(description, source.sampleRate, source.numberOfChannels).description;
    }
    audioConfig = {
      codec: source.codec,
      sampleRate: source.sampleRate,
      numberOfChannels: source.numberOfChannels,
      ...(description ? { description } : {}),
    };
  }

  const output = new Output({ format, target: new BufferTarget() });
  const videoSource = new EncodedVideoPacketSource(first.videoCodec);
  output.addVideoTrack(videoSource);
  const audioSource = audioConfig && audioCodec ? new EncodedAudioPacketSource(audioCodec) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  // Explicitly empty: no title, date or other tag can reach the file (plan 10).
  output.setMetadataTags({});

  const sec = (us: number) => (us - zeroUs) / 1e6;
  const audioOut = audioSource ? audioPlan : [];
  try {
    await output.start();
    let v = 0;
    let a = 0;
    while (v < video.length || a < audioOut.length) {
      const nextVideo = v < video.length ? video[v].capUs : Infinity;
      const nextAudio = a < audioOut.length ? audioOut[a].capUs : Infinity;
      if (nextVideo <= nextAudio) {
        const p = video[v];
        await videoSource.add(
          new EncodedPacket(p.packet.data, p.packet.type, sec(p.capUs), p.durUs / 1e6),
          v === 0 ? { decoderConfig: videoConfig } : undefined,
        );
        v++;
      } else {
        const p = audioOut[a];
        await audioSource!.add(
          new EncodedPacket(p.data, p.key ? "key" : "delta", sec(p.capUs), p.durUs / 1e6),
          a === 0 ? { decoderConfig: audioConfig! } : undefined,
        );
        a++;
      }
    }
    videoSource.close();
    audioSource?.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw new ConcatError("muxer", `mediabunny could not write the file: ${describe(error)}`);
  }
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new ConcatError("muxer", "mediabunny returned no bytes");
  return {
    container: job.container,
    mime: CONTAINER_MIME[job.container],
    bytes: new Uint8Array(buffer),
    startUs: zeroUs,
    endUs,
    videoSec: ((job.container === "webm" ? lastStartUs : endUs) - zeroUs) / 1e6,
    hasAudio: audioOut.length > 0,
    aacInMp4: job.container === "mp4" && audioCodec === "aac" && audioOut.length > 0,
    videoPackets: video.length,
    audioPackets: audioOut.length,
    spliceDrops,
    firstKey: {
      data: video[0].packet.data,
      config: {
        codec: videoConfig.codec,
        codedWidth: videoConfig.codedWidth ?? 0,
        codedHeight: videoConfig.codedHeight ?? 0,
        ...(videoConfig.description ? { description: videoConfig.description as Uint8Array } : {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Record parts
// ---------------------------------------------------------------------------

/**
 * Puts a recording's segments in order and makes their windows meet (plan
 * 8.4). The segments can come in any order: two recorders that a pause
 * stopped together in a hand-off give their files in either order.
 *
 * - Sorted by start.
 * - Each window ends at the next segment's window start, so a frame that two
 *   recorders made across a hand-off is used once (also when the old
 *   recorder was stopped by a pause before its hand-off was done).
 * - The recording starts at the latest keyframe at or before the tap
 *   (tapUs) that a segment has: every segment that covers the tap names its
 *   own last keyframe before the tap as its window start, and the segments
 *   whose windows end at or before the latest of those are left out.
 * - A window that is empty after this is left out.
 * `items` carry any extra data (the index keys, the posters) along.
 */
export function orderRecordSegments<T extends { segment: RecorderSegmentRef }>(items: readonly T[], tapUs: number | null): T[] {
  const sorted = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.segment.startUs - b.item.segment.startUs || a.i - b.i)
    .map(({ item }) => ({ ...item, segment: { ...item.segment } }));
  let startUs = -Infinity;
  if (tapUs !== null) {
    for (const { segment } of sorted) if (segment.startUs <= tapUs && segment.fromUs <= tapUs) startUs = Math.max(startUs, segment.fromUs);
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const next = sorted[i + 1].segment;
    const s = sorted[i].segment;
    s.toUs = Math.min(s.toUs, Math.max(next.fromUs, next.startUs));
  }
  return sorted.filter(({ segment }) => segment.toUs > segment.fromUs && segment.toUs > startUs);
}

/**
 * Splits a recording's segments (in order, from orderRecordSegments()) into
 * parts (plan 8.4, the same rules as the Record tee). A new part starts:
 * - at a segment with another video config (plan 6.6: one track never spans
 *   two configs);
 * - before a segment that would make the part larger than maxBytes. A
 *   segment larger than maxBytes is a part of its own.
 * The first segment of each later part starts at its own first packet (a
 * keyframe). No segment is dropped.
 */
export function planRecordParts(segments: readonly RecorderSegmentRef[], videoKeys: readonly string[], maxBytes: number): RecorderSegmentRef[][] {
  const parts: RecorderSegmentRef[][] = [];
  let part: RecorderSegmentRef[] = [];
  let bytes = 0;
  let video: string | null = null;
  segments.forEach((segment, i) => {
    const size = segment.blob.size;
    const key = videoKeys[i];
    const otherVideo = video !== null && key !== video;
    const tooBig = part.length > 0 && bytes + size > maxBytes;
    if (part.length > 0 && (otherVideo || tooBig)) {
      parts.push(part);
      part = [];
      bytes = 0;
      video = null;
    }
    // A later part starts at the first packet of its first segment (a keyframe).
    part.push(part.length === 0 && parts.length > 0 ? { ...segment, fromUs: Math.max(segment.fromUs, segment.startUs) } : segment);
    bytes += size;
    video = key;
  });
  if (part.length > 0) parts.push(part);
  return parts;
}
