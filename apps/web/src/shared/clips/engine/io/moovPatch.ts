/**
 * AAC roll-group patch for a finished MP4 (plan 6.4).
 *
 * An AAC decoder needs the packet before a start packet to make correct output (the
 * MDCT overlap). ffmpeg's mp4 muxer tells players this with a "roll" sample group:
 * an sgpd box with roll_distance -1 and an sbgp box that puts every audio sample in
 * that group. AVFoundation (iPhone Photos, Messages, Safari) needs these boxes to
 * apply the AAC priming edit list correctly.
 *
 * MEASURED (plan 3a, iPhone SE 3, iOS 27): with an edit list only, AVFoundation
 * plays the audio 44 ms early. After ffmpeg adds these two boxes (no sample
 * changes), AVFoundation reads 0 ms. mediabunny writes the edit list but not the
 * roll group, so this patch adds the boxes after mediabunny finalizes the file.
 *
 * The patch puts the two boxes at the end of the audio stbl, where ffmpeg puts them.
 * The moov box becomes larger. In a fast-start file the mdat comes after the moov, so
 * the patch also moves every chunk offset (stco or co64) that points after the moov.
 */

import {
  BoxError,
  type BoxNode,
  type ContainerNode,
  type LeafNode,
  childOf,
  containerAt,
  fullBoxPayload,
  isContainer,
  leafAt,
  nodeSize,
  readBoxes,
  readFourCC,
  readTree,
  readU32,
  readU64,
  writeFourCC,
  writeTree,
  writeU32,
  writeU64,
} from "./boxes";

/** The roll distance that ffmpeg writes for AAC: each sample needs one sample before it. */
export const AAC_ROLL_DISTANCE = -1;

/** MPEG-4 objectTypeIndication for AAC (ISO/IEC 14496-1, table 5). */
const OTI_AAC = 0x40;

const U32_LIMIT = 0x1_0000_0000;

export type MoovPatchErrorCode = "no-moov" | "two-moov" | "fragmented" | "bad-structure" | "bad-audio-entry";

/** The file cannot be patched safely. The caller must not keep a half-patched file. */
export class MoovPatchError extends Error {
  readonly code: MoovPatchErrorCode;
  constructor(code: MoovPatchErrorCode, message: string) {
    super(message);
    this.name = "MoovPatchError";
    this.code = code;
  }
}

/** The sgpd box body for one 'roll' group entry (ffmpeg movenc.c layout). */
export function rollSgpdPayload(rollDistance = AAC_ROLL_DISTANCE): Uint8Array {
  // Version 1 has default_length. grouping_type, default_length 2, entry_count 1,
  // then one signed 16-bit roll_distance.
  const body = new Uint8Array(4 + 4 + 4 + 2);
  writeFourCC(body, 0, "roll");
  writeU32(body, 4, 2);
  writeU32(body, 8, 1);
  const distance = rollDistance & 0xffff;
  body[12] = (distance >>> 8) & 0xff;
  body[13] = distance & 0xff;
  return fullBoxPayload(1, 0, body);
}

/** The sbgp box body that maps all `sampleCount` samples to group description 1. */
export function rollSbgpPayload(sampleCount: number): Uint8Array {
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw new MoovPatchError("bad-structure", `sample count ${sampleCount} is not a positive integer`);
  }
  // Version 0: grouping_type, entry_count 1, then (sample_count, group_description_index).
  const body = new Uint8Array(4 + 4 + 8);
  writeFourCC(body, 0, "roll");
  writeU32(body, 4, 1);
  writeU32(body, 8, sampleCount);
  writeU32(body, 12, 1);
  return fullBoxPayload(0, 0, body);
}

/** The full sgpd box bytes (26 bytes), for tests and for callers that write boxes. */
export function rollSgpdBox(rollDistance = AAC_ROLL_DISTANCE): Uint8Array {
  return writeTree({ type: "sgpd", payload: rollSgpdPayload(rollDistance) });
}

/** The full sbgp box bytes (28 bytes). */
export function rollSbgpBox(sampleCount: number): Uint8Array {
  return writeTree({ type: "sbgp", payload: rollSbgpPayload(sampleCount) });
}

export interface RollPatchResult {
  /** The patched file, or the input itself when no track needed a patch. */
  bytes: Uint8Array;
  /** How many AAC tracks got the roll group. */
  patchedTracks: number;
  /** How many bytes the moov grew, which is also how far the mdat moved. */
  shift: number;
}

function handlerType(trak: ContainerNode): string | undefined {
  const hdlr = leafAt(trak, ["mdia", "hdlr"]);
  if (!hdlr || hdlr.payload.length < 12) return undefined;
  return readFourCC(hdlr.payload, 8);
}

/** Reads an MPEG-4 descriptor size (1 to 4 bytes, 7 bits each). */
function readDescriptorSize(bytes: Uint8Array, offset: number): { size: number; next: number } {
  let size = 0;
  for (let i = 0; i < 4; i++) {
    if (offset + i >= bytes.length) throw new BoxError("descriptor size goes past the end");
    const byte = bytes[offset + i];
    size = (size << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { size, next: offset + i + 1 };
  }
  throw new BoxError("descriptor size has more than 4 bytes");
}

/** Reads objectTypeIndication from an esds payload (version and flags first). */
export function esdsObjectType(esds: Uint8Array): number {
  let offset = 4;
  if (esds[offset] !== 0x03) throw new BoxError("esds does not start with an ES_Descriptor");
  offset = readDescriptorSize(esds, offset + 1).next;
  if (offset + 3 > esds.length) throw new BoxError("ES_Descriptor is cut");
  const flags = esds[offset + 2];
  offset += 3;
  if (flags & 0x80) offset += 2; // dependsOn_ES_ID
  if (flags & 0x40) {
    if (offset >= esds.length) throw new BoxError("ES_Descriptor URL is cut");
    offset += 1 + esds[offset]; // URLlength and URLstring
  }
  if (flags & 0x20) offset += 2; // OCR_ES_Id
  if (esds[offset] !== 0x04) throw new BoxError("esds has no DecoderConfigDescriptor");
  offset = readDescriptorSize(esds, offset + 1).next;
  if (offset >= esds.length) throw new BoxError("DecoderConfigDescriptor is cut");
  return esds[offset];
}

/**
 * Tells if the first sample entry of a sound track is AAC in 'mp4a'.
 * Returns false for other sound codecs. Throws when an 'mp4a' entry cannot be read,
 * because a silent skip would ship a clip that plays 44 ms out of sync.
 */
function isAacTrack(stbl: ContainerNode): boolean {
  const stsd = childOf(stbl, "stsd");
  if (!stsd || isContainer(stsd)) throw new MoovPatchError("bad-audio-entry", "audio stbl has no stsd");
  const payload = stsd.payload;
  try {
    const entries = readBoxes(payload, 8, payload.length);
    const entry = entries[0];
    if (!entry || entry.type !== "mp4a") return false;
    // SampleEntry (8) then the sound sample entry. Its version sets the field length.
    const soundStart = entry.start + entry.headerSize + 8;
    const soundVersion = (payload[soundStart] << 8) | payload[soundStart + 1];
    const fieldBytes = soundVersion === 0 ? 20 : soundVersion === 1 ? 36 : soundVersion === 2 ? 56 : -1;
    if (fieldBytes < 0) throw new BoxError(`sound sample entry version ${soundVersion} is unknown`);
    const children = readBoxes(payload, soundStart + fieldBytes, entry.start + entry.size);
    const esds = children.find((child) => child.type === "esds");
    if (!esds) throw new BoxError("mp4a entry has no esds");
    return esdsObjectType(payload.subarray(esds.start + esds.headerSize, esds.start + esds.size)) === OTI_AAC;
  } catch (error) {
    if (error instanceof MoovPatchError) throw error;
    throw new MoovPatchError("bad-audio-entry", `cannot read the audio sample entry: ${(error as Error).message}`);
  }
}

function sampleCountOf(stbl: ContainerNode): number {
  const stsz = childOf(stbl, "stsz");
  if (stsz && !isContainer(stsz) && stsz.payload.length >= 12) return readU32(stsz.payload, 8);
  const stz2 = childOf(stbl, "stz2");
  if (stz2 && !isContainer(stz2) && stz2.payload.length >= 12) return readU32(stz2.payload, 8);
  throw new MoovPatchError("bad-structure", "audio stbl has no sample size table");
}

function hasRollGroup(stbl: ContainerNode): boolean {
  return stbl.children.some(
    (child) =>
      (child.type === "sgpd" || child.type === "sbgp") &&
      !isContainer(child) &&
      child.payload.length >= 8 &&
      readFourCC(child.payload, 4) === "roll",
  );
}

/** All chunk offset tables in the moov, with their parent stbl so a table can be replaced. */
function chunkOffsetTables(moov: ContainerNode): Array<{ stbl: ContainerNode; index: number }> {
  const tables: Array<{ stbl: ContainerNode; index: number }> = [];
  for (const trak of moov.children) {
    if (trak.type !== "trak" || !isContainer(trak)) continue;
    const stbl = containerAt(trak, ["mdia", "minf", "stbl"]);
    if (!stbl) continue;
    stbl.children.forEach((child, index) => {
      if ((child.type === "stco" || child.type === "co64") && !isContainer(child)) tables.push({ stbl, index });
    });
  }
  return tables;
}

function readOffsets(table: LeafNode): number[] {
  const count = readU32(table.payload, 4);
  const width = table.type === "co64" ? 8 : 4;
  if (8 + count * width > table.payload.length) {
    throw new MoovPatchError("bad-structure", `${table.type} says ${count} entries but is too short`);
  }
  const offsets: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    offsets[i] = width === 8 ? readU64(table.payload, 8 + i * 8) : readU32(table.payload, 8 + i * 4);
  }
  return offsets;
}

function offsetTable(type: "stco" | "co64", offsets: number[]): LeafNode {
  const width = type === "co64" ? 8 : 4;
  const payload = new Uint8Array(8 + offsets.length * width);
  writeU32(payload, 4, offsets.length);
  offsets.forEach((offset, i) => {
    if (width === 8) writeU64(payload, 8 + i * 8, offset);
    else writeU32(payload, 8 + i * 4, offset);
  });
  return { type, payload };
}

/**
 * Adds 'roll' sgpd and sbgp boxes to every AAC track that does not have them, and
 * fixes every size field and chunk offset. Tracks that are not AAC stay as they are.
 * Calling it twice gives the same bytes as calling it once.
 */
export function addAacRollGroups(file: Uint8Array): RollPatchResult {
  let top;
  try {
    top = readBoxes(file);
  } catch (error) {
    throw new MoovPatchError("bad-structure", (error as Error).message);
  }
  const moovs = top.filter((box) => box.type === "moov");
  if (moovs.length === 0) throw new MoovPatchError("no-moov", "the file has no moov box");
  if (moovs.length > 1) throw new MoovPatchError("two-moov", "the file has more than one moov box");
  if (top.some((box) => box.type === "moof")) {
    throw new MoovPatchError("fragmented", "fragmented files keep absolute offsets in moof boxes");
  }
  const moovInfo = moovs[0];
  let moov: ContainerNode;
  try {
    moov = readTree(file, moovInfo) as ContainerNode;
  } catch (error) {
    throw new MoovPatchError("bad-structure", (error as Error).message);
  }
  if (childOf(moov, "mvex")) {
    throw new MoovPatchError("fragmented", "the moov has an mvex box, so the file is fragmented");
  }

  let patchedTracks = 0;
  for (const trak of moov.children) {
    if (trak.type !== "trak" || !isContainer(trak)) continue;
    if (handlerType(trak) !== "soun") continue;
    const stbl = containerAt(trak, ["mdia", "minf", "stbl"]);
    if (!stbl) throw new MoovPatchError("bad-structure", "sound track has no stbl");
    if (hasRollGroup(stbl) || !isAacTrack(stbl)) continue;
    const samples = sampleCountOf(stbl);
    if (samples === 0) continue;
    stbl.children.push({ type: "sgpd", payload: rollSgpdPayload() });
    stbl.children.push({ type: "sbgp", payload: rollSbgpPayload(samples) });
    patchedTracks++;
  }
  if (patchedTracks === 0) return { bytes: file, patchedTracks: 0, shift: 0 };

  const oldMoovEnd = moovInfo.start + moovInfo.size;
  const tables = chunkOffsetTables(moov);
  const original = tables.map(({ stbl, index }) => readOffsets(stbl.children[index] as LeafNode));
  for (const offsets of original) {
    if (offsets.some((offset) => offset >= moovInfo.start && offset < oldMoovEnd)) {
      throw new MoovPatchError("bad-structure", "a chunk offset points into the moov box");
    }
  }

  // A larger moov can push a 32-bit offset past 4 GiB. Such a table becomes co64,
  // which makes the moov larger again, so repeat until no table changes.
  let shift = nodeSize(moov) - moovInfo.size;
  for (;;) {
    let upgraded = false;
    tables.forEach(({ stbl, index }, i) => {
      const table = stbl.children[index];
      if (table.type !== "stco") return;
      const overflow = original[i].some((offset) => offset >= oldMoovEnd && offset + shift >= U32_LIMIT);
      if (overflow) {
        stbl.children[index] = offsetTable("co64", original[i]);
        upgraded = true;
      }
    });
    if (!upgraded) break;
    shift = nodeSize(moov) - moovInfo.size;
  }

  tables.forEach(({ stbl, index }, i) => {
    const type = stbl.children[index].type as "stco" | "co64";
    const moved = original[i].map((offset) => (offset >= oldMoovEnd ? offset + shift : offset));
    stbl.children[index] = offsetTable(type, moved);
  });

  const newMoov = writeTree(moov);
  const out = new Uint8Array(file.length + shift);
  out.set(file.subarray(0, moovInfo.start), 0);
  out.set(newMoov, moovInfo.start);
  out.set(file.subarray(oldMoovEnd), moovInfo.start + newMoov.length);
  return { bytes: out, patchedTracks, shift };
}

/** Boxes on the path from the file root, for tests and diagnostics. */
export function describeBoxes(file: Uint8Array): string[] {
  const lines: string[] = [];
  const visit = (node: BoxNode, path: string) => {
    const here = `${path}/${node.type}`;
    lines.push(here);
    if (isContainer(node)) node.children.forEach((child) => visit(child, here));
  };
  for (const box of readBoxes(file)) visit(readTree(file, box), "");
  return lines;
}
