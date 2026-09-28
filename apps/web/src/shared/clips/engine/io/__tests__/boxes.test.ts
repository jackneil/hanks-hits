// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  BoxError,
  type ContainerNode,
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
} from "../boxes";

function box(type: string, body: number[] | Uint8Array): Uint8Array {
  const payload = body instanceof Uint8Array ? body : new Uint8Array(body);
  const out = new Uint8Array(8 + payload.length);
  writeU32(out, 0, out.length);
  writeFourCC(out, 4, type);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("integer and type helpers", () => {
  it("reads and writes 32-bit values, including the top bit", () => {
    const bytes = new Uint8Array(8);
    writeU32(bytes, 0, 0xfedcba98);
    writeU32(bytes, 4, 1);
    expect(Array.from(bytes)).toEqual([0xfe, 0xdc, 0xba, 0x98, 0, 0, 0, 1]);
    expect(readU32(bytes, 0)).toBe(0xfedcba98);
    expect(readU32(bytes, 4)).toBe(1);
  });

  it("refuses values that do not fit in 32 bits", () => {
    const bytes = new Uint8Array(4);
    expect(() => writeU32(bytes, 0, 2 ** 32)).toThrow(BoxError);
    expect(() => writeU32(bytes, 0, -1)).toThrow(BoxError);
    expect(() => writeU32(bytes, 0, 1.5)).toThrow(BoxError);
  });

  it("reads and writes 64-bit values above 4 GiB", () => {
    const bytes = new Uint8Array(8);
    writeU64(bytes, 0, 2 ** 40 + 12345);
    expect(readU64(bytes, 0)).toBe(2 ** 40 + 12345);
  });

  it("refuses 64-bit values that are not safe integers", () => {
    const bytes = new Uint8Array(8).fill(0xff);
    expect(() => readU64(bytes, 0)).toThrow(BoxError);
  });

  it("refuses reads past the end", () => {
    expect(() => readU32(new Uint8Array(3), 0)).toThrow(BoxError);
    expect(() => readFourCC(new Uint8Array(3), 0)).toThrow(BoxError);
  });

  it("refuses box types that are not 4 Latin-1 characters", () => {
    expect(() => writeFourCC(new Uint8Array(4), 0, "abc")).toThrow(BoxError);
    expect(() => writeFourCC(new Uint8Array(8), 0, "ab€1")).toThrow(BoxError);
  });
});

describe("readBoxes", () => {
  it("lists boxes one after another", () => {
    const file = concat(box("ftyp", [1, 2, 3, 4]), box("free", []), box("mdat", [9, 9]));
    expect(readBoxes(file)).toEqual([
      { type: "ftyp", start: 0, size: 12, headerSize: 8 },
      { type: "free", start: 12, size: 8, headerSize: 8 },
      { type: "mdat", start: 20, size: 10, headerSize: 8 },
    ]);
  });

  it("reads a 64-bit size", () => {
    const large = new Uint8Array(20);
    writeU32(large, 0, 1);
    writeFourCC(large, 4, "mdat");
    writeU64(large, 8, 20);
    expect(readBoxes(large)).toEqual([{ type: "mdat", start: 0, size: 20, headerSize: 16 }]);
  });

  it("treats size 0 as 'to the end of the range'", () => {
    const file = concat(box("ftyp", [0, 0, 0, 0]), new Uint8Array([0, 0, 0, 0, 0x6d, 0x64, 0x61, 0x74, 7, 7, 7]));
    expect(readBoxes(file)[1]).toEqual({ type: "mdat", start: 12, size: 11, headerSize: 8 });
  });

  it("rejects a box that goes past the end", () => {
    const file = box("moov", [1, 2, 3]);
    writeU32(file, 0, 100);
    expect(() => readBoxes(file)).toThrow(/goes past the end/);
  });

  it("rejects a size smaller than the header", () => {
    const file = box("moov", []);
    writeU32(file, 0, 4);
    expect(() => readBoxes(file)).toThrow(/smaller than its header/);
  });

  it("rejects trailing bytes that cannot be a box", () => {
    expect(() => readBoxes(concat(box("free", []), new Uint8Array([1, 2, 3])))).toThrow(/after the last box/);
  });

  it("rejects a cut 64-bit size", () => {
    const cut = new Uint8Array(12);
    writeU32(cut, 0, 1);
    writeFourCC(cut, 4, "mdat");
    expect(() => readBoxes(cut)).toThrow(/cut 64-bit size/);
  });
});

describe("box tree", () => {
  const stsz = box("stsz", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
  const stbl = box("stbl", stsz);
  const minf = box("minf", stbl);
  const mdia = box("mdia", concat(box("hdlr", [0, 0, 0, 0, 0, 0, 0, 0, 0x73, 0x6f, 0x75, 0x6e]), minf));
  const trak = box("trak", mdia);
  const udta = box("udta", [0, 0, 0, 0]); // QuickTime udta can end with 4 zero bytes, which is not a box.
  const moov = box("moov", concat(trak, udta));

  it("opens container boxes and keeps other boxes as bytes", () => {
    const tree = readTree(moov, readBoxes(moov)[0]) as ContainerNode;
    expect(isContainer(tree)).toBe(true);
    expect(tree.children.map((child) => child.type)).toEqual(["trak", "udta"]);
    expect(isContainer(tree.children[1])).toBe(false);
    const stblNode = containerAt(tree, ["trak", "mdia", "minf", "stbl"]);
    expect(stblNode?.children.map((child) => child.type)).toEqual(["stsz"]);
    expect(leafAt(tree, ["trak", "mdia", "hdlr"])?.payload.length).toBe(12);
    expect(childOf(tree, "mvex")).toBeUndefined();
    expect(containerAt(tree, ["trak", "nope"])).toBeUndefined();
    expect(leafAt(tree, ["trak", "mdia", "minf"])).toBeUndefined();
  });

  it("writes the same bytes it read", () => {
    const tree = readTree(moov, readBoxes(moov)[0]);
    expect(Array.from(writeTree(tree))).toEqual(Array.from(moov));
    expect(nodeSize(tree)).toBe(moov.length);
  });

  it("recomputes every size after a change", () => {
    const tree = readTree(moov, readBoxes(moov)[0]) as ContainerNode;
    const stblNode = containerAt(tree, ["trak", "mdia", "minf", "stbl"])!;
    stblNode.children.push({ type: "sgpd", payload: new Uint8Array(18) });
    const out = writeTree(tree);
    expect(out.length).toBe(moov.length + 26);
    const reread = readTree(out, readBoxes(out)[0]) as ContainerNode;
    expect(containerAt(reread, ["trak", "mdia", "minf", "stbl"])?.children.map((child) => child.type)).toEqual([
      "stsz",
      "sgpd",
    ]);
  });

  it("builds full-box payloads with version and 24-bit flags", () => {
    expect(Array.from(fullBoxPayload(1, 0x010203, new Uint8Array([9])))).toEqual([1, 1, 2, 3, 9]);
  });
});
