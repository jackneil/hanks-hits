import { describe, expect, it } from "vitest";
import { fakeAvcC } from "@/__tests__/webcodecs-mock";
import { NAL_AUD, NAL_IDR, NAL_SLICE, classifyChunk, nalTypesAnnexB, nalTypesAvcc, parseAvcC } from "../avc";
import { bytesEqual, copyToArrayBuffer, viewBytes } from "../bytes";

/** Length-prefixed access unit from NAL units, with the given prefix size. */
function au(nals: number[][], lengthSize = 4): Uint8Array {
  const out: number[] = [];
  for (const n of nals) {
    const len = n.length;
    for (let i = lengthSize - 1; i >= 0; i--) out.push((len >> (8 * i)) & 0xff);
    out.push(...n);
  }
  return new Uint8Array(out);
}

describe("bytes", () => {
  it("copies into a new buffer that does not share memory", () => {
    const src = new Uint8Array([1, 2, 3, 4, 5]);
    const view = src.subarray(1, 4);
    const copy = copyToArrayBuffer(view);
    expect(Array.from(new Uint8Array(copy))).toEqual([2, 3, 4]);
    src[2] = 99;
    expect(new Uint8Array(copy)[1]).toBe(3);
  });

  it("views a DataView and an ArrayBuffer", () => {
    const buf = new Uint8Array([9, 8, 7]).buffer;
    expect(Array.from(viewBytes(new DataView(buf, 1)))).toEqual([8, 7]);
    expect(Array.from(viewBytes(buf))).toEqual([9, 8, 7]);
  });

  it("compares bytes, length and null", () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]).buffer)).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(bytesEqual(null, undefined)).toBe(false);
    expect(bytesEqual(null, null)).toBe(true);
    expect(bytesEqual(new Uint8Array([1]), null)).toBe(false);
  });
});

describe("parseAvcC", () => {
  it("reads profile, level, length size, SPS and PPS", () => {
    const c = parseAvcC(fakeAvcC(720, 1280, 3, "avc1.64001f"))!;
    expect(c.profileIdc).toBe(0x64);
    expect(c.levelIdc).toBe(0x1f);
    expect(c.lengthSize).toBe(4);
    expect(c.sps).toHaveLength(1);
    expect(c.pps).toHaveLength(1);
    expect(c.sps[0][0] & 0x1f).toBe(7);
    expect(c.pps[0][0] & 0x1f).toBe(8);
  });

  it("reads a 2-byte length size", () => {
    const b = fakeAvcC(640, 360, 0);
    b[4] = 0xfd; // lengthSizeMinusOne = 1
    expect(parseAvcC(b)!.lengthSize).toBe(2);
  });

  it("rejects a record that is not avcC", () => {
    expect(parseAvcC(null)).toBeNull();
    expect(parseAvcC(new Uint8Array([2, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(parseAvcC(new Uint8Array([1, 0x64]))).toBeNull();
    // An SPS length that points past the end.
    expect(parseAvcC(new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0x00, 0x40, 0x67]))).toBeNull();
    // No PPS count byte.
    expect(parseAvcC(new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0x00, 0x01, 0x67]))).toBeNull();
    // A PPS length that points past the end.
    expect(parseAvcC(new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0x00, 0x01, 0x67, 0x01, 0x00, 0x09, 0x68]))).toBeNull();
  });
});

describe("NAL scanning", () => {
  it("lists NAL types in a length-prefixed access unit", () => {
    expect(nalTypesAvcc(au([[0x09, 0xf0], [0x06, 1], [0x65, 1, 2]]), 4)).toEqual([NAL_AUD, 6, NAL_IDR]);
    expect(nalTypesAvcc(au([[0x41, 1, 2]], 2), 2)).toEqual([NAL_SLICE]);
    expect(nalTypesAvcc(au([[0x65, 1]], 1), 1)).toEqual([NAL_IDR]);
  });

  it("reports broken framing as null", () => {
    expect(nalTypesAvcc(new Uint8Array([0, 0, 0, 9, 0x65]), 4)).toBeNull();
    expect(nalTypesAvcc(new Uint8Array([0, 0, 0, 0]), 4)).toBeNull();
    expect(nalTypesAvcc(new Uint8Array([0, 0]), 4)).toBeNull();
  });

  it("lists NAL types in Annex B with 3- and 4-byte start codes", () => {
    const b = new Uint8Array([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 1, 0x65, 9]);
    expect(nalTypesAnnexB(b)).toEqual([7, 8, NAL_IDR]);
  });
});

describe("classifyChunk", () => {
  it("trusts an IDR NAL over the chunk type", () => {
    const idr = au([[0x65, 1]]);
    const slice = au([[0x41, 1]]);
    expect(classifyChunk(idr, "key", 4)).toEqual({ key: true, verified: true, mismatch: false });
    expect(classifyChunk(slice, "delta", 4)).toEqual({ key: false, verified: true, mismatch: false });
    // mediabunny #365: "key" without an IDR is not a keyframe.
    expect(classifyChunk(slice, "key", 4)).toEqual({ key: false, verified: true, mismatch: true });
    // An IDR labeled "delta" is still a random access point.
    expect(classifyChunk(idr, "delta", 4)).toEqual({ key: true, verified: true, mismatch: true });
  });

  it("falls back to the chunk type when the bytes cannot be parsed", () => {
    const garbage = new Uint8Array([0, 0, 0, 50, 1, 2]);
    expect(classifyChunk(garbage, "key", 4)).toEqual({ key: true, verified: false, mismatch: false });
    expect(classifyChunk(garbage, "delta", 4)).toEqual({ key: false, verified: false, mismatch: false });
  });

  it("uses Annex B scanning when no length size is known", () => {
    expect(classifyChunk(new Uint8Array([0, 0, 1, 0x65, 1]), "delta", null)).toEqual({ key: true, verified: true, mismatch: true });
    expect(classifyChunk(new Uint8Array([1, 2, 3]), "key", null)).toEqual({ key: true, verified: false, mismatch: false });
  });
});
