// @vitest-environment node
/**
 * Box-writer unit tests for the roll-group patch (plan 6.4), on synthetic MP4 files
 * built here byte by byte. The ffmpeg and AVFoundation checks on real media are in
 * mux.av.node.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  type ContainerNode,
  type LeafNode,
  containerAt,
  fullBoxPayload,
  readBoxes,
  readTree,
  readU32,
  readU64,
  writeFourCC,
  writeTree,
  writeU32,
  writeU64,
} from "../boxes";
import {
  AAC_ROLL_DISTANCE,
  MoovPatchError,
  addAacRollGroups,
  describeBoxes,
  esdsObjectType,
  rollSbgpBox,
  rollSgpdBox,
} from "../moovPatch";
import { toHex } from "./fixtures";

// Captured from `ffmpeg -c copy` output of a 191-sample AAC track (ffmpeg 8.1.2).
const FFMPEG_SGPD_HEX = "0000001a7367706401000000726f6c6c0000000200000001ffff";
const FFMPEG_SBGP_191_HEX = "0000001c7362677000000000726f6c6c00000001000000bf00000001";

function u32(value: number): number[] {
  const bytes = new Uint8Array(4);
  writeU32(bytes, 0, value);
  return Array.from(bytes);
}
function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}
function fourcc(type: string): number[] {
  const bytes = new Uint8Array(4);
  writeFourCC(bytes, 0, type);
  return Array.from(bytes);
}
function leaf(type: string, payload: number[] | Uint8Array): LeafNode {
  return { type, payload: payload instanceof Uint8Array ? payload : new Uint8Array(payload) };
}
function full(type: string, version: number, body: number[]): LeafNode {
  return { type, payload: fullBoxPayload(version, 0, new Uint8Array(body)) };
}
function container(type: string, children: Array<ContainerNode | LeafNode>): ContainerNode {
  return { type, children };
}

function hdlr(handler: string): LeafNode {
  return full("hdlr", 0, [...u32(0), ...fourcc(handler), ...new Array(12).fill(0), 0]);
}

interface EsdsOptions {
  oti?: number;
  esFlags?: number;
}
function esdsBody({ oti = 0x40, esFlags = 0 }: EsdsOptions = {}): number[] {
  const optional: number[] = [];
  if (esFlags & 0x80) optional.push(0, 7);
  if (esFlags & 0x40) optional.push(3, 0x61, 0x62, 0x63);
  if (esFlags & 0x20) optional.push(0, 9);
  const decoderSpecific = [0x05, 2, 0x11, 0x90];
  const decoderConfig = [0x04, 13 + decoderSpecific.length, oti, 0x15, 0, 0, 0, ...u32(128000), ...u32(128000), ...decoderSpecific];
  const es = [...u16(1), esFlags, ...optional, ...decoderConfig, 0x06, 1, 2];
  // A 4-byte descriptor size (0x80 0x80 0x80 n), the form some encoders write.
  return [0x03, 0x80, 0x80, 0x80, es.length, ...es];
}

function mp4aEntry(esds: EsdsOptions | null, soundVersion = 0): Uint8Array {
  const soundFields =
    soundVersion === 0
      ? [...u16(0), ...u16(0), ...u32(0), ...u16(2), ...u16(16), ...u16(0), ...u16(0), ...u32(48000 * 65536)]
      : [...u16(1), ...u16(0), ...u32(0), ...u16(2), ...u16(16), ...u16(0), ...u16(0), ...u32(48000 * 65536), ...new Array(16).fill(0)];
  const children = esds ? writeTree(full("esds", 0, esdsBody(esds))) : new Uint8Array(0);
  return writeTree(leaf("mp4a", [0, 0, 0, 0, 0, 0, ...u16(1), ...soundFields, ...children]));
}

function stsd(entry: Uint8Array): LeafNode {
  return full("stsd", 0, [...u32(1), ...entry]);
}
function stsz(count: number): LeafNode {
  return full("stsz", 0, [...u32(0), ...u32(count), ...new Array(count).fill(0).flatMap(() => u32(4))]);
}
function stz2(count: number): LeafNode {
  // reserved (3 bytes), field_size 8, sample_count, then one byte per sample.
  return full("stz2", 0, [0, 0, 0, 8, ...u32(count), ...new Array(count).fill(4)]);
}
function stco(offsets: number[]): LeafNode {
  return full("stco", 0, [...u32(offsets.length), ...offsets.flatMap(u32)]);
}
function co64(offsets: number[]): LeafNode {
  return full(
    "co64",
    0,
    [...u32(offsets.length), ...offsets.flatMap((offset) => {
      const bytes = new Uint8Array(8);
      writeU64(bytes, 0, offset);
      return Array.from(bytes);
    })],
  );
}

interface TrackSpec {
  handler: "vide" | "soun";
  entry: Uint8Array;
  samples: number;
  chunks: number;
  table?: "stco" | "co64";
  sizeTable?: "stsz" | "stz2";
  extra?: LeafNode[];
  /** Offsets to write as they are (for overflow tests). */
  fixedOffsets?: number[];
}

function trak(spec: TrackSpec, offsets: number[]): ContainerNode {
  const table = spec.table === "co64" ? co64(offsets) : stco(offsets);
  const sizes = spec.sizeTable === "stz2" ? stz2(spec.samples) : stsz(spec.samples);
  return container("trak", [
    full("tkhd", 0, new Array(80).fill(0)),
    container("mdia", [
      full("mdhd", 0, new Array(20).fill(0)),
      hdlr(spec.handler),
      container("minf", [container("stbl", [stsd(spec.entry), full("stts", 0, u32(0)), sizes, table, ...(spec.extra ?? [])])]),
    ]),
  ]);
}

interface Built {
  file: Uint8Array;
  /** Chunk offsets per track, in file order. */
  offsets: number[][];
}

/** Builds ftyp + moov + mdat (fast start), or ftyp + mdat + moov when moovLast is true. */
function buildFile(tracks: TrackSpec[], options: { moovLast?: boolean; topExtra?: LeafNode[] } = {}): Built {
  const ftyp = writeTree(leaf("ftyp", [...fourcc("isom"), 0, 0, 2, 0, ...fourcc("isom")]));
  const chunkBytes = 16;
  const totalChunks = tracks.reduce((sum, track) => sum + track.chunks, 0);
  const makeMoov = (offsets: number[][]) =>
    writeTree(container("moov", [full("mvhd", 0, new Array(96).fill(0)), ...tracks.map((track, i) => trak(track, offsets[i]))]));
  const zeroOffsets = tracks.map((track) => track.fixedOffsets ?? new Array(track.chunks).fill(0));
  const moovSize = makeMoov(zeroOffsets).length;
  const mdatStart = options.moovLast ? ftyp.length : ftyp.length + moovSize;
  const offsets: number[][] = [];
  let next = mdatStart + 8;
  for (const track of tracks) {
    if (track.fixedOffsets) {
      offsets.push(track.fixedOffsets);
      continue;
    }
    const list: number[] = [];
    for (let c = 0; c < track.chunks; c++) {
      list.push(next);
      next += chunkBytes;
    }
    offsets.push(list);
  }
  const mdatPayload = new Uint8Array(totalChunks * chunkBytes);
  for (let i = 0; i < mdatPayload.length; i++) mdatPayload[i] = (i * 7 + 3) & 0xff;
  const mdat = writeTree(leaf("mdat", mdatPayload));
  const moov = makeMoov(offsets);
  const extra = (options.topExtra ?? []).map((node) => writeTree(node));
  const parts = options.moovLast ? [ftyp, mdat, moov, ...extra] : [ftyp, moov, mdat, ...extra];
  const file = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    file.set(part, cursor);
    cursor += part.length;
  }
  return { file, offsets };
}

function moovTree(file: Uint8Array): ContainerNode {
  const info = readBoxes(file).find((box) => box.type === "moov")!;
  return readTree(file, info) as ContainerNode;
}

function tracksOf(file: Uint8Array): ContainerNode[] {
  return moovTree(file).children.filter((child): child is ContainerNode => child.type === "trak");
}

function offsetsOf(trakNode: ContainerNode): { type: string; offsets: number[] } {
  const stbl = containerAt(trakNode, ["mdia", "minf", "stbl"])!;
  const table = stbl.children.find((child) => child.type === "stco" || child.type === "co64") as LeafNode;
  const count = readU32(table.payload, 4);
  const offsets = Array.from({ length: count }, (_, i) =>
    table.type === "co64" ? readU64(table.payload, 8 + i * 8) : readU32(table.payload, 8 + i * 4),
  );
  return { type: table.type, offsets };
}

function stblTypes(trakNode: ContainerNode): string[] {
  return containerAt(trakNode, ["mdia", "minf", "stbl"])!.children.map((child) => child.type);
}

const VIDEO: TrackSpec = { handler: "vide", entry: writeTree(leaf("avc1", new Array(78).fill(0))), samples: 60, chunks: 3 };
const AUDIO: TrackSpec = { handler: "soun", entry: mp4aEntry({}), samples: 191, chunks: 4 };

describe("roll group boxes", () => {
  it("writes the same sgpd bytes as ffmpeg's mp4 muxer", () => {
    expect(toHex(rollSgpdBox())).toBe(FFMPEG_SGPD_HEX);
    expect(AAC_ROLL_DISTANCE).toBe(-1);
  });

  it("writes the same sbgp bytes as ffmpeg's mp4 muxer", () => {
    expect(toHex(rollSbgpBox(191))).toBe(FFMPEG_SBGP_191_HEX);
  });

  it("writes large sample counts in 32 bits", () => {
    const sbgp = rollSbgpBox(0x01020304);
    expect(readU32(sbgp, 20)).toBe(0x01020304);
  });

  it("rejects a sample count that is not a positive integer", () => {
    expect(() => rollSbgpBox(0)).toThrow(MoovPatchError);
    expect(() => rollSbgpBox(2.5)).toThrow(MoovPatchError);
  });
});

describe("esdsObjectType", () => {
  it.each([
    ["no optional fields", 0],
    ["dependsOn_ES_ID", 0x80],
    ["URL", 0x40],
    ["OCR_ES_Id", 0x20],
    ["all optional fields", 0xe0],
  ])("reads the object type with %s", (_name, esFlags) => {
    const payload = fullBoxPayload(0, 0, new Uint8Array(esdsBody({ oti: 0x40, esFlags })));
    expect(esdsObjectType(payload)).toBe(0x40);
  });

  it("rejects bytes that are not an ES_Descriptor", () => {
    expect(() => esdsObjectType(new Uint8Array([0, 0, 0, 0, 0x05, 2, 0x11, 0x90]))).toThrow();
  });
});

describe("addAacRollGroups", () => {
  it("adds sgpd and sbgp at the end of the audio stbl, like ffmpeg", () => {
    const { file } = buildFile([VIDEO, AUDIO]);
    const result = addAacRollGroups(file);
    expect(result.patchedTracks).toBe(1);
    expect(result.shift).toBe(26 + 28);
    const [video, audio] = tracksOf(result.bytes);
    expect(stblTypes(video)).toEqual(["stsd", "stts", "stsz", "stco"]);
    expect(stblTypes(audio)).toEqual(["stsd", "stts", "stsz", "stco", "sgpd", "sbgp"]);
    const stbl = containerAt(audio, ["mdia", "minf", "stbl"])!;
    expect(toHex(writeTree(stbl.children[4]))).toBe(FFMPEG_SGPD_HEX);
    expect(toHex(writeTree(stbl.children[5]))).toBe(FFMPEG_SBGP_191_HEX);
  });

  it("keeps every size field valid", () => {
    const { bytes } = addAacRollGroups(buildFile([VIDEO, AUDIO]).file);
    const top = readBoxes(bytes);
    expect(top.map((box) => box.type)).toEqual(["ftyp", "moov", "mdat"]);
    expect(top[2].start + top[2].size).toBe(bytes.length);
    // readTree throws when any nested size is wrong.
    expect(() => moovTree(bytes)).not.toThrow();
  });

  it("moves every chunk offset of every track by the moov growth, so each still points at its data", () => {
    const built = buildFile([VIDEO, AUDIO]);
    const result = addAacRollGroups(built.file);
    const after = tracksOf(result.bytes).map(offsetsOf);
    after.forEach(({ offsets }, track) => {
      offsets.forEach((offset, chunk) => {
        const before = built.offsets[track][chunk];
        expect(offset).toBe(before + result.shift);
        expect(toHex(result.bytes.subarray(offset, offset + 16))).toBe(toHex(built.file.subarray(before, before + 16)));
      });
    });
  });

  it("keeps the mdat bytes the same", () => {
    const built = buildFile([VIDEO, AUDIO]);
    const result = addAacRollGroups(built.file);
    const oldMdat = readBoxes(built.file).find((box) => box.type === "mdat")!;
    const newMdat = readBoxes(result.bytes).find((box) => box.type === "mdat")!;
    expect(toHex(result.bytes.subarray(newMdat.start, newMdat.start + newMdat.size))).toBe(
      toHex(built.file.subarray(oldMdat.start, oldMdat.start + oldMdat.size)),
    );
  });

  it("gives the same bytes when it runs twice", () => {
    const once = addAacRollGroups(buildFile([VIDEO, AUDIO]).file);
    const twice = addAacRollGroups(once.bytes);
    expect(twice.patchedTracks).toBe(0);
    expect(twice.shift).toBe(0);
    expect(twice.bytes).toBe(once.bytes);
  });

  it("returns the input when there is no audio track", () => {
    const { file } = buildFile([VIDEO]);
    const result = addAacRollGroups(file);
    expect(result).toEqual({ bytes: file, patchedTracks: 0, shift: 0 });
  });

  it("leaves a sound track that is not AAC (MP3 in mp4a) as it is", () => {
    const mp3: TrackSpec = { ...AUDIO, entry: mp4aEntry({ oti: 0x6b }) };
    const result = addAacRollGroups(buildFile([VIDEO, mp3]).file);
    expect(result.patchedTracks).toBe(0);
  });

  it("leaves a sound track with another sample entry (Opus) as it is", () => {
    const opus: TrackSpec = { ...AUDIO, entry: writeTree(leaf("Opus", new Array(28).fill(0))) };
    expect(addAacRollGroups(buildFile([VIDEO, opus]).file).patchedTracks).toBe(0);
  });

  it("reads a QuickTime version 1 sound entry", () => {
    const v1: TrackSpec = { ...AUDIO, entry: mp4aEntry({}, 1) };
    expect(addAacRollGroups(buildFile([VIDEO, v1]).file).patchedTracks).toBe(1);
  });

  it("throws on an mp4a entry with no esds, so a clip never ships 44 ms out of sync without notice", () => {
    const broken: TrackSpec = { ...AUDIO, entry: mp4aEntry(null) };
    expect(() => addAacRollGroups(buildFile([VIDEO, broken]).file)).toThrow(
      expect.objectContaining({ code: "bad-audio-entry" }),
    );
  });

  it("uses the sample count from stz2 when there is no stsz", () => {
    const compact: TrackSpec = { ...AUDIO, sizeTable: "stz2", samples: 77 };
    const result = addAacRollGroups(buildFile([VIDEO, compact]).file);
    const stbl = containerAt(tracksOf(result.bytes)[1], ["mdia", "minf", "stbl"])!;
    const sbgp = stbl.children.find((child) => child.type === "sbgp") as LeafNode;
    expect(readU32(sbgp.payload, 12)).toBe(77);
  });

  it("skips a track with zero samples", () => {
    const empty: TrackSpec = { ...AUDIO, samples: 0 };
    expect(addAacRollGroups(buildFile([VIDEO, empty]).file).patchedTracks).toBe(0);
  });

  it("moves co64 offsets and keeps them 64-bit", () => {
    const built = buildFile([{ ...VIDEO, table: "co64" }, { ...AUDIO, table: "co64" }]);
    const result = addAacRollGroups(built.file);
    const after = tracksOf(result.bytes).map(offsetsOf);
    expect(after.map((table) => table.type)).toEqual(["co64", "co64"]);
    expect(after[1].offsets).toEqual(built.offsets[1].map((offset) => offset + result.shift));
  });

  it("changes an stco to co64 when a moved offset passes 4 GiB", () => {
    const near = 2 ** 32 - 10;
    const video: TrackSpec = { ...VIDEO, chunks: 2, fixedOffsets: [near - 100, near] };
    const built = buildFile([video, AUDIO]);
    const result = addAacRollGroups(built.file);
    const [videoTable, audioTable] = tracksOf(result.bytes).map(offsetsOf);
    expect(videoTable.type).toBe("co64");
    expect(audioTable.type).toBe("stco");
    // The co64 table is 4 bytes per entry larger, so the shift includes that growth.
    expect(result.shift).toBe(26 + 28 + 2 * 4);
    expect(videoTable.offsets).toEqual([near - 100 + result.shift, near + result.shift]);
    expect(audioTable.offsets).toEqual(built.offsets[1].map((offset) => offset + result.shift));
  });

  it("does not move offsets when the moov is after the mdat", () => {
    const built = buildFile([VIDEO, AUDIO], { moovLast: true });
    const result = addAacRollGroups(built.file);
    expect(result.patchedTracks).toBe(1);
    expect(tracksOf(result.bytes).map((track) => offsetsOf(track).offsets)).toEqual(built.offsets);
    expect(readBoxes(result.bytes).map((box) => box.type)).toEqual(["ftyp", "mdat", "moov"]);
  });

  it("refuses fragmented files", () => {
    const moof = buildFile([VIDEO, AUDIO], { topExtra: [leaf("moof", [0, 0, 0, 0])] });
    expect(() => addAacRollGroups(moof.file)).toThrow(expect.objectContaining({ code: "fragmented" }));
    const withMvex = buildFile([VIDEO, AUDIO]);
    const tree = moovTree(withMvex.file);
    tree.children.push(container("mvex", []));
    const moovBytes = writeTree(tree);
    const info = readBoxes(withMvex.file).find((box) => box.type === "moov")!;
    const rebuilt = new Uint8Array([
      ...withMvex.file.subarray(0, info.start),
      ...moovBytes,
      ...withMvex.file.subarray(info.start + info.size),
    ]);
    expect(() => addAacRollGroups(rebuilt)).toThrow(expect.objectContaining({ code: "fragmented" }));
  });

  it("refuses a file with no moov or with two", () => {
    const ftyp = writeTree(leaf("ftyp", fourcc("isom")));
    expect(() => addAacRollGroups(ftyp)).toThrow(expect.objectContaining({ code: "no-moov" }));
    const { file } = buildFile([VIDEO, AUDIO]);
    const info = readBoxes(file).find((box) => box.type === "moov")!;
    const moov = file.subarray(info.start, info.start + info.size);
    expect(() => addAacRollGroups(new Uint8Array([...file, ...moov]))).toThrow(expect.objectContaining({ code: "two-moov" }));
  });

  it("refuses a chunk offset that points into the moov", () => {
    const bad: TrackSpec = { ...VIDEO, chunks: 1, fixedOffsets: [40] };
    expect(() => addAacRollGroups(buildFile([bad, AUDIO]).file)).toThrow(expect.objectContaining({ code: "bad-structure" }));
  });

  it("refuses a file whose boxes do not add up", () => {
    const { file } = buildFile([VIDEO, AUDIO]);
    const cut = file.subarray(0, file.length - 3);
    expect(() => addAacRollGroups(cut)).toThrow(expect.objectContaining({ code: "bad-structure" }));
  });

  it("reads a moov that uses a 64-bit size header", () => {
    const { file } = buildFile([VIDEO, AUDIO]);
    const moovInfo = readBoxes(file).find((box) => box.type === "moov")!;
    // A 16-byte header moves the mdat 8 bytes later, so every chunk offset gets +8.
    const tree = moovTree(file);
    for (const trakNode of tree.children.filter((child): child is ContainerNode => child.type === "trak")) {
      const stbl = containerAt(trakNode, ["mdia", "minf", "stbl"])!;
      const index = stbl.children.findIndex((child) => child.type === "stco");
      stbl.children[index] = stco(offsetsOf(trakNode).offsets.map((offset) => offset + 8));
    }
    const body = writeTree(tree).subarray(8);
    const large = new Uint8Array(16 + body.length);
    writeU32(large, 0, 1);
    writeFourCC(large, 4, "moov");
    writeU64(large, 8, large.length);
    large.set(body, 16);
    const input = new Uint8Array([...file.subarray(0, moovInfo.start), ...large, ...file.subarray(moovInfo.start + moovInfo.size)]);
    expect(readBoxes(input).find((box) => box.type === "moov")!.headerSize).toBe(16);
    const result = addAacRollGroups(input);
    // The output uses an 8-byte header again, so the moov grows by 54 - 8 bytes.
    expect(result.shift).toBe(54 - 8);
    const mdat = readBoxes(result.bytes).find((box) => box.type === "mdat")!;
    const [videoTable] = tracksOf(result.bytes).map(offsetsOf);
    expect(videoTable.offsets[0]).toBe(mdat.start + 8);
    expect(describeBoxes(result.bytes)).toContain("/moov/trak/mdia/minf/stbl/sgpd");
  });
});
