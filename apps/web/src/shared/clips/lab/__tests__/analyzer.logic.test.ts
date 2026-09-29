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
  flashOnsets,
  formatBeepTable,
  formatRows,
  fpsText,
  offsetDeltas,
  pairEvents,
  passed,
  rateParts,
  ratePartsText,
  videoStats,
} from "../../../../../../../scripts/clips/lib/sync.mjs";

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

/** One continuous 48 kHz segment with 1 ms peaks: silence, and a 60 ms beep at each time. */
function beeps(options: { seconds: number; at: number[]; start?: number; level?: number }): Segment {
  const bins = Math.round(options.seconds * 1000);
  const peaks = new Array<number>(bins).fill(0.001);
  for (const t of options.at) {
    const first = Math.round((t - (options.start ?? 0)) * 1000);
    for (let i = first; i < first + 60 && i < bins; i++) if (i >= 0) peaks[i] = options.level ?? 0.5;
  }
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
    expect(rowOf(evaluate({ container: CONTAINER, ffmpeg: inside, ffmpegRaw: inside, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "swiftc not found" } }, {}), "flash and beep every second (ffmpeg)").status).toBe("FAIL");

    const edge = analyzeDecode({
      frames: lab({ seconds: 6, flashes: [0.5, 1.5, 2.5, 3.5, 4.5] }),
      segments: [beeps({ seconds: 6, at: [...HALF_SECONDS.slice(0, 5), 5.9] })],
    });
    expect(edge.unmatched.beepsAtEdge.map((t) => Math.round(t * 1000))).toEqual([5900]);
    expect(rowOf(evaluate({ container: CONTAINER, ffmpeg: edge, ffmpegRaw: edge, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, {}), "flash and beep every second (ffmpeg)").status).toBe("PASS");
  });

  it("fails when too few pairs cover the file", () => {
    const sparse = analyzeDecode({ frames: lab({ seconds: 6, flashes: [2.5] }), segments: [beeps({ seconds: 6, at: [2.5] })] });
    expect(expectedPairs(6)).toBe(5);
    const row = rowOf(evaluate({ container: CONTAINER, ffmpeg: sparse, ffmpegRaw: sparse, avfoundation: null, skipped: { ffmpeg: null, avfoundation: "x" } }, {}), "flash and beep every second (ffmpeg)");
    expect(row.status).toBe("FAIL");
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
    [-6, "FAIL"],
  ])("judges a player that ignores edit lists, %i ms later, as %s (plan 6.4)", (late, status) => {
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
    expect(LIMITS.maxVideoGapMs).toBe(100);
    expect(LIMITS.fpsShare).toEqual({ desktop: 0.9, phone: 0.8 });
  });
});
