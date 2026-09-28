// @vitest-environment node
/**
 * Real-decoder checks of the AAC WASM module (plan 5 tier W+, 6.4, 3a).
 *
 * The committed module (apps/web/public/clips/aac) encodes through the real
 * WASM backend. ffmpeg, an independent decoder, then reads the result:
 *   (a) ffprobe reads AAC-LC at 48 kHz with 2 channels;
 *   (b) ffmpeg decodes it with no errors, and the audio is the same tone,
 *       at the same level, in the same channel;
 *   (c) the decoded audio is late by exactly the priming that the session
 *       uses for this backend (PRIMING_CONSTANTS.wasm, 1024 frames). The
 *       session writes the -P shift into every packet timestamp, so a wrong
 *       constant would move all clip audio.
 * The raw packets go into an ADTS stream, because ADTS carries no priming
 * information: ffmpeg then gives every decoded sample, and (c) sees the full
 * encoder delay.
 *
 * Without ffmpeg and ffprobe, the tests are skipped and the reason shows in
 * the suite name.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AAC_FRAME, PRE_PAD_FRAMES, PRIMING_CONSTANTS, type AacSink } from "../audio/aac";
import { createWasmBackend, type AacWasmModule } from "../audio/aacBackends";
import { calibrationChirp, plausiblePriming } from "../audio/priming";
import { loadAacWasmFromDisk, toAdts } from "./aacWasmModule";

const SR = 48000;
const TOOL_TIMEOUT_MS = 60_000;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout: TOOL_TIMEOUT_MS });
  return {
    status: result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
    error: result.error,
  };
}

function available(command: string): boolean {
  const result = run(command, ["-hide_banner", "-version"]);
  return !result.error && result.status === 0;
}

const HAS_FFMPEG = available("ffmpeg") && available("ffprobe");
const REASON = HAS_FFMPEG ? "" : "ffmpeg or ffprobe not found";

/** Encodes planar stereo with the real WASM backend. Returns the raw AAC packets. */
async function encode(mod: AacWasmModule, left: Float32Array, right: Float32Array): Promise<ArrayBuffer[]> {
  const packets: ArrayBuffer[] = [];
  const errors: unknown[] = [];
  const sink: AacSink = { packet: (d) => packets.push(d), error: (e) => errors.push(e) };
  const backend = await createWasmBackend(sink, { load: async () => mod });
  for (let at = 0; at < left.length; at += 8192) {
    backend.encode(left.subarray(at, at + 8192), right.subarray(at, at + 8192));
  }
  await backend.flush();
  backend.close();
  expect(errors).toEqual([]);
  return packets;
}

/** Decodes an ADTS file with ffmpeg to interleaved float stereo. */
function decode(file: string): { left: Float32Array; right: Float32Array; stderr: string } {
  const out = run("ffmpeg", ["-hide_banner", "-v", "error", "-i", file, "-f", "f32le", "-c:a", "pcm_f32le", "-"]);
  expect(out.error).toBeUndefined();
  expect(out.status).toBe(0);
  const bytes = out.stdout;
  const all = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const frames = all.length / 2;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = all[i * 2];
    right[i] = all[i * 2 + 1];
  }
  return { left, right, stderr: out.stderr };
}

function rms(x: Float32Array): number {
  let sum = 0;
  for (const v of x) sum += v * v;
  return Math.sqrt(sum / x.length);
}

/** Amplitude of the `hz` component (a single-bin DFT). */
function toneAmplitude(x: Float32Array, hz: number): number {
  let re = 0;
  let im = 0;
  for (let n = 0; n < x.length; n++) {
    const w = (2 * Math.PI * hz * n) / SR;
    re += x[n] * Math.cos(w);
    im -= x[n] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / x.length;
}

/** The lag where `probe` best matches `signal` (normalized cross-correlation), in [from, to]. */
function bestLag(signal: Float32Array, probe: Float32Array, from: number, to: number): { lag: number; score: number } {
  let probeEnergy = 0;
  for (const v of probe) probeEnergy += v * v;
  let best = { lag: -1, score: -Infinity };
  for (let lag = from; lag <= Math.min(to, signal.length - probe.length); lag++) {
    let dot = 0;
    let energy = 0;
    for (let n = 0; n < probe.length; n++) {
      const s = signal[lag + n];
      dot += s * probe[n];
      energy += s * s;
    }
    const score = energy > 0 ? dot / Math.sqrt(energy * probeEnergy) : 0;
    if (score > best.score) best = { lag, score };
  }
  return best;
}

describe.skipIf(!!REASON)(`AAC WASM output in a real decoder${REASON ? ` (skipped: ${REASON})` : ""}`, () => {
  let mod: AacWasmModule;
  let dir: string;

  beforeAll(async () => {
    mod = await loadAacWasmFromDisk();
    dir = mkdtempSync(path.join(tmpdir(), "aac-wasm-decode-"));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("encodes 1 s of a 1 kHz sine as valid AAC-LC, 48 kHz, stereo, that decodes to the same tone", async () => {
    const left = new Float32Array(SR);
    const right = new Float32Array(SR);
    for (let n = 0; n < SR; n++) {
      const s = Math.sin((2 * Math.PI * 1000 * n) / SR);
      left[n] = 0.5 * s;
      right[n] = 0.25 * s;
    }
    const packets = await encode(mod, left, right);
    expect(packets.length).toBe(Math.ceil((SR + PRIMING_CONSTANTS.wasm) / AAC_FRAME));
    const file = path.join(dir, "sine.aac");
    writeFileSync(file, toAdts(packets));

    const probe = run("ffprobe", [
      "-hide_banner",
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,profile,sample_rate,channels",
      "-of",
      "json",
      file,
    ]);
    expect(probe.status).toBe(0);
    const stream = JSON.parse(probe.stdout.toString("utf8")).streams[0];
    expect(stream).toMatchObject({ codec_name: "aac", profile: "LC", sample_rate: "48000", channels: 2 });

    const { left: l, right: r, stderr } = decode(file);
    // No decode error or warning at all.
    expect(stderr).toBe("");
    // One 1024-frame output per packet.
    expect(l.length).toBe(packets.length * AAC_FRAME);
    // The steady middle of the tone: skip the delay and the edges.
    const from = PRIMING_CONSTANTS.wasm + 4096;
    const to = PRIMING_CONSTANTS.wasm + SR - 4096;
    const midL = l.subarray(from, to);
    const midR = r.subarray(from, to);
    expect(toneAmplitude(midL, 1000)).toBeCloseTo(0.5, 1);
    expect(toneAmplitude(midR, 1000)).toBeCloseTo(0.25, 1);
    // Almost all of the energy is the 1 kHz tone (a pure sine has RMS = amplitude / sqrt 2).
    expect(toneAmplitude(midL, 1000) / Math.SQRT2 / rms(midL)).toBeGreaterThan(0.99);
    expect(toneAmplitude(midR, 1000) / Math.SQRT2 / rms(midR)).toBeGreaterThan(0.99);
    // The channels stay in their place: left is twice as loud as right.
    expect(rms(midL) / rms(midR)).toBeGreaterThan(1.9);
    expect(rms(midL) / rms(midR)).toBeLessThan(2.1);
  });

  it("delays the audio by exactly the priming that the session uses (1024 frames, plan 3a)", async () => {
    // The live stream shape: the 1024-frame silent pre-pad, then silence, a chirp, and silence.
    const lead = 4096;
    const chirp = calibrationChirp();
    const input = new Float32Array(PRE_PAD_FRAMES + lead + chirp.length + 8192);
    input.set(chirp, PRE_PAD_FRAMES + lead);
    const packets = await encode(mod, input, input.slice());
    const file = path.join(dir, "chirp.aac");
    writeFileSync(file, toAdts(packets));
    const { left, stderr } = decode(file);
    expect(stderr).toBe("");
    const hit = bestLag(left, chirp, 0, input.length);
    expect(hit.score).toBeGreaterThan(0.95);
    const measured = hit.lag - (PRE_PAD_FRAMES + lead);
    expect(measured).toBe(PRIMING_CONSTANTS.wasm);
    expect(plausiblePriming(measured, PRIMING_CONSTANTS.wasm)).toBe(PRIMING_CONSTANTS.wasm);
  });

  it("gives byte-identical packets for the same audio, so one stream leaves no state for the next", async () => {
    const tone = new Float32Array(SR / 2);
    for (let n = 0; n < tone.length; n++) tone[n] = 0.4 * Math.sin((2 * Math.PI * 440 * n) / SR);
    const a = toAdts(await encode(mod, tone, tone.slice()));
    const b = toAdts(await encode(mod, tone, tone.slice()));
    expect(a.byteLength).toBeGreaterThan(0);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });
});
