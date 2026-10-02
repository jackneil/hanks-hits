// @vitest-environment node
/**
 * The poster check of a leaderboard clip upload: a JPEG of at most 64 KB,
 * with every APP1 to APP15 and COM segment removed (also between the scans
 * of a progressive JPEG), and a complete SOI to EOI.
 *
 * Fixtures: poster-ffmpeg-com.jpg (ffmpeg's JPEG, which has a COM segment)
 * and poster-progressive.jpg (cjpeg -progressive, 10 scans with tables
 * between them).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { jpegFrameSize, jpegHasMetadata, stripJpegMetadata } from "@/shared/lib/jpeg";

import { LEADERBOARD_CLIP_LIMITS } from "../contract";
import { cleanPoster } from "../poster";

const FIXTURES = path.join(__dirname, "fixtures");
const BASELINE = new Uint8Array(readFileSync(path.join(FIXTURES, "poster-ffmpeg-com.jpg")));
const PROGRESSIVE = new Uint8Array(readFileSync(path.join(FIXTURES, "poster-progressive.jpg")));

function segment(marker: number, body: number[]): number[] {
  const length = body.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...body];
}

const EXIF = segment(0xe1, [...Buffer.from("Exif\0\0"), 0x4d, 0x4d, 0, 0x2a, 9, 9, 9, 9]);
const XMP = segment(0xe1, [...Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Hank</x:xmpmeta>")]);
const ICC = segment(0xe2, [...Buffer.from("ICC_PROFILE\0"), 1, 1]);
const APP15 = segment(0xef, [1, 2, 3]);
const COMMENT = segment(0xfe, [...Buffer.from("Hank's phone")]);

/** Insert bytes at an offset. */
function insert(bytes: Uint8Array, at: number, extra: number[]): Uint8Array {
  return Uint8Array.from([...bytes.subarray(0, at), ...extra, ...bytes.subarray(at)]);
}

/** The offset of the first segment with this marker after `from`. */
function markerAt(bytes: Uint8Array, marker: number, from = 2): number {
  for (let i = from; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === marker) return i;
  }
  throw new Error(`no marker ${marker.toString(16)}`);
}

describe("stripJpegMetadata (shared by the browser poster and the server)", () => {
  it("removes the COM segment of a real ffmpeg JPEG and keeps a decodable image", () => {
    expect(jpegHasMetadata(BASELINE)).toBe(true);
    const clean = stripJpegMetadata(BASELINE)!;
    expect(jpegHasMetadata(clean)).toBe(false);
    expect(jpegFrameSize(clean)).toEqual({ width: 320, height: 180 });
    expect(Array.from(clean.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(Array.from(clean.subarray(-2))).toEqual([0xff, 0xd9]);
  });

  it("removes EXIF, XMP, ICC, APP15 and COM after APP0", () => {
    const clean = stripJpegMetadata(BASELINE)!;
    const app0End = 2 + 2 + ((clean[4] << 8) | clean[5]);
    const dirty = insert(clean, app0End, [...EXIF, ...XMP, ...ICC, ...APP15, ...COMMENT]);
    expect(jpegHasMetadata(dirty)).toBe(true);
    expect(Buffer.from(stripJpegMetadata(dirty)!).equals(Buffer.from(clean))).toBe(true);
  });

  it("removes metadata between the scans of a progressive JPEG", () => {
    // After the first scan, before the second scan's table. The old browser
    // copy stopped at the first SOS and kept everything after it.
    const secondTable = markerAt(PROGRESSIVE, 0xc4, markerAt(PROGRESSIVE, 0xda) + 2);
    const dirty = insert(PROGRESSIVE, secondTable, [...EXIF, ...COMMENT]);
    expect(jpegHasMetadata(dirty)).toBe(true);
    const clean = stripJpegMetadata(dirty)!;
    expect(jpegHasMetadata(clean)).toBe(false);
    expect(Buffer.from(clean).equals(Buffer.from(PROGRESSIVE))).toBe(true);
  });

  it("drops bytes after EOI (a file can hide data there)", () => {
    const dirty = Uint8Array.from([...PROGRESSIVE, ...Buffer.from("secret trailer")]);
    expect(Buffer.from(stripJpegMetadata(dirty)!).equals(Buffer.from(PROGRESSIVE))).toBe(true);
  });

  it("returns null for a JPEG with no EOI, a cut segment or no SOI", () => {
    expect(stripJpegMetadata(PROGRESSIVE.subarray(0, PROGRESSIVE.length - 2))).toBeNull();
    expect(stripJpegMetadata(PROGRESSIVE.subarray(0, 100))).toBeNull();
    expect(stripJpegMetadata(PROGRESSIVE.subarray(2))).toBeNull();
  });
});

describe("cleanPoster", () => {
  it("accepts a real JPEG and returns the cleaned bytes", () => {
    const check = cleanPoster(BASELINE);
    expect(check.ok).toBe(true);
    if (check.ok) expect(jpegHasMetadata(check.jpeg)).toBe(false);
  });

  it("accepts a progressive JPEG", () => {
    expect(cleanPoster(PROGRESSIVE)).toEqual({ ok: true, jpeg: PROGRESSIVE });
  });

  it("rejects an empty poster, a poster over 64 KB, and bytes that are not a JPEG", () => {
    expect(cleanPoster(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
    const big = insert(BASELINE, 20, segment(0xfe, new Array(65_000).fill(0x41)));
    expect(big.length).toBeGreaterThan(LEADERBOARD_CLIP_LIMITS.maxPosterBytes);
    expect(cleanPoster(big)).toEqual({ ok: false, reason: "too_big" });
    expect(cleanPoster(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toEqual({ ok: false, reason: "not_jpeg" });
    expect(cleanPoster(BASELINE.subarray(0, BASELINE.length - 2))).toEqual({ ok: false, reason: "not_jpeg" });
  });

  it("rejects a JPEG with no frame header", () => {
    expect(cleanPoster(Uint8Array.from([0xff, 0xd8, ...segment(0xdb, [0, ...new Array(64).fill(1)]), 0xff, 0xd9]))).toEqual({
      ok: false,
      reason: "not_jpeg",
    });
  });

  it("rejects a picture larger than 1280 on a side", () => {
    const sof = markerAt(BASELINE, 0xc0);
    const wide = BASELINE.slice();
    // SOF0: FF C0, length (2), precision (1), height (2), width (2).
    wide[sof + 7] = 0x05;
    wide[sof + 8] = 0x01; // width 1281
    expect(cleanPoster(wide)).toEqual({ ok: false, reason: "size" });
  });
});
