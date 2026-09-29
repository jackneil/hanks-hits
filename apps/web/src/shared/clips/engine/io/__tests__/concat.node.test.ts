// @vitest-environment node
/**
 * Tiers M and V: joining rotating-recorder segments (plan 5, 6.6), on real
 * WebM (VP8, Opus) and fragmented MP4 (H.264, AAC) files that ffmpeg makes
 * the way MediaRecorder does (segmentFixtures.ts).
 *
 * The segments overlap across each hand-off: [0, 5.25), [5, 10.25), [10, 12).
 * A clip of [3, 11) must show every source frame from its start keyframe to
 * 11 s exactly once, in order: the frame codes of the decoded file prove it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RecorderSegmentRef, SegmentContainer } from "../../../protocol";
import { verifyClip } from "../../../library/verify";
import { addAacRollGroups } from "../moovPatch";
import {
  CONTAINER_MIME,
  ConcatError,
  concatSegments,
  indexSegment,
  keysOf,
  planRecordParts,
  type SegmentKeys,
} from "../concat";
import {
  CODE_PERIOD,
  FFMPEG_SKIP_REASON,
  SOURCE_FPS,
  blobOf,
  cleanupSegmentFixtures,
  decodeCodes,
  decodeErrors,
  firstClusterSizeUnknown,
  hasUnknownSegmentSize,
  makeSegment,
  probeStreams,
} from "./segmentFixtures";

const SKIP = FFMPEG_SKIP_REASON !== "";
if (SKIP) console.warn(`[clips] concat.node.test: SKIPPED (${FFMPEG_SKIP_REASON})`);

const SEC = 1_000_000;
/** The overlapping segment spans of a rotation with a 5 s period and a 0.25 s hand-off. */
const SPANS = [
  { startSec: 0, durationSec: 5.25 },
  { startSec: 5, durationSec: 5.25 },
  { startSec: 10, durationSec: 2 },
];

interface Made {
  bytes: Uint8Array;
  blob: Blob;
  startUs: number;
}

function makeSet(container: SegmentContainer, options: { gop?: number; live?: boolean; audio?: boolean[] } = {}): Made[] {
  return SPANS.map((span, i) => {
    const bytes = makeSegment({ ...span, container, gop: options.gop, live: options.live, audio: options.audio?.[i] ?? true });
    return { bytes, blob: blobOf(bytes, container), startUs: span.startSec * SEC };
  });
}

/** The job windows for a clip [fromUs, toUs): each segment is used up to the next one's start. */
function windows(made: Made[], fromUs: number, toUs: number): RecorderSegmentRef[] {
  const out: RecorderSegmentRef[] = [];
  for (let i = 0; i < made.length; i++) {
    const next = made[i + 1];
    const segFrom = i === 0 ? fromUs : made[i].startUs;
    const segTo = next ? Math.min(toUs, next.startUs) : toUs;
    if (segTo <= segFrom || (next && next.startUs <= fromUs)) continue;
    out.push({ blob: made[i].blob, startUs: made[i].startUs, fromUs: Math.max(segFrom, i === 0 ? fromUs : made[i].startUs), toUs: segTo });
  }
  // The first used segment starts at the clip start.
  if (out.length > 0) out[0] = { ...out[0], fromUs };
  return out;
}

/** Expected frame codes for source frames [first, last]. */
function codesFor(first: number, last: number): number[] {
  const out: number[] = [];
  for (let n = first; n <= last; n++) out.push(n % CODE_PERIOD);
  return out;
}

let webm: Made[];
let webmLive: Made[];
let mp4: Made[];

beforeAll(() => {
  if (SKIP) return;
  webm = makeSet("webm");
  webmLive = makeSet("webm", { live: true });
  mp4 = makeSet("mp4");
});

afterAll(() => {
  cleanupSegmentFixtures();
});

describe.skipIf(SKIP)("indexSegment", () => {
  it("reads the keyframes, the length and the configs of a WebM segment", async () => {
    const index = await indexSegment(webm[0].blob, "webm");
    expect(index.container).toBe("webm");
    expect(index.videoCodec).toBe("vp8");
    expect(index.firstIsKey).toBe(true);
    expect(index.keyframesUs.map((us) => Math.round(us / 1000))).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(index.durationUs / SEC).toBeCloseTo(5.25, 1);
    expect(index.videoPackets).toBe(158);
    expect(index.audioConfigKey).toMatch(/^opus\|48000\|1\|/);
    // Two recorders with the same settings give the same configs: the segments splice.
    const other = await indexSegment(webm[1].blob, "webm");
    expect(other.videoConfigKey).toBe(index.videoConfigKey);
    expect(other.audioConfigKey).toBe(index.audioConfigKey);
  });

  it("reads a live WebM (unknown Segment and Cluster sizes, like Chrome) the same way", async () => {
    // A pipe gives a Segment of unknown size; the live copy also has Clusters of unknown size.
    expect(hasUnknownSegmentSize(webm[0].bytes)).toBe(true);
    expect(firstClusterSizeUnknown(webm[0].bytes)).toBe(false);
    expect(hasUnknownSegmentSize(webmLive[0].bytes)).toBe(true);
    expect(firstClusterSizeUnknown(webmLive[0].bytes)).toBe(true);
    const live = await indexSegment(webmLive[0].blob, "webm");
    const plain = await indexSegment(webm[0].blob, "webm");
    expect(live.keyframesUs).toEqual(plain.keyframesUs);
    expect(live.videoPackets).toBe(plain.videoPackets);
  });

  it("reads a fragmented MP4 segment and sees a segment with no sound", async () => {
    const index = await indexSegment(mp4[0].blob, "mp4");
    expect(index.videoCodec).toMatch(/^avc1\./);
    expect(index.firstIsKey).toBe(true);
    expect(index.keyframesUs.length).toBe(6);
    expect(index.audioConfigKey).toMatch(/^mp4a\.40\.2\|48000\|/);
    const silent = makeSegment({ startSec: 0, durationSec: 2, container: "webm", audio: false });
    expect((await indexSegment(blobOf(silent, "webm"), "webm")).audioConfigKey).toBeNull();
  });

  it("refuses bytes that are not a segment", async () => {
    await expect(indexSegment(new Blob([new Uint8Array([1, 2, 3, 4])]), "webm")).rejects.toMatchObject({ code: "unreadable" });
    await expect(indexSegment(new Blob([]), "mp4")).rejects.toMatchObject({ code: "unreadable" });
    // A WebM read as MP4 does not parse.
    await expect(indexSegment(webm[0].blob, "mp4")).rejects.toBeInstanceOf(ConcatError);
  });
});

describe.skipIf(SKIP)("concatSegments across hand-offs", () => {
  async function checkClip(made: Made[], container: SegmentContainer, firstFrame: number) {
    const job = { container, segments: windows(made, 3 * SEC, 11 * SEC) };
    expect(job.segments).toHaveLength(3);
    const result = await concatSegments(job);
    expect(result.mime).toBe(CONTAINER_MIME[container]);
    // The start is the source frame's time, within the 21 ms that ffmpeg's MP4 shift adds.
    expect(Math.abs(result.startUs - (firstFrame / SOURCE_FPS) * SEC)).toBeLessThan(25_000);
    expect(result.hasAudio).toBe(true);
    // ffmpeg decodes every frame with no error.
    expect(decodeErrors(result.bytes, container)).toBe("");
    // Every source frame once, in order, across both hand-offs.
    const lastFrame = 11 * SOURCE_FPS - 1;
    expect(decodeCodes(result.bytes, container)).toEqual(codesFor(firstFrame, lastFrame));
    expect(result.videoPackets).toBe(lastFrame - firstFrame + 1);
    // The write protocol check: it parses, a keyframe first, and the planned length within 0.2 s.
    const bytes = result.aacInMp4 ? addAacRollGroups(result.bytes).bytes : result.bytes;
    const facts = await verifyClip(bytes, { mime: result.mime, videoSec: result.videoSec });
    expect(facts.firstVideoIsKey).toBe(true);
    expect(facts.hasAudio).toBe(true);
    expect(facts.videoDurationSec).toBeCloseTo((lastFrame + 1 - firstFrame) / SOURCE_FPS, 1);
    // The sound covers the picture (within one audio packet at each end).
    const streams = probeStreams(bytes, container);
    const audio = streams.find((s) => s.type === "audio")!;
    expect(Math.abs(audio.duration - facts.videoDurationSec)).toBeLessThan(0.1);
    return result;
  }

  it("WebM (tier V): starts at the keyframe at the clip start and shows each frame once", async () => {
    const result = await checkClip(webm, "webm", 90);
    expect(result.startUs).toBe(3 * SEC);
    expect(probeStreams(result.bytes, "webm").map((s) => s.codec).sort()).toEqual(["opus", "vp8"]);
  });

  it("WebM from live segments (unknown sizes) joins the same way", async () => {
    await checkClip(webmLive, "webm", 90);
  });

  it("MP4 (tier M): H.264 and AAC in a fast-start MP4, at the last keyframe at or before the start", async () => {
    // ffmpeg's fragmented MP4 puts the keyframes after the first at 1.021 s, 2.021 s...
    // The last one at or before 3.0 s is at 2.021 s: source frame 60.
    const result = await checkClip(mp4, "mp4", 60);
    expect(result.aacInMp4).toBe(true);
    expect(probeStreams(result.bytes, "mp4").map((s) => s.codec).sort()).toEqual(["aac", "h264"]);
    // Fast start: moov before mdat.
    const text = new TextDecoder("latin1").decode(result.bytes.subarray(0, 64));
    expect(text.indexOf("moov")).toBeGreaterThan(0);
  });

  it("with only one keyframe per segment (Firefox VP8), the clip starts at the segment start", async () => {
    const sparse = makeSet("webm", { gop: 1000 });
    expect((await indexSegment(sparse[0].blob, "webm")).keyframesUs).toEqual([0]);
    const result = await concatSegments({ container: "webm", segments: windows(sparse, 3 * SEC, 11 * SEC) });
    expect(result.startUs).toBe(0);
    expect(decodeCodes(result.bytes, "webm")).toEqual(codesFor(0, 11 * SOURCE_FPS - 1));
  });

  it("a clip inside one segment uses that segment only", async () => {
    const result = await concatSegments({ container: "webm", segments: [{ blob: webm[1].blob, startUs: 5 * SEC, fromUs: 6 * SEC, toUs: 9 * SEC }] });
    expect(result.startUs).toBe(6 * SEC);
    expect(decodeCodes(result.bytes, "webm")).toEqual(codesFor(180, 269));
  });

  it("a first segment with no sound (the game had not made its sound bus yet) leaves a gap, not a failure", async () => {
    const mixed = makeSet("webm", { audio: [false, true, true] });
    const result = await concatSegments({ container: "webm", segments: windows(mixed, 3 * SEC, 11 * SEC) });
    expect(result.hasAudio).toBe(true);
    expect(decodeErrors(result.bytes, "webm")).toBe("");
    expect(decodeCodes(result.bytes, "webm")).toEqual(codesFor(90, 329));
    // The sound starts at the second segment (5 s), 2 s into the clip.
    const facts = await verifyClip(result.bytes, { mime: "video/webm", videoSec: result.videoSec });
    expect(facts.hasAudio).toBe(true);
    const noSound = makeSet("webm", { audio: [false, false, false] });
    const silent = await concatSegments({ container: "webm", segments: windows(noSound, 3 * SEC, 11 * SEC) });
    expect(silent.hasAudio).toBe(false);
    expect(silent.audioPackets).toBe(0);
  });

  it("refuses segments with two video configs (plan 6.6: one track, one config)", async () => {
    const small = makeSegment({ startSec: 5, durationSec: 5.25, container: "webm", size: 48 });
    const job = {
      container: "webm" as const,
      segments: [
        { blob: webm[0].blob, startUs: 0, fromUs: 3 * SEC, toUs: 5 * SEC },
        { blob: blobOf(small, "webm"), startUs: 5 * SEC, fromUs: 5 * SEC, toUs: 9 * SEC },
      ],
    };
    await expect(concatSegments(job)).rejects.toMatchObject({ code: "mixed-configs" });
  });

  it("refuses bad jobs with a typed code", async () => {
    await expect(concatSegments({ container: "webm", segments: [] })).rejects.toMatchObject({ code: "no-segments" });
    await expect(concatSegments({ container: "ogg" as never, segments: windows(webm, 0, SEC) })).rejects.toMatchObject({ code: "container" });
    await expect(
      concatSegments({ container: "webm", segments: [{ blob: webm[0].blob, startUs: 0, fromUs: 2 * SEC, toUs: 2 * SEC }] }),
    ).rejects.toMatchObject({ code: "bad-window" });
    await expect(
      concatSegments({
        container: "webm",
        segments: [
          { blob: webm[0].blob, startUs: 0, fromUs: 0, toUs: 5 * SEC },
          { blob: webm[1].blob, startUs: 5 * SEC, fromUs: 4 * SEC, toUs: 9 * SEC },
        ],
      }),
    ).rejects.toMatchObject({ code: "bad-window" });
    await expect(
      concatSegments({ container: "webm", segments: [{ blob: new Blob([new Uint8Array(10)]), startUs: 0, fromUs: 0, toUs: SEC }] }),
    ).rejects.toMatchObject({ code: "unreadable" });
    // A window after the segment's last frame has no keyframe to start at.
    await expect(
      concatSegments({ container: "webm", segments: [{ blob: webm[2].blob, startUs: 10 * SEC, fromUs: 30 * SEC, toUs: 31 * SEC }] }),
    ).rejects.toMatchObject({ code: "no-keyframe" });
  });
});

describe.skipIf(SKIP)("the write protocol check on tier V files (plan 8.1)", () => {
  it("verifies a joined WebM: it parses, the length is the planned one, and a keyframe comes first", async () => {
    const result = await concatSegments({ container: "webm", segments: windows(webmLive, 3 * SEC, 11 * SEC) });
    const facts = await verifyClip(result.bytes, { mime: "video/webm", videoSec: result.videoSec });
    expect(facts).toMatchObject({ mime: "video/webm", firstVideoIsKey: true, hasAudio: true, width: 64, height: 64 });
    // A length 0.3 s off the plan is refused (the limit is 0.2 s).
    await expect(verifyClip(result.bytes, { mime: "video/webm", videoSec: result.videoSec + 0.3 })).rejects.toMatchObject({ code: "verify-failed" });
  });

  it("reads a WebM whose DocType says matroska (the Matroska reader), as index and as a stored file", async () => {
    const bytes = makeSegment({ startSec: 0, durationSec: 2, container: "webm", matroskaDocType: true });
    expect(new TextDecoder("latin1").decode(bytes.subarray(0, 64))).toContain("matroska");
    const index = await indexSegment(blobOf(bytes, "webm"), "webm");
    expect(index.keyframesUs).toEqual([0, SEC]);
    const facts = await verifyClip(bytes, { mime: "video/webm", videoSec: 2 });
    expect(facts.firstVideoIsKey).toBe(true);
  });
});

describe("planRecordParts", () => {
  const seg = (i: number, size: number): RecorderSegmentRef => ({
    blob: new Blob([new Uint8Array(size)]),
    startUs: i * 5 * SEC,
    fromUs: i * 5 * SEC + (i === 0 ? 1_500_000 : 0),
    toUs: (i + 1) * 5 * SEC,
  });
  const same: SegmentKeys = { video: "vp8|64x64|", audio: "opus|48000|2|aa" };

  it("keeps a recording in one part when it fits and the configs match", () => {
    const segments = [seg(0, 100), seg(1, 100), seg(2, 100)];
    const parts = planRecordParts(segments, [same, same, same], 1000);
    expect(parts).toEqual([segments]);
    // The first part keeps its record start (a keyframe inside the first segment).
    expect(parts[0][0].fromUs).toBe(1_500_000);
  });

  it("starts a new part before the size limit and at a video config change; no segment is dropped", () => {
    const segments = [seg(0, 400), seg(1, 400), seg(2, 400), seg(3, 400), seg(4, 400)];
    const other: SegmentKeys = { video: "vp8|48x48|", audio: same.audio };
    const parts = planRecordParts(segments, [same, same, same, other, other], 900);
    expect(parts.map((p) => p.length)).toEqual([2, 1, 2]);
    expect(parts.flat().map((s) => s.startUs)).toEqual(segments.map((s) => s.startUs));
    // Each later part starts at its first segment's first packet.
    for (const part of parts.slice(1)) expect(part[0].fromUs).toBe(part[0].startUs);
  });

  it("a segment with no sound joins any part; another sound config starts a new part", () => {
    const silent: SegmentKeys = { video: same.video, audio: null };
    const otherSound: SegmentKeys = { video: same.video, audio: "opus|48000|2|bb" };
    const segments = [seg(0, 10), seg(1, 10), seg(2, 10), seg(3, 10)];
    expect(planRecordParts(segments, [silent, same, silent, same], 1000).map((p) => p.length)).toEqual([4]);
    expect(planRecordParts(segments, [same, silent, otherSound, same], 1000).map((p) => p.length)).toEqual([2, 1, 1]);
  });

  it("a segment larger than the limit is a part of its own", () => {
    const segments = [seg(0, 50), seg(1, 5000), seg(2, 50)];
    expect(planRecordParts(segments, [same, same, same], 1000).map((p) => p.length)).toEqual([1, 1, 1]);
  });

  it("keysOf takes the video and audio keys of an index", () => {
    expect(keysOf({ videoConfigKey: "v", audioConfigKey: null })).toEqual({ video: "v", audio: null });
  });
});
