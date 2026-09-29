#!/usr/bin/env node
/**
 * Clips lab A/V analyzer (plan 15.2, 15.3).
 *
 * Usage:
 *   node scripts/clips/analyze-sync.mjs <file.mp4> [options]
 *
 * Options:
 *   --mode live|synthetic   live (default): each beep inside ITU-R BT.1359
 *                           (sound -45..+125 ms from the picture).
 *                           synthetic: each beep within 5 ms of --expect-offset.
 *   --expect-offset <ms>    synthetic mode: the offset the file was made with.
 *   --rung <fps>            the settled capture rung (ClipRecord.fps), for the fps check.
 *   --profile desktop|phone effective fps must be 90% (desktop) or 80% (phone) of the rung.
 *   --expect-seconds <s>    the asked clip or recording length, for the length check.
 *   --beat-interval <s>     the lab's beat interval. Default: from --truth, else
 *                           from the file's own beats (sync.mjs fileBeatInterval).
 *   --truth <path>          the lab's ground truth (the JSON that the E2E spec and
 *                           the iOS driver write next to each file), for the
 *                           truth.mjs rows: which beats the file holds and where
 *                           it ends.
 *   --json <path>           also write the rows and the measurements as JSON.
 *
 * What it does:
 *   - ffprobe: container duration and streams.
 *   - ffmpeg: luma per video frame and a 1 ms sound envelope, once with the
 *     edit lists applied and once with -ignore_editlist 1 (plan 6.4).
 *   - AVFoundation (macOS with swiftc): the same series from
 *     scripts/clips/avsync.swift, the decoder that iPhone Photos uses.
 *   - scripts/clips/lib/sync.mjs pairs each flash with its beep and makes
 *     the rows.
 * It prints one PASS, FAIL, SKIPPED or INFO row per check, then the offset
 * of each beep in each decoder.
 *
 * Each decoder runs on its own, and one decoder that fails never removes
 * the rows of the others:
 *   - A missing tool gives SKIPPED rows, never a failure. So does an
 *     avsync.swift that swiftc cannot build (an SDK or a Command Line Tools
 *     update can break the build): the reader is not usable here.
 *   - A decoder that is here and cannot read the file gives FAIL rows.
 * Exit status: 0 when no row failed, 1 when a row failed, 2 on a usage
 * error or a file that does not exist.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { avfoundationDecode, buildAvsync, ffmpegDecode, probeContainer, probeTools } from "./lib/media.mjs";
import { analyzeDecode, beepTable, evaluate, formatBeepTable, formatRows, passed } from "./lib/sync.mjs";

/** The first line of an error, at most `max` characters, for a row detail. */
export function errorText(error, max = 400) {
  const text = String(error instanceof Error ? error.message : error).trim();
  const first = text.split("\n").find((line) => line.trim()) ?? text;
  return first.length > max ? `${first.slice(0, max - 3)}...` : first;
}

/** Waits for a promise and gives { ok, value } or { ok: false, error }. It never rejects. */
function settle(promise) {
  return Promise.resolve(promise).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
}

/**
 * The truth object for the analyzer from a JSON file: the E2E spec's
 * { status, truth } file, or a truth object itself.
 */
export function readTruthFile(file) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  const truth = json && typeof json === "object" && json.truth && Array.isArray(json.truth.beats) ? json.truth : json;
  if (!truth || !Array.isArray(truth.beats)) throw new Error(`${file} has no beat log (a "beats" array)`);
  return truth;
}

/**
 * Analyses one file.
 *
 * @param {string} file
 * @param {{ mode?: "live" | "synthetic", expectOffsetMs?: number, rungFps?: number | null,
 *           profile?: "desktop" | "phone", expectSeconds?: number | null, beatIntervalSec?: number | null,
 *           truth?: object | null, tools?: ReturnType<typeof probeTools>, ffmpeg?: string, ffprobe?: string,
 *           swiftc?: string, avsyncSource?: string, avsyncBinary?: string, cacheDir?: string }} [options]
 */
export async function analyzeSync(file, options = {}) {
  if (!existsSync(file)) throw new Error(`no such file: ${file}`);
  const tools = options.tools ?? probeTools(options);
  const skipped = {
    ffmpeg: tools.ffmpeg.ok ? null : tools.ffmpeg.reason,
    avfoundation: tools.avfoundation.ok ? null : tools.avfoundation.reason,
  };
  const failed = { ffprobe: null, ffmpeg: null, ffmpegRaw: null, avfoundation: null };

  // AVFoundation: build the reader, then read. A build failure is a tool that is not usable (SKIPPED).
  const avfoundationTask = async () => {
    const built = await settle(options.avsyncBinary ?? buildAvsync(options));
    if (!built.ok) {
      skipped.avfoundation = errorText(built.error);
      return null;
    }
    const read = await settle(avfoundationDecode(file, { ...options, avsyncBinary: built.value }));
    if (!read.ok) failed.avfoundation = errorText(read.error);
    return read.ok ? read.value : null;
  };
  const ffmpegTask = async (promise, key) => {
    const done = await settle(promise);
    if (!done.ok) failed[key] = errorText(done.error);
    return done.ok ? done.value : null;
  };

  // The decoders are independent, so they run at the same time.
  const [container, ffmpeg, ffmpegRaw, avfoundation] = await Promise.all([
    tools.ffmpeg.ok ? ffmpegTask(probeContainer(file, options), "ffprobe") : null,
    tools.ffmpeg.ok ? ffmpegTask(ffmpegDecode(file, options), "ffmpeg") : null,
    tools.ffmpeg.ok ? ffmpegTask(ffmpegDecode(file, { ...options, ignoreEditList: true }), "ffmpegRaw") : null,
    tools.avfoundation.ok ? avfoundationTask() : null,
  ]);
  const measure = {
    container,
    ffmpeg: ffmpeg ? analyzeDecode(ffmpeg) : null,
    ffmpegRaw: ffmpegRaw ? analyzeDecode(ffmpegRaw) : null,
    avfoundation: avfoundation ? analyzeDecode(avfoundation) : null,
    skipped,
    failed,
  };
  const rows = evaluate(measure, options);
  return { file, rows, ok: passed(rows), beeps: beepTable(measure), measure, tools };
}

function parseArgs(argv) {
  const options = { mode: "live", profile: "desktop" };
  let file = null;
  let json = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    const num = () => {
      const value = Number(next());
      if (!Number.isFinite(value)) throw new Error(`${arg} needs a number`);
      return value;
    };
    if (arg === "--mode") {
      const mode = next();
      if (mode !== "live" && mode !== "synthetic") throw new Error("--mode is live or synthetic");
      options.mode = mode;
    } else if (arg === "--expect-offset") options.expectOffsetMs = num();
    else if (arg === "--rung") options.rungFps = num();
    else if (arg === "--profile") {
      const profile = next();
      if (profile !== "desktop" && profile !== "phone") throw new Error("--profile is desktop or phone");
      options.profile = profile;
    } else if (arg === "--expect-seconds") options.expectSeconds = num();
    else if (arg === "--beat-interval") {
      const value = num();
      if (value <= 0) throw new Error("--beat-interval needs a number of seconds over 0");
      options.beatIntervalSec = value;
    } else if (arg === "--truth") options.truth = readTruthFile(next());
    else if (arg === "--json") json = next();
    else if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else if (file === null) file = arg;
    else throw new Error(`one file only (got ${file} and ${arg})`);
  }
  if (file === null) throw new Error("give the file to analyse");
  return { file, json, options };
}

const USAGE =
  "Usage: node scripts/clips/analyze-sync.mjs <file.mp4> [--mode live|synthetic] [--expect-offset ms] [--rung fps] [--profile desktop|phone] [--expect-seconds s] [--beat-interval s] [--truth lab.json] [--json out.json]";

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`analyze-sync: ${error.message}\n${USAGE}`);
    process.exit(2);
  }
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  let result;
  try {
    result = await analyzeSync(path.resolve(parsed.file), parsed.options);
  } catch (error) {
    console.error(`analyze-sync: ${error.message}`);
    process.exit(2);
  }
  console.log(formatRows(result.rows, path.basename(parsed.file)));
  console.log(`\nPer beep (sound minus picture; + means the sound comes later):\n${formatBeepTable(result.beeps)}`);
  if (parsed.json) writeFileSync(parsed.json, JSON.stringify({ file: result.file, ok: result.ok, rows: result.rows, beeps: result.beeps, measure: result.measure }, null, 1));
  process.exit(result.ok ? 0 : 1);
}

// No top-level await: the Playwright spec and the iOS script load this file as a module.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`analyze-sync: ${error.stack || error}`);
    process.exit(2);
  });
}
