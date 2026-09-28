/**
 * Clip muxer: ClipPackets to MP4 bytes with mediabunny (plan 6.4, 6.6).
 *
 * Rules:
 * - Fast start in memory: ftyp, moov, mdat. The moov patch runs after this.
 * - Timestamps are rebased so the first video packet (a keyframe) is at 0. The video
 *   track has no edit list.
 * - Audio timestamps already carry the -P priming shift (protocol PacketDTO.tsUs):
 *   the encode worker applies it per AAC stream, so a clip across an encoder restart
 *   with another delay is still correct. The muxer only rebases them. The first audio
 *   packet is then before 0, so mediabunny writes an audio edit list that hides the
 *   priming. primingSamples is never applied a second time (it would put the sound
 *   44 ms early on every clip).
 * - Metadata tags are {}. No udta box is written (plan 10: no hidden metadata).
 * - The decoder config comes from the epoch of the first video packet. The encode
 *   worker sends one avcC per clip; a packet from a different config is an error,
 *   because one track is never written across two configs (plan 6.6).
 */

import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import type { ClipPackets, EpochInfo, PacketDTO } from "../../protocol";
import { sanitizeAacDescription } from "./aacConfig";

export type MuxErrorCode =
  | "no-video"
  | "first-not-key"
  | "unknown-epoch"
  | "mixed-epochs"
  | "bad-packet"
  | "bad-audio-config"
  | "muxer";

/** The packets cannot make a valid clip. */
export class MuxError extends Error {
  readonly code: MuxErrorCode;
  constructor(code: MuxErrorCode, message: string) {
    super(message);
    this.name = "MuxError";
    this.code = code;
  }
}

export interface MuxResult {
  /** The finished MP4 file, before the roll-group patch. */
  bytes: Uint8Array;
  /** End of the video track in seconds, measured from the first video packet. */
  videoDurationSec: number;
  hasAudio: boolean;
  videoPackets: number;
  /** Audio packets written, after the trim at both ends. */
  audioPackets: number;
  /** True when the ASC was not valid and the muxer built a new one. */
  audioConfigRebuilt: boolean;
  /** The decoder config of the video track. */
  epoch: EpochInfo;
  /** The first video packet. It is a keyframe, so the poster step can decode it. */
  firstKey: PacketDTO;
}

/** One packet on the output timeline, in seconds. */
export interface TimedPacket {
  packet: PacketDTO;
  timestamp: number;
  duration: number;
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** True when two epochs can share one track: same codec, coded size and avcC bytes. */
export function sameVideoConfig(a: EpochInfo, b: EpochInfo): boolean {
  return (
    a.codec === b.codec &&
    a.codedWidth === b.codedWidth &&
    a.codedHeight === b.codedHeight &&
    sameBytes(a.description, b.description)
  );
}

function checkPacket(packet: PacketDTO, where: string): void {
  if (!Number.isFinite(packet.tsUs) || !Number.isFinite(packet.durUs) || packet.durUs < 0) {
    throw new MuxError("bad-packet", `${where} has a bad timestamp or duration`);
  }
  if (!(packet.data instanceof ArrayBuffer) || packet.data.byteLength === 0) {
    throw new MuxError("bad-packet", `${where} has no data`);
  }
}

/** Finds the config of the first video packet and checks that every packet can use it. */
export function videoEpochFor(clip: ClipPackets): EpochInfo {
  if (clip.video.length === 0) throw new MuxError("no-video", "the clip has no video packets");
  const first = clip.video[0];
  if (first.type !== "key") throw new MuxError("first-not-key", "the first video packet is not a keyframe");
  const byEpoch = new Map(clip.videoEpochs.map((info) => [info.epoch, info]));
  const epoch = byEpoch.get(first.epoch);
  if (!epoch) throw new MuxError("unknown-epoch", `no decoder config for epoch ${first.epoch}`);
  const checked = new Set<number>([epoch.epoch]);
  for (const packet of clip.video) {
    if (checked.has(packet.epoch)) continue;
    const other = byEpoch.get(packet.epoch);
    if (!other) throw new MuxError("unknown-epoch", `no decoder config for epoch ${packet.epoch}`);
    if (!sameVideoConfig(epoch, other)) {
      throw new MuxError("mixed-epochs", `epoch ${packet.epoch} has a different avcC than epoch ${epoch.epoch}`);
    }
    checked.add(packet.epoch);
  }
  return epoch;
}

/** Video packets on the output timeline: the first packet is at 0. Decode order stays. */
export function planVideo(video: PacketDTO[]): { packets: TimedPacket[]; endSec: number } {
  const zeroUs = video[0].tsUs;
  let endUs = zeroUs;
  const packets = video.map((packet, i) => {
    checkPacket(packet, `video packet ${i}`);
    endUs = Math.max(endUs, packet.tsUs + packet.durUs);
    return { packet, timestamp: (packet.tsUs - zeroUs) / 1e6, duration: packet.durUs / 1e6 };
  });
  return { packets, endSec: (endUs - zeroUs) / 1e6 };
}

/**
 * Audio packets on the output timeline.
 *
 * - Each packet timestamp is the time of its first decoded sample, with the priming
 *   shift already applied by the encode worker. The muxer only measures it from the
 *   first video packet.
 * - Packets that end at or before 0 are not played. The muxer keeps only the last
 *   one of them: the AAC decoder needs one packet before the first played packet
 *   (roll distance -1). The edit list hides it.
 * - Packets that start at or after the video end are dropped, so the clip never
 *   ends with sound over no picture.
 */
export function planAudio(audio: PacketDTO[], zeroUs: number, sampleRate: number, videoEndSec: number): TimedPacket[] {
  const sorted = audio
    .map((packet, index) => {
      checkPacket(packet, `audio packet ${index}`);
      return { packet, index };
    })
    .sort((a, b) => a.packet.tsUs - b.packet.tsUs || a.index - b.index);
  const timed: TimedPacket[] = [];
  let lastTsUs = Number.NaN;
  for (const { packet } of sorted) {
    if (packet.tsUs === lastTsUs) continue; // A repeated packet adds no sound.
    lastTsUs = packet.tsUs;
    const timestamp = (packet.tsUs - zeroUs) / 1e6;
    if (timestamp >= videoEndSec) break;
    timed.push({ packet, timestamp, duration: packet.durUs / 1e6 });
  }
  // Microsecond timestamps can put an end a fraction of a sample after 0. Half a
  // sample is the smallest end that plays a real sample.
  const halfSample = 0.5 / sampleRate;
  const firstPlayed = timed.findIndex((p) => p.timestamp + p.duration > halfSample);
  if (firstPlayed < 0) return [];
  return timed.slice(Math.max(0, firstPlayed - 1));
}

function view(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

/** Muxes one clip. Throws MuxError when the packets cannot make a valid file. */
export async function muxClip(clip: ClipPackets): Promise<MuxResult> {
  const epoch = videoEpochFor(clip);
  const video = planVideo(clip.video);

  let audio: TimedPacket[] = [];
  let audioConfig: { codec: string; sampleRate: number; numberOfChannels: number; description: Uint8Array } | null =
    null;
  let audioConfigRebuilt = false;
  if (clip.audioConfig && clip.audio.length > 0) {
    const { sampleRate, numberOfChannels } = clip.audioConfig;
    if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(numberOfChannels) || numberOfChannels <= 0) {
      throw new MuxError("bad-audio-config", `audio config ${sampleRate} Hz x ${numberOfChannels} is not valid`);
    }
    let sanitized;
    try {
      sanitized = sanitizeAacDescription(clip.audioConfig.description, sampleRate, numberOfChannels);
    } catch (error) {
      throw new MuxError("bad-audio-config", (error as Error).message);
    }
    audioConfigRebuilt = sanitized.rebuilt;
    audio = planAudio(clip.audio, clip.video[0].tsUs, sampleRate, video.endSec);
    if (audio.length > 0) {
      audioConfig = { codec: "mp4a.40.2", sampleRate, numberOfChannels, description: sanitized.description };
    }
  }

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  // No frameRate: mediabunny then uses its 57600 time scale (plan 6.2).
  const videoSource = new EncodedVideoPacketSource("avc");
  output.addVideoTrack(videoSource);
  const audioSource = audioConfig ? new EncodedAudioPacketSource("aac") : null;
  if (audioSource) output.addAudioTrack(audioSource);
  // Explicitly empty: no title, date or other tag can reach the file.
  output.setMetadataTags({});

  try {
    await output.start();
    const videoConfig = {
      codec: epoch.codec,
      codedWidth: epoch.codedWidth,
      codedHeight: epoch.codedHeight,
      description: view(epoch.description),
    };
    // Interleave the two tracks by timestamp so the chunks alternate in the mdat.
    let v = 0;
    let a = 0;
    while (v < video.packets.length || a < audio.length) {
      const nextVideo = v < video.packets.length ? video.packets[v].timestamp : Infinity;
      const nextAudio = a < audio.length ? audio[a].timestamp : Infinity;
      if (nextVideo <= nextAudio) {
        const { packet, timestamp, duration } = video.packets[v];
        await videoSource.add(
          new EncodedPacket(view(packet.data), packet.type, timestamp, duration),
          v === 0 ? { decoderConfig: videoConfig } : undefined,
        );
        v++;
      } else {
        const { packet, timestamp, duration } = audio[a];
        await audioSource!.add(
          new EncodedPacket(view(packet.data), "key", timestamp, duration),
          a === 0 ? { decoderConfig: audioConfig! } : undefined,
        );
        a++;
      }
    }
    videoSource.close();
    audioSource?.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    if (error instanceof MuxError) throw error;
    throw new MuxError("muxer", `mediabunny could not mux the clip: ${(error as Error).message}`);
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new MuxError("muxer", "mediabunny returned no bytes");
  return {
    bytes: new Uint8Array(buffer),
    videoDurationSec: video.endSec,
    hasAudio: audio.length > 0,
    videoPackets: video.packets.length,
    audioPackets: audio.length,
    audioConfigRebuilt,
    epoch,
    firstKey: clip.video[0],
  };
}
