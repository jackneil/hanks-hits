/**
 * Tiers M and V: joins MediaRecorder segments into one file (plan 5, 6.6).
 *
 * The rotating recorders on the main thread (engine/recorder/) make one
 * segment every few seconds. Each segment is a whole file (MP4 on tier M,
 * WebM on tier V) with its own header and a keyframe first. Two recorders
 * run together only across a hand-off, so neighbor segments overlap by a
 * short time. The main thread sends the segments that cover a clip, each with
 * its window on the capture timeline, and this module:
 *
 * 1. Reads each segment with mediabunny (MP4, or WebM and Matroska).
 * 2. Puts every packet on the capture timeline: the segment's first video
 *    packet is at segment.startUs, and the other packets keep their distance
 *    from it. Audio uses the same anchor, so the file's own A/V sync stays.
 * 3. Takes the video packets of each window. The first segment starts at its
 *    last keyframe at or before the window start (plan 6.6: a clip starts at a
 *    keyframe, at most one keyframe gap longer). A later segment starts at its
 *    first keyframe. Each window ends before the next segment's first packet,
 *    so a frame that both recorders made across a hand-off is used once.
 * 4. Takes the audio packets of the same windows. A segment with no audio
 *    track (the game had no sound yet) leaves a gap in the sound track.
 * 5. Writes one file: fast-start MP4 for tier M, WebM for tier V. No metadata
 *    tags (plan 10).
 *
 * One track is never written across two decoder configs (plan 6.6). The main
 * thread cuts a clip to the newest segments with the same config (the index
 * tells it the configs); a job that still mixes configs is refused here.
 *
 * Record parts (plan 8.4) use the same join: planRecordParts() splits a
 * recording's segments at a config change and at the part size limit.
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
  type AudioCodec,
  type InputFormat,
  type VideoCodec,
} from "mediabunny";
import type { RecorderSegmentRef, SegmentContainer, SegmentIndex, SegmentJob } from "../../protocol";
import { sanitizeAacDescription } from "./aacConfig";

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
  audioCodec: AudioCodec | null;
  audioConfig: AudioDecoderConfig | null;
  audioKey: string | null;
  /** Decode order. */
  video: TimedPacket[];
  audio: TimedPacket[];
}

async function openSegment(blob: Blob, container: SegmentContainer): Promise<Input> {
  if (!(blob instanceof Blob) || blob.size === 0) throw new ConcatError("unreadable", "the segment has no bytes");
  return new Input({ formats: SEGMENT_FORMATS[container], source: new BlobSource(blob) });
}

/**
 * Reads one segment. startUs: the capture time of its first video packet
 * (null for an index: times are then measured from that packet).
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
    const audioTrack = await input.getPrimaryAudioTrack();
    const audioCodec = audioTrack ? await audioTrack.getCodec() : null;
    const audioConfig = audioTrack && audioCodec ? await audioTrack.getDecoderConfig() : null;

    const options = { metadataOnly: !withData };
    const rawVideo: EncodedPacket[] = [];
    for await (const packet of new EncodedPacketSink(videoTrack).packets(undefined, undefined, options)) rawVideo.push(packet);
    if (rawVideo.length === 0) throw new ConcatError("no-video", "the segment has no video packets");
    // The anchor: the first video packet in presentation order.
    let anchor = Infinity;
    for (const p of rawVideo) anchor = Math.min(anchor, p.timestamp);
    const at = (seconds: number) => startUs + Math.round((seconds - anchor) * 1e6);
    const timed = (p: EncodedPacket): TimedPacket => ({ packet: p, capUs: at(p.timestamp), durUs: Math.max(0, Math.round(p.duration * 1e6)) });

    const audio: TimedPacket[] = [];
    if (audioTrack && audioConfig) {
      for await (const packet of new EncodedPacketSink(audioTrack).packets(undefined, undefined, options)) audio.push(timed(packet));
    }
    return {
      videoCodec,
      videoConfig,
      videoKey: videoConfigKey(videoConfig),
      audioCodec: audioConfig ? audioCodec : null,
      audioConfig: audioConfig ?? null,
      audioKey: audioConfig ? audioConfigKey(audioConfig) : null,
      video: rawVideo.map(timed),
      audio,
    };
  } catch (error) {
    if (error instanceof ConcatError) throw error;
    throw new ConcatError("unreadable", `the segment does not parse: ${describe(error)}`);
  } finally {
    input.dispose();
  }
}

/**
 * Reads the keyframes and decoder configs of one segment (the "index"
 * command). Packet data is not read.
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
    audioConfigKey: read.audioKey,
    keyframesUs,
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
    if (p.capUs >= toUs) {
      // A later keyframe ends the window: nothing after it can be shown before toUs.
      if (p.packet.type === "key") break;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** The audio packets of one window, sorted by time. */
function pickAudio(read: ReadSegment, fromUs: number, toUs: number, keepPreRoll: boolean): TimedPacket[] {
  const sorted = read.audio.slice().sort((a, b) => a.capUs - b.capUs);
  const out: TimedPacket[] = [];
  let preRoll: TimedPacket | null = null;
  let lastUs = Number.NaN;
  for (const p of sorted) {
    if (p.capUs === lastUs) continue;
    lastUs = p.capUs;
    if (p.capUs < fromUs) {
      preRoll = p;
      continue;
    }
    if (p.capUs >= toUs) break;
    out.push(p);
  }
  // AAC needs the packet before the first one that plays (roll distance -1). The edit list hides it.
  if (keepPreRoll && preRoll && preRoll.capUs + preRoll.durUs > fromUs - 50_000) out.unshift(preRoll);
  return out;
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
  /** endUs - startUs, from the packet plan (not from the written file). */
  videoSec: number;
  hasAudio: boolean;
  /** True when the audio is AAC in MP4 (the roll-group patch applies). */
  aacInMp4: boolean;
  videoPackets: number;
  audioPackets: number;
  /** The first keyframe and its decoder config, for the poster. */
  firstKey: { data: Uint8Array; config: { codec: string; codedWidth: number; codedHeight: number; description?: Uint8Array } };
}

function supports<T extends string>(list: readonly T[], codec: T): boolean {
  return list.includes(codec);
}

/**
 * Joins the job's segments into one file. Throws ConcatError when the
 * segments cannot make a valid file.
 */
export async function concatSegments(job: SegmentJob): Promise<ConcatResult> {
  checkJob(job);
  const video: TimedPacket[] = [];
  const audio: TimedPacket[] = [];
  let first: ReadSegment | null = null;
  let audioRef: ReadSegment | null = null;

  for (let i = 0; i < job.segments.length; i++) {
    const ref = job.segments[i];
    const read = await readSegment(ref.blob, job.container, ref.startUs, true);
    if (!first) first = read;
    else if (read.videoKey !== first.videoKey) {
      throw new ConcatError("mixed-configs", `segment ${i} has another video config than segment 0`);
    }
    const isFirst = i === 0;
    const picked = pickVideo(read, ref.fromUs, ref.toUs, isFirst);
    if (isFirst && picked.length === 0) throw new ConcatError("no-keyframe", "the first segment has no keyframe in its window");
    if (picked.length === 0) continue;
    // A frame that runs past the next window would overlap the next segment's first frame.
    const last = picked[picked.length - 1];
    if (last.capUs + last.durUs > ref.toUs) last.durUs = Math.max(0, ref.toUs - last.capUs);
    video.push(...picked);

    if (read.audioConfig && read.audioKey) {
      if (audioRef && read.audioKey !== audioRef.audioKey) {
        throw new ConcatError("mixed-configs", `segment ${i} has another audio config than the segments before it`);
      }
      audioRef ??= read;
      const from = isFirst ? picked[0].capUs : ref.fromUs;
      const keepPreRoll = isFirst && job.container === "mp4" && read.audioCodec === "aac";
      audio.push(...pickAudio(read, from, ref.toUs, keepPreRoll));
    }
  }

  if (!first || video.length === 0) throw new ConcatError("empty", "the segments give no video");
  const zeroUs = video[0].capUs;
  let endUs = zeroUs;
  for (const p of video) endUs = Math.max(endUs, p.capUs + p.durUs);
  // Sound never runs past the picture.
  const audioPlan = audio.filter((p) => p.capUs < endUs);
  if (job.container === "webm") {
    // WebM block times cannot be before the first cluster: drop sound before the first frame.
    while (audioPlan.length > 0 && audioPlan[0].capUs < zeroUs) audioPlan.shift();
  }

  const format = job.container === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat();
  if (!supports(format.getSupportedVideoCodecs(), first.videoCodec)) {
    throw new ConcatError("container", `a ${job.container} file cannot hold ${first.videoCodec} video`);
  }
  const audioCodec = audioRef?.audioCodec ?? null;
  const withAudio = audioPlan.length > 0 && !!audioRef?.audioConfig && !!audioCodec && supports(format.getSupportedAudioCodecs(), audioCodec);

  const videoConfig: VideoDecoderConfig = {
    codec: first.videoConfig.codec,
    codedWidth: first.videoConfig.codedWidth,
    codedHeight: first.videoConfig.codedHeight,
    ...(first.videoConfig.description ? { description: copyBytes(first.videoConfig.description) } : {}),
    ...(first.videoConfig.colorSpace ? { colorSpace: first.videoConfig.colorSpace } : {}),
  };
  let audioConfig: AudioDecoderConfig | null = null;
  if (withAudio && audioRef?.audioConfig) {
    const source = audioRef.audioConfig;
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
          new EncodedPacket(p.packet.data, p.packet.type, sec(p.capUs), p.durUs / 1e6),
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
    videoSec: (endUs - zeroUs) / 1e6,
    hasAudio: audioOut.length > 0,
    aacInMp4: job.container === "mp4" && audioCodec === "aac" && audioOut.length > 0,
    videoPackets: video.length,
    audioPackets: audioOut.length,
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

/** The decoder configs of one segment, from its index. */
export interface SegmentKeys {
  video: string;
  /** null: the segment has no audio track. */
  audio: string | null;
}

/**
 * Splits a recording's segments into parts (plan 8.4, the same rules as the
 * Record tee). A new part starts:
 * - at a segment with another video config, or with another audio config
 *   than the part's earlier segments with audio (plan 6.6: one track never
 *   spans two configs; a segment with no audio joins any part);
 * - before a segment that would make the part larger than maxBytes. A
 *   segment larger than maxBytes is a part of its own.
 * The first segment of each later part starts at its own first packet (a
 * keyframe). No segment is dropped.
 */
export function planRecordParts(
  segments: readonly RecorderSegmentRef[],
  keys: readonly SegmentKeys[],
  maxBytes: number,
): RecorderSegmentRef[][] {
  const parts: RecorderSegmentRef[][] = [];
  let part: RecorderSegmentRef[] = [];
  let bytes = 0;
  let video: string | null = null;
  let audio: string | null = null;
  segments.forEach((segment, i) => {
    const size = segment.blob.size;
    const k = keys[i];
    const otherVideo = video !== null && k.video !== video;
    const otherAudio = audio !== null && k.audio !== null && k.audio !== audio;
    const tooBig = part.length > 0 && bytes + size > maxBytes;
    if (part.length > 0 && (otherVideo || otherAudio || tooBig)) {
      parts.push(part);
      part = [];
      bytes = 0;
      video = null;
      audio = null;
    }
    // A later part starts at the first packet of its first segment (a keyframe).
    part.push(part.length === 0 && parts.length > 0 ? { ...segment, fromUs: Math.max(segment.fromUs, segment.startUs) } : segment);
    bytes += size;
    video = k.video;
    audio ??= k.audio;
  });
  if (part.length > 0) parts.push(part);
  return parts;
}

/** The config keys of a segment index. */
export function keysOf(index: Pick<SegmentIndex, "videoConfigKey" | "audioConfigKey">): SegmentKeys {
  return { video: index.videoConfigKey, audio: index.audioConfigKey };
}
