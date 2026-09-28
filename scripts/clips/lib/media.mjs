/**
 * Decoders for the clips lab analyzer: ffmpeg/ffprobe, and AVFoundation
 * through scripts/clips/avsync.swift on macOS.
 *
 * Each decode gives the same shape, so sync.mjs treats every decoder the same:
 *   { frames: Array<[time s, luma]>,
 *     segments: Array<{ start s, sampleRate, samples, binMs, peaks: number[] }> }
 *
 * - Video: ffmpeg signalstats YAVG per decoded frame, with the frame's
 *   presentation time (the edit list applied, unless ignoreEditList).
 * - Audio: ffmpeg decodes to 48 kHz mono float. ashowinfo logs the time and
 *   the sample count of every frame that goes to stdout, so each sample has
 *   an exact time, also across a gap. A new segment starts where a frame's
 *   time does not follow on from the samples before it.
 * - A missing tool is not an error. probeTools() says what is missing and
 *   why, and the analyzer turns that into SKIPPED rows.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Sample rate of the audio envelope. The lab and the clip encoder use 48 kHz. */
export const ENVELOPE_RATE = 48000;
/** Envelope bin length (ms). */
export const BIN_MS = 1;
/** A frame whose time is further than this from the end of the samples before it starts a new segment (s). */
export const SEGMENT_TOLERANCE_SEC = 0.00025;

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The AVFoundation reader source. */
export const AVSYNC_SOURCE = path.resolve(HERE, "..", "avsync.swift");

/**
 * Runs a command and collects its output. Never throws: a missing command
 * gives { error }, and a non-zero exit gives its status.
 *
 * @returns {Promise<{ status: number | null, stdout: Buffer, stderr: string, error: Error | null }>}
 */
export function run(command, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], cwd: options.cwd });
    } catch (error) {
      resolve({ status: null, stdout: Buffer.alloc(0), stderr: "", error });
      return;
    }
    const out = [];
    const err = [];
    let settled = false;
    const timer = options.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs) : null;
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8"), error });
    };
    child.on("error", (error) => finish(null, error));
    child.on("close", (status) => finish(status, null));
  });
}

function toolWorks(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return !result.error && result.status === 0;
}

/**
 * Which decoders this machine has.
 *
 * @returns {{ ffmpeg: { ok: boolean, reason: string }, avfoundation: { ok: boolean, reason: string } }}
 */
export function probeTools(options = {}) {
  const ffmpeg = options.ffmpeg ?? "ffmpeg";
  const ffprobe = options.ffprobe ?? "ffprobe";
  const platform = options.platform ?? process.platform;
  const hasFfmpeg = toolWorks(ffmpeg, ["-hide_banner", "-version"]);
  const hasFfprobe = toolWorks(ffprobe, ["-hide_banner", "-version"]);
  const ffmpegReason = !hasFfmpeg ? "ffmpeg not found" : !hasFfprobe ? "ffprobe not found" : "";
  let avfReason = "";
  if (platform !== "darwin") avfReason = "AVFoundation needs macOS";
  else if (!toolWorks(options.swiftc ?? "swiftc", ["--version"])) avfReason = "swiftc not found";
  else if (!existsSync(options.avsyncSource ?? AVSYNC_SOURCE)) avfReason = "scripts/clips/avsync.swift is missing";
  return {
    ffmpeg: { ok: !ffmpegReason, reason: ffmpegReason },
    avfoundation: { ok: !avfReason, reason: avfReason },
  };
}

/**
 * Container facts from ffprobe.
 *
 * @returns {Promise<{ durationSec: number | null, video: string, audio: string, streams: object[] }>}
 */
export async function probeContainer(file, options = {}) {
  const result = await run(options.ffprobe ?? "ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,duration,start_time,avg_frame_rate,nb_frames,sample_rate,channels",
    "-of", "json", file,
  ]);
  if (result.status !== 0) throw new Error(`ffprobe failed on ${file}: ${result.stderr.trim() || result.error}`);
  const json = JSON.parse(result.stdout.toString("utf8"));
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const duration = Number(json.format?.duration);
  return {
    durationSec: Number.isFinite(duration) ? duration : null,
    video: video ? `video ${video.codec_name} ${video.width}x${video.height} ${video.nb_frames ?? "?"} frames, avg ${video.avg_frame_rate}` : "no video track",
    audio: audio ? `audio ${audio.codec_name} ${audio.sample_rate} Hz ${audio.channels} ch, ${audio.duration ?? "?"} s` : "no audio track",
    streams,
  };
}

/** Parses ffmpeg `metadata=mode=print` output: pts_time lines followed by a YAVG line. */
export function parseLumaLog(text) {
  const frames = [];
  let pts = null;
  for (const line of text.split("\n")) {
    const time = /pts_time:(-?[\d.]+(?:e-?\d+)?)/.exec(line);
    if (time) pts = Number(time[1]);
    const luma = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (luma && pts !== null) {
      frames.push([pts, Number(luma[1])]);
      pts = null;
    }
  }
  return frames;
}

/** Parses ffmpeg ashowinfo lines: the time, the sample count and the rate of each frame. */
export function parseAudioFrameLog(text) {
  const frames = [];
  for (const line of text.split("\n")) {
    if (!line.includes("ashowinfo")) continue;
    const time = /pts_time:(-?[\d.]+(?:e-?\d+)?)/.exec(line);
    const count = /nb_samples:(\d+)/.exec(line);
    const rate = /rate:(\d+)/.exec(line);
    if (time && count) frames.push({ time: Number(time[1]), samples: Number(count[1]), rate: rate ? Number(rate[1]) : ENVELOPE_RATE });
  }
  return frames;
}

/**
 * Splits decoded samples into continuous segments and makes the 1 ms peak
 * envelope of each.
 *
 * @param {Float32Array} samples all samples, in frame order
 * @param {Array<{ time: number, samples: number, rate: number }>} frames
 */
export function envelopeSegments(samples, frames, options = {}) {
  const tolerance = options.toleranceSec ?? SEGMENT_TOLERANCE_SEC;
  const binMs = options.binMs ?? BIN_MS;
  const total = frames.reduce((sum, frame) => sum + frame.samples, 0);
  if (total !== samples.length) {
    throw new Error(`the decoder logged ${total} samples but wrote ${samples.length}`);
  }
  const segments = [];
  let current = null;
  let cursor = 0;
  for (const frame of frames) {
    const rate = frame.rate;
    const binSamples = Math.max(1, Math.round((rate * binMs) / 1000));
    const expected = current ? current.start + current.samples / current.sampleRate : null;
    if (!current || current.sampleRate !== rate || Math.abs(frame.time - expected) > tolerance) {
      current = { start: frame.time, sampleRate: rate, samples: 0, binMs, peaks: [], binSamples };
      segments.push(current);
    }
    for (let i = 0; i < frame.samples; i++) {
      const bin = Math.floor(current.samples / current.binSamples);
      const value = Math.abs(samples[cursor + i]);
      if (bin >= current.peaks.length) current.peaks.push(value);
      else if (value > current.peaks[bin]) current.peaks[bin] = value;
      current.samples++;
    }
    cursor += frame.samples;
  }
  return segments.map(({ binSamples, ...segment }) => {
    void binSamples;
    return segment;
  });
}

function float32From(buffer) {
  const copy = new Uint8Array(buffer.length - (buffer.length % 4));
  copy.set(buffer.subarray(0, copy.length));
  return new Float32Array(copy.buffer);
}

/**
 * Decodes the picture and the sound of `file` with ffmpeg.
 *
 * @returns {Promise<{ frames: Array<[number, number]>, segments: object[] }>}
 */
export async function ffmpegDecode(file, options = {}) {
  const ffmpeg = options.ffmpeg ?? "ffmpeg";
  const pre = options.ignoreEditList ? ["-ignore_editlist", "1"] : [];
  const [video, audio] = await Promise.all([
    run(ffmpeg, [
      "-hide_banner", "-nostats", "-loglevel", "info", ...pre, "-i", file,
      "-map", "0:v:0", "-an", "-vf", "signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG", "-f", "null", "-",
    ]),
    run(ffmpeg, [
      "-hide_banner", "-nostats", "-loglevel", "info", ...pre, "-i", file,
      "-map", "0:a:0", "-vn", "-af", `aformat=sample_fmts=flt:channel_layouts=mono:sample_rates=${ENVELOPE_RATE},ashowinfo`,
      "-f", "f32le", "-",
    ]),
  ]);
  if (video.status !== 0) throw new Error(`ffmpeg could not decode the video of ${file}: ${video.stderr.slice(-400) || video.error}`);
  const frames = parseLumaLog(video.stderr);
  let segments = [];
  if (audio.status === 0) {
    segments = envelopeSegments(float32From(audio.stdout), parseAudioFrameLog(audio.stderr));
  } else if (!/matches no streams|does not contain any stream/i.test(audio.stderr)) {
    throw new Error(`ffmpeg could not decode the audio of ${file}: ${audio.stderr.slice(-400) || audio.error}`);
  }
  return { frames, segments };
}

/**
 * Builds avsync.swift once per source version (the binary name carries a
 * hash of the source) in the system temp folder.
 *
 * @returns {Promise<string>} the binary path
 */
export async function buildAvsync(options = {}) {
  const sourcePath = options.avsyncSource ?? AVSYNC_SOURCE;
  const source = readFileSync(sourcePath);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const dir = options.cacheDir ?? path.join(tmpdir(), "hh-clips-avsync");
  mkdirSync(dir, { recursive: true });
  const binary = path.join(dir, `avsync-lab-${hash}`);
  if (existsSync(binary)) return binary;
  // Build under a private name, then rename: two runs at the same time never see half a binary.
  const building = `${binary}.${process.pid}.${Date.now()}`;
  const built = await run(options.swiftc ?? "swiftc", ["-o", building, sourcePath]);
  if (built.status !== 0) {
    rmSync(building, { force: true });
    throw new Error(`swiftc could not build avsync.swift: ${built.stderr.slice(-600) || built.error}`);
  }
  renameSync(building, binary);
  return binary;
}

/**
 * Decodes `file` with AVFoundation (AVAssetReader: the stack that iPhone
 * Photos and Messages use).
 */
export async function avfoundationDecode(file, options = {}) {
  const binary = await buildAvsync(options);
  const result = await run(binary, [file]);
  if (result.status !== 0) throw new Error(`avsync failed on ${file}: ${result.stderr.trim() || result.error}`);
  const json = JSON.parse(result.stdout.toString("utf8"));
  const segments = (json.audio?.segments ?? []).map((segment) => ({
    start: segment.start,
    sampleRate: json.audio.sampleRate,
    samples: segment.samples,
    binMs: json.audio.binMs,
    peaks: segment.peaks,
  }));
  return { frames: json.video.frames, segments };
}
