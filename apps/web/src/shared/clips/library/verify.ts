/**
 * Clip file checks for the write protocol (plan 8.1): the file parses, the video
 * duration is within 0.2 s of the expected value, and the first video packet is a
 * keyframe. The checks read only the MP4 structure and packet tables, not the pixels.
 */

import { BlobSource, BufferSource, EncodedPacketSink, Input, MP4 } from "mediabunny";
import { LibraryError } from "./errors";

/** Largest allowed difference between the file's video duration and the expected one. */
export const DURATION_TOLERANCE_SEC = 0.2;

export interface ClipInspection {
  videoDurationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  firstVideoIsKey: boolean;
  /** Average video packet rate, 0 when unknown. */
  fps: number;
}

/** Reads the facts the library needs from an MP4. Throws when the file does not parse. */
export async function inspectClip(source: Blob | Uint8Array, options: { packetRate?: boolean } = {}): Promise<ClipInspection> {
  const input = new Input({
    formats: [MP4],
    source: source instanceof Uint8Array ? new BufferSource(source) : new BlobSource(source),
  });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("the file has no video track");
    const audio = await input.getPrimaryAudioTrack();
    const first = await new EncodedPacketSink(video).getFirstPacket({ metadataOnly: true });
    const videoDurationSec = await video.computeDuration();
    const fps = options.packetRate ? (await video.computePacketStats()).averagePacketRate : 0;
    return {
      videoDurationSec,
      width: await video.getDisplayWidth(),
      height: await video.getDisplayHeight(),
      hasAudio: audio !== null,
      firstVideoIsKey: first?.type === "key",
      fps: Number.isFinite(fps) ? fps : 0,
    };
  } finally {
    input.dispose();
  }
}

/**
 * Checks a stored clip. Throws LibraryError("verify-failed") with the reason.
 * Returns the inspection so the caller can use the real duration.
 */
export async function verifyClip(source: Blob | Uint8Array, expectedVideoSec: number): Promise<ClipInspection> {
  let facts: ClipInspection;
  try {
    facts = await inspectClip(source);
  } catch (error) {
    throw new LibraryError("verify-failed", `the clip does not parse: ${(error as Error).message}`);
  }
  if (!facts.firstVideoIsKey) throw new LibraryError("verify-failed", "the first video packet is not a keyframe");
  if (!(Math.abs(facts.videoDurationSec - expectedVideoSec) <= DURATION_TOLERANCE_SEC)) {
    throw new LibraryError(
      "verify-failed",
      `video duration ${facts.videoDurationSec.toFixed(3)} s is not within ${DURATION_TOLERANCE_SEC} s of ${expectedVideoSec.toFixed(3)} s`,
    );
  }
  return facts;
}
