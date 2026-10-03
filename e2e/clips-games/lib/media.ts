/**
 * Reads a clip file with ffprobe and ffmpeg, for the clips check on every
 * clip game (games.spec.ts).
 *
 * - findTool: ffprobe or ffmpeg on the PATH, or in the usual Homebrew
 *   folders. Null when it is not on this machine: the check then fails
 *   with "not run", because a check that did not run must not look like a
 *   pass.
 * - probeClip: the container, the streams and the lengths.
 * - decodeErrors: a full decode of every stream; ffmpeg exits 0 on corrupt
 *   H.264 (it hides the damage), so the check reads its error lines.
 * - grayFrame: one frame as 8-bit gray pixels, and frameStats and
 *   changedPixels on such frames (is the picture blank, does it move).
 * - pictureRect and gamePicture: the game's own picture in a frame, the
 *   letterbox bars and the compositor's paint left out. The compositor
 *   paints the game name, the score and the host on every frame, and bars
 *   around a picture of another shape (engine/encode/compositor.ts), so a
 *   check on the whole frame would pass a picture of one colour.
 * - withoutHud: the frame with the score's band or chip blanked, for the
 *   motion checks.
 * - scanFrames: every frame of a stretch, `fps` a second, one at a time
 *   (a 60 s clip at full size would be over 500 MB of frames at once).
 * - savePng: the same frame as a PNG next to the clip, for a person to see.
 * - loudness: the mean and the peak level of the sound track (volumedetect).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { COMPOSITOR_COLORS, computeLayout } from "../../../apps/web/src/shared/clips/engine/encode/compositor";

const TOOL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

/** The path of an ffmpeg tool, or null. */
export function findTool(name: "ffprobe" | "ffmpeg"): string | null {
  const onPath = spawnSync(name, ["-version"], { encoding: "utf8" });
  if (!onPath.error && onPath.status === 0) return name;
  for (const dir of TOOL_DIRS) {
    const full = path.join(dir, name);
    if (existsSync(full)) return full;
  }
  return null;
}

export interface StreamInfo {
  codec: string;
  profile: string | null;
  width: number;
  height: number;
  fps: number | null;
  sampleRate: number | null;
  channels: number | null;
  durationSec: number | null;
  /** The number of frames (nb_frames), when the container says. */
  frames: number | null;
}

export interface ClipProbe {
  formatName: string;
  /** The container's length (format duration): the longer of the tracks. */
  durationSec: number | null;
  video: StreamInfo[];
  audio: StreamInfo[];
  /** Any other stream (data, subtitles). */
  other: string[];
}

function rate(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const [n, d] = text.split("/").map(Number);
  return d ? n / d : Number.isFinite(n) ? n : null;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ffprobe on the file: the container, the streams and the length. */
export function probeClip(ffprobe: string, file: string): ClipProbe {
  const run = spawnSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) throw new Error(`ffprobe failed: ${run.error?.message ?? run.stderr.trim().split("\n")[0]}`);
  const json = JSON.parse(run.stdout) as {
    format?: { format_name?: string; duration?: string };
    streams?: Array<Record<string, unknown>>;
  };
  const streams = json.streams ?? [];
  const info = (s: Record<string, unknown>): StreamInfo => ({
    codec: String(s.codec_name ?? "unknown"),
    profile: typeof s.profile === "string" ? s.profile : null,
    width: Number(s.width ?? 0),
    height: Number(s.height ?? 0),
    fps: rate(s.avg_frame_rate) ?? rate(s.r_frame_rate),
    sampleRate: num(s.sample_rate),
    channels: num(s.channels),
    durationSec: num(s.duration),
    frames: num(s.nb_frames),
  });
  const video = streams.filter((s) => s.codec_type === "video").map(info);
  const audio = streams.filter((s) => s.codec_type === "audio").map(info);
  const other = streams.filter((s) => s.codec_type !== "video" && s.codec_type !== "audio").map((s) => String(s.codec_type));
  return {
    formatName: json.format?.format_name ?? "",
    durationSec: num(json.format?.duration),
    video,
    audio,
    other,
  };
}

export interface GrayFrame {
  width: number;
  height: number;
  pixels: Buffer;
}

/** The frame at `atSec`, as 8-bit gray (the luma), decoded by ffmpeg. */
export function grayFrame(ffmpeg: string, file: string, atSec: number, width: number, height: number): GrayFrame {
  const run = spawnSync(
    ffmpeg,
    ["-v", "error", "-ss", atSec.toFixed(3), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.error || run.status !== 0) throw new Error(`ffmpeg could not decode a frame at ${atSec.toFixed(2)} s: ${String(run.stderr).trim().split("\n")[0]}`);
  const pixels = run.stdout as Buffer;
  if (pixels.length !== width * height) {
    throw new Error(`ffmpeg gave ${pixels.length} bytes for a ${width}x${height} frame at ${atSec.toFixed(2)} s`);
  }
  return { width, height, pixels };
}

/** The luma of a "#RRGGBB" colour, the way ffmpeg's gray gives it (BT.601 weights; BT.709 gives the same for a near-gray). */
function hexLuma(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/** The luma of the compositor's letterbox bars (COMPOSITOR_COLORS.frame, #0B0C0E): about 12. */
export const BAR_LUMA = hexLuma(COMPOSITOR_COLORS.frame);
/** A bar pixel is at most this many luma steps from BAR_LUMA: the encoder keeps a flat bar flat. */
const BAR_STEPS = 3;
/** The game picture's edge rows and columns blend with the bar when the compositor scales it; they are left out. */
const EDGE_PX = 2;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the game's own picture is in a frame. The compositor letterboxes
 * the picture into its content area (computeLayout's fit) with bars of
 * COMPOSITOR_COLORS.frame, and centres it: the bar above is as tall as the
 * bar below (or one row less), and the bar at the left is as wide as the
 * bar at the right (or one column less). The bars come from the pixels:
 *   - the bar above: the rows from the top of the content area that are
 *     all bar colour (right of the wide corner chip, which can lie over
 *     the bar). The bar below is the same height: it can hold the host
 *     name, so it is not read.
 *   - the bars at the sides: the columns from each edge that are all bar
 *     colour, over the picture's rows less the chip's rows and the host
 *     pill's rows. The narrower of the two counts for both, so a game
 *     whose own edge is near the bar colour keeps its picture.
 * A content area that is all bar colour gives an empty rectangle.
 */
export function pictureRect(frame: GrayFrame): Rect {
  const { width: W, height: H, pixels } = frame;
  const orientation = W >= H ? "wide" : "tall";
  const layout = computeLayout({ width: W, height: H, targetFps: 30, orientation }, W, H);
  const area = layout.contentArea;
  const bar = (x: number, y: number) => Math.abs(pixels[y * W + x] - BAR_LUMA) <= BAR_STEPS;
  const rowFrom = layout.chip ? Math.min(area.x + area.w, layout.chip.x + layout.chip.maxW) : area.x;
  const rowIsBar = (y: number) => {
    for (let x = rowFrom; x < area.x + area.w; x++) if (!bar(x, y)) return false;
    return true;
  };
  let top = 0;
  while (top * 2 < area.h && rowIsBar(area.y + top)) top++;
  if (top * 2 >= area.h) return { x: area.x, y: area.y + Math.floor(area.h / 2), w: 0, h: 0 };
  const y0 = area.y + top;
  const y1 = area.y + area.h - top;
  // The rows to judge the side bars by: the picture's rows less the chip and the host pill (computeLayout's brandBox, overlay mode).
  const short = Math.min(W, H);
  const pillTop = H - Math.round(short * 0.02) - Math.round(Math.round(short * 0.03) * 1.6);
  const chipBottom = layout.chip ? layout.chip.y + layout.chip.h : 0;
  let r0 = Math.max(y0, chipBottom);
  let r1 = Math.min(y1, pillTop);
  if (r1 - r0 < 8) [r0, r1] = [y0, y1];
  const columnIsBar = (x: number) => {
    for (let y = r0; y < r1; y++) if (!bar(x, y)) return false;
    return true;
  };
  let left = 0;
  while (left * 2 < area.w && columnIsBar(area.x + left)) left++;
  let right = 0;
  while (right * 2 < area.w && columnIsBar(area.x + area.w - 1 - right)) right++;
  const side = Math.min(left, right);
  if (side * 2 >= area.w) return { x: area.x + Math.floor(area.w / 2), y: y0, w: 0, h: y1 - y0 };
  return { x: area.x + side, y: y0, w: area.w - side * 2, h: y1 - y0 };
}

/** A part of a frame, with where it lies in the frame. */
export interface FramePart extends GrayFrame {
  rect: Rect;
}

/**
 * The game's own picture, for the "not blank" rows: the picture rectangle
 * (pictureRect: the letterbox bars left out, EDGE_PX in from its edges)
 * inside the middle of the frame, x 20% to 80% and y 15% to 85%. The
 * middle leaves out the compositor's own paint over the picture: the wide
 * corner chip (top 2.5% to 8.5%) and the host pill (bottom 7%); the tall
 * band (top 10%) and the host text in the bottom bar are outside the
 * picture. Without the bars a game picture of one colour measures sd 0
 * and range 0 (with them, a wide game in a tall frame passed: the bars
 * are luma 12 and the picture a different colour). On the 13 clips of
 * 2026-10-02 the picture measured sd 14.9 or more and a range of 113 or
 * more at 25% and 75%.
 */
export function gamePicture(frame: GrayFrame): FramePart {
  const picture = pictureRect(frame);
  const x0 = Math.max(Math.round(frame.width * 0.2), picture.x + EDGE_PX);
  const x1 = Math.min(Math.round(frame.width * 0.8), picture.x + picture.w - EDGE_PX);
  const y0 = Math.max(Math.round(frame.height * 0.15), picture.y + EDGE_PX);
  const y1 = Math.min(Math.round(frame.height * 0.85), picture.y + picture.h - EDGE_PX);
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) frame.pixels.copy(pixels, y * width, (y0 + y) * frame.width + x0, (y0 + y) * frame.width + x1);
  return { width, height, pixels, rect: { x: x0, y: y0, w: width, h: height } };
}

/**
 * The frame with the compositor's changing paint blanked out: the tall top
 * band and the wide corner chip, where the score is (computeLayout, the
 * product's own geometry). The motion checks use the rest of the frame,
 * edges too: a Bomberman balloon walks in a far corner, and the score must
 * never count as the picture moving. The host label never changes, so it
 * can stay.
 */
export function withoutHud(frame: GrayFrame): GrayFrame {
  const orientation = frame.width >= frame.height ? "wide" : "tall";
  const layout = computeLayout({ width: frame.width, height: frame.height, targetFps: 30, orientation }, frame.width, frame.height);
  const box = layout.band ?? (layout.chip ? { x: layout.chip.x, y: layout.chip.y, w: layout.chip.maxW, h: layout.chip.h } : null);
  if (!box) return frame;
  const pixels = Buffer.from(frame.pixels);
  const x0 = Math.max(0, box.x);
  const x1 = Math.min(frame.width, box.x + box.w);
  for (let y = Math.max(0, box.y); y < Math.min(frame.height, box.y + box.h); y++) pixels.fill(0, y * frame.width + x0, y * frame.width + x1);
  return { width: frame.width, height: frame.height, pixels };
}

/**
 * Semantic sources are exactly 640x720. Measure the real board rectangle
 * through the compositor's actual fit, excluding each renderer's changing
 * title/status/footer. Cookie Clicker uses its cookie face, not its counters.
 */
export function semanticBoardPicture(frame: GrayFrame, id: string): GrayFrame {
  const boardGames = ["2048", "chess", "checkers", "quoridor", "wordle", "memory-match"];
  const area = id === "cookie-clicker" ? { x: 58, y: 133, w: 284, h: 284 }
    : boardGames.includes(id) ? { x: 32, y: 96, w: 576, h: 576 } : null;
  if (!area) return withoutHud(frame);
  const { width, height } = frame;
  const { content } = computeLayout({ width, height, targetFps: 30, orientation: width >= height ? "wide" : "tall" }, 640, 720);
  const x0 = Math.ceil(content.x + area.x * content.w / 640);
  const x1 = Math.floor(content.x + (area.x + area.w) * content.w / 640);
  const y0 = Math.ceil(content.y + area.y * content.h / 720);
  const y1 = Math.floor(content.y + (area.y + area.h) * content.h / 720);
  const pixels = Buffer.alloc(width * height);
  const gameplay = withoutHud(frame);
  for (let y = y0; y < y1; y++) gameplay.pixels.copy(pixels, y * width + x0, y * width + x0, y * width + x1);
  return { width, height, pixels };
}

/**
 * Decodes the stretch from `fromSec` to `toSec` (the end when null), `fps`
 * frames a second, as 8-bit gray, and hands each frame to `onFrame` with
 * its time in the clip. One frame is in memory at a time. Gives the number
 * of frames; throws when ffmpeg fails or prints an error.
 */
export function scanFrames(
  ffmpeg: string,
  file: string,
  range: { fromSec: number; toSec: number | null; fps: number; width: number; height: number },
  onFrame: (frame: GrayFrame, atSec: number) => void,
): Promise<number> {
  const { fromSec, toSec, fps, width, height } = range;
  const args = ["-v", "error", "-ss", fromSec.toFixed(3), ...(toSec === null ? [] : ["-to", toSec.toFixed(3)]), "-i", file, "-vf", `fps=${fps}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"];
  const size = width * height;
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let pending: Buffer = Buffer.alloc(0);
    let count = 0;
    let stderr = "";
    let failed: Error | null = null;
    child.stdout.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= size && !failed) {
        const pixels = Buffer.from(pending.subarray(0, size));
        pending = pending.subarray(size);
        try {
          onFrame({ width, height, pixels }, fromSec + count / fps);
        } catch (error) {
          failed = error instanceof Error ? error : new Error(String(error));
          child.kill();
        }
        count++;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (status) => {
      if (failed) return reject(failed);
      const lines = stderr.trim().split("\n").filter(Boolean);
      if (status !== 0 || lines.length) return reject(new Error(`ffmpeg could not decode ${fromSec.toFixed(2)}..${toSec === null ? "end" : toSec.toFixed(2)} s: ${lines[0] ?? `exit ${status}`}`));
      resolve(count);
    });
  });
}

/**
 * A full decode of the file (every stream) to nothing. ffmpeg exits 0 on a
 * corrupt H.264 stream, so the check is its error lines: a good clip
 * prints none (all 13 clips of 2026-10-01), and 4000 bytes scrambled in
 * the middle of one printed 7 lines ("Invalid NAL unit size").
 *
 * A clip has a variable frame rate (a frame lasts as long as the game took
 * to draw it, 25 ms to 33 ms and more). The null output keeps the file's
 * own time base (-enc_time_base:v -1): at ffmpeg's default 1/30 s, two
 * frames 25 ms apart land on one tick, and ffmpeg prints "non
 * monotonically increasing dts to muxer", a fault of its output and not of
 * the clip. "-1" and not "demux": ffmpeg 4.4 to 6.0 refuse "demux"
 * ("Invalid time base"), and 6.1 to 8.1 take "-1" with a deprecation
 * warning, which -v error does not print (fftools FFMPEG_OPT_ENC_TIME_BASE_NUM).
 */
export function decodeErrors(ffmpeg: string, file: string): { status: number | null; lines: string[] } {
  const run = spawnSync(ffmpeg, ["-v", "error", "-nostats", "-i", file, "-map", "0", "-enc_time_base:v", "-1", "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error) return { status: null, lines: [run.error.message] };
  return { status: run.status, lines: (run.stderr ?? "").trim().split("\n").filter(Boolean) };
}

/**
 * The longest time between two video frames of the file (packet times,
 * sorted), and where it starts, in seconds; null when ffprobe cannot read
 * them. A clip's frames come 25 ms to 33 ms apart; a gap of seconds is a
 * hole in the capture (2026-10-02, at a load of 45 on 10 cores: 3.03 s
 * with no frame, beside "[clips] encoder failure (keyframe-starved)").
 * The still row names it, so a frozen capture and a game picture that
 * stands still can be told apart.
 */
export function longestFrameGap(ffprobe: string, file: string): { gapSec: number; fromSec: number } | null {
  const run = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) return null;
  const times = run.stdout
    .split("\n")
    .map((line) => Number.parseFloat(line))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (times.length < 2) return null;
  let best = { gapSec: 0, fromSec: times[0] };
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > best.gapSec) best = { gapSec: times[i] - times[i - 1], fromSec: times[i - 1] };
  return best;
}

/** The same frame as a PNG, for a person to look at. */
export function savePng(ffmpeg: string, file: string, atSec: number, out: string): void {
  spawnSync(ffmpeg, ["-v", "error", "-y", "-ss", atSec.toFixed(3), "-i", file, "-frames:v", "1", out]);
}

export interface FrameStats {
  mean: number;
  sd: number;
  min: number;
  max: number;
}

export function frameStats(frame: GrayFrame): FrameStats {
  let sum = 0;
  let squares = 0;
  let min = 255;
  let max = 0;
  for (const v of frame.pixels) {
    sum += v;
    squares += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const n = frame.pixels.length;
  // No pixels (the picture is all bar): blank.
  if (n === 0) return { mean: 0, sd: 0, min: 0, max: 0 };
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, squares / n - mean * mean)), min, max };
}

/** How many pixels differ by more than `threshold` luma steps between two frames of one size. */
export function changedPixels(a: GrayFrame, b: GrayFrame, threshold: number): number {
  let changed = 0;
  for (let i = 0; i < a.pixels.length; i++) if (Math.abs(a.pixels[i] - b.pixels[i]) > threshold) changed++;
  return changed;
}

/** The mean and the peak level of the first sound track, in dB, or null. */
export function loudness(ffmpeg: string, file: string): { meanDb: number; maxDb: number } | null {
  const run = spawnSync(ffmpeg, ["-v", "info", "-nostats", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const mean = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(run.stderr ?? "");
  const max = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(run.stderr ?? "");
  if (!mean || !max) return null;
  const db = (text: string) => (text === "-inf" ? Number.NEGATIVE_INFINITY : Number(text));
  return { meanDb: db(mean[1]), maxDb: db(max[1]) };
}

/** True when the bytes start with an ISO BMFF "ftyp" box (an MP4 file). */
export function startsWithFtyp(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString("latin1", 4, 8) === "ftyp";
}

/** The ftyp box's major brand, for the report. */
export function majorBrand(bytes: Buffer): string {
  return startsWithFtyp(bytes) ? bytes.toString("latin1", 8, 12) : "none";
}
