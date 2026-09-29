// @vitest-environment node
/**
 * Tiers M and V: joining rotating-recorder segments (plan 5, 6.6), on real
 * WebM (VP8) and fragmented MP4 (H.264) files that ffmpeg makes the way
 * MediaRecorder does (segmentFixtures.ts), with the game sound from one
 * sound run (Opus in WebM, AAC in fragmented MP4) read by the io worker's
 * sound store.
 *
 * The segments overlap across each hand-off: [0, 5.25), [5, 10.25), [10, 12).
 * A clip of [3, 11) must show every source frame from its start keyframe to
 * 11 s exactly once, in order: the frame codes of the decoded file prove it.
 * Its sound must be as smooth across the hand-offs as the sound run itself:
 * the decoded samples prove it (a splice of two encoder streams gives a
 * drop-out or a click, and a control test shows that the check sees one).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RecorderSegmentRef, SegmentContainer } from "../../../protocol";
import { verifyClip } from "../../../library/verify";
import { addAacRollGroups } from "../moovPatch";
import {
  CONTAINER_MIME,
  ConcatError,
  applySpliceRule,
  concatSegments,
  indexSegment,
  orderRecordSegments,
  planRecordParts,
  type SoundSource,
} from "../concat";
import { SoundStore, pickSound, type GameSound, type SoundPacket } from "../soundStore";
import {
  CODE_PERIOD,
  FFMPEG_SKIP_REASON,
  SOURCE_FPS,
  blobOf,
  cleanupSegmentFixtures,
  decodeCodes,
  decodeErrors,
  decodePcm,
  firstClusterSizeUnknown,
  h264Pictures,
  hasUnknownSegmentSize,
  makeSegment,
  makeSoundRun,
  probeStreams,
  toneSmoothness,
} from "./segmentFixtures";

const SKIP = FFMPEG_SKIP_REASON !== "";
if (SKIP) console.warn(`[clips] concat.node.test: SKIPPED (${FFMPEG_SKIP_REASON})`);

const SEC = 1_000_000;
/** The overlapping segment spans of a rotation with a 0.25 s hand-off. */
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

function makeSet(container: SegmentContainer, options: { gop?: number; live?: boolean } = {}): Made[] {
  return SPANS.map((span) => {
    const bytes = makeSegment({ ...span, container, gop: options.gop, live: options.live, audio: false });
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

/** A whole sound run, read by the sound store as one run of timeline 1 that starts at capture 0. */
async function soundOf(container: SegmentContainer, seconds: number): Promise<{ store: SoundStore; source: SoundSource; clean: { minRms: number; maxStep: number } }> {
  const bytes = makeSoundRun({ container, seconds });
  const store = new SoundStore();
  store.open(1, 1, container, 0, 120);
  // Chunks cut anywhere, as a MediaRecorder timeslice does.
  for (let at = 0; at < bytes.length; at += 1777) store.append(1, bytes.slice(at, at + 1777));
  store.end(1);
  await store.ready(1, Infinity, 5000);
  return { store, source: (from, to) => store.take(1, from, to), clean: toneSmoothness(decodePcm(bytes, container)) };
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
  it("reads the keyframes, the packet times, the length and the video config of a WebM segment", async () => {
    const index = await indexSegment(webm[0].blob, "webm");
    expect(index.container).toBe("webm");
    expect(index.videoCodec).toBe("vp8");
    expect(index.firstIsKey).toBe(true);
    expect(index.keyframesUs.map((us) => Math.round(us / 1000))).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(index.durationUs / SEC).toBeCloseTo(5.25, 1);
    expect(index.videoPackets).toBe(158);
    // Every packet's time, from the first one (the engine matches them to its paints).
    expect(index.packetTimesUs).toHaveLength(158);
    expect(index.packetTimesUs[0]).toBe(0);
    index.packetTimesUs.forEach((us, i) => expect(Math.abs(us - (i * SEC) / 30)).toBeLessThanOrEqual(1000));
    // Two recorders with the same settings give the same config: the segments splice.
    const other = await indexSegment(webm[1].blob, "webm");
    expect(other.videoConfigKey).toBe(index.videoConfigKey);
    expect(index).not.toHaveProperty("audioConfigKey");
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
    expect(live.packetTimesUs).toEqual(plain.packetTimesUs);
  });

  it("reads a fragmented MP4 segment, and a segment with a sound track the same way (the sound is not used)", async () => {
    const index = await indexSegment(mp4[0].blob, "mp4");
    expect(index.videoCodec).toMatch(/^avc1\./);
    expect(index.firstIsKey).toBe(true);
    expect(index.keyframesUs.length).toBe(6);
    const withSound = makeSegment({ startSec: 0, durationSec: 2, container: "webm", audio: true });
    expect((await indexSegment(blobOf(withSound, "webm"), "webm")).videoPackets).toBe(60);
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
    const sound = await soundOf(container, 14);
    const job = { container, segments: windows(made, 3 * SEC, 11 * SEC) };
    expect(job.segments).toHaveLength(3);
    const result = await concatSegments(job, sound.source);
    expect(result.mime).toBe(CONTAINER_MIME[container]);
    // The start is the source frame's time, within the 21 ms that ffmpeg's MP4 shift adds.
    expect(Math.abs(result.startUs - (firstFrame / SOURCE_FPS) * SEC)).toBeLessThan(25_000);
    expect(result.hasAudio).toBe(true);
    expect(result.spliceDrops).toBe(0);
    // ffmpeg decodes every frame with no error.
    expect(decodeErrors(result.bytes, container)).toBe("");
    // Every source frame once, in order, across both hand-offs.
    const lastFrame = 11 * SOURCE_FPS - 1;
    expect(decodeCodes(result.bytes, container)).toEqual(codesFor(firstFrame, lastFrame));
    expect(result.videoPackets).toBe(lastFrame - firstFrame + 1);
    // The poster step gets every keyframe on the file's timeline, in order, from 0 to the end (posterKey.ts).
    expect(result.keyframes[0]).toMatchObject({ atSec: 0 });
    expect(result.keyframes.every((k, i) => i === 0 || k.atSec > result.keyframes[i - 1].atSec)).toBe(true);
    expect(result.keyframes.at(-1)!.atSec).toBeGreaterThan(result.videoSec - 1.5);
    expect(result.keyframes.at(-1)!.atSec).toBeLessThanOrEqual(result.videoSec);
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
    // The sound is as smooth across the hand-offs (5 s and 10 s) as the run itself: no drop-out, no click.
    const smooth = toneSmoothness(decodePcm(bytes, container));
    expect(smooth.windows).toBeGreaterThan(1000);
    expect(smooth.maxStep).toBeLessThanOrEqual(sound.clean.maxStep * 1.25);
    expect(smooth.minRms).toBeGreaterThanOrEqual(sound.clean.minRms * 0.8);
    return result;
  }

  it("WebM (tier V): starts at the keyframe at the clip start, shows each frame once, and the sound has no splice", async () => {
    const result = await checkClip(webm, "webm", 90);
    expect(result.startUs).toBe(3 * SEC);
    expect(probeStreams(result.bytes, "webm").map((s) => s.codec).sort()).toEqual(["opus", "vp8"]);
  });

  it("WebM from live segments (unknown sizes) joins the same way", async () => {
    await checkClip(webmLive, "webm", 90);
  });

  it("MP4 (tier M): H.264 and AAC in a fast-start MP4, at the last keyframe at or before the start", async () => {
    // The video-only segments have a keyframe every second: the one at 3.0 s is source frame 90.
    const result = await checkClip(mp4, "mp4", 90);
    expect(result.startUs).toBe(3 * SEC);
    expect(result.aacInMp4).toBe(true);
    expect(probeStreams(result.bytes, "mp4").map((s) => s.codec).sort()).toEqual(["aac", "h264"]);
    // Fast start: moov before mdat.
    const text = new TextDecoder("latin1").decode(result.bytes.subarray(0, 64));
    expect(text.indexOf("moov")).toBeGreaterThan(0);
  });

  it("a control: sound joined from two encoder streams at a hand-off has a click or a drop-out, and the check sees it", async () => {
    for (const container of ["webm", "mp4"] as const) {
      const a = await soundOf(container, 5.25);
      const b = await soundOf(container, 5.25);
      // The second stream is put at 5 s, the way the old join put each segment's own sound.
      const shifted: SoundPacket[] = b.store.held(1).map((p) => ({ ...p, capUs: p.capUs + 5 * SEC }));
      const spliced: SoundSource = (from, to) => pickSound([...a.store.held(1).filter((p) => p.capUs < 5 * SEC), ...shifted], from, to);
      const result = await concatSegments({ container, segments: windows(container === "webm" ? webm : mp4, 3 * SEC, 9 * SEC) }, spliced);
      const bytes = result.aacInMp4 ? addAacRollGroups(result.bytes).bytes : result.bytes;
      const smooth = toneSmoothness(decodePcm(bytes, container));
      const clicked = smooth.maxStep > a.clean.maxStep * 1.25;
      const dropped = smooth.minRms < a.clean.minRms * 0.8;
      expect(clicked || dropped, container).toBe(true);
    }
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
    // No sound source: no sound track.
    expect(result.hasAudio).toBe(false);
    expect(probeStreams(result.bytes, "webm").map((s) => s.type)).toEqual(["video"]);
  });

  it("sound that starts in the middle (the game made its sound bus late) leaves a gap, not a failure", async () => {
    const sound = await soundOf("webm", 14);
    const late: SoundSource = (from, to) => {
      const all = sound.store.take(1, from, to);
      if (!all) return null;
      const packets = all.packets.filter((p) => p.capUs >= 5 * SEC).map((p) => ({ ...p }));
      return { ...all, packets } satisfies GameSound;
    };
    const result = await concatSegments({ container: "webm", segments: windows(webm, 3 * SEC, 11 * SEC) }, late);
    expect(result.hasAudio).toBe(true);
    expect(decodeErrors(result.bytes, "webm")).toBe("");
    expect(decodeCodes(result.bytes, "webm")).toEqual(codesFor(90, 329));
    const facts = await verifyClip(result.bytes, { mime: "video/webm", videoSec: result.videoSec });
    expect(facts.hasAudio).toBe(true);
  });

  it("refuses segments with two video configs (plan 6.6: one track, one config)", async () => {
    const small = makeSegment({ startSec: 5, durationSec: 5.25, container: "webm", size: 48, audio: false });
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

describe.skipIf(SKIP)("splices (plan 5.1): no two IDR frames of two encoders in a row", () => {
  it("a window that ends with a lone keyframe gives up that frame; the joined H.264 has no IDR after an IDR", async () => {
    // The old encoder's keyframe at 5.0 s (frame 150) is the last frame before the new segment (frame 151).
    const a = makeSegment({ startSec: 0, durationSec: 5.25, container: "mp4", audio: false });
    const b = makeSegment({ startSec: 151 / 30, durationSec: 4, container: "mp4", audio: false });
    const aIndex = await indexSegment(blobOf(a, "mp4"), "mp4");
    const bStartUs = Math.round((151 / 30) * SEC);
    // Put segment a so that its keyframe near 5 s is the last frame before b starts (20 ms before it).
    const aKeyNear5 = aIndex.keyframesUs.find((k) => Math.abs(k - 5 * SEC) < 60_000)!;
    const aStartUs = bStartUs - 20_000 - aKeyNear5;
    const segments: RecorderSegmentRef[] = [
      { blob: blobOf(a, "mp4"), startUs: aStartUs, fromUs: aStartUs + aIndex.keyframesUs[3], toUs: bStartUs },
      { blob: blobOf(b, "mp4"), startUs: bStartUs, fromUs: bStartUs, toUs: bStartUs + 3 * SEC },
    ];
    const result = await concatSegments({ container: "mp4", segments });
    expect(result.spliceDrops).toBe(1);
    const pictures = await h264Pictures(result.bytes);
    for (let i = 1; i < pictures.length; i++) expect(pictures[i].idr && pictures[i - 1].idr, `packet ${i}`).toBe(false);
    // Each IDR has its idr_pic_id (the slice header parses at every splice).
    const idrs = pictures.filter((p) => p.idr);
    expect(idrs.length).toBeGreaterThanOrEqual(2);
    expect(idrs.every((p) => typeof p.idrPicId === "number")).toBe(true);
    // The frame before the dropped keyframe is shown up to the new segment: no gap, one code less.
    const codes = decodeCodes(result.bytes, "mp4");
    expect(decodeErrors(result.bytes, "mp4")).toBe("");
    const gaps = codes.slice(1).filter((c, i) => c !== (codes[i] + 1) % CODE_PERIOD);
    expect(gaps).toHaveLength(1);
  });

  it("the fixture of that test is a real splice hazard: its old window ends with a keyframe, and the new one starts with an IDR", async () => {
    const a = makeSegment({ startSec: 0, durationSec: 5.25, container: "mp4", audio: false });
    const b = makeSegment({ startSec: 151 / 30, durationSec: 4, container: "mp4", audio: false });
    const aIndex = await indexSegment(blobOf(a, "mp4"), "mp4");
    const bIndex = await indexSegment(blobOf(b, "mp4"), "mp4");
    const aKeyNear5 = aIndex.keyframesUs.find((k) => Math.abs(k - 5 * SEC) < 60_000)!;
    // Placed as above (the keyframe 20 ms before the window end), the frame after it falls after the end:
    // the keyframe is alone at the end of its window.
    const after = aIndex.packetTimesUs.find((t) => t > aKeyNear5)!;
    expect(after - aKeyNear5).toBeGreaterThan(20_000);
    expect(bIndex.firstIsKey).toBe(true);
    // Both files start and restart their IDR numbering on their own: two IDRs in a row could share an id.
    const aPictures = await h264Pictures(a);
    const bPictures = await h264Pictures(b);
    expect(aPictures[0].idr && bPictures[0].idr).toBe(true);
  });
});

describe("applySpliceRule", () => {
  const p = (capUs: number, key = false) => ({ capUs, durUs: 10, key });

  it("drops a lone keyframe at the end of a window that a later window follows, and stretches the frame before it", () => {
    const windows = [[p(0, true), p(10), p(20, true)], [p(35, true), p(45)]];
    expect(applySpliceRule(windows)).toBe(1);
    expect(windows[0].map((x) => x.capUs)).toEqual([0, 10]);
    expect(windows[0][1].durUs).toBe(25);
    // The last window keeps its frames.
    expect(windows[1]).toHaveLength(2);
  });

  it("leaves a window alone when it ends inside a GOP, and the last window always", () => {
    const windows = [[p(0, true), p(10), p(20)], [p(30, true)]];
    expect(applySpliceRule(windows)).toBe(0);
    expect(windows.flat()).toHaveLength(4);
  });

  it("a window of one keyframe goes whole; empty windows are skipped", () => {
    const windows = [[p(0, true), p(10)], [p(20, true)], [], [p(30, true), p(40)]];
    expect(applySpliceRule(windows)).toBe(1);
    expect(windows[1]).toEqual([]);
    expect(windows[0][1].durUs).toBe(20);
  });
});

describe("orderRecordSegments", () => {
  const ref = (startUs: number, fromUs: number, toUs: number): { segment: RecorderSegmentRef; key: string } => ({
    segment: { blob: new Blob([String(startUs)]), startUs, fromUs, toUs },
    key: "v",
  });

  it("sorts by start and ends each window at the next one's start (a pause in a hand-off: both stop together)", () => {
    // The fault this guards: the old window reached to the pause, past the new segment's start, and the whole part failed.
    const items = [ref(4.5 * SEC, 4.5 * SEC, 4.6 * SEC), ref(0, 3 * SEC, 4.6 * SEC)];
    const ordered = orderRecordSegments(items, 3 * SEC);
    expect(ordered.map((i) => [i.segment.startUs, i.segment.fromUs, i.segment.toUs])).toEqual([
      [0, 3 * SEC, 4.5 * SEC],
      [4.5 * SEC, 4.5 * SEC, 4.6 * SEC],
    ]);
    // The input is not changed, and the extra data rides along.
    expect(items[1].segment.toUs).toBe(4.6 * SEC);
    expect(ordered.every((i) => i.key === "v")).toBe(true);
  });

  it("starts at the latest keyframe at or before the tap that a segment has", () => {
    // Tap at 4.6 s in a hand-off: the old segment's last keyframe is at 0 (Firefox), the new one's at 4.5 s.
    const ordered = orderRecordSegments([ref(0, 0, 9 * SEC), ref(4.5 * SEC, 4.5 * SEC, 9 * SEC)], 4.6 * SEC);
    expect(ordered.map((i) => [i.segment.startUs, i.segment.fromUs])).toEqual([[4.5 * SEC, 4.5 * SEC]]);
    // A tap before the new segment starts: the old segment's keyframe at 4 s starts the recording.
    const earlier = orderRecordSegments([ref(0, 4 * SEC, 9 * SEC), ref(4.7 * SEC, 4.7 * SEC, 9 * SEC)], 4.6 * SEC);
    expect(earlier.map((i) => [i.segment.fromUs, i.segment.toUs])).toEqual([
      [4 * SEC, 4.7 * SEC],
      [4.7 * SEC, 9 * SEC],
    ]);
  });

  it("drops a window that is empty after the ends meet", () => {
    const ordered = orderRecordSegments([ref(0, 1 * SEC, 5 * SEC), ref(1 * SEC, 1 * SEC, 5 * SEC)], null);
    expect(ordered.map((i) => i.segment.startUs)).toEqual([1 * SEC]);
  });
});

describe("planRecordParts", () => {
  const seg = (i: number, size: number): RecorderSegmentRef => ({
    blob: new Blob([new Uint8Array(size)]),
    startUs: i * 5 * SEC,
    fromUs: i * 5 * SEC + (i === 0 ? 1_500_000 : 0),
    toUs: (i + 1) * 5 * SEC,
  });
  const same = "vp8|64x64|";

  it("keeps a recording in one part when it fits and the configs match", () => {
    const segments = [seg(0, 100), seg(1, 100), seg(2, 100)];
    const parts = planRecordParts(segments, [same, same, same], 1000);
    expect(parts).toEqual([segments]);
    // The first part keeps its record start (a keyframe inside the first segment).
    expect(parts[0][0].fromUs).toBe(1_500_000);
  });

  it("starts a new part before the size limit and at a video config change; no segment is dropped", () => {
    const segments = [seg(0, 400), seg(1, 400), seg(2, 400), seg(3, 400), seg(4, 400)];
    const other = "vp8|48x48|";
    const parts = planRecordParts(segments, [same, same, same, other, other], 900);
    expect(parts.map((p) => p.length)).toEqual([2, 1, 2]);
    expect(parts.flat().map((s) => s.startUs)).toEqual(segments.map((s) => s.startUs));
    // Each later part starts at its first segment's first packet.
    for (const part of parts.slice(1)) expect(part[0].fromUs).toBe(part[0].startUs);
  });

  it("a segment larger than the limit is a part of its own", () => {
    const segments = [seg(0, 50), seg(1, 5000), seg(2, 50)];
    expect(planRecordParts(segments, [same, same, same], 1000).map((p) => p.length)).toEqual([1, 1, 1]);
  });
});

describe.skipIf(SKIP)("the write protocol check on tier V files (plan 8.1)", () => {
  it("verifies a joined WebM: it parses, the length is the planned one, and a keyframe comes first", async () => {
    const sound = await soundOf("webm", 14);
    const result = await concatSegments({ container: "webm", segments: windows(webmLive, 3 * SEC, 11 * SEC) }, sound.source);
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
