/**
 * ISO BMFF (MP4) box reader and writer.
 *
 * Pure functions with no browser APIs. The moov patch uses them to change the
 * sample tables of a finished file. Only the box types in CONTAINER_TYPES are
 * opened; every other box stays as its original bytes.
 */

/** An error in the box structure of a file. */
export class BoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoxError";
  }
}

/** The position of one box in a byte range. */
export interface BoxInfo {
  type: string;
  /** Offset of the first header byte. */
  start: number;
  /** Size of the full box, header included. */
  size: number;
  /** 8, or 16 when the box uses a 64-bit size. */
  headerSize: number;
}

/** A container box and its child boxes. */
export interface ContainerNode {
  type: string;
  children: BoxNode[];
}

/** A leaf box. The payload is every byte after the header (version and flags included). */
export interface LeafNode {
  type: string;
  payload: Uint8Array;
}

export type BoxNode = ContainerNode | LeafNode;

/**
 * Box types that hold only child boxes, so the tree reader opens them.
 * "udta" and "meta" are not in this set: QuickTime "udta" can hold data that is not
 * a box, and "meta" is a full box. The patch never needs to change them.
 */
export const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "edts",
  "dinf",
  "mvex",
]);

const U32_LIMIT = 0x1_0000_0000;

export function isContainer(node: BoxNode): node is ContainerNode {
  return (node as ContainerNode).children !== undefined;
}

export function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new BoxError(`read of 4 bytes at ${offset} is outside ${bytes.length} bytes`);
  }
  return (
    bytes[offset] * 0x100_0000 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

export function readU64(bytes: Uint8Array, offset: number): number {
  const hi = readU32(bytes, offset);
  const lo = readU32(bytes, offset + 4);
  const value = hi * U32_LIMIT + lo;
  if (!Number.isSafeInteger(value)) {
    throw new BoxError(`64-bit value at ${offset} is too large`);
  }
  return value;
}

export function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= U32_LIMIT) {
    throw new BoxError(`value ${value} does not fit in 32 bits`);
  }
  bytes[offset] = Math.floor(value / 0x100_0000) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

export function writeU64(bytes: Uint8Array, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BoxError(`value ${value} is not a safe unsigned integer`);
  }
  writeU32(bytes, offset, Math.floor(value / U32_LIMIT));
  writeU32(bytes, offset + 4, value % U32_LIMIT);
}

export function readFourCC(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new BoxError(`read of a type at ${offset} is outside ${bytes.length} bytes`);
  }
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

export function writeFourCC(bytes: Uint8Array, offset: number, type: string): void {
  if (type.length !== 4) throw new BoxError(`box type "${type}" must have 4 characters`);
  for (let i = 0; i < 4; i++) {
    const code = type.charCodeAt(i);
    if (code > 0xff) throw new BoxError(`box type "${type}" is not Latin-1`);
    bytes[offset + i] = code;
  }
}

/**
 * Reads the boxes that follow each other in [start, end).
 * A size of 0 means "to the end of the range". A size of 1 means a 64-bit size follows.
 */
export function readBoxes(bytes: Uint8Array, start = 0, end = bytes.length): BoxInfo[] {
  const boxes: BoxInfo[] = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) {
      throw new BoxError(`${end - offset} bytes after the last box at ${offset}`);
    }
    let size = readU32(bytes, offset);
    const type = readFourCC(bytes, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      if (end - offset < 16) throw new BoxError(`box "${type}" at ${offset} has a cut 64-bit size`);
      size = readU64(bytes, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize) {
      throw new BoxError(`box "${type}" at ${offset} has size ${size}, which is smaller than its header`);
    }
    if (offset + size > end) {
      throw new BoxError(`box "${type}" at ${offset} (size ${size}) goes past the end ${end}`);
    }
    boxes.push({ type, start: offset, size, headerSize });
    offset += size;
  }
  return boxes;
}

/** Reads one box and, for container types, all of its child boxes. */
export function readTree(bytes: Uint8Array, box: BoxInfo): BoxNode {
  const bodyStart = box.start + box.headerSize;
  const bodyEnd = box.start + box.size;
  if (CONTAINER_TYPES.has(box.type)) {
    return {
      type: box.type,
      children: readBoxes(bytes, bodyStart, bodyEnd).map((child) => readTree(bytes, child)),
    };
  }
  return { type: box.type, payload: bytes.subarray(bodyStart, bodyEnd) };
}

/** The size in bytes of a node when it is written. */
export function nodeSize(node: BoxNode): number {
  const body = isContainer(node)
    ? node.children.reduce((sum, child) => sum + nodeSize(child), 0)
    : node.payload.length;
  return body + 8 < U32_LIMIT ? body + 8 : body + 16;
}

function writeNode(node: BoxNode, out: Uint8Array, offset: number): number {
  const size = nodeSize(node);
  let cursor = offset;
  if (size < U32_LIMIT) {
    writeU32(out, cursor, size);
    writeFourCC(out, cursor + 4, node.type);
    cursor += 8;
  } else {
    writeU32(out, cursor, 1);
    writeFourCC(out, cursor + 4, node.type);
    writeU64(out, cursor + 8, size);
    cursor += 16;
  }
  if (isContainer(node)) {
    for (const child of node.children) cursor = writeNode(child, out, cursor);
  } else {
    out.set(node.payload, cursor);
    cursor += node.payload.length;
  }
  return cursor;
}

/** Writes a node and its children. Every size field comes from the real content. */
export function writeTree(node: BoxNode): Uint8Array {
  const out = new Uint8Array(nodeSize(node));
  const end = writeNode(node, out, 0);
  if (end !== out.length) throw new BoxError(`wrote ${end} bytes, expected ${out.length}`);
  return out;
}

/** The first direct child with this type, or undefined. */
export function childOf(node: ContainerNode, type: string): BoxNode | undefined {
  return node.children.find((child) => child.type === type);
}

/** The first container found at this path of child types, or undefined. */
export function containerAt(node: ContainerNode, path: string[]): ContainerNode | undefined {
  let current: ContainerNode | undefined = node;
  for (const type of path) {
    const next: BoxNode | undefined = current ? childOf(current, type) : undefined;
    if (!next || !isContainer(next)) return undefined;
    current = next;
  }
  return current;
}

/** The first leaf found at this path of child types, or undefined. */
export function leafAt(node: ContainerNode, path: string[]): LeafNode | undefined {
  const parent = containerAt(node, path.slice(0, -1));
  const leaf = parent ? childOf(parent, path[path.length - 1]) : undefined;
  return leaf && !isContainer(leaf) ? leaf : undefined;
}

/** Makes a full-box payload: version, 24-bit flags, then the body bytes. */
export function fullBoxPayload(version: number, flags: number, body: Uint8Array): Uint8Array {
  const payload = new Uint8Array(4 + body.length);
  payload[0] = version & 0xff;
  payload[1] = (flags >>> 16) & 0xff;
  payload[2] = (flags >>> 8) & 0xff;
  payload[3] = flags & 0xff;
  payload.set(body, 4);
  return payload;
}
