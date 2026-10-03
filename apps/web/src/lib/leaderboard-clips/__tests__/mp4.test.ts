// @vitest-environment node
/**
 * The MP4 check of a leaderboard clip upload (design/LEADERBOARD_CLIPS.html,
 * section 6), on real clips and on files that break exactly one rule.
 *
 * Fixtures (scripts/leaderboard-clip-fixtures.ts makes them):
 * - real-1280x720.mp4: 2 s of a real iPhone SE clip (Asteroids), muxed
 *   again by the clip engine's own muxer: the phone's own packets.
 * - engine-*.mp4: the other sizes the engine makes, and engine files the
 *   check must reject (1920x1080, 62 s).
 * - ffmpeg-*.mp4: ffmpeg's own output of an engine clip, which always has
 *   a udta/meta box.
 * The crafted files come from real-1280x720.mp4 through mp4Surgery.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readU32, writeFourCC, writeU32 } from "@/shared/clips/engine/io/boxes";
import { PRESETS } from "@/shared/clips/protocol";
import { SOFTWARE_PRESETS } from "@/shared/clips/runtime/capabilities";

import { LEADERBOARD_CLIP_LIMITS, LEADERBOARD_CLIP_SIZES } from "../contract";
import { MAX_BOXES, MAX_MOOV_BYTES, MAX_TOP_LEVEL_BOXES, inspectClipMp4, spsFrameSize, type Mp4Check } from "../mp4";
import { deepCopy, edit, find, findAll, leaf, parse, rebuild, trackOf, type MBox } from "./mp4Surgery";

const FIXTURES = path.join(__dirname, "fixtures");
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const REAL = fixture("real-1280x720.mp4");

function reason(check: Mp4Check): string {
  return check.ok ? "ok" : check.reason;
}

/** The offset of the mdat header in a fast-start file: after ftyp and moov. */
function mdatOffset(bytes: Uint8Array): number {
  const ftyp = readU32(bytes, 0);
  const at = ftyp + readU32(bytes, ftyp);
  expect(String.fromCharCode(...bytes.subarray(at + 4, at + 8))).toBe("mdat");
  return at;
}

describe("the sizes the server accepts", () => {
  it("are exactly the engine's presets (hardware and software, both shapes)", () => {
    const engine = [PRESETS.wide, PRESETS.tall, SOFTWARE_PRESETS.wide, SOFTWARE_PRESETS.tall].map(
      ({ width, height }) => `${width}x${height}`
    );
    const accepted = LEADERBOARD_CLIP_SIZES.map(({ width, height }) => `${width}x${height}`);
    expect([...accepted].sort()).toEqual([...new Set(engine)].sort());
  });
});

describe("good clips", () => {
  it("accepts the real phone clip and measures it", () => {
    const check = inspectClipMp4(REAL);
    expect(check).toEqual({
      ok: true,
      info: { durationMs: 2011, width: 1280, height: 720, hasAudio: true, bytes: REAL.length },
    });
  });

  it.each([
    ["engine-720x1280.mp4", 720, 1280, true],
    ["engine-960x544.mp4", 960, 544, true],
    ["engine-544x960.mp4", 544, 960, true],
    ["engine-1280x720-noaudio.mp4", 1280, 720, false],
  ])("accepts %s", (name, width, height, hasAudio) => {
    const check = inspectClipMp4(fixture(name));
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.info).toMatchObject({ width, height, hasAudio });
  });

  const DEVICE_CLIPS = ["/tmp/hh-se/clip-asteroids-end.mp4", "/tmp/hh-se/clip-asteroids-button.mp4"];
  it.each(DEVICE_CLIPS.filter((file) => existsSync(file)))("accepts the full device clip %s", (file) => {
    const check = inspectClipMp4(new Uint8Array(readFileSync(file)));
    expect(reason(check)).toBe("ok");
  });

  it("accepts a last mdat with size 0 (to the end of the file)", () => {
    const bytes = edit(REAL, (boxes) => {
      find(boxes, "mdat").toEnd = true;
    });
    expect(readU32(bytes, mdatOffset(bytes))).toBe(0);
    expect(reason(inspectClipMp4(bytes))).toBe("ok");
  });

  it("accepts an mdat with a 64-bit size header", () => {
    const bytes = edit(REAL, (boxes) => {
      find(boxes, "mdat").large = true;
    });
    expect(readU32(bytes, mdatOffset(bytes))).toBe(1);
    expect(bytes.length).toBe(REAL.length + 8);
    expect(reason(inspectClipMp4(bytes))).toBe("ok");
  });

  it("measures the same facts after a rebuild with no change (the surgery is exact)", () => {
    expect(Buffer.from(rebuild(REAL, parse(REAL))).equals(Buffer.from(REAL))).toBe(true);
  });
});

describe("rejected clips", () => {
  it("rejects a size the engine never makes (1920x1080)", () => {
    expect(reason(inspectClipMp4(fixture("engine-1920x1080.mp4")))).toBe("size");
  });

  it("rejects a run longer than 61 s", () => {
    expect(reason(inspectClipMp4(fixture("engine-62s.mp4")))).toBe("duration");
  });

  it.each(["ffmpeg-faststart-udta.mp4", "ffmpeg-fragmented.mp4", "ffmpeg-moov-at-end.mp4"])(
    "rejects ffmpeg's own file %s (it always writes udta/meta)",
    (name) => {
      expect(reason(inspectClipMp4(fixture(name)))).toBe("metadata");
    }
  );

  it("rejects ffmpeg's moov-at-end file for no fast start once its udta is gone", () => {
    const bytes = edit(fixture("ffmpeg-moov-at-end.mp4"), (boxes) => {
      const moov = find(boxes, "moov");
      moov.children = moov.children!.filter((box) => box.type !== "udta");
      return boxes.filter((box) => box.type !== "free");
    });
    expect(reason(inspectClipMp4(bytes))).toBe("no_fast_start");
  });

  it("rejects ffmpeg's fragmented file for fragments once its udta is gone", () => {
    const bytes = edit(fixture("ffmpeg-fragmented.mp4"), (boxes) => {
      const moov = find(boxes, "moov");
      moov.children = moov.children!.filter((box) => box.type !== "udta");
    });
    expect(reason(inspectClipMp4(bytes))).toBe("fragmented");
  });

  it("rejects moov after mdat (no fast start)", () => {
    const bytes = edit(REAL, (boxes) => {
      const moov = find(boxes, "moov");
      return [...boxes.filter((box) => box !== moov), moov];
    });
    expect(reason(inspectClipMp4(bytes))).toBe("no_fast_start");
  });

  it("rejects a second video track", () => {
    const bytes = edit(REAL, (boxes) => {
      find(boxes, "moov").children!.push(deepCopy(trackOf(boxes, "vide")));
    });
    expect(reason(inspectClipMp4(bytes))).toBe("track_count");
  });

  it("rejects a second audio track", () => {
    const bytes = edit(REAL, (boxes) => {
      find(boxes, "moov").children!.push(deepCopy(trackOf(boxes, "soun")));
    });
    expect(reason(inspectClipMp4(bytes))).toBe("track_count");
  });

  it("rejects a clip with no video track", () => {
    const bytes = edit(REAL, (boxes) => {
      const moov = find(boxes, "moov");
      const video = trackOf(boxes, "vide");
      moov.children = moov.children!.filter((box) => box !== video);
    });
    expect(reason(inspectClipMp4(bytes))).toBe("track_count");
  });

  it("rejects a third kind of track (a text track)", () => {
    const bytes = edit(REAL, (boxes) => {
      const text = deepCopy(trackOf(boxes, "soun"));
      const hdlr = find(text.children!, "hdlr");
      hdlr.payload.set([0x74, 0x65, 0x78, 0x74], 8); // "text"
      find(boxes, "moov").children!.push(text);
    });
    expect(reason(inspectClipMp4(bytes))).not.toBe("ok");
  });

  const udta = (): MBox => ({ type: "udta", payload: new Uint8Array(), children: [leaf("©nam", [0, 4, 0, 0, 72, 97, 110, 107])] });
  const meta = (): MBox => leaf("meta", [0, 0, 0, 0]);

  it.each<[string, (boxes: MBox[]) => void]>([
    ["udta in moov", (boxes) => void find(boxes, "moov").children!.push(udta())],
    ["udta in a trak", (boxes) => void trackOf(boxes, "vide").children!.push(udta())],
    ["meta in moov", (boxes) => void find(boxes, "moov").children!.push(meta())],
    ["meta in stbl", (boxes) => void find(trackOf(boxes, "soun").children!, "stbl").children!.push(meta())],
    ["meta in the avc1 sample entry", (boxes) => void find(boxes, "avc1").children!.push(meta())],
    ["meta in the mp4a sample entry", (boxes) => void find(boxes, "mp4a").children!.push(meta())],
    ["udta at the top level", (boxes) => void boxes.splice(1, 0, udta())],
    ["a uuid box at the top level", (boxes) => void boxes.splice(1, 0, leaf("uuid", new Uint8Array(20)))],
  ])("rejects %s (metadata)", (_name, change) => {
    expect(reason(inspectClipMp4(edit(REAL, change)))).toBe("metadata");
  });

  it("rejects HEVC (hvc1) as a codec it does not take", () => {
    const bytes = edit(REAL, (boxes) => {
      find(boxes, "avc1").type = "hvc1";
    });
    expect(reason(inspectClipMp4(bytes))).toBe("codec");
  });

  it("rejects Opus audio as a codec it does not take", () => {
    const bytes = edit(REAL, (boxes) => {
      find(boxes, "mp4a").type = "Opus";
    });
    expect(reason(inspectClipMp4(bytes))).toBe("codec");
  });

  it("rejects an mvex box (a fragmented file)", () => {
    const bytes = edit(REAL, (boxes) => {
      find(boxes, "moov").children!.push({ type: "mvex", payload: new Uint8Array(), children: [leaf("trex", new Uint8Array(28))] });
    });
    expect(reason(inspectClipMp4(bytes))).toBe("fragmented");
  });

  it("rejects a top-level moof (a fragment)", () => {
    const bytes = edit(REAL, (boxes) => {
      boxes.push(leaf("moof", new Uint8Array(8)));
    });
    expect(reason(inspectClipMp4(bytes))).toBe("fragmented");
  });

  it("rejects a top-level free box (only ftyp, moov and mdat)", () => {
    const bytes = edit(REAL, (boxes) => {
      boxes.splice(1, 0, leaf("free", new Uint8Array(16)));
    });
    expect(reason(inspectClipMp4(bytes))).toBe("unknown_box");
  });

  it("rejects a second mdat", () => {
    const bytes = edit(REAL, (boxes) => {
      boxes.push(leaf("mdat", new Uint8Array(16)));
    });
    expect(reason(inspectClipMp4(bytes))).toBe("box_count");
  });

  it("rejects a rotated track (the engine letterboxes, it never rotates)", () => {
    const bytes = edit(REAL, (boxes) => {
      const tkhd = find(trackOf(boxes, "vide").children!, "tkhd");
      const matrixAt = tkhd.payload[0] === 1 ? 52 : 40;
      // 90 degrees: a=0, b=1, c=-1, d=0.
      writeU32(tkhd.payload, matrixAt, 0);
      writeU32(tkhd.payload, matrixAt + 4, 0x0001_0000);
      writeU32(tkhd.payload, matrixAt + 12, 0xffff_0000);
      writeU32(tkhd.payload, matrixAt + 16, 0);
    });
    expect(reason(inspectClipMp4(bytes))).toBe("rotation");
  });

  it("rejects a tkhd size that does not match the H.264 picture", () => {
    const bytes = edit(REAL, (boxes) => {
      const tkhd = find(trackOf(boxes, "vide").children!, "tkhd");
      const matrixAt = tkhd.payload[0] === 1 ? 52 : 40;
      writeU32(tkhd.payload, matrixAt + 36, 720 * 0x1_0000);
      writeU32(tkhd.payload, matrixAt + 40, 1280 * 0x1_0000);
    });
    expect(reason(inspectClipMp4(bytes))).toBe("size");
  });

  it.each([
    ["62 s", 62_000],
    ["0.5 s", 500],
  ])("rejects a movie duration of %s", (_name, ms) => {
    const bytes = edit(REAL, (boxes) => {
      const mvhd = find(boxes, "mvhd");
      const v1 = mvhd.payload[0] === 1;
      const timescale = readU32(mvhd.payload, v1 ? 20 : 12);
      writeU32(mvhd.payload, v1 ? 28 : 16, Math.round((ms / 1000) * timescale));
    });
    expect(reason(inspectClipMp4(bytes))).toBe("duration");
  });

  it("rejects a chunk offset outside the mdat", () => {
    const bytes = edit(REAL, (boxes) => {
      const stco = find(trackOf(boxes, "vide").children!, "stco");
      writeU32(stco.payload, 8, 4);
    });
    expect(reason(inspectClipMp4(bytes))).toBe("chunk_offsets");
  });

  it("rejects media data in another file (a data reference with no self flag)", () => {
    const bytes = edit(REAL, (boxes) => {
      const url = find(trackOf(boxes, "vide").children!, "url ");
      url.payload[3] = 0;
    });
    expect(reason(inspectClipMp4(bytes))).toBe("bad_structure");
  });

  it("rejects a moov larger than MAX_MOOV_BYTES", () => {
    const bytes = edit(REAL, (boxes) => {
      const stbl = find(trackOf(boxes, "vide").children!, "stbl");
      stbl.children!.push(leaf("sdtp", new Uint8Array(MAX_MOOV_BYTES)));
    });
    expect(reason(inspectClipMp4(bytes))).toBe("moov_too_big");
  });

  it("rejects a cut file (the mdat goes past the end)", () => {
    expect(reason(inspectClipMp4(REAL.slice(0, REAL.length - 1000)))).toBe("bad_structure");
  });

  it("rejects a file cut inside the moov", () => {
    const ftypSize = readU32(REAL, 0);
    expect(readU32(REAL, ftypSize)).toBeGreaterThan(200);
    expect(reason(inspectClipMp4(REAL.slice(0, ftypSize + 200)))).toBe("bad_structure");
  });

  it("rejects a box that declares a size bigger than the file", () => {
    const bytes = REAL.slice();
    writeU32(bytes, mdatOffset(bytes), 0xffff_fff0);
    expect(reason(inspectClipMp4(bytes))).toBe("bad_structure");
  });

  it("rejects a huge 64-bit declared size", () => {
    const large = edit(REAL, (boxes) => {
      find(boxes, "mdat").large = true;
    });
    const mdatAt = mdatOffset(large);
    // 2^40 bytes, then a size past Number.MAX_SAFE_INTEGER.
    writeU32(large, mdatAt + 8, 0x100);
    writeU32(large, mdatAt + 12, 0);
    expect(reason(inspectClipMp4(large))).toBe("bad_structure");
    writeU32(large, mdatAt + 8, 0xffff_ffff);
    expect(reason(inspectClipMp4(large))).toBe("bad_structure");
  });

  it("rejects a size smaller than the box header", () => {
    const bytes = REAL.slice();
    writeU32(bytes, readU32(REAL, 0), 4);
    expect(reason(inspectClipMp4(bytes))).toBe("bad_structure");
  });

  it("rejects an ftyp that is not first, or too big", () => {
    const moovFirst = edit(REAL, (boxes) => [boxes[1], boxes[0], ...boxes.slice(2)]);
    expect(reason(inspectClipMp4(moovFirst))).toBe("not_mp4");
    const bigFtyp = edit(REAL, (boxes) => {
      const ftyp = boxes[0];
      ftyp.payload = Uint8Array.from([...ftyp.payload, ...new Array(64).fill(0x20)]);
    });
    expect(reason(inspectClipMp4(bigFtyp))).toBe("bad_structure");
  });

  it("rejects bytes that are not an MP4, an empty file and a file over 16 MiB", () => {
    expect(reason(inspectClipMp4(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))).toBe("not_mp4");
    expect(reason(inspectClipMp4(new Uint8Array()))).toBe("empty");
    expect(reason(inspectClipMp4(new Uint8Array(LEADERBOARD_CLIP_LIMITS.maxVideoBytes + 1)))).toBe("too_big");
  });

  it("never throws on random bytes after a real header", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let run = 0; run < 200; run++) {
      const bytes = REAL.slice(0, 4096);
      for (let i = 0; i < 20; i++) bytes[32 + Math.floor(random() * 4000)] = Math.floor(random() * 256);
      const check = inspectClipMp4(bytes);
      expect(check.ok).toBe(false);
    }
  });
});

describe("a hostile file costs no more than a clip", () => {
  const MAX = LEADERBOARD_CLIP_LIMITS.maxVideoBytes;

  /** A 16 MiB file: the real ftyp, then `fill` from the given offset on. */
  function bomb(fill: (bytes: Uint8Array, from: number) => void): Uint8Array {
    const bytes = new Uint8Array(MAX);
    const ftypSize = readU32(REAL, 0);
    bytes.set(REAL.subarray(0, ftypSize));
    fill(bytes, ftypSize);
    return bytes;
  }

  /** 8-byte boxes of one type from `from` to the end. */
  function tinyBoxes(bytes: Uint8Array, from: number, type: string): void {
    for (let at = from; at + 8 <= bytes.length; at += 8) {
      writeU32(bytes, at, 8);
      writeFourCC(bytes, at + 4, type);
    }
  }

  /** Run the check, and how long it took. */
  function timed(bytes: Uint8Array): { reason: string; ms: number } {
    const start = performance.now();
    const check = inspectClipMp4(bytes);
    return { reason: reason(check), ms: performance.now() - start };
  }

  it("stops at the first top-level box past MAX_TOP_LEVEL_BOXES (2 million 8-byte boxes)", () => {
    const run = timed(bomb((bytes, from) => tinyBoxes(bytes, from, "free")));
    expect(run.reason).toBe("box_count");
    // Before the limit, this walk read all 2 million boxes: about 400 ms and 180 MiB.
    expect(run.ms).toBeLessThan(50);
  });

  it("stops in a 16 MiB moov of 2 million empty boxes before it reads them all", () => {
    const bytes = bomb((out, from) => {
      writeU32(out, from, out.length - from);
      writeFourCC(out, from + 4, "moov");
      tinyBoxes(out, from + 8, "trak");
    });
    const run = timed(bytes);
    expect(run.reason).toBe("box_count");
    expect(run.ms).toBeLessThan(50);
  });

  it("stops at the total budget when every box holds a few children", () => {
    // ftyp, then a moov of nested 3-child chains: each box is under its own
    // limit, but the file has far more boxes than MAX_BOXES.
    const chain = (depth: number): MBox =>
      depth === 0 ? leaf("free", []) : { type: "trak", payload: new Uint8Array(), children: [chain(depth - 1), chain(depth - 1), chain(depth - 1)] };
    const bytes = edit(REAL, (boxes) => {
      find(boxes, "moov").children!.push(chain(6)); // 3^6 = 729 leaves, 1,093 boxes
    });
    expect(reason(inspectClipMp4(bytes))).toBe("box_count");
  });

  it("has room for the real clip under every limit", () => {
    expect(MAX_TOP_LEVEL_BOXES).toBeGreaterThanOrEqual(3);
    expect(MAX_BOXES).toBeGreaterThanOrEqual(47 * 4);
    expect(reason(inspectClipMp4(REAL))).toBe("ok");
  });
});

describe("spsFrameSize", () => {
  it("reads the cropped 1280x720 size of the real clip's SPS", () => {
    const avcC = find(parse(REAL), "avcC").payload;
    const length = (avcC[6] << 8) | avcC[7];
    expect(spsFrameSize(avcC.subarray(8, 8 + length))).toEqual({ width: 1280, height: 720 });
  });

  it("reads every engine size from its SPS", () => {
    for (const name of ["engine-720x1280.mp4", "engine-960x544.mp4", "engine-544x960.mp4"]) {
      const avcC = find(parse(fixture(name)), "avcC").payload;
      const length = (avcC[6] << 8) | avcC[7];
      const [w, h] = name.match(/(\d+)x(\d+)/)!.slice(1).map(Number);
      expect(spsFrameSize(avcC.subarray(8, 8 + length))).toEqual({ width: w, height: h });
    }
  });

  it("finds every crafted box helper target in the real clip", () => {
    const boxes = parse(REAL);
    expect(findAll(boxes, "trak")).toHaveLength(2);
    expect(findAll(boxes, "stco").length + findAll(boxes, "co64").length).toBe(2);
  });
});
