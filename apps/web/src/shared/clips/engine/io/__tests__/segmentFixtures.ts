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

/** The frame code (N mod CODE_PERIOD) of each decoded video frame, in display order. */
export function decodeCodes(bytes: Uint8Array, ext: "mp4" | "webm"): number[] {
  const file = writeTemp(bytes, ext);
  // yuv420p keeps the Y values the source wrote (no range conversion): 64 Y bytes, then 16 U and 16 V.
  const r = run("ffmpeg", ["-hide_banner", "-v", "error", "-i", file, "-map", "0:v:0", "-vf", "scale=8:8", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"]);
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
