// @vitest-environment node
/**
 * File checks of the write protocol, on real MP4, WebM and PNG bytes. A fast-start
 * MP4 with a cut mdat still parses and has the full duration (its moov describes
 * the whole clip), so only the box sizes can show the cut.
 */
import { BufferSource, Input, MP4 } from "mediabunny";
import { beforeAll, describe, expect, it } from "vitest";
import { readBoxes } from "../../engine/io/boxes";
import { PNG_3X2_HEX, hexBytes, makeMp4, makeWebm } from "../../engine/io/__tests__/fixtures";
import { checkMp4Layout, checkWebmLayout, inspectClip, inspectPng, isUsable, verifyClip } from "../verify";

let mp4: { bytes: Uint8Array; videoDurationSec: number };
let webm: { bytes: Uint8Array; videoDurationSec: number };
const png = hexBytes(PNG_3X2_HEX);

beforeAll(async () => {
  mp4 = await makeMp4({ seconds: 2 });
  webm = await makeWebm({ seconds: 2 });
});

describe("checkMp4Layout", () => {
  it("accepts a whole fast-start file, from bytes and from a Blob", async () => {
    expect(await checkMp4Layout(mp4.bytes)).toEqual(["ftyp", "moov", "mdat"]);
    expect(await checkMp4Layout(new Blob([new Uint8Array(mp4.bytes)]))).toEqual(["ftyp", "moov", "mdat"]);
  });

  it("finds a cut mdat that mediabunny still parses with the full duration", async () => {
    const cut = mp4.bytes.subarray(0, mp4.bytes.length - 50);
    // The control: the parser alone does not see the cut.
    const input = new Input({ formats: [MP4], source: new BufferSource(cut) });
    expect(await (await input.getPrimaryVideoTrack())!.computeDuration()).toBeCloseTo(2, 3);
    input.dispose();
    await expect(checkMp4Layout(cut)).rejects.toThrow(/the file is cut/);
    await expect(checkMp4Layout(new Blob([new Uint8Array(cut)]))).rejects.toThrow(/the file is cut/);
  });

  it("refuses bytes after the last box, an open-ended box, and a file with no moov or mdat", async () => {
    const extra = new Uint8Array(mp4.bytes.length + 4);
    extra.set(mp4.bytes);
    await expect(checkMp4Layout(extra)).rejects.toThrow(/bytes after the last box/);

    const openEnded = mp4.bytes.slice();
    const mdat = readBoxes(openEnded).find((box) => box.type === "mdat")!;
    openEnded.fill(0, mdat.start, mdat.start + 4);
    await expect(checkMp4Layout(openEnded)).rejects.toThrow(/has no size/);

    const ftypOnly = mp4.bytes.slice(0, readBoxes(mp4.bytes)[0].size);
    await expect(checkMp4Layout(ftypOnly)).rejects.toThrow(/not moov and mdat/);
  });
});

describe("checkWebmLayout", () => {
  it("accepts a whole WebM and finds a cut one", async () => {
    await expect(checkWebmLayout(webm.bytes)).resolves.toBeUndefined();
    await expect(checkWebmLayout(webm.bytes.subarray(0, webm.bytes.length - 10))).rejects.toThrow(/the file is cut/);
  });

  it("accepts a live Segment of unknown size (a MediaRecorder file) and refuses a file that is not EBML", async () => {
    // EBML header (empty), then a Segment with the unknown size 0x01FFFFFFFFFFFFFF.
    const live = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1, 2]);
    await expect(checkWebmLayout(live)).resolves.toBeUndefined();
    await expect(checkWebmLayout(mp4.bytes)).rejects.toThrow(/EBML header/);
    await expect(checkWebmLayout(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80]))).rejects.toThrow(/no Segment/);
  });
});

describe("inspectPng", () => {
  it("reads the size of a whole PNG", async () => {
    expect(await inspectPng(png)).toEqual({ width: 3, height: 2 });
    expect(await inspectPng(new Blob([png]))).toEqual({ width: 3, height: 2 });
  });

  it("refuses a cut PNG, bytes after IEND, a missing IHDR, and bytes that are not a PNG", async () => {
    await expect(inspectPng(png.subarray(0, png.length - 4))).rejects.toThrow(/cut/);
    await expect(inspectPng(png.subarray(0, 33))).rejects.toThrow(/cut|IEND/);
    const extra = new Uint8Array(png.length + 3);
    extra.set(png);
    await expect(inspectPng(extra)).rejects.toThrow(/after IEND/);
    const noIhdr = png.slice();
    noIhdr.set([0x69, 0x48, 0x44, 0x52], 12); // "iHDR"
    await expect(inspectPng(noIhdr)).rejects.toThrow(/IHDR/);
    await expect(inspectPng(mp4.bytes)).rejects.toThrow(/not a PNG/);
  });
});

describe("inspectClip and verifyClip", () => {
  it("MP4: the duration, the size, sound, and a keyframe first", async () => {
    const facts = await inspectClip(mp4.bytes, "video/mp4", { packetRate: true });
    expect(facts).toMatchObject({ mime: "video/mp4", width: 64, height: 64, hasAudio: true, firstVideoIsKey: true, fps: 30 });
    expect(facts.videoDurationSec).toBeCloseTo(2, 3);
    expect(isUsable(facts)).toBe(true);
    await expect(verifyClip(mp4.bytes, { mime: "video/mp4", videoSec: 2 })).resolves.toMatchObject({ mime: "video/mp4" });
  });

  it("WebM: the same checks through the WebM reader", async () => {
    const facts = await verifyClip(webm.bytes, { mime: "video/webm", videoSec: webm.videoDurationSec });
    expect(facts).toMatchObject({ mime: "video/webm", width: 64, height: 64, hasAudio: false, firstVideoIsKey: true });
    // An MP4 is not a WebM, and the other way round.
    await expect(verifyClip(mp4.bytes, { mime: "video/webm", videoSec: 2 })).rejects.toMatchObject({ code: "verify-failed" });
    await expect(verifyClip(webm.bytes, { mime: "video/mp4", videoSec: 2 })).rejects.toMatchObject({ code: "verify-failed" });
  });

  it("PNG: no duration check", async () => {
    const facts = await verifyClip(png, { mime: "image/png", videoSec: null });
    expect(facts).toEqual({ mime: "image/png", videoDurationSec: 0, width: 3, height: 2, hasAudio: false, firstVideoIsKey: true, fps: 0 });
    expect(isUsable(facts)).toBe(true);
  });

  it("refuses a cut MP4 as verify-failed", async () => {
    await expect(verifyClip(mp4.bytes.subarray(0, mp4.bytes.length - 50), { mime: "video/mp4", videoSec: 2 })).rejects.toMatchObject({
      code: "verify-failed",
      message: expect.stringMatching(/cut/),
    });
  });

  it("checks the duration against the producer's value, within 0.2 s, and skips it for null", async () => {
    await expect(verifyClip(mp4.bytes, { mime: "video/mp4", videoSec: 2.19 })).resolves.toBeTruthy();
    await expect(verifyClip(mp4.bytes, { mime: "video/mp4", videoSec: 2.5 })).rejects.toMatchObject({ code: "verify-failed" });
    await expect(verifyClip(mp4.bytes, { mime: "video/mp4", videoSec: null })).resolves.toBeTruthy();
  });

  it("isUsable refuses a video with no keyframe first or no duration, and a picture with no size", () => {
    const base = { mime: "video/mp4" as const, videoDurationSec: 1, width: 1, height: 1, hasAudio: false, firstVideoIsKey: true, fps: 30 };
    expect(isUsable({ ...base, firstVideoIsKey: false })).toBe(false);
    expect(isUsable({ ...base, videoDurationSec: 0 })).toBe(false);
    expect(isUsable({ ...base, mime: "image/png", width: 0 })).toBe(false);
  });
});
