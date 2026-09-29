/**
 * Real MediaRecorder-shaped segments for node tests (tiers M and V, plan 5).
 *
 * ffmpeg makes one 30 s source: 64x64 video at 30 fps where frame N is a flat
 * gray of level 16 + 4 * (N mod 50), and a 440 Hz tone. Then it cuts
 * segments from the source the way rotating recorders make them: each
 * segment is its own file, with its own header and a keyframe first, and its
 * packet times start at 0. Segments overlap across each hand-off.
 *
 * - WebM segments (VP8 and Opus) are written to a pipe, so ffmpeg writes a
 *   live file (no Cues, no seek back), like MediaRecorder. toLiveWebm() also
 *   marks the Segment and every Cluster "unknown size", as Chrome's
 *   MediaRecorder does.
 * - MP4 segments (H.264 and AAC) are fragmented (moof and mdat), like
 *   Chrome's MediaRecorder MP4.
 *
 * decodeCodes() decodes a file with ffmpeg and returns the frame number code
 * (N mod 50) of each decoded frame, so a test can prove that a joined file
 * shows every frame once, in order, across the hand-offs.
 *
 * The engine tests need more than cuts of one source:
 * - makeFramesSegment() makes a file of exactly the frames a recorder got,
 *   each with its own picture code and its own (uneven) time;
 * - makeSoundRun() makes an audio-only run (Opus in WebM, AAC in fragmented
 *   MP4), and decodePcm() and toneSmoothness() show a drop-out or a click in
 *   the sound of a joined file;
 * - h264Pictures() reads the H.264 slice headers (IDR and idr_pic_id) at
 *   every packet, for the plan 5.1 splice check.
 *
 * Without ffmpeg (and libvpx, libopus, libx264), FFMPEG_SKIP_REASON says why,
 * and the tests that need it are skipped with that reason.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const SOURCE_SECONDS = 30;
export const SOURCE_FPS = 30;
/** Frame codes repeat after this many frames. */
export const CODE_PERIOD = 50;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr?.toString("utf8") ?? "", error: result.error };
}

function has(command: string): boolean {
  const r = run(command, ["-hide_banner", "-version"]);
  return !r.error && r.status === 0;
}

function skipReason(): string {
  if (!has("ffmpeg") || !has("ffprobe")) return "ffmpeg or ffprobe not found";
  const encoders = run("ffmpeg", ["-hide_banner", "-encoders"]).stdout.toString("utf8");
  for (const name of ["libvpx", "libopus", "libx264"]) {
    if (!new RegExp(`\\b${name}\\b`).test(encoders)) return `ffmpeg has no ${name}`;
  }
  return "";
}

/** Why the ffmpeg tests are skipped, or "" when ffmpeg can make the fixtures. */
export const FFMPEG_SKIP_REASON = skipReason();

let dir: string | null = null;

function workDir(): string {
  dir ??= mkdtempSync(path.join(tmpdir(), "hh-clips-seg-"));
  return dir;
}

/** Removes the fixture files (call it in afterAll). */
export function cleanupSegmentFixtures(): void {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
  sourcePath = null;
}

let sourcePath: string | null = null;

function source(): string {
  if (sourcePath) return sourcePath;
  const out = path.join(workDir(), "source.mkv");
  const r = run("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `nullsrc=s=64x64:r=${SOURCE_FPS},geq=lum='16+mod(N\\,${CODE_PERIOD})*4':cb=128:cr=128`,
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:sample_rate=48000",
    "-t",
    String(SOURCE_SECONDS),
    "-c:v",
    "rawvideo",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "pcm_s16le",
    out,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg could not make the source: ${r.stderr}`);
  sourcePath = out;
  return out;
}

export interface SegmentSpec {
  /** Start in the source, in seconds (the capture time of the segment's first frame). */
  startSec: number;
  durationSec: number;
  container: "webm" | "mp4";
  /** Frames between keyframes. Default 30 (a keyframe every second). */
  gop?: number;
  /** Include the sound track. Default true. */
  audio?: boolean;
  /** Frame size. Default 64 (the source size). */
  size?: number;
  /** WebM only: mark the Segment and the Clusters "unknown size", like Chrome. Default false. */
  live?: boolean;
  /** WebM only: write the DocType "matroska" (the same elements, VP8 and Opus). Default false. */
  matroskaDocType?: boolean;
}

/** Makes one segment and returns its bytes. */
export function makeSegment(spec: SegmentSpec): Uint8Array {
  const gop = String(spec.gop ?? 30);
  const size = spec.size ?? 64;
  const args = ["-hide_banner", "-v", "error", "-y", "-ss", String(spec.startSec), "-t", String(spec.durationSec), "-i", source()];
  if (size !== 64) args.push("-vf", `scale=${size}:${size}`);
  if (spec.container === "webm") {
    args.push("-c:v", "libvpx", "-b:v", "600k", "-g", gop, "-keyint_min", gop, "-auto-alt-ref", "0");
    if (spec.audio === false) args.push("-an");
    else args.push("-c:a", "libopus", "-b:a", "64k");
    args.push("-f", spec.matroskaDocType ? "matroska" : "webm", "pipe:1");
  } else {
    args.push("-c:v", "libx264", "-profile:v", "baseline", "-g", gop, "-keyint_min", gop, "-sc_threshold", "0", "-bf", "0");
    if (spec.audio === false) args.push("-an");
    else args.push("-c:a", "aac", "-b:a", "128k");
    args.push("-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");
  }
  const r = run("ffmpeg", args);
  if (r.status !== 0 || !r.stdout || r.stdout.length === 0) throw new Error(`ffmpeg could not make a segment: ${r.stderr}`);
  const bytes = new Uint8Array(r.stdout);
  return spec.container === "webm" && spec.live ? toLiveWebm(bytes) : bytes;
}

// ---------------------------------------------------------------------------
// EBML
// ---------------------------------------------------------------------------

const SEGMENT_ID = 0x18538067;
const CLUSTER_ID = 0x1f43b675;

function readVint(bytes: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number } {
  const first = bytes[at];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i];
  return { value, length };
}

/** The 8-byte "unknown size" value that libwebm (Chrome's MediaRecorder) writes. */
const UNKNOWN_SIZE_8 = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/**
 * The same WebM with the Segment and every Cluster marked "unknown size" in
 * the 8-byte form, the way Chrome's MediaRecorder (libwebm) writes a live
 * file. The elements are copied; only their size fields change.
 *
 * Note: mediabunny 1.60 reads the 8-byte form, but it reads a SHORT
 * all-ones size (for example the 2-byte 0x7FFF) as a real size and loses
 * the clusters after it. No browser writes the short form.
 */
export function toLiveWebm(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  const copy = (from: number, to: number) => {
    for (let i = from; i < to; i++) out.push(input[i]);
  };
  let at = 0;
  while (at < input.length) {
    const id = readVint(input, at, true);
    const size = readVint(input, at + id.length, false);
    if (id.value !== SEGMENT_ID) {
      copy(at, at + id.length + size.length + size.value);
      at += id.length + size.length + size.value;
      continue;
    }
    copy(at, at + id.length);
    out.push(...UNKNOWN_SIZE_8);
    const end = Math.min(input.length, at + id.length + size.length + size.value);
    let child = at + id.length + size.length;
    while (child < end) {
      const cid = readVint(input, child, true);
      const csize = readVint(input, child + cid.length, false);
      const bodyAt = child + cid.length + csize.length;
      if (cid.value === CLUSTER_ID) {
        copy(child, child + cid.length);
        out.push(...UNKNOWN_SIZE_8);
      } else {
        copy(child, bodyAt);
      }
      copy(bodyAt, Math.min(end, bodyAt + csize.value));
      child = bodyAt + csize.value;
    }
    break;
  }
  return new Uint8Array(out);
}

/** True when the first Cluster has the "unknown size" value (a live file cannot be walked past it). */
export function firstClusterSizeUnknown(bytes: Uint8Array): boolean {
  let at = 0;
  while (at < bytes.length) {
    const id = readVint(bytes, at, true);
    const size = readVint(bytes, at + id.length, false);
    if (id.value !== SEGMENT_ID) {
      at += id.length + size.length + size.value;
      continue;
    }
    let child = at + id.length + size.length;
    while (child < bytes.length) {
      const cid = readVint(bytes, child, true);
      const csize = readVint(bytes, child + cid.length, false);
      if (cid.value === CLUSTER_ID) return csize.value === 2 ** (7 * csize.length) - 1;
      child += cid.length + csize.length + csize.value;
    }
    return false;
  }
  return false;
}

/** True when the Segment has the "unknown size" value. */
export function hasUnknownSegmentSize(bytes: Uint8Array): boolean {
  let at = 0;
  while (at < bytes.length) {
    const id = readVint(bytes, at, true);
    const size = readVint(bytes, at + id.length, false);
    if (id.value === SEGMENT_ID) return size.value === 2 ** (7 * size.length) - 1;
    at += id.length + size.length + size.value;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Checks with ffmpeg
// ---------------------------------------------------------------------------

function writeTemp(bytes: Uint8Array, ext: string): string {
  const file = path.join(workDir(), `check-${Math.random().toString(36).slice(2)}.${ext}`);
  writeFileSync(file, bytes);
  return file;
}

/** ffmpeg decodes the whole file: returns its error output ("" when clean). */
export function decodeErrors(bytes: Uint8Array, ext: "mp4" | "webm"): string {
  const file = writeTemp(bytes, ext);
  const r = run("ffmpeg", ["-hide_banner", "-v", "error", "-i", file, "-f", "null", "-"]);
  return r.status === 0 ? r.stderr.trim() : `exit ${r.status}: ${r.stderr.trim()}`;
}

/**
 * The frame code (N mod CODE_PERIOD) of each decoded video frame, in display
 * order: one code per frame in the file (no frame is added or dropped to fit
 * a frame rate, so a file with uneven frame times reads true).
 */
export function decodeCodes(bytes: Uint8Array, ext: "mp4" | "webm"): number[] {
  const file = writeTemp(bytes, ext);
  // yuv420p keeps the Y values the source wrote (no range conversion): 64 Y bytes, then 16 U and 16 V.
  const r = run("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-i",
    file,
    "-map",
    "0:v:0",
    "-vf",
    "scale=8:8",
    "-pix_fmt",
    "yuv420p",
    "-fps_mode",
    "passthrough",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg could not decode: ${r.stderr}`);
  const raw = new Uint8Array(r.stdout);
  const frameBytes = 64 + 16 + 16;
  const codes: number[] = [];
  for (let at = 0; at + frameBytes <= raw.length; at += frameBytes) {
    let sum = 0;
    for (let i = 0; i < 64; i++) sum += raw[at + i];
    codes.push(((Math.round((sum / 64 - 16) / 4) % CODE_PERIOD) + CODE_PERIOD) % CODE_PERIOD);
  }
  return codes;
}

/** Stream facts from ffprobe: codec names and durations in seconds. */
export function probeStreams(bytes: Uint8Array, ext: "mp4" | "webm"): Array<{ type: string; codec: string; duration: number }> {
  const file = writeTemp(bytes, ext);
  const r = run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name:stream=duration:format=duration", "-of", "json", file]);
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const json = JSON.parse(r.stdout.toString("utf8")) as {
    streams: Array<{ codec_type: string; codec_name: string; duration?: string }>;
    format?: { duration?: string };
  };
  return json.streams.map((s) => ({ type: s.codec_type, codec: s.codec_name, duration: Number(s.duration ?? json.format?.duration ?? NaN) }));
}

/** The bytes of a file as a Blob with the container's type. */
export function blobOf(bytes: Uint8Array, container: "webm" | "mp4"): Blob {
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: container === "webm" ? "video/webm" : "video/mp4" });
}

// ---------------------------------------------------------------------------
// Frame-true segments (the engine tests)
// ---------------------------------------------------------------------------

/** One frame of a recorder's file: its time on the capture timeline and its picture code. */
export interface FrameSpec {
  atUs: number;
  code: number;
}

const FRAME_BYTES = 64 * 64 + 2 * 32 * 32;

/**
 * A segment file of exactly `frames`, like a MediaRecorder makes it from the
 * frames its track got: frame i shows the gray level of `code` (decodeCodes
 * reads it back), and its time in the file is its atUs minus the first
 * frame's atUs. ffmpeg encodes the pictures (VP8, or H.264 baseline), and
 * mediabunny writes them again with those uneven times (a WebM, or a
 * fragmented MP4 like Chrome's). gop: frames between keyframes (default 30).
 */
export async function makeFramesSegment(spec: { frames: readonly FrameSpec[]; container: "webm" | "mp4"; gop?: number }): Promise<Uint8Array> {
  if (spec.frames.length === 0) throw new Error("a segment needs at least one frame");
  const raw = new Uint8Array(spec.frames.length * FRAME_BYTES);
  spec.frames.forEach((frame, i) => {
    const at = i * FRAME_BYTES;
    raw.fill(16 + 4 * (((frame.code % CODE_PERIOD) + CODE_PERIOD) % CODE_PERIOD), at, at + 64 * 64);
    raw.fill(128, at + 64 * 64, at + FRAME_BYTES);
  });
  const gop = String(spec.gop ?? 30);
  const args = ["-hide_banner", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", "64x64", "-r", "30", "-i", "pipe:0"];
  if (spec.container === "webm") {
    args.push("-c:v", "libvpx", "-b:v", "600k", "-g", gop, "-keyint_min", gop, "-auto-alt-ref", "0", "-f", "webm", "pipe:1");
  } else {
    args.push("-c:v", "libx264", "-profile:v", "baseline", "-g", gop, "-keyint_min", gop, "-sc_threshold", "0", "-bf", "0");
    args.push("-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");
  }
  const result = spawnSync("ffmpeg", args, { input: raw, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout || result.stdout.length === 0) {
    throw new Error(`ffmpeg could not encode the frames: ${result.stderr?.toString("utf8")}`);
  }
  return retime(
    new Uint8Array(result.stdout),
    spec.container,
    spec.frames.map((f) => f.atUs - spec.frames[0].atUs),
  );
}

/** Writes the file again with the video packets at `timesUs` (decode order = presentation order: no B-frames). */
async function retime(bytes: Uint8Array, container: "webm" | "mp4", timesUs: readonly number[]): Promise<Uint8Array> {
  const mb = await import("mediabunny");
  const input = new mb.Input({ formats: container === "webm" ? [mb.WEBM, mb.MATROSKA] : [mb.MP4], source: new mb.BufferSource(bytes) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("the encoded frames have no video track");
  const codec = await track.getCodec();
  const config = await track.getDecoderConfig();
  if (!codec || !config) throw new Error("the encoded frames have no codec");
  const packets: InstanceType<typeof mb.EncodedPacket>[] = [];
  for await (const packet of new mb.EncodedPacketSink(track).packets()) packets.push(packet);
  input.dispose();
  if (packets.length !== timesUs.length) throw new Error(`ffmpeg made ${packets.length} frames, not ${timesUs.length}`);
  const format = container === "webm" ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat({ fastStart: "fragmented" });
  const output = new mb.Output({ format, target: new mb.BufferTarget() });
  const source = new mb.EncodedVideoPacketSource(codec);
  output.addVideoTrack(source);
  await output.start();
  for (let i = 0; i < packets.length; i++) {
    const t = timesUs[i] / 1e6;
    const next = i + 1 < timesUs.length ? timesUs[i + 1] / 1e6 : t + 1 / 30;
    await source.add(new mb.EncodedPacket(packets[i].data, packets[i].type, t, Math.max(0.001, next - t)), i === 0 ? { decoderConfig: config } : undefined);
  }
  source.close();
  await output.finalize();
  const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!buffer) throw new Error("mediabunny wrote no bytes");
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// Sound runs
// ---------------------------------------------------------------------------

/**
 * One sound run as an audio-only MediaRecorder makes it: a 440 Hz tone, Opus
 * in a live WebM (tier V) or AAC in a fragmented MP4 (tier M, a fragment
 * every fragmentMs). WebM clusters: clusterMs (default: ffmpeg's own, some
 * seconds long; a browser can make them long too).
 */
export function makeSoundRun(spec: { container: "webm" | "mp4"; seconds: number; fragmentMs?: number; clusterMs?: number }): Uint8Array {
  const args = ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000", "-t", String(spec.seconds)];
  if (spec.container === "webm") {
    args.push("-c:a", "libopus", "-b:a", "128k");
    if (spec.clusterMs) args.push("-cluster_time_limit", String(spec.clusterMs));
    args.push("-f", "webm", "pipe:1");
  } else {
    args.push("-c:a", "aac", "-b:a", "128k", "-movflags", "+frag_keyframe+empty_moov+default_base_moof");
    args.push("-frag_duration", String((spec.fragmentMs ?? 250) * 1000), "-f", "mp4", "pipe:1");
  }
  const r = run("ffmpeg", args);
  if (r.status !== 0 || !r.stdout || r.stdout.length === 0) throw new Error(`ffmpeg could not make a sound run: ${r.stderr}`);
  return new Uint8Array(r.stdout);
}

/** Byte offsets at which a fragmented MP4's fragments (moof boxes) start, and the file end. */
export function mp4FragmentStarts(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  let at = 0;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === "moof") out.push(at);
    if (size < 8) break;
    at += size;
  }
  out.push(bytes.length);
  return out;
}

/** The sound of a file as mono 48 kHz samples. */
export function decodePcm(bytes: Uint8Array, ext: "mp4" | "webm"): Float32Array {
  const file = writeTemp(bytes, ext);
  const r = run("ffmpeg", ["-hide_banner", "-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"]);
  if (r.status !== 0) throw new Error(`ffmpeg could not decode the sound: ${r.stderr}`);
  const buf = r.stdout as Buffer;
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/**
 * How smooth a tone is: in 5 ms windows, the lowest RMS and the largest step
 * from one sample to the next, leaving out `skipSec` at each end (the
 * encoders' start and end). A drop-out shows as a low RMS, a click as a large
 * step.
 */
export function toneSmoothness(pcm: Float32Array, skipSec = 0.1): { minRms: number; maxStep: number; windows: number } {
  const win = 240;
  const skip = Math.round(skipSec * 48_000);
  let minRms = Infinity;
  let maxStep = 0;
  let windows = 0;
  for (let at = skip; at + win + 1 < pcm.length - skip; at += win) {
    let energy = 0;
    let step = 0;
    for (let i = at; i < at + win; i++) {
      energy += pcm[i] * pcm[i];
      step = Math.max(step, Math.abs(pcm[i + 1] - pcm[i]));
    }
    minRms = Math.min(minRms, Math.sqrt(energy / win));
    maxStep = Math.max(maxStep, step);
    windows++;
  }
  return { minRms, maxStep, windows };
}

// ---------------------------------------------------------------------------
// H.264 slice headers (plan 5.1: the splice check)
// ---------------------------------------------------------------------------

/** The RBSP of a NAL unit: the emulation prevention bytes (00 00 03) taken out. */
function rbsp(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (const b of nal) {
    if (zeros >= 2 && b === 3) {
      zeros = 0;
      continue;
    }
    out.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return new Uint8Array(out);
}

class Bits {
  private at = 0;
  constructor(private readonly bytes: Uint8Array) {}
  bit(): number {
    const b = (this.bytes[this.at >> 3] >> (7 - (this.at & 7))) & 1;
    this.at++;
    return b;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 2 + this.bit();
    return v;
  }
  ue(): number {
    let zeros = 0;
    while (this.bit() === 0) zeros++;
    return 2 ** zeros - 1 + this.bits(zeros);
  }
}

/** The SPS values a baseline slice header needs. */
function readSps(sps: Uint8Array): { log2MaxFrameNum: number; frameMbsOnly: boolean } {
  const r = new Bits(rbsp(sps).subarray(1));
  const profile = r.bits(8);
  r.bits(16);
  r.ue();
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128].includes(profile)) throw new Error("the splice check reads baseline profile only");
  const log2MaxFrameNum = r.ue() + 4;
  const pocType = r.ue();
  if (pocType === 0) r.ue();
  else if (pocType === 1) throw new Error("the splice check does not read pic_order_cnt_type 1");
  r.ue();
  r.bit();
  r.ue();
  r.ue();
  return { log2MaxFrameNum, frameMbsOnly: r.bit() === 1 };
}

/** For each video packet of an H.264 MP4 (in decode order): is it an IDR, and its idr_pic_id (H.264 7.4.3). */
export async function h264Pictures(bytes: Uint8Array): Promise<Array<{ idr: boolean; idrPicId: number | null }>> {
  const mb = await import("mediabunny");
  const input = new mb.Input({ formats: [mb.MP4], source: new mb.BufferSource(bytes) });
  try {
    const track = await input.getPrimaryVideoTrack();
    const config = await track!.getDecoderConfig();
    const description = config!.description as ArrayBuffer | ArrayBufferView;
    const avcc = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
    const lengthSize = (avcc[4] & 3) + 1;
    const spsLength = (avcc[6] << 8) | avcc[7];
    const sps = readSps(avcc.subarray(8, 8 + spsLength));
    const out: Array<{ idr: boolean; idrPicId: number | null }> = [];
    for await (const packet of new mb.EncodedPacketSink(track!).packets()) {
      const data = packet.data;
      let at = 0;
      let found: { idr: boolean; idrPicId: number | null } | null = null;
      while (at + lengthSize <= data.length && !found) {
        let size = 0;
        for (let i = 0; i < lengthSize; i++) size = size * 256 + data[at + i];
        const nal = data.subarray(at + lengthSize, at + lengthSize + size);
        at += lengthSize + size;
        const type = nal[0] & 0x1f;
        if (type !== 1 && type !== 5) continue;
        const r = new Bits(rbsp(nal).subarray(1));
        r.ue();
        r.ue();
        r.ue();
        r.bits(sps.log2MaxFrameNum);
        if (!sps.frameMbsOnly && r.bit()) r.bit();
        found = { idr: type === 5, idrPicId: type === 5 ? r.ue() : null };
      }
      out.push(found ?? { idr: false, idrPicId: null });
    }
    return out;
  } finally {
    input.dispose();
  }
}
