// @vitest-environment node
import { describe, expect, it } from "vitest";

import { MAX_READ_CHUNK, bytesToBase64, readBlobBase64 } from "../labBytes";

/** Bytes 0..n-1 of a fixed pseudo-random pattern (every byte value appears). */
function pattern(n: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(n);
  let x = 0x12345678;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    bytes[i] = (x >>> 16) & 0xff;
  }
  return bytes;
}

const nodeBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

describe("bytesToBase64", () => {
  it.each([0, 1, 2, 3, 4, 0x7fff, 0x8000, 0x8001, 3 * 0x8000 + 7])("matches Node's base64 for %i bytes", (n) => {
    const bytes = pattern(n);
    expect(bytesToBase64(bytes)).toBe(nodeBase64(bytes));
  });

  it("encodes every byte value", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToBase64(all)).toBe(nodeBase64(all));
  });
});

describe("readBlobBase64", () => {
  const bytes = pattern(100_000);
  const blob = new Blob([bytes], { type: "video/mp4" });

  it("reads a range", async () => {
    expect(await readBlobBase64(blob, 10, 1000)).toBe(nodeBase64(bytes.subarray(10, 1010)));
  });

  it("reads the whole file back in chunks, byte for byte", async () => {
    const chunk = 7_777;
    const parts: Buffer[] = [];
    for (let offset = 0; offset < blob.size; offset += chunk) {
      parts.push(Buffer.from(await readBlobBase64(blob, offset, chunk), "base64"));
    }
    expect(Buffer.compare(Buffer.concat(parts), Buffer.from(bytes))).toBe(0);
  });

  it("cuts the range at the end of the file, and gives an empty string past it", async () => {
    expect(await readBlobBase64(blob, blob.size - 5, 100)).toBe(nodeBase64(bytes.subarray(blob.size - 5)));
    expect(await readBlobBase64(blob, blob.size, 10)).toBe("");
    expect(await readBlobBase64(blob, blob.size + 10, 10)).toBe("");
    expect(await readBlobBase64(blob, 0, 0)).toBe("");
  });

  it("gives at most MAX_READ_CHUNK bytes in one read", async () => {
    const big = new Blob([new Uint8Array(MAX_READ_CHUNK + 10)]);
    const text = await readBlobBase64(big, 0, MAX_READ_CHUNK * 2);
    expect(Buffer.from(text, "base64").length).toBe(MAX_READ_CHUNK);
  });

  it.each([
    [-1, 10],
    [0, -1],
    [1.5, 10],
    [0, 2.5],
    [Number.NaN, 10],
    [0, Number.POSITIVE_INFINITY],
  ])("rejects offset %s and length %s", async (offset, length) => {
    await expect(readBlobBase64(blob, offset, length)).rejects.toThrow(RangeError);
  });
});
