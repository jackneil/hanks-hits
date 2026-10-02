/**
 * Box surgery for the MP4 check tests: read a real clip into a tree, change
 * one thing, and write it back with every box size (and every chunk offset)
 * correct, so the file breaks exactly one rule.
 *
 * Containers are opened with the fixed bytes that come before their child
 * boxes (stsd: version, flags and entry count; avc1: the 78-byte visual
 * sample entry; mp4a: the 28-byte audio sample entry). Every other box is a
 * leaf whose payload is kept as it is.
 */
import { readBoxes, readU32, readU64, writeFourCC, writeU32, writeU64 } from "@/shared/clips/engine/io/boxes";

export interface MBox {
  type: string;
  /** Leaf: the bytes after the header. Container: the fixed bytes before the children. */
  payload: Uint8Array;
  children?: MBox[];
  /** Write a 64-bit size header even when the box is small. */
  large?: boolean;
  /** Write size 0 ("to the end of the file"). Only for the last top-level box. */
  toEnd?: boolean;
}

const SKIP: Record<string, number> = {
  moov: 0, trak: 0, mdia: 0, minf: 0, stbl: 0, dinf: 0, edts: 0, udta: 0, mvex: 0,
  stsd: 8, dref: 8, avc1: 78, mp4a: 28,
};

function read(bytes: Uint8Array, start: number, end: number): MBox[] {
  return readBoxes(bytes, start, end).map((info) => {
    const bodyStart = info.start + info.headerSize;
    const bodyEnd = info.start + info.size;
    const skip = Object.hasOwn(SKIP, info.type) ? SKIP[info.type] : undefined;
    if (skip === undefined) return { type: info.type, payload: bytes.slice(bodyStart, bodyEnd) };
    return {
      type: info.type,
      payload: bytes.slice(bodyStart, bodyStart + skip),
      children: read(bytes, bodyStart + skip, bodyEnd),
    };
  });
}

export function parse(bytes: Uint8Array): MBox[] {
  return read(bytes, 0, bytes.length);
}

function bodySize(box: MBox): number {
  return box.payload.length + (box.children ?? []).reduce((sum, child) => sum + boxSize(child), 0);
}

function boxSize(box: MBox): number {
  const body = bodySize(box);
  return body + (box.large || body + 8 > 0xffff_ffff ? 16 : 8);
}

function writeBox(box: MBox, out: Uint8Array, at: number): number {
  const size = boxSize(box);
  const large = size - bodySize(box) === 16;
  if (box.toEnd) writeU32(out, at, 0);
  else writeU32(out, at, large ? 1 : size);
  writeFourCC(out, at + 4, box.type);
  let cursor = at + 8;
  if (large) {
    writeU64(out, cursor, size);
    cursor += 8;
  }
  out.set(box.payload, cursor);
  cursor += box.payload.length;
  for (const child of box.children ?? []) cursor = writeBox(child, out, cursor);
  return cursor;
}

function serialize(boxes: MBox[]): Uint8Array {
  const out = new Uint8Array(boxes.reduce((sum, box) => sum + boxSize(box), 0));
  let cursor = 0;
  for (const box of boxes) cursor = writeBox(box, out, cursor);
  return out;
}

/** Every box of a type, at any depth. */
export function findAll(boxes: MBox[], type: string): MBox[] {
  const found: MBox[] = [];
  const visit = (list: MBox[]) => {
    for (const box of list) {
      if (box.type === type) found.push(box);
      if (box.children) visit(box.children);
    }
  };
  visit(boxes);
  return found;
}

export function find(boxes: MBox[], type: string): MBox {
  const [box] = findAll(boxes, type);
  if (!box) throw new Error(`no ${type} box`);
  return box;
}

/** The trak whose handler is "vide" or "soun". */
export function trackOf(boxes: MBox[], handler: "vide" | "soun"): MBox {
  for (const trak of findAll(boxes, "trak")) {
    const hdlr = find(trak.children!, "hdlr");
    if (String.fromCharCode(...hdlr.payload.subarray(8, 12)) === handler) return trak;
  }
  throw new Error(`no ${handler} track`);
}

export function deepCopy(box: MBox): MBox {
  return { ...box, payload: box.payload.slice(), children: box.children?.map(deepCopy) };
}

/** A box with these payload bytes. */
export function leaf(type: string, payload: number[] | Uint8Array = []): MBox {
  return { type, payload: Uint8Array.from(payload) };
}

/** The start offset of the mdat payload in the written file. */
function mdatDataStart(boxes: MBox[]): number {
  let at = 0;
  for (const box of boxes) {
    const size = boxSize(box);
    if (box.type === "mdat") return at + (size - bodySize(box));
    at += size;
  }
  throw new Error("no mdat");
}

/**
 * Write the tree. Each chunk offset moves by the distance that the mdat
 * payload moved, so the file stays playable after the change.
 */
export function rebuild(original: Uint8Array, boxes: MBox[]): Uint8Array {
  const before = mdatDataStart(parse(original));
  const after = mdatDataStart(boxes);
  const delta = after - before;
  if (delta !== 0) {
    for (const table of [...findAll(boxes, "stco"), ...findAll(boxes, "co64")]) {
      const p = table.payload;
      const count = readU32(p, 4);
      for (let i = 0; i < count; i++) {
        if (table.type === "stco") writeU32(p, 8 + i * 4, readU32(p, 8 + i * 4) + delta);
        else writeU64(p, 8 + i * 8, readU64(p, 8 + i * 8) + delta);
      }
    }
  }
  return serialize(boxes);
}

/** Change a copy of the file with `edit`, then rebuild it. */
export function edit(bytes: Uint8Array, change: (boxes: MBox[]) => MBox[] | void): Uint8Array {
  const boxes = parse(bytes);
  const result = change(boxes) ?? boxes;
  return rebuild(bytes, result);
}
