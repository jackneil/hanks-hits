// @vitest-environment node
/**
 * The A/V analyzer's logic (scripts/clips/lib/sync.mjs and the parsers in
 * scripts/clips/lib/media.mjs), on series with known answers. The real-file
 * checks with ffmpeg and AVFoundation are in analyzer.media.test.ts.
 */
import { describe, expect, it } from "vitest";

import { envelopeSegments, parseAudioFrameLog, parseLumaLog } from "../../../../../../../scripts/clips/lib/media.mjs";
import {
  DETECT,
  LIMITS,
  RATE,
  analyzeDecode,
  audioGaps,
  beepOnsets,
  beepTable,
  evaluate,
  expectedPairs,
  fileBeatInterval,
  flashOnsets,
  formatBeepTable,
  formatRows,
  fpsText,
  markOf,
  offsetDeltas,
  pairEvents,
  passed,
  rateParts,
  ratePartsText,
  truthBeatInterval,
  videoStats,
} from "../../../../../../../scripts/clips/lib/sync.mjs";
import { TRUTH_CHECKS, cleanBeats, fitPlaces, marksText, truthRows } from "../../../../../../../scripts/clips/lib/truth.mjs";
import { beatMark, type BeatTruth } from "../labSchedule";

type Frames = Array<[number, number]>;
interface Segment {
  start: number;
  sampleRate: number;
  samples: number;
  binMs: number;
  peaks: number[];
}

/** Frames at `fps` from 0 to `seconds`: dark (30), with a white (235) frame at each flash time. */
function lab(options: { seconds: number; fps?: number; flashes?: number[]; drop?: [number, number] }): Frames {
  const fps = options.fps ?? 30;
  const frames: Frames = [];
  for (let n = 0; n < Math.round(options.seconds * fps); n++) {
    const t = n / fps;
    if (options.drop && t >= options.drop[0] && t < options.drop[1]) continue;
    const white = (options.flashes ?? []).some((f) => Math.abs(f - t) < 0.5 / fps);
    frames.push([t, white ? 235 : 30]);
  }
  return frames;
}

/** One continuous 48 kHz segment with 1 ms peaks: silence, and a beep at each time (60 ms, or lengths[i] ms). */
function beeps(options: { seconds: number; at: number[]; start?: number; level?: number; lengths?: number[] }): Segment {
  const bins = Math.round(options.seconds * 1000);
  const peaks = new Array<number>(bins).fill(0.001);
  options.at.forEach((t, n) => {
    const first = Math.round((t - (options.start ?? 0)) * 1000);
    const length = options.lengths?.[n] ?? 60;
    for (let i = first; i < first + length && i < bins; i++) if (i >= 0) peaks[i] = options.level ?? 0.5;
  });
  return { start: options.start ?? 0, sampleRate: 48000, samples: bins * 48, binMs: 1, peaks };
}

const HALF_SECONDS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];

function decodeWith(offsetMs: number, seconds = 6) {
  return analyzeDecode({
    frames: lab({ seconds, flashes: HALF_SECONDS.filter((t) => t < seconds) }),
    segments: [beeps({ seconds, at: HALF_SECONDS.filter((t) => t < seconds).map((t) => t + offsetMs / 1000) })],
  });
}

const NO_SKIP = { ffmpeg: null, avfoundation: null };
const CONTAINER = { durationSec: 6, video: "video h264", audio: "audio aac", streams: [] };

function rowOf<R extends { status: string; check: string; detail?: unknown }>(rows: R[], prefix: string): R {
  const found = rows.find((r) => r.check.startsWith(prefix));
  if (!found) throw new Error(`no row "${prefix}" in ${rows.map((r) => r.check).join(", ")}`);
  return found;
}

describe("flashOnsets", () => {
  it("finds the first frame of each flash, and never the first frame of the file", () => {
    const frames = lab({ seconds: 3, flashes: [0, 1, 2] });
    // The flash at 0 s may have started before the file: it is not an onset.
    expect(flashOnsets(frames).onsets).toEqual([1, 2]);
  });

  it("uses the file's own contrast: a band and a border make a flash frame only partly white", () => {
    const frames: Frames = lab({ seconds: 3, flashes: [1.5] }).map(([t, y]) => [t, y === 235 ? 120 : 40]);
    const result = flashOnsets(frames);
    expect(result.onsets).toEqual([1.5]);
    expect(result.threshold).toBe(80);
  });

  it("counts a long flash once, at its start", () => {
    const frames = lab({ seconds: 2, flashes: [1, 1 + 1 / 30, 1 + 2 / 30] });
    expect(flashOnsets(frames).onsets).toEqual([1]);
  });

  it("finds no flash in a picture with too little contrast", () => {
    const frames: Frames = lab({ seconds: 2 }).map(([t], i) => [t, 30 + (i % 3) * (DETECT.minLumaContrast / 3)]);
    expect(flashOnsets(frames).onsets).toEqual([]);
  });

  it("sorts frames by time and drops frames without a finite time or luma", () => {
    const frames: Frames = [
      [1, 235],
      [0.5, 30],
      [Number.NaN, 235],
      [0.9, 30],
      [1.1, Number.POSITIVE_INFINITY],
      [1.2, 30],
    ];
    expect(flashOnsets(frames).onsets).toEqual([1]);
  });
});

describe("beepOnsets", () => {
  it("finds each beep that has quiet before it, at the start of its first loud bin", () => {
    const result = beepOnsets([beeps({ seconds: 4, at: [0.5, 1.5, 2.5] })]);
    expect(result.onsets.map((t) => Math.round(t * 1000))).toEqual([500, 1500, 2500]);
    expect(result.loudest).toBe(0.5);
  });

  it("needs DETECT.quietMs of quiet before an onset, so a sound that goes on is one beep", () => {
    const segment = beeps({ seconds: 2, at: [0.5] });
    // A second burst 50 ms after the first one ends: not enough quiet.
    for (let i = 610; i < 640; i++) segment.peaks[i] = 0.5;
    expect(beepOnsets([segment]).onsets.map((t) => Math.round(t * 1000))).toEqual([500]);
  });

  it("finds no onset at the very start of a segment (there is no quiet before it)", () => {
    const result = beepOnsets([beeps({ seconds: 2, at: [0, 1] })]);
    expect(result.onsets.map((t) => Math.round(t * 1000))).toEqual([1000]);
  });

  it("finds beeps in every segment, at the segment's own time", () => {
    const result = beepOnsets([beeps({ seconds: 1, at: [0.5] }), beeps({ seconds: 1, at: [1.7], start: 1.2 })]);
    expect(result.onsets.map((t) => Math.round(t * 1000))).toEqual([500, 1700]);
  });

  it("finds no beep in a quiet track", () => {
    expect(beepOnsets([beeps({ seconds: 2, at: [1], level: DETECT.minBeepPeak / 2 })]).onsets).toEqual([]);
  });

  it("measures each beep's length, and gives null for a beep that the segment cuts", () => {
    const result = beepOnsets([beeps({ seconds: 3, at: [0.5, 1.5, 2.95], lengths: [60, 120, 60] })]);
    expect(result.onsets.map((t) => Math.round(t * 1000))).toEqual([500, 1500, 2950]);
    // The last beep runs into the end of the segment: its length is not known.
    expect(result.lengths).toEqual([60, 120, null]);
    // A short dip inside a beep does not end it; DETECT.beepEndQuietMs of quiet does.
    const dipped = beeps({ seconds: 2, at: [0.5], lengths: [120] });
    for (let i = 540; i < 545; i++) dipped.peaks[i] = 0.001;
    expect(beepOnsets([dipped]).lengths).toEqual([120]);
    expect(DETECT.beepEndQuietMs).toBe(10);
  });

  it("reads the mark of a beep from its length: 90 ms or more is mark 1", () => {
    expect(DETECT.markSplitMs).toBe(90);
    expect([markOf(60), markOf(89), markOf(90), markOf(120), markOf(null), markOf(Number.NaN)]).toEqual([0, 0, 1, 1, null, null]);
  });
});

describe("pairEvents", () => {
  it("pairs one to one, closest pairs first", () => {
    const { pairs, unmatchedFlashes, unmatchedBeeps } = pairEvents([1, 2, 3], [1.02, 2.1, 3.3, 3.9]);
    expect(pairs).toEqual([
      { flash: 1, beep: 1.02, audioMinusVideoMs: 20 },
      { flash: 2, beep: 2.1, audioMinusVideoMs: 100 },
      { flash: 3, beep: 3.3, audioMinusVideoMs: 300 },
    ]);
    expect(unmatchedFlashes).toEqual([]);
    expect(unmatchedBeeps).toEqual([3.9]);
  });

  it("never pairs events further apart than the window", () => {
    const { pairs, unmatchedFlashes, unmatchedBeeps } = pairEvents([1], [1.6], 500);
    expect(pairs).toEqual([]);
    expect(unmatchedFlashes).toEqual([1]);
    expect(unmatchedBeeps).toEqual([1.6]);
  });

  it("gives a beep that is early a negative offset", () => {
    expect(pairEvents([2], [1.94]).pairs[0].audioMinusVideoMs).toBe(-60);
  });
});

describe("videoStats and audioGaps", () => {
  it("measures the largest gap and the effective frame rate", () => {
    const stats = videoStats(lab({ seconds: 4, drop: [2, 2.2] }));
    expect(stats.maxGapMs).toBeCloseTo(233.3, 1);
    expect(stats.maxGapAt).toBeCloseTo(59 / 30, 6);
    expect(stats.effectiveFps).toBeCloseTo((114 - 1) / (119 / 30), 1);
    expect(videoStats(lab({ seconds: 2 })).effectiveFps).toBe(30);
    expect(videoStats([]).effectiveFps).toBeNull();
  });

  it("finds the cadence: the most common frame interval, also when a clip spans two rungs", () => {
    const steady = videoStats(lab({ seconds: 2 }));
    expect(steady.cadenceMs).toBe(33.3);
    expect(steady.cadenceFps).toBe(30);
    expect(steady.cadenceShare).toBe(1);
    // 1 s at 60 fps (60 intervals of 16.7 ms, with the step), then 3.5 s at 20 fps (69 intervals of 50 ms).
    const frames: Frames = [];
    for (let i = 0; i < 60; i++) frames.push([i / 60, 30]);
    for (let i = 0; i < 70; i++) frames.push([1 + i / 20, 30]);
    const mixed = videoStats(frames);
    expect(mixed.cadenceMs).toBe(50);
    expect(mixed.cadenceFps).toBe(20);
    expect(mixed.cadenceShare).toBeCloseTo(69 / 129, 2);
    expect(videoStats([[0, 1]]).cadenceMs).toBeNull();
  });

  it("gives the jump between two sound segments", () => {
    const a = { start: 0, samples: 48000, sampleRate: 48000 };
    const b = { start: 1.25, samples: 48000, sampleRate: 48000 };
    expect(audioGaps([b, a])).toEqual([{ at: 1, ms: 250 }]);
    expect(audioGaps([a])).toEqual([]);
  });
});

/**
 * Frames in parts with one rate each: [fps, from s, to s]. Each part starts
 * on its own `from`, so a step lands where a governor rung change lands.
 * A frame within half an interval of a flash time is white.
 */
function stepped(parts: Array<[number, number, number]>, flashes: number[] = []): Frames {
  const frames: Frames = [];
  for (const [fps, from, to] of parts) {
    for (let t = from; t < to - 1e-9; t += 1 / fps) {
      const white = flashes.some((f) => Math.abs(f - t) < 0.5 / fps);
      frames.push([Math.round(t * 1e6) / 1e6, white ? 235 : 30]);
    }
  }
  return frames;
}

/** The Record run of 2026-09-29 (scratch run with governor logs): 60 fps, Compute Pressure "serious" at +3 s (30 fps), again at +13 s (20 fps). */
const PRESSURE_STEPS: Array<[number, number, number]> = [
  [60, 0, 3],
  [30, 3, 13],
  [20, 13, 20],
];

describe("rateParts", () => {
  it("gives one part for a steady file, also when some frames are missed", () => {
    // 60 fps for 5 s with every 7th frame missed: the median interval stays 16.7 ms.
    const frames = lab({ seconds: 5, fps: 60 }).filter((_, i) => i % 7 !== 3);
    const parts = rateParts(frames);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ from: 0, fps: 60, cadenceMs: 16.7 });
    expect(parts[0].to).toBeCloseTo(299 / 60, 6);
    // 6 of 7 frames: the effective rate of the part, not its cadence.
    expect(parts[0].effectiveFps).toBeCloseTo(60 * (6 / 7), 0);
    expect(ratePartsText(parts)).toEqual({ value: "60 fps", detail: "one rate from 0.00 s to 4.98 s" });
  });

  it("finds each governor rung of a file that steps down, to within one frame", () => {
    const parts = rateParts(stepped(PRESSURE_STEPS));
    expect(parts.map((p) => p.fps)).toEqual([60, 30, 20]);
    expect(parts[0].from).toBe(0);
    expect(Math.abs(parts[0].to - 3)).toBeLessThanOrEqual(1 / 30 + 1e-6);
    expect(parts[1].from).toBe(parts[0].to);
    expect(Math.abs(parts[1].to - 13)).toBeLessThanOrEqual(1 / 20 + 1e-6);
    expect(parts[2].to).toBeCloseTo(19.95, 6);
    expect(ratePartsText(parts)).toEqual({
      value: "60 > 30 > 20 fps",
      detail: `60 fps 0.00-${parts[0].to.toFixed(2)} s, 30 fps ${parts[1].from.toFixed(2)}-${parts[1].to.toFixed(2)} s, 20 fps ${parts[2].from.toFixed(2)}-19.95 s`,
    });
  });

  it("shows a step up too, and rates that are not whole numbers", () => {
    // 90 Hz rungs: 22.5 fps, then 45 fps.
    const parts = rateParts(stepped([
      [22.5, 0, 4],
      [45, 4, 8],
    ]));
    expect(parts.map((p) => p.fps)).toEqual([22.5, 45]);
    expect(ratePartsText(parts).value).toBe("22.5 > 45 fps");
    expect(fpsText(59.96)).toBe("60");
    expect(fpsText(17.14)).toBe("17.1");
  });

  it("joins a run shorter than 0.5 s to the part next to it", () => {
    // 0.3 s at 30 fps inside 60 fps, and 0.2 s at 30 fps at the very start.
    const middle = rateParts(stepped([
      [60, 0, 2],
      [30, 2, 2.3],
      [60, 2.3, 5],
    ]));
    expect(middle.map((p) => p.fps)).toEqual([60]);
    expect(middle[0].from).toBe(0);
    const first = rateParts(stepped([
      [30, 0, 0.2],
      [60, 0.2, 4],
    ]));
    expect(first.map((p) => p.fps)).toEqual([60]);
    expect(first[0].from).toBe(0);
    // 0.6 s is long enough to be its own part.
    expect(rateParts(stepped([
      [60, 0, 2],
      [30, 2, 2.6],
      [60, 2.6, 5],
    ])).map((p) => p.fps)).toEqual([60, 30, 60]);
  });

  it("gives no parts for fewer than 2 frames", () => {
    expect(rateParts([])).toEqual([]);
    expect(rateParts([[0, 30]])).toEqual([]);
    expect(ratePartsText([])).toEqual({ value: "?", detail: "fewer than 2 frames" });
  });

  it("has the settings that the file comment gives", () => {
    expect(RATE).toEqual({ medianWindow: 9, minPartSec: 0.5, sameShare: 0.05 });
  });
});

describe("offsetDeltas", () => {
  it("joins the beeps of two decoders by flash time", () => {
    const a = [
      { flash: 1, beep: 1, audioMinusVideoMs: 0 },
      { flash: 2, beep: 2, audioMinusVideoMs: 1 },
    ];
    const b = [
      { flash: 1.004, beep: 0.96, audioMinusVideoMs: -44 },
      { flash: 5, beep: 5, audioMinusVideoMs: 0 },
    ];
    expect(offsetDeltas(a, b, 20)).toEqual({ deltas: [{ flash: 1, a: 0, b: -44, deltaMs: -44 }], unmatchedA: 1, unmatchedB: 1 });
  });
});

describe("evaluate", () => {
  it("passes a file that is in sync, in both modes", () => {
    const decode = decodeWith(0);
    for (const mode of ["synthetic", "live"] as const) {
      const rows = evaluate({ container: CONTAINER, ffmpeg: decode, ffmpegRaw: decodeWith(21), avfoundation: decode, skipped: NO_SKIP }, { mode, rungFps: 30, expectSeconds: 6 });
      expect(rows.filter((r) => r.status === "FAIL")).toEqual([]);
      expect(passed(rows)).toBe(true);
    }
  });

  it("holds synthetic files to 5 ms of the offset they were made with", () => {
    const decode = decodeWith(20);
    const measure = { container: CONTAINER, ffmpeg: decode, ffmpegRaw: decodeWith(41), avfoundation: decode, skipped: NO_SKIP };
    expect(rowOf(evaluate(measure, { mode: "synthetic", expectOffsetMs: 20 }), "container A/V (ffmpeg)").status).toBe("PASS");
    expect(rowOf(evaluate(measure, { mode: "synthetic", expectOffsetMs: 14 }), "container A/V (ffmpeg)").status).toBe("FAIL");
    expect(rowOf(evaluate(measure, { mode: "synthetic", expectOffsetMs: 15 }), "container A/V (ffmpeg)").status).toBe("PASS");
    expect(rowOf(evaluate(measure, { mode: "synthetic" }), "container A/V (ffmpeg)").status).toBe("FAIL");
  });

  it.each([
    [-45, "PASS"],
    [-46, "FAIL"],
    [0, "PASS"],
    [125, "PASS"],
    [126, "FAIL"],
  ])("judges live sync of %i ms (sound minus picture) as %s (ITU-R BT.1359)", (offset, status) => {
    const decode = decodeWith(offset);
    const rows = evaluate({ container: CONTAINER, ffmpeg: decode, ffmpegRaw: decode, avfoundation: decode, skipped: NO_SKIP }, { mode: "live" });
    expect(rowOf(rows, "live A/V, BT.1359 (ffmpeg)").status).toBe(status);
    expect(rowOf(rows, "live A/V, BT.1359 (AVFoundation)").status).toBe(status);
  });

  it("fails a beep with no flash inside the file, but not one cut by the file's edge", () => {
    const inside = analyzeDecode({
      frames: lab({ seconds: 6, flashes: [0.5, 1.5, 3.5, 4.5, 5.5] }),
      segments: [beeps({ seconds: 6, at: HALF_SECONDS })],
    });
    expect(inside.unmatched.beepsInside.map((t) => Math.round(t * 1000))).toEqual([2500]);
    expect(rowOf(evaluate({ container: CONTAINER, ffmpeg: inside, ffmpegRaw: inside, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "swiftc not found" } }, {}), "flash and beep at every beat (ffmpeg)").status).toBe("FAIL");

    const edge = analyzeDecode({
      frames: lab({ seconds: 6, flashes: [0.5, 1.5, 2.5, 3.5, 4.5] }),
      segments: [beeps({ seconds: 6, at: [...HALF_SECONDS.slice(0, 5), 5.9] })],
    });
    expect(edge.unmatched.beepsAtEdge.map((t) => Math.round(t * 1000))).toEqual([5900]);
    expect(rowOf(evaluate({ container: CONTAINER, ffmpeg: edge, ffmpegRaw: edge, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, {}), "flash and beep at every beat (ffmpeg)").status).toBe("PASS");
  });

  it("fails when too few pairs cover the file", () => {
    const sparse = analyzeDecode({ frames: lab({ seconds: 6, flashes: [2.5] }), segments: [beeps({ seconds: 6, at: [2.5] })] });
    expect(expectedPairs(6)).toBe(5);
    const row = rowOf(evaluate({ container: CONTAINER, ffmpeg: sparse, ffmpegRaw: sparse, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, {}), "flash and beep at every beat (ffmpeg)");
    expect(row.status).toBe("FAIL");
  });

  /** A long lab file: beats `interval` s apart from 0.5 s, each with its flash and its beep, all paired. */
  function longRun(seconds: number, interval: number, fps: number) {
    const times: number[] = [];
    for (let t = 0.5; t < seconds - 0.2; t += interval) times.push(Math.round(t * 1e6) / 1e6);
    return analyzeDecode({ frames: lab({ seconds, fps, flashes: times }), segments: [beeps({ seconds, at: times })] });
  }

  it.each([
    [160, 60, 61 / 60, 157], // a Record of 160 s at 60 Hz: 61 frames between beats
    [80, 30, 31 / 30, 77], // 80 s at 30 Hz (iOS Low Power Mode rAF): 31 frames between beats
  ])("counts the pairs of a %i s file at %i Hz with the lab's real beat spacing, not 1 s", (seconds, hz, interval, pairs) => {
    const decode = longRun(seconds, interval, hz);
    expect(decode.pairs).toHaveLength(pairs);
    expect(decode.unmatched.flashesInside.length + decode.unmatched.beepsInside.length).toBe(0);
    const measure = { container: { ...CONTAINER, durationSec: seconds }, ffmpeg: decode, ffmpegRaw: decode, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } };
    const check = `flash and beep at every beat (ffmpeg)`;
    // The file's own spacing (61/60 s or 31/30 s) sets the count.
    expect(fileBeatInterval(decode.pairs)).toBeCloseTo(interval, 2);
    expect(rowOf(evaluate(measure, {}), check).status).toBe("PASS");
    // So does a given interval, and the ground truth's.
    expect(rowOf(evaluate(measure, { beatIntervalSec: interval }), check).status).toBe("PASS");
    const log = Array.from({ length: 5 }, (_, i) => ({ index: i, rafTs: 1000 + i * interval * 1000, mark: 0 }));
    expect(truthBeatInterval(log)).toBeCloseTo(interval, 9);
    // The old count (1 s between beats, over the span the file covers) asks for one pair more than the file can have: it failed a good file.
    const span = decode.span!.end - decode.span!.start;
    expect(expectedPairs(span)).toBe(pairs + 1);
    expect(rowOf(evaluate(measure, { beatIntervalSec: 1 }), check).status).toBe("FAIL");
    expect(expectedPairs(span, interval)).toBeLessThanOrEqual(pairs);
  });

  it("never lets a file with lost beats ask for fewer pairs: a spacing outside the lab's range counts as 1 s", () => {
    // Every second beat lost: flashes and beeps 2 s apart.
    const decode = longRun(20, 2, 30);
    expect(fileBeatInterval(decode.pairs)).toBe(1);
    const measure = { container: { ...CONTAINER, durationSec: 20 }, ffmpeg: decode, ffmpegRaw: decode, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } };
    expect(rowOf(evaluate(measure, {}), "flash and beep at every beat (ffmpeg)").status).toBe("FAIL");
    expect(fileBeatInterval([])).toBe(1);
    expect(fileBeatInterval([{ flash: 0.5 }, { flash: 1.48 }])).toBeCloseTo(0.98, 9);
    expect(LIMITS.beatIntervalRangeSec).toEqual([0.95, 1.05]);
    expect(truthBeatInterval([])).toBeNull();
    expect(truthBeatInterval(undefined)).toBeNull();
    // Beats that are not consecutive in the log (a stopped and started lab) give no spacing.
    expect(truthBeatInterval([{ index: 1, rafTs: 0 }, { index: 3, rafTs: 5000 }])).toBeNull();
    expect(expectedPairs(10, Number.NaN)).toBe(9);
    expect(expectedPairs(0.5)).toBe(1);
  });

  it("fails when the two decoders read the container differently (the -44 ms AVFoundation defect of plan 3a)", () => {
    const rows = evaluate({ container: CONTAINER, ffmpeg: decodeWith(0), ffmpegRaw: decodeWith(21), avfoundation: decodeWith(-44), skipped: NO_SKIP }, { mode: "live" });
    expect(rowOf(rows, "live A/V, BT.1359 (AVFoundation)").status).toBe("PASS");
    expect(rowOf(rows, "decoders agree").status).toBe("FAIL");
    const close = evaluate({ container: CONTAINER, ffmpeg: decodeWith(0), ffmpegRaw: decodeWith(21), avfoundation: decodeWith(4), skipped: NO_SKIP }, { mode: "live" });
    expect(rowOf(close, "decoders agree").status).toBe("PASS");
  });

  it.each([
    [21, "PASS"],
    [45, "PASS"],
    [46, "FAIL"],
    [-4, "PASS"],
    [-25, "PASS"],
    [-26, "FAIL"],
  ])("judges a player that ignores edit lists, %i ms later, as %s (plan 6.4: at most 25 ms early, 15.2: at most 45 ms late)", (late, status) => {
    const rows = evaluate({ container: CONTAINER, ffmpeg: decodeWith(0), ffmpegRaw: decodeWith(late), avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, {});
    expect(rowOf(rows, "edit list ignored").status).toBe(status);
  });

  it("fails a video gap over 100 ms, and a frame rate under 90% (desktop) or 80% (phone) of the rung", () => {
    const gappy = analyzeDecode({ frames: lab({ seconds: 6, flashes: HALF_SECONDS, drop: [2.6, 2.75] }), segments: [beeps({ seconds: 6, at: HALF_SECONDS })] });
    const rows = evaluate({ container: CONTAINER, ffmpeg: gappy, ffmpegRaw: gappy, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, { rungFps: 30 });
    expect(rowOf(rows, "largest video gap").status).toBe("FAIL");

    const clean = decodeWith(0);
    const at = (rungFps: number, profile: "desktop" | "phone") =>
      rowOf(evaluate({ container: CONTAINER, ffmpeg: clean, ffmpegRaw: clean, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, { rungFps, profile }), "capture fps").status;
    // The fixture runs at 30 fps: 30 >= 0.9 * 33.3, but not >= 0.9 * 34; a phone needs 80%.
    expect(at(33.3, "desktop")).toBe("PASS");
    expect(at(34, "desktop")).toBe("FAIL");
    expect(at(37.5, "phone")).toBe("PASS");
    expect(at(38, "phone")).toBe("FAIL");
    expect(rowOf(evaluate({ container: CONTAINER, ffmpeg: clean, ffmpegRaw: clean, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, {}), "capture fps").status).toBe("SKIPPED");
  });

  it("reports the frame cadence, and says so when the given rung does not match the file", () => {
    const clean = decodeWith(0);
    const measure = { container: CONTAINER, ffmpeg: clean, ffmpegRaw: clean, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } };
    const cadence = rowOf(evaluate(measure, {}), "frame cadence (ffmpeg)");
    expect(cadence).toMatchObject({ status: "INFO", value: "30.0 fps", detail: "100% of the frames are 33.3 ms apart" });

    // A rung of 60 on a 30 fps file (a nominal rate, not the governor's rung).
    const nominal = rowOf(evaluate(measure, { rungFps: 60 }), "capture fps");
    expect(nominal.status).toBe("FAIL");
    expect(nominal.detail).toBe("the file's cadence is 30.0 fps, not the given rung 60");
    expect(formatRows([nominal as never])).toContain(">= 54.0 fps (90% of 60) (the file's cadence is 30.0 fps, not the given rung 60)");

    const matching = rowOf(evaluate(measure, { rungFps: 30 }), "capture fps");
    expect(matching.status).toBe("PASS");
    expect(matching.detail).toBeUndefined();
  });

  it("judges the capture fps against the rung the library row gives, never a fixed 60 (the Record run of 2026-09-29)", () => {
    // The governor stepped the recording down from 60 to 30 to 20 fps
    // (Compute Pressure "serious"), and every frame it asked for is in the file.
    const flashes = Array.from({ length: 20 }, (_, i) => i + 0.5);
    const decode = analyzeDecode({ frames: stepped(PRESSURE_STEPS, flashes), segments: [beeps({ seconds: 20, at: flashes })] });
    const measure = { container: { ...CONTAINER, durationSec: 20 }, ffmpeg: decode, ffmpegRaw: decode, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } };
    const fps = (rungFps?: number) => rowOf(evaluate(measure, rungFps === undefined ? {} : { rungFps, expectSeconds: 20 }), "capture fps");

    const rows = evaluate(measure, { rungFps: 60, expectSeconds: 20 });
    expect(rowOf(rows, "live A/V, BT.1359 (ffmpeg)").status).toBe("PASS");
    expect(rowOf(rows, "largest video gap").status).toBe("PASS");
    expect(rowOf(rows, "frame rate over time (ffmpeg)")).toMatchObject({ status: "INFO", value: "60 > 30 > 20 fps" });

    // A row that claims 60 for this file fails: the file ran at 60 fps for 3 s only.
    const claims60 = fps(60);
    expect(claims60.status).toBe("FAIL");
    expect(claims60.value).toBe("31.0 fps");
    expect(claims60.detail).toBe("the file's cadence is 30.0 fps, not the given rung 60; the rate changed in the file: 60 > 30 > 20 fps");
    // A row that gives the rungs the frames came at (time-weighted: 31 fps), or the rung it settled at (20), passes.
    expect(fps(31).status).toBe("PASS");
    expect(fps(20).status).toBe("PASS");
    // With no rung, there is nothing to judge against: SKIPPED, never an assumed 60.
    expect(fps().status).toBe("SKIPPED");
    // The same file with half of the 30 fps frames lost fails against the time-weighted rung.
    const lossy = analyzeDecode({
      frames: stepped(PRESSURE_STEPS, flashes).filter(([t], i) => !(t >= 3 && t < 13 && i % 2 === 1 && !flashes.some((f) => Math.abs(f - t) < 0.05))),
      segments: [beeps({ seconds: 20, at: flashes })],
    });
    expect(rowOf(evaluate({ ...measure, ffmpeg: lossy, ffmpegRaw: lossy }, { rungFps: 31 }), "capture fps").status).toBe("FAIL");
  });

  it("fails a jump in the sound track", () => {
    const split = analyzeDecode({
      frames: lab({ seconds: 6, flashes: HALF_SECONDS }),
      segments: [beeps({ seconds: 3, at: [0.5, 1.5, 2.5] }), beeps({ seconds: 3, at: [3.5, 4.5, 5.5], start: 3.02 })],
    });
    const rows = evaluate({ container: CONTAINER, ffmpeg: split, ffmpegRaw: split, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, {});
    expect(rowOf(rows, "sound track is continuous").status).toBe("FAIL");
  });

  it("checks the length against the asked seconds (a clip starts at a keyframe, up to 1 s longer)", () => {
    const decode = decodeWith(0);
    const length = (durationSec: number, expectSeconds: number) =>
      rowOf(evaluate({ container: { ...CONTAINER, durationSec }, ffmpeg: decode, ffmpegRaw: decode, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, { expectSeconds }), "length").status;
    expect(length(10.9, 10)).toBe("PASS");
    expect(length(9.0, 10)).toBe("PASS");
    expect(length(8.9, 10)).toBe("FAIL");
    expect(length(11.3, 10)).toBe("FAIL");
  });

  it("gives SKIPPED rows, and never a failure, when no decoder ran", () => {
    const skipped = { ffmpeg: "ffmpeg not found", avfoundation: "AVFoundation needs macOS" };
    const rows = evaluate({ container: null, ffmpeg: null, ffmpegRaw: null, avfoundation: null, skipped }, { rungFps: 60, expectSeconds: 10 });
    expect(rows.some((r) => r.status === "PASS" || r.status === "FAIL")).toBe(false);
    expect(rows.filter((r) => r.status === "SKIPPED").length).toBeGreaterThanOrEqual(8);
    expect(passed(rows)).toBe(true);
    const text = formatRows(rows, "clip.mp4");
    expect(text).toContain("skipped: ffmpeg not found");
    expect(text).toContain("skipped: AVFoundation needs macOS");
    expect(text.split("\n")[0]).toBe("== clip.mp4");
  });

  it("uses AVFoundation alone when ffmpeg is missing", () => {
    const decode = decodeWith(10);
    const rows = evaluate({ container: null, ffmpeg: null, ffmpegRaw: null, avfoundation: decode, skipped: { ffmpeg: "ffmpeg not found", avfoundation: null } }, { rungFps: 30 });
    expect(rowOf(rows, "live A/V, BT.1359 (AVFoundation)").status).toBe("PASS");
    expect(rowOf(rows, "largest video gap (AVFoundation)").status).toBe("PASS");
    expect(rowOf(rows, "live A/V, BT.1359 (ffmpeg)").status).toBe("SKIPPED");
  });
});

describe("evaluate with a decoder that could not read the file", () => {
  const good = () => decodeWith(0);

  it("gives FAIL rows for AVFoundation, keeps every ffmpeg row, and fails the decoder comparison", () => {
    const rows = evaluate(
      { container: CONTAINER, ffmpeg: good(), ffmpegRaw: decodeWith(21), avfoundation: null, skipped: NO_SKIP, failed: { avfoundation: "avsync failed on x.mp4: Cannot Open" } },
      { mode: "live", rungFps: 30, expectSeconds: 6 },
    );
    for (const check of ["flash and beep at every beat (AVFoundation)", "live A/V, BT.1359 (AVFoundation)"]) {
      expect(rowOf(rows, check)).toMatchObject({ status: "FAIL", value: "could not read the file", detail: "AVFoundation could not read the file: avsync failed on x.mp4: Cannot Open" });
    }
    expect(rowOf(rows, "decoders agree").status).toBe("FAIL");
    for (const check of ["flash and beep at every beat (ffmpeg)", "live A/V, BT.1359 (ffmpeg)", "edit list ignored", "largest video gap (ffmpeg)", "capture fps", "length"]) {
      expect(rowOf(rows, check).status, check).toBe("PASS");
    }
    expect(passed(rows)).toBe(false);
  });

  it("gives SKIPPED rows, and passes, when the AVFoundation reader could not be built (a tool that is not usable)", () => {
    const rows = evaluate({ container: CONTAINER, ffmpeg: good(), ffmpegRaw: decodeWith(21), avfoundation: null, skipped: { ffmpeg: null, avfoundation: "swiftc could not build avsync.swift: error: no such module" }, failed: {} }, { rungFps: 30 });
    expect(rowOf(rows, "live A/V, BT.1359 (AVFoundation)")).toMatchObject({ status: "SKIPPED", detail: "swiftc could not build avsync.swift: error: no such module" });
    expect(rowOf(rows, "decoders agree").status).toBe("SKIPPED");
    expect(passed(rows)).toBe(true);
  });

  it("uses AVFoundation for the file rows when ffmpeg could not read the file, and fails the ffmpeg rows", () => {
    const rows = evaluate({ container: null, ffmpeg: null, ffmpegRaw: null, avfoundation: good(), skipped: NO_SKIP, failed: { ffprobe: "Invalid data", ffmpeg: "moov atom not found", ffmpegRaw: "moov atom not found" } }, { rungFps: 30 });
    expect(rowOf(rows, "container (ffprobe)")).toMatchObject({ status: "FAIL", detail: "ffprobe could not read the file: Invalid data" });
    expect(rowOf(rows, "live A/V, BT.1359 (ffmpeg)")).toMatchObject({ status: "FAIL", detail: "ffmpeg could not read the file: moov atom not found" });
    expect(rowOf(rows, "edit list ignored").status).toBe("FAIL");
    expect(rowOf(rows, "live A/V, BT.1359 (AVFoundation)").status).toBe("PASS");
    expect(rowOf(rows, "largest video gap (AVFoundation)").status).toBe("PASS");
  });

  it("fails the edit-list row alone when only the -ignore_editlist decode failed", () => {
    const rows = evaluate({ container: CONTAINER, ffmpeg: good(), ffmpegRaw: null, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" }, failed: { ffmpegRaw: "bad edit list" } }, {});
    expect(rowOf(rows, "edit list ignored")).toMatchObject({ status: "FAIL", detail: "ffmpeg -ignore_editlist 1 could not read the file: bad edit list" });
    expect(rowOf(rows, "live A/V, BT.1359 (ffmpeg)").status).toBe("PASS");
  });

  it("fails the file rows when the only decoder here could not read the file", () => {
    const rows = evaluate({ container: null, ffmpeg: null, ffmpegRaw: null, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "AVFoundation needs macOS" }, failed: { ffmpeg: "broken" } }, { rungFps: 30, expectSeconds: 6, truth: { beats: [], endMs: 1, displayHz: 60, maxStride: 4 } });
    for (const check of ["largest video gap", "capture fps", "sound track is continuous", "length", TRUTH_CHECKS.match]) {
      expect(rowOf(rows, check).status, check).toBe("FAIL");
    }
    expect(rowOf(rows, "decoders agree").status).toBe("SKIPPED");
  });
});

/** 61 display frames at 60 Hz: the lab's beat interval there (ms). */
const LOG_INTERVAL_MS = (1000 * 61) / 60;
const T0 = 100_000;

/** The lab's log: beats `from`..`to`, each 61 frames apart at 60 Hz, each with its mark. */
function labLog(from: number, to: number): BeatTruth[] {
  return Array.from({ length: to - from + 1 }, (_, i) => {
    const index = from + i;
    return { index, ctxTime: 0, rafTs: T0 + index * LOG_INTERVAL_MS, perfNow: 0, holdFrames: 4, mark: beatMark(index) };
  });
}

/**
 * A decoded file whose beats are `slots` (log indices, in file order), one
 * log interval apart from `start` s, with the beep length of each beat's
 * mark. moveMs moves the flash and the beep of one slot.
 */
function fileOf(slots: number[], options: { seconds: number; start?: number; moveMs?: Record<number, number> }) {
  const times = slots.map((_, k) => Math.round(((options.start ?? 0.5) + (k * LOG_INTERVAL_MS) / 1000 + (options.moveMs?.[k] ?? 0) / 1000) * 1e6) / 1e6);
  const lengths = slots.map((index) => (beatMark(index) === 1 ? 120 : 60));
  return analyzeDecode({ frames: lab({ seconds: options.seconds, fps: 60, flashes: times }), segments: [beeps({ seconds: options.seconds, at: times, lengths })] });
}

/** Page time of the end of a file whose slot 0 is log beat `first` at file time `start`. */
function endOf(first: number, seconds: number, start = 0.5): number {
  return T0 + first * LOG_INTERVAL_MS + (seconds - start) * 1000;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("ground truth (truth.mjs)", () => {
  const SECONDS = 10;
  const FILE = range(43, 52); // 10 beats in a 10 s clip: the next beat (53) is 0.3 s after its end
  const truthAt = (endMs: number | null, beats = labLog(30, 70)) => ({ beats, endMs, displayHz: 60, maxStride: 4 });
  const judge = (decode: ReturnType<typeof analyzeDecode>, endMs: number | null, beats?: BeatTruth[]) =>
    evaluate({ container: { ...CONTAINER, durationSec: SECONDS }, ffmpeg: decode, ffmpegRaw: decode, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, { truth: truthAt(endMs, beats) });

  it("reads the marks of the file, and passes a file that holds the right beats and ends at the press", () => {
    const decode = fileOf(FILE, { seconds: SECONDS });
    expect(decode.pairs.map((p) => p.mark)).toEqual(FILE.map((index) => beatMark(index)));
    expect(new Set(decode.pairs.map((p) => p.mark))).toEqual(new Set([0, 1]));
    const rows = judge(decode, endOf(43, SECONDS));
    expect(rowOf(rows, TRUTH_CHECKS.match)).toMatchObject({ status: "PASS", value: "beats 44..53 (10)" });
    expect(rowOf(rows, TRUTH_CHECKS.ends).status).toBe("PASS");
    expect(rowOf(rows, TRUTH_CHECKS.spacing).status).toBe("PASS");
    const press = rowOf(rows, TRUTH_CHECKS.press);
    expect(press.status).toBe("PASS");
    // The 30 fps frames put each flash onset within half a frame of its time.
    expect(Math.abs((press.detail as { lagMs: number }).lagMs)).toBeLessThanOrEqual(17);
    expect(passed(rows)).toBe(true);
  });

  it("fails a file that is one beat, or 5 s, away from the press (the wrong part of the ring)", () => {
    const decode = fileOf(FILE, { seconds: SECONDS });
    for (const shift of [LOG_INTERVAL_MS, -LOG_INTERVAL_MS, 5000, 1000]) {
      const rows = judge(decode, endOf(43, SECONDS) + shift);
      expect(rowOf(rows, TRUTH_CHECKS.match).status, `shift ${shift}`).toBe("PASS");
      expect(rowOf(rows, TRUTH_CHECKS.press).status, `shift ${shift}`).toBe("FAIL");
    }
    // Inside half a beat is a pass: that is capture and encoder latency, not a wrong second.
    expect(rowOf(judge(decode, endOf(43, SECONDS) + 400), TRUTH_CHECKS.press).status).toBe("PASS");
  });

  it("fails a file that lost a beat inside it, or repeated one (drops and duplicates)", () => {
    const lost = fileOf([43, 44, 45, 47, 48, 49, 50, 51, 52, 53], { seconds: SECONDS });
    expect(lost.unmatched.flashesInside.length + lost.unmatched.beepsInside.length).toBe(0);
    expect(rowOf(judge(lost, endOf(43, SECONDS)), TRUTH_CHECKS.match).status).toBe("FAIL");
    const repeated = fileOf([43, 44, 45, 46, 46, 47, 48, 49, 50, 51], { seconds: SECONDS });
    const rows = judge(repeated, endOf(43, SECONDS));
    expect(rowOf(rows, TRUTH_CHECKS.match).status).toBe("FAIL");
    expect(rowOf(rows, TRUTH_CHECKS.press)).toMatchObject({ status: "INFO", value: "not checked" });
  });

  it("fails a file that lost the beat at its start, while its other beats are in order", () => {
    // The first flash at 1.5 s: beat 43 would be at 0.48 s, inside the file.
    const decode = fileOf(range(44, 52), { seconds: SECONDS, start: 1.5 });
    const rows = judge(decode, endOf(44, SECONDS, 1.5));
    expect(rowOf(rows, TRUTH_CHECKS.match).status).toBe("PASS");
    const ends = rowOf(rows, TRUTH_CHECKS.ends);
    expect(ends.status).toBe("FAIL");
    expect(ends.value).toMatch(/^beat 44 at 0\.4[78]\d s$/);
    // A beat that falls in the edge band is not lost: the file can cut it.
    const edge = fileOf(range(44, 52), { seconds: SECONDS, start: 1.1 });
    expect(rowOf(judge(edge, endOf(44, SECONDS, 1.1)), TRUTH_CHECKS.ends).status).toBe("PASS");
  });

  it("fails a spacing that differs from the log by more than one capture frame at the lowest rung", () => {
    const moved = fileOf(FILE, { seconds: SECONDS, moveMs: { 4: 100 } });
    expect(moved.pairs).toHaveLength(10);
    const spacing = rowOf(judge(moved, endOf(43, SECONDS)), TRUTH_CHECKS.spacing);
    expect(spacing.status).toBe("FAIL");
    expect(spacing.limit).toBe("+/- 68.7 ms (one capture frame at 15 fps, + 2 ms)");
    // 50 ms is inside one capture frame at 15 fps (66.7 ms).
    expect(rowOf(judge(fileOf(FILE, { seconds: SECONDS, moveMs: { 4: 50 } }), endOf(43, SECONDS)), TRUTH_CHECKS.spacing).status).toBe("PASS");
  });

  it("picks the place nearest the press when the 127-beat sequence repeats in the log", () => {
    const decode = fileOf(range(150, 159), { seconds: SECONDS });
    const rows = judge(decode, endOf(150, SECONDS), labLog(0, 300));
    const match = rowOf(rows, TRUTH_CHECKS.match);
    expect(match).toMatchObject({ status: "PASS", value: "beats 151..160 (10)" });
    expect(match.detail).toMatch(/^3 places in the log fit/);
    expect(rowOf(rows, TRUTH_CHECKS.press).status).toBe("PASS");
    expect(fitPlaces(decode.pairs, cleanBeats(labLog(0, 300)))).toEqual([23, 150, 277]);
  });

  it("gives an INFO row, not a press check, for a Record part before the last part", () => {
    const rows = judge(fileOf(FILE, { seconds: SECONDS }), null);
    expect(rowOf(rows, TRUTH_CHECKS.press)).toMatchObject({ status: "INFO", value: "no press for this file" });
    expect(rowOf(rows, TRUTH_CHECKS.match).status).toBe("PASS");
  });

  it("fails when too few marks are read to name the beats, when the log is empty, and when the file has no pairs", () => {
    const pairs = FILE.map((index, k) => ({ flash: 0.5 + k, mark: k < 3 ? beatMark(index) : null }));
    const rows = truthRows({ pairs, span: { start: 0, end: 10 } }, 10, truthAt(null), LIMITS);
    expect(rowOf(rows, TRUTH_CHECKS.match)).toMatchObject({ status: "FAIL", value: "3 of 10 marks read" });
    expect(marksText(pairs)).toBe(`${pairs.slice(0, 3).map((p) => p.mark).join("")}???????`);
    expect(rowOf(truthRows({ pairs: [], span: null }, 10, truthAt(null), LIMITS), TRUTH_CHECKS.match).value).toBe("no pairs in the file");
    const empty = truthRows(fileOf(FILE, { seconds: SECONDS }), 10, truthAt(null, []), LIMITS);
    expect(rowOf(empty, TRUTH_CHECKS.match)).toMatchObject({ status: "FAIL", value: "the log has no beats" });
    // One unread mark at the end (a beep cut by the end of the file) still names the place.
    const cut = FILE.map((index, k) => ({ flash: 0.5 + (k * LOG_INTERVAL_MS) / 1000, mark: k === 9 ? null : beatMark(index) }));
    expect(rowOf(truthRows({ pairs: cut, span: { start: 0, end: 10 } }, 10, truthAt(null), LIMITS), TRUTH_CHECKS.match).status).toBe("PASS");
  });

  it("says so in one INFO row when no ground truth is given", () => {
    const rows = evaluate({ container: CONTAINER, ffmpeg: decodeWith(0), ffmpegRaw: decodeWith(21), avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, {});
    expect(rowOf(rows, "ground truth")).toMatchObject({ status: "INFO", value: "not given" });
    expect(rows.some((r) => r.check === TRUTH_CHECKS.match)).toBe(false);
  });

  it("keeps only whole, marked beats of the log, once each", () => {
    const beats = [
      { index: 2, rafTs: 20, mark: 1 },
      { index: 1, rafTs: 10, mark: 0 },
      { index: 2, rafTs: 99, mark: 0 },
      { index: 3.5, rafTs: 30, mark: 1 },
      { index: 4, rafTs: Number.NaN, mark: 1 },
      { index: 5, rafTs: 50, mark: 2 },
      null,
    ];
    expect(cleanBeats(beats).map((b: { index: number; rafTs: number }) => [b.index, b.rafTs])).toEqual([
      [1, 10],
      [2, 20],
    ]);
  });
});

describe("beepTable", () => {
  it("lists every beep with each decoder's offset", () => {
    const table = beepTable({ ffmpeg: decodeWith(0, 4), avfoundation: decodeWith(3, 4), ffmpegRaw: decodeWith(21, 4) });
    expect(table).toEqual([
      { beep: 1, flash: 0.5, ffmpeg: 0, avfoundation: 3, ignoreEditList: 21 },
      { beep: 2, flash: 1.5, ffmpeg: 0, avfoundation: 3, ignoreEditList: 21 },
      { beep: 3, flash: 2.5, ffmpeg: 0, avfoundation: 3, ignoreEditList: 21 },
      { beep: 4, flash: 3.5, ffmpeg: 0, avfoundation: 3, ignoreEditList: 21 },
    ]);
    const text = formatBeepTable(table);
    expect(text.split("\n")).toHaveLength(5);
    expect(text).toContain("+3.0 ms");
    expect(formatBeepTable([])).toBe("no beeps were paired");
  });

  it("shows a dash where a decoder did not run", () => {
    const table = beepTable({ ffmpeg: null, avfoundation: decodeWith(-7, 3), ffmpegRaw: null });
    expect(table.map((r) => [r.ffmpeg, r.avfoundation, r.ignoreEditList])).toEqual([
      [null, -7, null],
      [null, -7, null],
      [null, -7, null],
    ]);
  });
});

describe("media.mjs parsers", () => {
  it("reads the luma of each frame from ffmpeg's metadata print", () => {
    const log = [
      "[Parsed_metadata_1 @ 0x1] frame:0    pts:0       pts_time:0",
      "[Parsed_metadata_1 @ 0x1] lavfi.signalstats.YAVG=28.5",
      "[Parsed_metadata_1 @ 0x1] frame:1    pts:512     pts_time:0.0333333",
      "[Parsed_metadata_1 @ 0x1] lavfi.signalstats.YAVG=235",
      "[Parsed_metadata_1 @ 0x1] frame:2    pts:-512    pts_time:-0.0333333",
      "[Parsed_metadata_1 @ 0x1] lavfi.signalstats.YAVG=30",
    ].join("\n");
    expect(parseLumaLog(log)).toEqual([
      [0, 28.5],
      [0.0333333, 235],
      [-0.0333333, 30],
    ]);
  });

  it("reads the time, the sample count and the rate of each audio frame from ashowinfo", () => {
    const log = [
      "[Parsed_ashowinfo_1 @ 0x2] n:0 pts:0 pts_time:0 fmt:flt channels:1 chlayout:mono rate:48000 nb_samples:1024 checksum:00000000",
      "[Parsed_ashowinfo_1 @ 0x2] n:1 pts:1024 pts_time:0.0213333 fmt:flt channels:1 chlayout:mono rate:48000 nb_samples:1024 checksum:00000000",
      "[Parsed_other @ 0x3] pts_time:9 nb_samples:5",
    ].join("\n");
    expect(parseAudioFrameLog(log)).toEqual([
      { time: 0, samples: 1024, rate: 48000 },
      { time: 0.0213333, samples: 1024, rate: 48000 },
    ]);
  });

  it("makes 1 ms peak bins and starts a new segment where the time jumps", () => {
    const samples = new Float32Array(48 * 4);
    samples[5] = -0.5; // bin 0
    samples[48 + 1] = 0.25; // bin 1
    samples[96 + 47] = 0.75; // bin 2, second segment
    const frames = [
      { time: 0, samples: 96, rate: 48000 },
      { time: 0.5, samples: 96, rate: 48000 },
    ];
    const segments = envelopeSegments(samples, frames);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ start: 0, samples: 96, binMs: 1 });
    expect(segments[0].peaks).toEqual([0.5, 0.25]);
    expect(segments[1]).toMatchObject({ start: 0.5, samples: 96 });
    expect(segments[1].peaks).toEqual([0.75, 0]);
  });

  it("keeps one segment when each frame follows on from the one before", () => {
    const frames = [
      { time: 0, samples: 1024, rate: 48000 },
      { time: 1024 / 48000, samples: 1024, rate: 48000 },
    ];
    expect(envelopeSegments(new Float32Array(2048), frames)).toHaveLength(1);
  });

  it("refuses a decode whose sample count does not match its log", () => {
    expect(() => envelopeSegments(new Float32Array(10), [{ time: 0, samples: 20, rate: 48000 }])).toThrow(/logged 20 samples but wrote 10/);
  });
});

describe("limits", () => {
  it("are the plan 15.2 and 6.4 numbers", () => {
    expect(LIMITS.containerMs).toBe(5);
    expect(LIMITS.liveLeadMs).toBe(45);
    expect(LIMITS.liveLagMs).toBe(125);
    expect(LIMITS.editListLateMs).toBe(45);
    // Plan 6.4: "the first audio packet is chosen so that playback is at most 25 ms early there".
    expect(LIMITS.editListEarlyMs).toBe(25);
    expect(LIMITS.maxVideoGapMs).toBe(100);
    expect(LIMITS.fpsShare).toEqual({ desktop: 0.9, phone: 0.8 });
  });

  it("put the ground-truth press limit at half of the shortest beat interval (49 frames at 50 Hz)", () => {
    expect(LIMITS.pressEndMs).toBe(490);
    expect(LIMITS.pressEndMs * 2).toBeLessThanOrEqual((1000 * 49) / 50);
    expect(LIMITS.truthSlackMs).toBe(2);
  });
});
