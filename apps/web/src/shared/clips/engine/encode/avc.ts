/**
 * H.264 helpers for the video session.
 *
 * The encoder runs with avc: { format: "avc" }. Each chunk is a list of NAL
 * units, each one after a big-endian length prefix. The avcC record gives the
 * prefix size. A chunk is a real keyframe only when it holds an IDR slice
 * (NAL type 5). Some encoders mark a chunk "key" without one (mediabunny #365),
 * so the session checks the bytes and does not trust chunk.type alone.
 */

import { viewBytes, type ByteSource } from "./bytes";

export const NAL_SLICE = 1;
export const NAL_IDR = 5;
export const NAL_SEI = 6;
export const NAL_SPS = 7;
export const NAL_PPS = 8;
export const NAL_AUD = 9;

export interface AvcConfig {
  profileIdc: number;
  profileCompatibility: number;
  levelIdc: number;
  /** Size of each NAL length prefix in bytes: 1, 2, 3 or 4. */
  lengthSize: number;
  sps: Uint8Array[];
  pps: Uint8Array[];
}

/** Parses an avcC record (ISO 14496-15). Returns null when the bytes are not a valid avcC. */
export function parseAvcC(desc: ByteSource | null | undefined): AvcConfig | null {
  if (!desc) return null;
  const b = viewBytes(desc);
  if (b.byteLength < 7 || b[0] !== 1) return null;
  const lengthSize = (b[4] & 0x03) + 1;
  let o = 5;
  const spsCount = b[o++] & 0x1f;
  const sps: Uint8Array[] = [];
  for (let i = 0; i < spsCount; i++) {
    if (o + 2 > b.byteLength) return null;
    const len = (b[o] << 8) | b[o + 1];
    o += 2;
    if (o + len > b.byteLength) return null;
    sps.push(b.subarray(o, o + len));
    o += len;
  }
  if (o >= b.byteLength) return null;
  const ppsCount = b[o++];
  const pps: Uint8Array[] = [];
  for (let i = 0; i < ppsCount; i++) {
    if (o + 2 > b.byteLength) return null;
    const len = (b[o] << 8) | b[o + 1];
    o += 2;
    if (o + len > b.byteLength) return null;
    pps.push(b.subarray(o, o + len));
    o += len;
  }
  return { profileIdc: b[1], profileCompatibility: b[2], levelIdc: b[3], lengthSize, sps, pps };
}

/**
 * Lists the NAL unit types in a length-prefixed access unit.
 * Returns null when a length prefix points past the end (broken framing).
 */
export function nalTypesAvcc(data: ByteSource, lengthSize: number): number[] | null {
  const b = viewBytes(data);
  const types: number[] = [];
  let o = 0;
  while (o < b.byteLength) {
    if (o + lengthSize > b.byteLength) return null;
    let len = 0;
    for (let i = 0; i < lengthSize; i++) len = len * 256 + b[o + i];
    o += lengthSize;
    if (len === 0 || o + len > b.byteLength) return null;
    types.push(b[o] & 0x1f);
    o += len;
  }
  return types;
}

/** Lists the NAL unit types in an Annex B access unit (start codes 00 00 01 or 00 00 00 01). */
export function nalTypesAnnexB(data: ByteSource): number[] {
  const b = viewBytes(data);
  const types: number[] = [];
  for (let i = 0; i + 3 < b.byteLength; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) {
      types.push(b[i + 3] & 0x1f);
      i += 3;
    }
  }
  return types;
}

export interface KeyVerdict {
  /** Treat the chunk as the start of a GOP. */
  key: boolean;
  /** The bytes were parsed, so the verdict comes from the NAL types. */
  verified: boolean;
  /** chunk.type and the NAL types disagree. */
  mismatch: boolean;
}

/**
 * Decides whether a chunk is a real keyframe.
 * With a known prefix size, the IDR NAL decides. Otherwise chunk.type decides.
 */
export function classifyChunk(data: ByteSource, chunkType: "key" | "delta", lengthSize: number | null): KeyVerdict {
  const types = lengthSize ? nalTypesAvcc(data, lengthSize) : nalTypesAnnexB(data);
  if (!types || types.length === 0) return { key: chunkType === "key", verified: false, mismatch: false };
  const idr = types.includes(NAL_IDR);
  return { key: idr, verified: true, mismatch: idr !== (chunkType === "key") };
}
