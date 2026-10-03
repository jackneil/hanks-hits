/**
 * The MP4 check for a leaderboard clip upload (design/LEADERBOARD_CLIPS.html,
 * section 6). Pure TypeScript, no third-party parser, no browser API.
 *
 * The clip engine writes every clip with mediabunny (pinned) in fast-start
 * mode: ftyp, moov, mdat, with no udta and no meta box (GAMEPLAY_CLIPS.html
 * section 10). This check accepts that shape and nothing else:
 * - The top level is exactly ftyp, moov, mdat, in that order (fast start).
 * - Every box in the moov is on an allow list for its parent box. A udta or
 *   meta box anywhere is "metadata". An mvex, moof or sidx is "fragmented".
 *   Any other box is "unknown_box".
 * - Exactly one video track (handler "vide", sample entry avc1) and at most
 *   one audio track (handler "soun", sample entry mp4a).
 * - The video size in tkhd, in the avc1 sample entry and in the H.264
 *   sequence parameter set is the same, and it is one of the sizes that the
 *   clip engine makes. The track matrix is the identity (no rotation).
 * - The duration (mvhd) is from 1 s to 61 s. No track is longer than 62 s.
 * - Every box size and offset is checked against its parent (64-bit sizes,
 *   size 0 = to the end). Every chunk offset points into the mdat.
 * - The walk is bounded before it allocates: at most MAX_TOP_LEVEL_BOXES at
 *   the top, at most the allowed children in each box, and MAX_BOXES in all
 *   (a real clip has 47). A file of millions of tiny boxes stops at the
 *   first box past a limit ("box_count"), so it costs no more than a clip.
 *
 * The checks prove the format, not the picture (D3).
 */
import {
  BoxError,
  TooManyBoxesError,
  readBoxes,
  readFourCC,
  readU32,
  readU64,
  type BoxInfo,
} from "@/shared/clips/engine/io/boxes";

import { LEADERBOARD_CLIP_LIMITS, LEADERBOARD_CLIP_SIZES, type ClipFrameSize } from "./contract";

/** Why an MP4 was rejected. Values-free, safe to log and to send back. */
export type Mp4RejectReason =
  | "not_mp4"
  | "bad_structure"
  | "no_fast_start"
  | "fragmented"
  | "metadata"
  | "unknown_box"
  | "box_count"
  | "track_count"
  | "codec"
  | "size"
  | "rotation"
  | "duration"
  | "bad_avc_config"
  | "bad_audio_config"
  | "chunk_offsets"
  | "moov_too_big"
  | "too_big"
  | "empty";

export interface Mp4Info {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  bytes: number;
}

export type Mp4Check = { ok: true; info: Mp4Info } | { ok: false; reason: Mp4RejectReason };

class Reject extends Error {
  constructor(readonly reason: Mp4RejectReason) {
    super(reason);
  }
}

/** The largest moov that a 61 s clip at 60 fps with audio can need, with room to spare. */
export const MAX_MOOV_BYTES = 2 * 1024 * 1024;
/** The longest track (audio priming can make a track a little longer than the movie). */
const MAX_TRACK_MS = LEADERBOARD_CLIP_LIMITS.maxDurationMs + 1_000;
/**
 * Boxes at the top level that the walk reads. A clip has 3 (ftyp, moov,
 * mdat); the room above 3 lets a file with one extra box get the exact
 * reason (metadata, fragmented, unknown_box) instead of box_count.
 */
export const MAX_TOP_LEVEL_BOXES = 16;
/** Boxes that one pass of the walk reads in all. A real clip has 47 (fixtures/real-1280x720.mp4). */
export const MAX_BOXES = 256;
/** Child boxes that the metadata scan reads in one box (a clip box has at most 14). */
const MAX_SCAN_CHILDREN = 32;

/** What is left of MAX_BOXES for one pass of the walk. */
interface Budget {
  left: number;
}

/**
 * The boxes in [start, end), at most `max` of them and at most what is
 * left of the budget. More is "box_count", found at the first extra box.
 */
function boxesIn(bytes: Uint8Array, start: number, end: number, max: number, budget: Budget): BoxInfo[] {
  let boxes: BoxInfo[];
  try {
    boxes = readBoxes(bytes, start, end, Math.min(max, budget.left));
  } catch (error) {
    if (error instanceof TooManyBoxesError) throw new Reject("box_count");
    throw error;
  }
  budget.left -= boxes.length;
  return boxes;
}

/** A box and the boxes inside it, read with the allow list. */
interface Node {
  type: string;
  info: BoxInfo;
  /** The bytes after the box header (version and flags included). */
  payload: Uint8Array;
  children: Node[];
}

interface Rule {
  /** Bytes of fixed fields after the box header, before the child boxes. */
  skip: number;
  /** The child box types and how many of each the box may hold. */
  children: Record<string, [min: number, max: number]>;
}

/** The most child boxes a box can hold under its rule (the sum of the max counts). */
function maxChildren(rule: Rule): number {
  return Object.values(rule.children).reduce((sum, [, max]) => sum + max, 0);
}

/** Boxes that hold child boxes, and which children they may hold. */
const CONTAINERS: Record<string, Rule> = {
  // More than one video or audio track is "track_count", checked after the walk.
  moov: { skip: 0, children: { mvhd: [1, 1], trak: [1, 8] } },
  trak: { skip: 0, children: { tkhd: [1, 1], edts: [0, 1], mdia: [1, 1] } },
  edts: { skip: 0, children: { elst: [1, 1] } },
  mdia: { skip: 0, children: { mdhd: [1, 1], hdlr: [1, 1], minf: [1, 1] } },
  minf: { skip: 0, children: { vmhd: [0, 1], smhd: [0, 1], dinf: [1, 1], stbl: [1, 1] } },
  dinf: { skip: 0, children: { dref: [1, 1] } },
  // Full box (version, flags) and an entry count, then the entries.
  dref: { skip: 8, children: { "url ": [1, 1] } },
  stbl: {
    skip: 0,
    children: {
      stsd: [1, 1],
      stts: [1, 1],
      ctts: [0, 1],
      cslg: [0, 1],
      stss: [0, 1],
      sdtp: [0, 1],
      stsc: [1, 1],
      stsz: [1, 1],
      stco: [0, 1],
      co64: [0, 1],
      // The AAC roll group that the clip engine's moov patch adds.
      sgpd: [0, 2],
      sbgp: [0, 2],
    },
  },
  stsd: { skip: 8, children: { avc1: [0, 1], mp4a: [0, 1] } },
  // VisualSampleEntry: 78 bytes of fields, then the child boxes.
  avc1: { skip: 78, children: { avcC: [1, 1], btrt: [0, 1], pasp: [0, 1], colr: [0, 1] } },
  // AudioSampleEntry version 0: 28 bytes of fields, then the child boxes.
  mp4a: { skip: 28, children: { esds: [1, 1], btrt: [0, 1] } },
};

const METADATA_TYPES = new Set(["udta", "meta", "ilst", "keys", "XMP_", "uuid"]);
const FRAGMENT_TYPES = new Set(["mvex", "moof", "mfra", "sidx", "styp", "ssix", "emsg"]);

function rejectFor(type: string): Reject {
  if (METADATA_TYPES.has(type)) return new Reject("metadata");
  if (FRAGMENT_TYPES.has(type)) return new Reject("fragmented");
  return new Reject("unknown_box");
}

function readNode(bytes: Uint8Array, info: BoxInfo, depth: number, budget: Budget): Node {
  if (depth > 12) throw new Reject("bad_structure");
  const bodyStart = info.start + info.headerSize;
  const bodyEnd = info.start + info.size;
  const payload = bytes.subarray(bodyStart, bodyEnd);
  const rule = Object.hasOwn(CONTAINERS, info.type) ? CONTAINERS[info.type] : undefined;
  const node: Node = { type: info.type, info, payload, children: [] };
  if (!rule) return node;
  if (payload.length < rule.skip) throw new Reject("bad_structure");
  const childInfos = boxesIn(bytes, bodyStart + rule.skip, bodyEnd, maxChildren(rule), budget);
  const counts = new Map<string, number>();
  for (const child of childInfos) {
    if (!Object.hasOwn(rule.children, child.type)) {
      // A sample entry that is not avc1 or mp4a (hvc1, avc3, Opus, ...) is a codec this site does not take.
      if (info.type === "stsd" && !METADATA_TYPES.has(child.type)) throw new Reject("codec");
      throw rejectFor(child.type);
    }
    const count = (counts.get(child.type) ?? 0) + 1;
    // Stop at the first box past its max, before the walk opens it.
    if (count > rule.children[child.type][1]) throw new Reject("box_count");
    counts.set(child.type, count);
    node.children.push(readNode(bytes, child, depth + 1, budget));
  }
  for (const [type, [min]] of Object.entries(rule.children)) {
    if ((counts.get(type) ?? 0) < min) throw new Reject("box_count");
  }
  return node;
}

/**
 * Containers to open when looking for metadata, and the fixed bytes before
 * their child boxes. Wider than the allow list on purpose: it also opens the
 * boxes that the allow list rejects, so a udta or meta inside them is named.
 */
const SCAN_SKIP: Record<string, number> = {
  moov: 0, trak: 0, mdia: 0, minf: 0, stbl: 0, edts: 0, dinf: 0, mvex: 0, moof: 0, traf: 0,
  udta: 0, meta: 4, dref: 8, stsd: 8, avc1: 78, avc3: 78, mp4a: 28,
};

/**
 * True when a udta, meta or other metadata box is anywhere in the boxes (a
 * best-effort scan). Bounded like the strict pass: MAX_SCAN_CHILDREN in one
 * box and the budget in all, else "box_count".
 */
function hasMetadataBox(bytes: Uint8Array, boxes: BoxInfo[], depth: number, budget: Budget): boolean {
  if (depth > 12) return false;
  for (const box of boxes) {
    if (METADATA_TYPES.has(box.type)) return true;
    const skip = Object.hasOwn(SCAN_SKIP, box.type) ? SCAN_SKIP[box.type] : undefined;
    if (skip === undefined) continue;
    const start = box.start + box.headerSize + skip;
    const end = box.start + box.size;
    if (start > end) continue;
    let children: BoxInfo[];
    try {
      children = boxesIn(bytes, start, end, MAX_SCAN_CHILDREN, budget);
    } catch (error) {
      if (error instanceof Reject) throw error;
      continue; // The strict pass reports the broken structure.
    }
    if (hasMetadataBox(bytes, children, depth + 1, budget)) return true;
  }
  return false;
}

function child(node: Node, type: string): Node | undefined {
  return node.children.find((c) => c.type === type);
}

function need(node: Node | undefined): Node {
  if (!node) throw new Reject("bad_structure");
  return node;
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new Reject("bad_structure");
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number): number {
  try {
    return readU32(bytes, offset);
  } catch {
    throw new Reject("bad_structure");
  }
}

function u64(bytes: Uint8Array, offset: number): number {
  try {
    return readU64(bytes, offset);
  } catch {
    throw new Reject("bad_structure");
  }
}

/** Timescale and duration of an mvhd or mdhd payload (version 0 or 1). */
function timeOf(payload: Uint8Array): { timescale: number; duration: number } {
  const version = payload[0];
  if (version === 0) return { timescale: u32(payload, 12), duration: u32(payload, 16) };
  if (version === 1) return { timescale: u32(payload, 20), duration: u64(payload, 24) };
  throw new Reject("bad_structure");
}

function durationMsOf(payload: Uint8Array): number {
  const { timescale, duration } = timeOf(payload);
  if (timescale === 0) throw new Reject("duration");
  return Math.round((duration / timescale) * 1000);
}

const IDENTITY = [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000];

/** tkhd: the matrix and the 16.16 width and height. */
function trackHeader(payload: Uint8Array): { matrix: number[]; width: number; height: number } {
  const version = payload[0];
  const matrixAt = version === 0 ? 40 : version === 1 ? 52 : -1;
  if (matrixAt < 0) throw new Reject("bad_structure");
  const matrix = Array.from({ length: 9 }, (_, i) => u32(payload, matrixAt + i * 4));
  const width = u32(payload, matrixAt + 36);
  const height = u32(payload, matrixAt + 40);
  return { matrix, width, height };
}

function handlerOf(payload: Uint8Array): string {
  if (payload.length < 24) throw new Reject("bad_structure");
  // The handler name (a string after the 24 fixed bytes) is short in a clip.
  if (payload.length > 24 + 64) throw new Reject("bad_structure");
  return readFourCC(payload, 8);
}

// ---------------------------------------------------------------------------
// H.264 sequence parameter set: the coded size after cropping
// ---------------------------------------------------------------------------

class BitReader {
  private bit = 0;
  constructor(private readonly bytes: Uint8Array) {}
  u(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.bit >> 3;
      if (byte >= this.bytes.length) throw new Reject("bad_avc_config");
      value = value * 2 + ((this.bytes[byte] >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return value;
  }
  ue(): number {
    let zeros = 0;
    while (this.u(1) === 0) {
      zeros++;
      if (zeros > 31) throw new Reject("bad_avc_config");
    }
    return 2 ** zeros - 1 + this.u(zeros);
  }
  se(): number {
    const k = this.ue();
    return k % 2 === 1 ? (k + 1) / 2 : -(k / 2);
  }
}

/** Remove the emulation prevention bytes (00 00 03 -> 00 00). */
function unescapeRbsp(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of nal) {
    if (zeros >= 2 && byte === 3) {
      zeros = 0;
      continue;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

/** The displayed width and height that an SPS NAL unit (with its 1-byte header) gives. Exported for tests. */
export function spsFrameSize(nal: Uint8Array): ClipFrameSize {
  if (nal.length < 4 || (nal[0] & 0x1f) !== 7) throw new Reject("bad_avc_config");
  const r = new BitReader(unescapeRbsp(nal.subarray(1)));
  const profile = r.u(8);
  r.u(8); // constraint flags
  r.u(8); // level
  r.ue(); // seq_parameter_set_id
  let chromaFormat = 1;
  let separateColourPlane = 0;
  if (HIGH_PROFILES.has(profile)) {
    chromaFormat = r.ue();
    if (chromaFormat > 3) throw new Reject("bad_avc_config");
    if (chromaFormat === 3) separateColourPlane = r.u(1);
    r.ue(); // bit_depth_luma_minus8
    r.ue(); // bit_depth_chroma_minus8
    r.u(1); // qpprime_y_zero_transform_bypass_flag
    if (r.u(1)) {
      const lists = chromaFormat !== 3 ? 8 : 12;
      for (let i = 0; i < lists; i++) {
        if (!r.u(1)) continue;
        const size = i < 6 ? 16 : 64;
        let last = 8;
        let next = 8;
        for (let j = 0; j < size; j++) {
          if (next !== 0) next = (last + r.se() + 256) % 256;
          last = next === 0 ? last : next;
        }
      }
    }
  }
  r.ue(); // log2_max_frame_num_minus4
  const pocType = r.ue();
  if (pocType === 0) {
    r.ue();
  } else if (pocType === 1) {
    r.u(1);
    r.se();
    r.se();
    const cycle = r.ue();
    if (cycle > 255) throw new Reject("bad_avc_config");
    for (let i = 0; i < cycle; i++) r.se();
  } else if (pocType !== 2) {
    throw new Reject("bad_avc_config");
  }
  r.ue(); // max_num_ref_frames
  r.u(1); // gaps_in_frame_num_value_allowed_flag
  const widthMbs = r.ue() + 1;
  const heightMapUnits = r.ue() + 1;
  const frameMbsOnly = r.u(1);
  if (!frameMbsOnly) r.u(1);
  r.u(1); // direct_8x8_inference_flag
  let crop = { left: 0, right: 0, top: 0, bottom: 0 };
  if (r.u(1)) crop = { left: r.ue(), right: r.ue(), top: r.ue(), bottom: r.ue() };
  const chromaArray = separateColourPlane ? 0 : chromaFormat;
  const subWidth = chromaArray === 1 || chromaArray === 2 ? 2 : 1;
  const subHeight = chromaArray === 1 ? 2 : 1;
  const cropX = chromaArray === 0 ? 1 : subWidth;
  const cropY = (chromaArray === 0 ? 1 : subHeight) * (2 - frameMbsOnly);
  const width = widthMbs * 16 - cropX * (crop.left + crop.right);
  const height = (2 - frameMbsOnly) * heightMapUnits * 16 - cropY * (crop.top + crop.bottom);
  if (width <= 0 || height <= 0) throw new Reject("bad_avc_config");
  return { width, height };
}

/** The first SPS in an avcC payload (AVCDecoderConfigurationRecord). */
function firstSps(avcC: Uint8Array): Uint8Array {
  if (avcC.length < 7 || avcC[0] !== 1) throw new Reject("bad_avc_config");
  const spsCount = avcC[5] & 0x1f;
  if (spsCount < 1) throw new Reject("bad_avc_config");
  const length = u16(avcC, 6);
  if (8 + length > avcC.length) throw new Reject("bad_avc_config");
  return avcC.subarray(8, 8 + length);
}

// ---------------------------------------------------------------------------

function sizeAllowed(width: number, height: number, sizes: readonly ClipFrameSize[]): boolean {
  return sizes.some((s) => s.width === width && s.height === height);
}

interface TrackFacts {
  handler: string;
  durationMs: number;
}

function checkChunkOffsets(stbl: Node, mdatStart: number, mdatEnd: number): void {
  for (const table of stbl.children) {
    if (table.type !== "stco" && table.type !== "co64") continue;
    const p = table.payload;
    const count = u32(p, 4);
    const width = table.type === "stco" ? 4 : 8;
    if (p.length !== 8 + count * width) throw new Reject("bad_structure");
    for (let i = 0; i < count; i++) {
      const offset = width === 4 ? u32(p, 8 + i * 4) : u64(p, 8 + i * 8);
      if (offset < mdatStart || offset >= mdatEnd) throw new Reject("chunk_offsets");
    }
  }
}

function checkTrack(
  trak: Node,
  mdat: BoxInfo,
  sizes: readonly ClipFrameSize[]
): TrackFacts & { width?: number; height?: number } {
  const tkhd = need(child(trak, "tkhd"));
  const mdia = need(child(trak, "mdia"));
  const handler = handlerOf(need(child(mdia, "hdlr")).payload);
  const durationMs = durationMsOf(need(child(mdia, "mdhd")).payload);
  if (durationMs <= 0 || durationMs > MAX_TRACK_MS) throw new Reject("duration");
  const minf = need(child(mdia, "minf"));
  const stbl = need(child(minf, "stbl"));
  const stsd = need(child(stbl, "stsd"));
  if (u32(stsd.payload, 4) !== 1 || stsd.children.length !== 1) throw new Reject("codec");
  const entry = stsd.children[0];
  const dref = need(child(need(child(minf, "dinf")), "dref"));
  if (u32(dref.payload, 4) !== 1) throw new Reject("bad_structure");
  const url = need(child(dref, "url "));
  // Flag 1: the media data is in this file. No external reference.
  if (url.payload.length !== 4 || (u32(url.payload, 0) & 0xffffff) !== 1) throw new Reject("bad_structure");
  if (!child(stbl, "stco") === !child(stbl, "co64")) throw new Reject("box_count");
  checkChunkOffsets(stbl, mdat.start + mdat.headerSize, mdat.start + mdat.size);

  if (handler === "vide") {
    if (entry.type !== "avc1" || !child(minf, "vmhd") || child(minf, "smhd")) throw new Reject("codec");
    const header = trackHeader(tkhd.payload);
    if (header.matrix.some((value, i) => value !== IDENTITY[i])) throw new Reject("rotation");
    if (header.width % 0x1_0000 !== 0 || header.height % 0x1_0000 !== 0) throw new Reject("size");
    const width = header.width / 0x1_0000;
    const height = header.height / 0x1_0000;
    const entryWidth = u16(entry.payload, 24);
    const entryHeight = u16(entry.payload, 26);
    const sps = spsFrameSize(firstSps(need(child(entry, "avcC")).payload));
    if (entryWidth !== width || entryHeight !== height || sps.width !== width || sps.height !== height) {
      throw new Reject("size");
    }
    if (!sizeAllowed(width, height, sizes)) throw new Reject("size");
    return { handler, durationMs, width, height };
  }
  if (handler === "soun") {
    if (entry.type !== "mp4a" || !child(minf, "smhd") || child(minf, "vmhd")) throw new Reject("codec");
    const p = entry.payload;
    if (u16(p, 8) !== 0) throw new Reject("bad_audio_config");
    const channels = u16(p, 16);
    const sampleRate = u32(p, 24) / 0x1_0000;
    if (channels < 1 || channels > 2 || sampleRate < 8_000 || sampleRate > 96_000) throw new Reject("bad_audio_config");
    return { handler, durationMs };
  }
  throw new Reject("track_count");
}

/**
 * Check an uploaded MP4. Returns the measured facts, or the first reason it
 * fails. Never throws.
 */
export function inspectClipMp4(bytes: Uint8Array, sizes: readonly ClipFrameSize[] = LEADERBOARD_CLIP_SIZES): Mp4Check {
  try {
    if (bytes.length === 0) throw new Reject("empty");
    if (bytes.length > LEADERBOARD_CLIP_LIMITS.maxVideoBytes) throw new Reject("too_big");
    if (bytes.length < 8 || readFourCC(bytes, 4) !== "ftyp") throw new Reject("not_mp4");
    const top = boxesIn(bytes, 0, bytes.length, MAX_TOP_LEVEL_BOXES, { left: MAX_TOP_LEVEL_BOXES });
    // The most specific reasons first, so a file is named for its worst fault.
    if (hasMetadataBox(bytes, top, 0, { left: MAX_BOXES })) throw new Reject("metadata");
    if (top.some((box) => FRAGMENT_TYPES.has(box.type))) throw new Reject("fragmented");
    const moovInfo = top.find((box) => box.type === "moov");
    const mdat = top.find((box) => box.type === "mdat");
    if (!moovInfo || !mdat) throw new Reject("box_count");
    if (moovInfo.start > mdat.start) throw new Reject("no_fast_start");
    for (const box of top) {
      if (box.type !== "ftyp" && box.type !== "moov" && box.type !== "mdat") throw rejectFor(box.type);
    }
    const count = (type: string) => top.filter((box) => box.type === type).length;
    if (count("ftyp") !== 1 || count("moov") !== 1 || count("mdat") !== 1) throw new Reject("box_count");
    if (top[0].size > 64) throw new Reject("bad_structure");
    if (moovInfo.size > MAX_MOOV_BYTES) throw new Reject("moov_too_big");

    const moov = readNode(bytes, moovInfo, 0, { left: MAX_BOXES });
    const movieMs = durationMsOf(need(child(moov, "mvhd")).payload);
    if (movieMs < LEADERBOARD_CLIP_LIMITS.minDurationMs || movieMs > LEADERBOARD_CLIP_LIMITS.maxDurationMs) {
      throw new Reject("duration");
    }

    let video: { width: number; height: number } | null = null;
    let audio = 0;
    for (const trak of moov.children.filter((c) => c.type === "trak")) {
      const facts = checkTrack(trak, mdat, sizes);
      if (facts.handler === "vide") {
        if (video) throw new Reject("track_count");
        video = { width: facts.width!, height: facts.height! };
      } else {
        audio++;
      }
    }
    if (!video || audio > 1) throw new Reject("track_count");
    return {
      ok: true,
      info: { durationMs: movieMs, width: video.width, height: video.height, hasAudio: audio === 1, bytes: bytes.length },
    };
  } catch (error) {
    if (error instanceof Reject) return { ok: false, reason: error.reason };
    if (error instanceof BoxError) return { ok: false, reason: "bad_structure" };
    return { ok: false, reason: "bad_structure" };
  }
}
