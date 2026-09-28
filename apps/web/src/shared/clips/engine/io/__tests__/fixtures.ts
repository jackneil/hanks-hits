/**
 * Test fixtures for the io worker and the library: ClipPackets with a real avcC and
 * small packets, like the encode worker sends. The bytes do not decode to pictures;
 * the checks that need real decoding use ffmpeg (mux.av.node.test.ts).
 */

import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Output, WebMOutputFormat } from "mediabunny";
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
 * Builds ClipPackets in the form the encode worker sends (protocol PacketDTO.tsUs):
 * an audio timestamp is the time of the packet's first decoded sample, with the -P
 * priming shift already applied. Packet n of a stream whose PCM starts at S holds the
 * decoded samples from S + (1024 n - P) / 48000, like encode/audio/aac.ts computes it
 * (frame index to microseconds, rounded).
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
  const primingSamples = options.primingSamples ?? 2114;
  if (withAudio) {
    const leadUs = options.audioLeadUs ?? 100_000;
    const startUs = baseUs - leadUs;
    const endUs = baseUs + seconds * 1e6 + 200_000;
    const at = (n: number) => Math.round(startUs + ((n * AAC_FRAME_SAMPLES - primingSamples) * 1e6) / 48000);
    for (let n = 0; ; n++) {
      const tsUs = at(n);
      if (tsUs >= endUs) break;
      audio.push({ kind: "audio", type: "key", tsUs, durUs: at(n + 1) - tsUs, data: packetBytes("audio", n), epoch: 0 });
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
    primingSamples,
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

/**
 * A real WebM like tier V makes (plan 5): VP8 video, container-valid, synthetic
 * frames. Byte 0 bit 0 is the VP8 frame type (0 = keyframe).
 */
export async function makeWebm(options: { seconds?: number; fps?: number; size?: number } = {}): Promise<{
  bytes: Uint8Array;
  videoDurationSec: number;
}> {
  const seconds = options.seconds ?? 1;
  const fps = options.fps ?? 30;
  const size = options.size ?? 64;
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const source = new EncodedVideoPacketSource("vp8");
  output.addVideoTrack(source);
  output.setMetadataTags({});
  await output.start();
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    const key = i % fps === 0;
    const data = new Uint8Array([key ? 0x10 : 0x11, 0x02, 0x00, i & 0xff]);
    await source.add(
      new EncodedPacket(data, key ? "key" : "delta", i / fps, 1 / fps),
      i === 0 ? { decoderConfig: { codec: "vp8", codedWidth: size, codedHeight: size } } : undefined,
    );
  }
  source.close();
  await output.finalize();
  return { bytes: new Uint8Array((output.target as BufferTarget).buffer!), videoDurationSec: frames / fps };
}

/** A real 3x2 RGBA PNG (valid CRCs), like a picture card (plan 8.1). */
export const PNG_3X2_HEX =
  "89504e470d0a1a0a0000000d49484452000000030000000208060000009d74661a0000001149444154789c6338a1a1f11f86" +
  "19903900a12d0c8b3f86cab60000000049454e44ae426082";
