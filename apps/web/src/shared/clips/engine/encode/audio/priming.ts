/**
 * Priming calibration (plan 6.4: "Priming P: calibrated per session").
 *
 * The session encodes a short test burst with the same backend and the same
 * 1024-frame pre-pad as the live stream, decodes it with AudioDecoder, and
 * finds where the burst lands. The burst is a Hann-windowed linear chirp, so
 * a normalized cross-correlation has one sharp peak. A pure tone would repeat
 * every period, and a threshold on the onset would read a few samples late.
 *
 * Only the native encoder is calibrated. The WASM encoder is FFmpeg aacenc,
 * pinned by scripts/clips/aac-wasm, and its delay is fixed at 1024 (a decode
 * in ffmpeg measures it: aacWasmDecode.node.test.ts). A round trip
 * through the platform AudioDecoder would only add that decoder's behavior.
 *
 * The round trip measures encoder and decoder together. A platform decoder
 * that drops or compensates its first output buffers moves the result by a
 * whole number of frames. plausiblePriming rejects such a result, and every
 * value an AAC-LC encoder cannot have, so the caller uses the constant.
 *
 * Without AudioDecoder (or AudioData), or when the result is not plausible,
 * the caller uses the constants (native 2114, WASM 1024, plan 3a).
 */

import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from "../../../protocol";
import { AAC_FRAME, PRE_PAD_FRAMES, buildAudioSpecificConfig, type AacBackend, type AacSink } from "./aac";

/** Silence before the chirp, in real frames after the pre-pad. */
const LEAD_FRAMES = 4096;
const CHIRP_FRAMES = 2048;
const TAIL_FRAMES = 8192;
/** Largest raw result the measurement returns. Real encoders sit near 1024-2114. */
export const MAX_MEASURABLE_PRIMING = 8192;
/** An AAC-LC encoder delays by at least one frame (the first MDCT window). Less is a decoder artifact. */
export const MIN_PLAUSIBLE_PRIMING = AAC_FRAME;
/** Largest priming the session accepts from a measurement. */
export const MAX_PLAUSIBLE_PRIMING = 4096;
/** How close to a whole number of frames a difference from the constant must be to count as a dropped buffer. */
const FRAME_SHIFT_TOLERANCE = 16;
/** Weakest normalized correlation that counts as a match. */
const MIN_CORRELATION = 0.6;
/** Longest time the calibration may take. After it, the codecs are closed and the constant is used. */
export const CALIBRATION_TIMEOUT_MS = 3000;

/** The test burst: a Hann-windowed chirp from 400 Hz to 6 kHz, amplitude 0.7. */
export function calibrationChirp(): Float32Array {
  const c = new Float32Array(CHIRP_FRAMES);
  const f0 = 400;
  const f1 = 6000;
  for (let n = 0; n < CHIRP_FRAMES; n++) {
    const phase = (2 * Math.PI * (f0 * n + ((f1 - f0) * n * n) / (2 * CHIRP_FRAMES))) / AUDIO_SAMPLE_RATE;
    const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (CHIRP_FRAMES - 1));
    c[n] = 0.7 * env * Math.sin(phase);
  }
  return c;
}

/**
 * Finds D: the decoded index of real frame j is j + D. Returns null when no
 * clear match exists.
 */
export function locateChirp(decoded: Float32Array, chirp: Float32Array = calibrationChirp()): { delay: number; score: number } | null {
  let coarse = -1;
  for (let i = 0; i < decoded.length; i++) {
    if (Math.abs(decoded[i]) > 0.05) {
      coarse = i;
      break;
    }
  }
  if (coarse < 0) return null;
  let chirpEnergy = 0;
  for (const v of chirp) chirpEnergy += v * v;
  const from = Math.max(0, coarse - CHIRP_FRAMES);
  const to = Math.min(decoded.length - chirp.length, coarse + 256);
  let best = -Infinity;
  let bestAt = -1;
  for (let at = from; at <= to; at++) {
    let dot = 0;
    let energy = 0;
    for (let n = 0; n < chirp.length; n++) {
      const d = decoded[at + n];
      dot += d * chirp[n];
      energy += d * d;
    }
    const score = energy > 0 ? dot / Math.sqrt(energy * chirpEnergy) : 0;
    if (score > best) {
      best = score;
      bestAt = at;
    }
  }
  if (bestAt < 0 || best < MIN_CORRELATION) return null;
  return { delay: bestAt - LEAD_FRAMES, score: best };
}

/**
 * Accepts a measured priming, or returns null so the caller uses `known`
 * (the constant measured for this encoder family, plan 3a):
 * - below one frame or above MAX_PLAUSIBLE_PRIMING: no AAC-LC encoder has it;
 * - a whole number of frames away from `known` (within 16 samples): the
 *   platform decoder dropped or added whole output buffers.
 */
export function plausiblePriming(measured: number | null, known: number): number | null {
  if (measured === null || !Number.isFinite(measured)) return null;
  if (measured < MIN_PLAUSIBLE_PRIMING || measured > MAX_PLAUSIBLE_PRIMING) return null;
  const off = Math.abs(measured - known);
  const toFrame = Math.abs(off - Math.round(off / AAC_FRAME) * AAC_FRAME);
  if (off >= AAC_FRAME - FRAME_SHIFT_TOLERANCE && toFrame <= FRAME_SHIFT_TOLERANCE) return null;
  return measured;
}

/** True when this realm can decode AAC for calibration. */
export function canCalibrate(): boolean {
  return typeof AudioDecoder !== "undefined" && typeof AudioData !== "undefined" && typeof EncodedAudioChunk !== "undefined";
}

/** The codecs of one calibration run, so a timeout can close them. */
interface RunHandles {
  aborted: boolean;
  backend: AacBackend | null;
  decoder: AudioDecoder | null;
}

function abortRun(h: RunHandles): void {
  h.aborted = true;
  if (h.backend) closeQuietly(() => h.backend!.close());
  if (h.decoder) closeQuietly(() => h.decoder!.state !== "closed" && h.decoder!.close());
}

function closeQuietly(close: () => unknown): void {
  try {
    close();
  } catch {
    // The codec is already closed.
  }
}

/**
 * Measures P (without the pre-pad) for one backend. Returns null when the
 * device cannot measure it, the result is outside 0..MAX_MEASURABLE_PRIMING,
 * or the run takes longer than the time limit. On the time limit, the
 * encoder and decoder of the run are closed at once, so no codec stays open
 * beside the live stream.
 */
export async function measurePriming(
  createBackend: (sink: AacSink) => Promise<AacBackend>,
  options: { timeoutMs?: number } = {},
): Promise<number | null> {
  if (!canCalibrate()) return null;
  const handles: RunHandles = { aborted: false, backend: null, decoder: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      abortRun(handles);
      resolve(null);
    }, options.timeoutMs ?? CALIBRATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(createBackend, handles).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function run(createBackend: (sink: AacSink) => Promise<AacBackend>, h: RunHandles): Promise<number | null> {
  const packets: ArrayBuffer[] = [];
  let failure: unknown = null;
  const backend = await createBackend({
    packet: (d) => packets.push(d),
    error: (e) => {
      failure = e;
    },
  });
  if (h.aborted) {
    // The time limit came while the backend loaded. Nobody waits for it now.
    closeQuietly(() => backend.close());
    return null;
  }
  h.backend = backend;
  try {
    const real = LEAD_FRAMES + CHIRP_FRAMES + TAIL_FRAMES;
    const input = new Float32Array(PRE_PAD_FRAMES + real);
    input.set(calibrationChirp(), PRE_PAD_FRAMES + LEAD_FRAMES);
    backend.encode(input, input.slice());
    await backend.flush();
  } finally {
    closeQuietly(() => backend.close());
    h.backend = null;
  }
  if (h.aborted || failure || packets.length === 0) return null;

  const decoded = await decode(packets, h);
  if (!decoded || h.aborted) return null;
  const hit = locateChirp(decoded);
  if (!hit) return null;
  const priming = hit.delay - PRE_PAD_FRAMES;
  return priming >= 0 && priming <= MAX_MEASURABLE_PRIMING ? priming : null;
}

async function decode(packets: ArrayBuffer[], h: RunHandles): Promise<Float32Array | null> {
  const parts: Float32Array[] = [];
  let failed = false;
  const dec = new AudioDecoder({
    output: (audio) => {
      try {
        const plane = new Float32Array(audio.numberOfFrames);
        audio.copyTo(plane, { planeIndex: 0, format: "f32-planar" });
        parts.push(plane);
      } finally {
        audio.close();
      }
    },
    error: () => {
      failed = true;
    },
  });
  h.decoder = dec;
  try {
    dec.configure({
      codec: "mp4a.40.2",
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: AUDIO_CHANNELS,
      description: buildAudioSpecificConfig(AUDIO_SAMPLE_RATE, AUDIO_CHANNELS),
    });
    const dur = Math.round((AAC_FRAME * 1e6) / AUDIO_SAMPLE_RATE);
    packets.forEach((data, i) => dec.decode(new EncodedAudioChunk({ type: "key", timestamp: i * dur, duration: dur, data })));
    await dec.flush();
  } catch {
    failed = true;
  } finally {
    closeQuietly(() => dec.state !== "closed" && dec.close());
    h.decoder = null;
  }
  if (failed) return null;
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
