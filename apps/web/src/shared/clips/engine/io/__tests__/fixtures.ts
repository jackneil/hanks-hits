/**
 * Test fixtures for the io worker and the library: ClipPackets with a real avcC and
 * small packets, like the encode worker sends. The bytes do not decode to pictures;
 * the checks that need real decoding use ffmpeg (mux.av.node.test.ts).
 */

import type { ClipPackets, EpochInfo, PacketDTO } from "../../../protocol";
import { muxClip } from "../mux";

/** avcC of a 64x64 High-profile stream from libx264 (profile 0x64, level 1.0). */
export const AVCC_64_HEX =
  "0164000affe100166764000aacb421360220000003002000000781e244d401000468ef0fcbfdf8f800";

/** A second, different avcC (same SPS with another level), for epoch tests. */
export const AVCC_64_OTHER_HEX =
  "0164000bffe100166764000bacb421360220000003002000000781e244d401000468ef0fcbfdf8f800";

export function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function epochInfo(epoch = 0, avccHex = AVCC_64_HEX, size = 64): EpochInfo {
  return {
    epoch,
    codec: "avc1.64000a",
    codedWidth: size,
    codedHeight: size,
    description: hexBytes(avccHex).buffer,
  };
}

/** AAC-LC 48 kHz stereo AudioSpecificConfig. */
export const ASC_48K_STEREO_HEX = "1190";

export const AAC_FRAME_SAMPLES = 1024;

function packetBytes(kind: "key" | "delta" | "audio", index: number): ArrayBuffer {
  // AVCC framing: a 4-byte length, then one NAL unit (IDR = type 5, slice = type 1).
  if (kind === "key") return new Uint8Array([0, 0, 0, 4, 0x65, 0x88, 0x84, index & 0xff]).buffer;
  if (kind === "delta") return new Uint8Array([0, 0, 0, 3, 0x41, 0x9a, index & 0xff]).buffer;
  return new Uint8Array([0x21, 0x10, 0x04, index & 0xff, (index >> 8) & 0xff]).buffer;
}

export interface ClipOptions {
  /** Video length in seconds. Default 2. */
  seconds?: number;
  fps?: number;
  /** Frames per GOP. Default fps (a keyframe each second). */
  gop?: number;
  /** Timeline value of the first video frame, in microseconds. Default 5 s (not 0, to test rebasing). */
  baseUs?: number;
  /** Encoder delay in samples. Default 2114 (measured WebKit, plan 3a). */
  primingSamples?: number;
  /** Include audio. Default true. */
  audio?: boolean;
  /** Audio starts this long before the first video frame, in microseconds. Default 100 ms. */
  audioLeadUs?: number;
  /** Audio config description. Default a valid ASC. */
  audioDescription?: ArrayBuffer;
  epoch?: EpochInfo;
  requestId?: string;
}

/**
 * Builds ClipPackets. Audio packet timestamps are encoder-style: the time of the PCM
 * the packet starts at, before the priming shift (as AudioEncoder reports them).
 */
export function makeClipPackets(options: ClipOptions = {}): ClipPackets {
  const seconds = options.seconds ?? 2;
  const fps = options.fps ?? 30;
  const gop = options.gop ?? fps;
  const baseUs = options.baseUs ?? 5_000_000;
  const epoch = options.epoch ?? epochInfo();
  const frameUs = 1e6 / fps;
  const frames = Math.round(seconds * fps);
  const video: PacketDTO[] = [];
  for (let i = 0; i < frames; i++) {
    const type = i % gop === 0 ? "key" : "delta";
    video.push({
      kind: "video",
      type,
      tsUs: Math.round(baseUs + i * frameUs),
      durUs: Math.round(baseUs + (i + 1) * frameUs) - Math.round(baseUs + i * frameUs),
      data: packetBytes(type, i),
      epoch: epoch.epoch,
    });
  }
  const audio: PacketDTO[] = [];
  const withAudio = options.audio ?? true;
  if (withAudio) {
    const leadUs = options.audioLeadUs ?? 100_000;
    const startUs = baseUs - leadUs;
    const endUs = baseUs + seconds * 1e6 + 200_000;
    for (let n = 0; ; n++) {
      const tsUs = Math.round(startUs + (n * AAC_FRAME_SAMPLES * 1e6) / 48000);
      if (tsUs >= endUs) break;
      const nextUs = Math.round(startUs + ((n + 1) * AAC_FRAME_SAMPLES * 1e6) / 48000);
      audio.push({ kind: "audio", type: "key", tsUs, durUs: nextUs - tsUs, data: packetBytes("audio", n), epoch: 0 });
    }
  }
  return {
    requestId: options.requestId ?? "req-1",
    video,
    audio,
    videoEpochs: [epoch],
    audioConfig: withAudio
      ? {
          codec: "mp4a.40.2",
          sampleRate: 48000,
          numberOfChannels: 2,
          description: options.audioDescription ?? hexBytes(ASC_48K_STEREO_HEX).buffer,
        }
      : null,
    primingSamples: options.primingSamples ?? 2114,
    startUs: baseUs,
    endUs: baseUs + seconds * 1e6,
    cutToNewestEpoch: false,
    coveredSec: seconds,
  };
}

/** A real MP4 (container-valid, synthetic samples) and its video duration. */
export async function makeMp4(options: ClipOptions = {}): Promise<{ bytes: Uint8Array; videoDurationSec: number }> {
  const result = await muxClip(makeClipPackets(options));
  return { bytes: result.bytes, videoDurationSec: result.videoDurationSec };
}
