/**
 * Test helpers for the real-media A/V checks (plan 15.1 "Node" tier, 15.2).
 *
 * - ffmpeg and ffprobe: found on PATH, with libx264 for the fixtures.
 * - avsync: design/clips/prototype/avcheck/avsync.swift (AVAssetReader, the
 *   decoder of iPhone Photos and Messages), built once with swiftc on macOS
 *   and cached by the hash of its source. It is read from the working tree,
 *   else from the clips/plan branch.
 * - ffmpegSync: flashes by luma and beeps by silence ends, the port of
 *   design/clips/prototype/probe/analyze_sync.py.
 *
 * A missing tool gives a reason string, never a failure: the tests that need
 * it are skipped with the reason in their name.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** ffmpeg runs take well under a second, but a busy machine can make them slow. */
export const TOOL_TIMEOUT_MS = 60_000;

export function run(command: string, args: string[], options: { cwd?: string; timeout?: number } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

export function available(command: string, args: string[]): boolean {
  const result = run(command, args);
  return !result.error && result.status === 0;
}

export const HAS_FFMPEG = available("ffmpeg", ["-hide_banner", "-version"]) && available("ffprobe", ["-hide_banner", "-version"]);
const ENCODERS = HAS_FFMPEG ? run("ffmpeg", ["-hide_banner", "-encoders"]).stdout : "";
export const HAS_X264 = /\blibx264\b/.test(ENCODERS);
export const HAS_AAC_AT = /\baac_at\b/.test(ENCODERS);
/** Why the ffmpeg checks cannot run here, or "" when they can. */
export const FFMPEG_REASON = !HAS_FFMPEG ? "ffmpeg or ffprobe not found" : !HAS_X264 ? "ffmpeg has no libx264" : "";

/** Finds avsync.swift: in the working tree, else on the clips/plan branch. */
function avsyncSource(): { source: string | null; reason: string } {
  if (process.platform !== "darwin") return { source: null, reason: "AVFoundation needs macOS" };
  if (!available("swiftc", ["--version"])) return { source: null, reason: "swiftc not found" };
  const top = run("git", ["rev-parse", "--show-toplevel"], { cwd: __dirname });
  const root = top.status === 0 ? top.stdout.trim() : path.resolve(__dirname, "../../../../../../..");
  const relative = "design/clips/prototype/avcheck/avsync.swift";
  const inTree = path.join(root, relative);
  if (existsSync(inTree)) return { source: readFileSync(inTree, "utf8"), reason: "" };
  const shown = run("git", ["show", `clips/plan:${relative}`], { cwd: root });
  if (shown.status === 0 && shown.stdout.includes("AVAssetReader")) return { source: shown.stdout, reason: "" };
  return { source: null, reason: `${relative} is not in the tree or on branch clips/plan` };
}

/** The avsync.swift source, or the reason it cannot run here. */
export const AVSYNC = avsyncSource();

/** Builds avsync once (cached by source hash). Returns the binary, or the reason it did not build. */
export function buildAvsync(): { binary: string | null; error: string } {
  if (!AVSYNC.source) return { binary: null, error: AVSYNC.reason };
  const hash = createHash("sha256").update(AVSYNC.source).digest("hex").slice(0, 16);
  const cacheDir = path.join(tmpdir(), "hh-clips-avsync");
  mkdirSync(cacheDir, { recursive: true });
  const binary = path.join(cacheDir, `avsync-${hash}`);
  if (!existsSync(binary)) {
    const sourceFile = path.join(cacheDir, `avsync-${hash}.swift`);
    writeFileSync(sourceFile, AVSYNC.source);
    const built = run("swiftc", ["-O", "-o", binary, sourceFile], { timeout: 280_000 });
    if (built.status !== 0) return { binary: null, error: `swiftc failed: ${built.stderr || built.error}` };
  }
  return { binary, error: "" };
}

/** AVFoundation's audio-minus-video offset (ms) at every flash of `file`. */
export function avsyncOffsets(binary: string, file: string): number[] {
  const result = run(binary, [file], { timeout: TOOL_TIMEOUT_MS });
  if (result.status !== 0) throw new Error(`avsync failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as { audioMinusVideoMs: number[] };
  return parsed.audioMinusVideoMs;
}

export interface SyncPair {
  flash: number;
  beep: number;
  ms: number;
}

/** Port of design/clips/prototype/probe/analyze_sync.py: flashes by luma, beeps by silence ends. */
export function ffmpegSync(file: string, ignoreEditList = false): { flashes: number[]; beeps: number[]; pairs: SyncPair[] } {
  const pre = ignoreEditList ? ["-ignore_editlist", "1"] : [];
  const video = run("ffmpeg", [
    "-hide_banner", "-nostats", ...pre, "-i", file, "-an",
    "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-",
  ]).stderr;
  const frames: Array<[number, number]> = [];
  let pts: number | null = null;
  for (const line of video.split("\n")) {
    const time = /pts_time:([\d.]+)/.exec(line);
    if (time) pts = Number(time[1]);
    const luma = /YAVG=([\d.]+)/.exec(line);
    if (luma && pts !== null) frames.push([pts, Number(luma[1])]);
  }
  const flashes = frames.filter(([, y]) => y > 200).map(([t]) => t);
  const audio = run("ffmpeg", [
    "-hide_banner", "-nostats", ...pre, "-i", file, "-vn", "-af", "silencedetect=n=-35dB:d=0.1", "-f", "null", "-",
  ]).stderr;
  // A beep starts where a silence ends and sound follows, so a later silence starts.
  // ffmpeg also reports the silence at the end of the file as a silence_end: no sound
  // follows it, so it is not a beep.
  const events = [...audio.matchAll(/silence_(start|end): ([\d.]+)/g)].map((match) => ({ kind: match[1], at: Number(match[2]) }));
  const beeps = events
    .filter((event, i) => event.kind === "end" && events.slice(i + 1).some((later) => later.kind === "start"))
    .map((event) => event.at);
  const pairs = flashes.map((flash) => {
    const beep = beeps.reduce((best, candidate) => (Math.abs(candidate - flash) < Math.abs(best - flash) ? candidate : best));
    return { flash, beep, ms: Math.round((beep - flash) * 10000) / 10 };
  });
  return { flashes, beeps, pairs };
}
