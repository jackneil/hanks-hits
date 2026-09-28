/**
 * Clip file checks for the write protocol (plan 8.1).
 *
 * Videos (MP4, and WebM from tier V, plan 5): the file parses, the top-level
 * structure fills the file exactly, the first video packet is a keyframe, and the
 * video duration is within 0.2 s of the expected value. The structure check matters
 * for fast-start MP4: its moov describes the whole clip, so a file with a cut mdat
 * still parses and still has the right duration. Only the box sizes show the cut.
 *
 * Pictures (PNG): the signature, an IHDR chunk first, and an IEND chunk that ends
 * exactly at the end of the file.
 *
 * The checks read only headers, box sizes and packet tables, never pixels.
 */

import { BlobSource, BufferSource, EncodedPacketSink, Input, type InputFormat, MP4, WEBM } from "mediabunny";
import { readFourCC, readU32, readU64 } from "../engine/io/boxes";
import { LibraryError } from "./errors";
import type { StoredMime } from "./shared";

/** Largest allowed difference between the file's video duration and the expected one. */
export const DURATION_TOLERANCE_SEC = 0.2;

export interface ClipInspection {
  mime: StoredMime;
  /** 0 for pictures. */
  videoDurationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Always true for pictures. */
  firstVideoIsKey: boolean;
  /** Average video packet rate, 0 when unknown and for pictures. */
  fps: number;
}

export interface VerifyExpectation {
  mime: StoredMime;
  /** The video length the producer described, in seconds. Null: no duration check (pictures). */
  videoSec: number | null;
}

type Source = Blob | Uint8Array;

function sourceSize(source: Source): number {
  return source instanceof Uint8Array ? source.length : source.size;
}

async function readRange(source: Source, start: number, end: number): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source.subarray(start, end);
  return new Uint8Array(await source.slice(start, end).arrayBuffer());
}

/**
 * Walks the top-level MP4 boxes by their headers. Throws when a box goes past the end
 * of the file (a cut file), when bytes are left after the last box, when a box has
 * no size (open-ended: the muxer never writes one), or when moov or mdat is missing.
 */
export async function checkMp4Layout(source: Source): Promise<string[]> {
  const size = sourceSize(source);
  const types: string[] = [];
  let offset = 0;
  while (offset < size) {
    if (size - offset < 8) throw new Error(`${size - offset} bytes after the last box`);
    const head = await readRange(source, offset, Math.min(size, offset + 16));
    let boxSize = readU32(head, 0);
    const type = readFourCC(head, 4);
    let headerSize = 8;
    if (boxSize === 1) {
      if (head.length < 16) throw new Error(`box "${type}" at ${offset} has a cut 64-bit size`);
      boxSize = readU64(head, 8);
      headerSize = 16;
    } else if (boxSize === 0) {
      throw new Error(`box "${type}" at ${offset} has no size`);
    }
    if (boxSize < headerSize) throw new Error(`box "${type}" at ${offset} has size ${boxSize}`);
    if (offset + boxSize > size) {
      throw new Error(`box "${type}" at ${offset} needs ${boxSize} bytes, but only ${size - offset} are left (the file is cut)`);
    }
    types.push(type);
    offset += boxSize;
  }
  if (!types.includes("moov") || !types.includes("mdat")) throw new Error(`the file has boxes ${types.join(",")}, not moov and mdat`);
  return types;
}

/** Reads an EBML variable-size integer. The marker bit stays in IDs and goes from sizes. */
function readEbmlVarint(bytes: Uint8Array, offset: number, keepMarker: boolean): { value: number; length: number; allOnes: boolean } {
  if (offset >= bytes.length) throw new Error("an EBML number goes past the end");
  const first = bytes[offset];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8) throw new Error("an EBML number has no length marker");
  if (offset + length > bytes.length) throw new Error("an EBML number goes past the end");
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[offset + i];
    if (bytes[offset + i] !== 0xff) allOnes = false;
  }
  return { value, length, allOnes };
}

/**
 * Walks the top-level WebM elements (EBML header, Segment). Throws when an element
 * with a known size goes past the end of the file (a cut file). An element of unknown
 * size (a live MediaRecorder file) runs to the end, so the walk stops there.
 */
export async function checkWebmLayout(source: Source): Promise<void> {
  const size = sourceSize(source);
  let offset = 0;
  let sawSegment = false;
  while (offset < size) {
    const head = await readRange(source, offset, Math.min(size, offset + 12));
    if (offset === 0 && !(head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)) {
      throw new Error("the file does not start with an EBML header");
    }
    const id = readEbmlVarint(head, 0, true);
    const length = readEbmlVarint(head, id.length, false);
    if (id.value === 0x18538067) sawSegment = true;
    if (length.allOnes) break;
    const total = id.length + length.length + length.value;
    if (offset + total > size) {
      throw new Error(`element 0x${id.value.toString(16)} at ${offset} needs ${total} bytes, but only ${size - offset} are left (the file is cut)`);
    }
    offset += total;
  }
  if (!sawSegment) throw new Error("the file has no Segment");
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Checks the PNG chunk structure and returns the picture size. */
export async function inspectPng(source: Source): Promise<{ width: number; height: number }> {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
  if (bytes.length < 8 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) throw new Error("the file is not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let first = true;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error(`the chunk at ${offset} is cut`);
    const length = readU32(bytes, offset);
    const type = readFourCC(bytes, offset + 4);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error(`chunk "${type}" at ${offset} goes past the end (the file is cut)`);
    if (first) {
      if (type !== "IHDR" || length !== 13) throw new Error("the first chunk is not IHDR");
      width = readU32(bytes, offset + 8);
      height = readU32(bytes, offset + 12);
      first = false;
    }
    if (type === "IEND") {
      if (end !== bytes.length) throw new Error(`${bytes.length - end} bytes after IEND`);
      if (!(width > 0 && height > 0)) throw new Error(`the picture size ${width}x${height} is not valid`);
      return { width, height };
    }
    offset = end;
  }
  throw new Error("the PNG has no IEND chunk (the file is cut)");
}

function formatsFor(mime: StoredMime): InputFormat[] {
  return mime === "video/webm" ? [WEBM] : [MP4];
}

/**
 * Reads the facts the library needs from a stored file. Throws when the file does
 * not parse or its structure does not fill the file.
 */
export async function inspectClip(
  source: Source,
  mime: StoredMime,
  options: { packetRate?: boolean } = {},
): Promise<ClipInspection> {
  if (mime === "image/png") {
    const { width, height } = await inspectPng(source);
    return { mime, videoDurationSec: 0, width, height, hasAudio: false, firstVideoIsKey: true, fps: 0 };
  }
  if (mime === "video/webm") await checkWebmLayout(source);
  else await checkMp4Layout(source);
  const input = new Input({
    formats: formatsFor(mime),
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
      mime,
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

/** True when an inspected file is a usable library item. */
export function isUsable(facts: ClipInspection): boolean {
  if (facts.mime === "image/png") return facts.width > 0 && facts.height > 0;
  return facts.firstVideoIsKey && facts.videoDurationSec > 0;
}

/**
 * Checks a stored clip. Throws LibraryError("verify-failed") with the reason.
 * Returns the inspection so the caller can use the real duration.
 */
export async function verifyClip(source: Source, expected: VerifyExpectation): Promise<ClipInspection> {
  let facts: ClipInspection;
  try {
    facts = await inspectClip(source, expected.mime);
  } catch (error) {
    throw new LibraryError("verify-failed", `the clip does not parse: ${(error as Error).message}`);
  }
  if (expected.mime === "image/png") return facts;
  if (!facts.firstVideoIsKey) throw new LibraryError("verify-failed", "the first video packet is not a keyframe");
  if (!(facts.videoDurationSec > 0)) throw new LibraryError("verify-failed", "the video has no duration");
  if (expected.videoSec !== null && !(Math.abs(facts.videoDurationSec - expected.videoSec) <= DURATION_TOLERANCE_SEC)) {
    throw new LibraryError(
      "verify-failed",
      `video duration ${facts.videoDurationSec.toFixed(3)} s is not within ${DURATION_TOLERANCE_SEC} s of ${expected.videoSec.toFixed(3)} s`,
    );
  }
  return facts;
}
