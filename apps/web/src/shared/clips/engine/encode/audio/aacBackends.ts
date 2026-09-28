/**
 * AAC encoder backends.
 *
 * native: AudioEncoder (mp4a.40.2, 48 kHz, 2 channels, 128 kbps). It needs
 * AudioData to feed it, so a device with AudioEncoder but no AudioData uses
 * the WASM backend.
 *
 * wasm: @mediabunny/aac-encoder (FFmpeg aacenc). The package exports only
 * registerAacEncoder(); its encoder class is not reachable. So the backend
 * feeds a mediabunny AudioSampleSource that writes to an ADTS Output with a
 * NullTarget. In mediabunny 1.60.0 the ADTS muxer writes each frame at once
 * and keeps no sample table, and NullTarget discards the bytes, so memory
 * stays flat for any stream length. (An MP4 Output would keep a table entry
 * for every sample.) Packets come out through onEncodedPacket as raw AAC,
 * because mediabunny always configures format "aac", never "adts".
 *
 * Neither backend uses the encoder's own AudioSpecificConfig. Clips always
 * carry the rebuilt one (WebKit 302253).
 */

import { AUDIO_BITRATE, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from "../../../protocol";
import { copyToArrayBuffer } from "../bytes";
import { AAC_FRAME, MAX_BACKLOG_FRAMES, type AacBackend, type AacBackendFactory, type AacKind, type AacSink } from "./aac";

export const NATIVE_AAC_CONFIG: AudioEncoderConfig = {
  codec: "mp4a.40.2",
  sampleRate: AUDIO_SAMPLE_RATE,
  numberOfChannels: AUDIO_CHANNELS,
  bitrate: AUDIO_BITRATE,
};

/** True when this realm can run the native backend. */
export async function nativeAacSupported(): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return false;
  try {
    return (await AudioEncoder.isConfigSupported(NATIVE_AAC_CONFIG)).supported === true;
  } catch {
    return false;
  }
}

function planarData(left: Float32Array, right: Float32Array): Float32Array<ArrayBuffer> {
  const data = new Float32Array(left.length * 2);
  data.set(left);
  data.set(right, left.length);
  return data;
}

export async function createNativeBackend(sink: AacSink): Promise<AacBackend> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    throw new Error("AudioEncoder or AudioData is not available");
  }
  const support = await AudioEncoder.isConfigSupported(NATIVE_AAC_CONFIG);
  if (!support.supported) throw new Error("AAC-LC 48 kHz stereo is not supported");
  let failed = false;
  let frames = 0;
  let packets = 0;
  const enc = new AudioEncoder({
    output: (chunk) => {
      packets++;
      const data = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(data);
      sink.packet(data);
    },
    error: (e) => {
      if (failed) return;
      failed = true;
      sink.error(e);
    },
  });
  enc.configure(NATIVE_AAC_CONFIG);
  return {
    kind: "native",
    encode(left, right) {
      // Frames fed minus frames that came out as packets: what the encoder still holds.
      if (frames - packets * AAC_FRAME > MAX_BACKLOG_FRAMES) throw new Error("native AAC encoder is not keeping up");
      const audio = new AudioData({
        format: "f32-planar",
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfFrames: left.length,
        numberOfChannels: AUDIO_CHANNELS,
        timestamp: Math.round((frames * 1e6) / AUDIO_SAMPLE_RATE),
        data: planarData(left, right),
      });
      frames += left.length;
      try {
        enc.encode(audio);
      } finally {
        audio.close();
      }
    },
    async flush() {
      if (enc.state === "configured") await enc.flush();
    },
    close() {
      if (enc.state !== "closed") enc.close();
    },
  };
}

export async function createWasmBackend(sink: AacSink): Promise<AacBackend> {
  const [mb, aac] = await Promise.all([import("mediabunny"), import("@mediabunny/aac-encoder")]);
  aac.registerAacEncoder();
  let failed = false;
  const fail = (e: unknown) => {
    if (failed) return;
    failed = true;
    sink.error(e);
  };
  const output = new mb.Output({ format: new mb.AdtsOutputFormat(), target: new mb.NullTarget() });
  const source = new mb.AudioSampleSource({
    codec: "aac",
    quality: new mb.Quality({ bitrate: AUDIO_BITRATE }),
    onEncodedPacket: (packet) => {
      if (!failed) sink.packet(copyToArrayBuffer(packet.data));
    },
  });
  output.addAudioTrack(source);
  await output.start();
  let frames = 0;
  let backlog = 0;
  let chain: Promise<void> = Promise.resolve();
  return {
    kind: "wasm",
    encode(left, right) {
      if (failed) throw new Error("WASM AAC encoder failed");
      if (backlog > MAX_BACKLOG_FRAMES) throw new Error("WASM AAC encoder is not keeping up");
      const n = left.length;
      const sample = new mb.AudioSample({
        data: planarData(left, right),
        format: "f32-planar",
        numberOfChannels: AUDIO_CHANNELS,
        sampleRate: AUDIO_SAMPLE_RATE,
        timestamp: frames / AUDIO_SAMPLE_RATE,
      });
      frames += n;
      backlog += n;
      chain = chain
        .then(() => source.add(sample))
        .catch(fail)
        .finally(() => {
          backlog -= n;
          sample.close();
        });
    },
    async flush() {
      await chain;
      if (failed) return;
      try {
        await output.finalize();
      } catch (e) {
        // finalize() throws for an empty ADTS file. That only means no packet was due.
        if (!/empty ADTS/i.test(String((e as Error)?.message ?? e))) fail(e);
      }
    },
    close() {
      if (output.state === "started" || output.state === "pending") void output.cancel().catch(() => {});
    },
  };
}

/** The factory the worker uses: the real backend for each kind. */
export const createAacBackend: AacBackendFactory = (kind: AacKind, sink: AacSink) =>
  kind === "native" ? createNativeBackend(sink) : createWasmBackend(sink);
