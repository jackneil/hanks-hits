// @vitest-environment node
/**
 * The A/V analyzer (scripts/clips/analyze-sync.mjs) on real files with known
 * offsets (plan 15.2, "Node" tier of 15.1).
 *
 * ffmpeg makes lab-pattern files: a white flash at 0.5 s, 1.5 s, ... and a
 * 1 kHz beep that starts a known time after each flash (0 ms, +20 ms,
 * -60 ms), plus a file with a run of dropped frames. The analyzer must read
 * each offset within 5 ms in ffmpeg, and in AVFoundation on macOS, and give
 * the right PASS and FAIL rows. Without ffmpeg (a kid's Windows or
 * Chromebook clone), the file-based tests are skipped with the reason, and
 * the analyzer gives SKIPPED rows, never a failure.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { analyzeSync } from "../../../../../../../scripts/clips/analyze-sync.mjs";
import { fixtureToolsReason, makeLabFixture } from "../../../../../../../scripts/clips/lib/fixtures.mjs";
import { probeTools } from "../../../../../../../scripts/clips/lib/media.mjs";

const REASON = fixtureToolsReason();
const TOOLS = probeTools();
const AVF_REASON = TOOLS.avfoundation.ok ? "" : TOOLS.avfoundation.reason;
if (REASON) console.warn(`[analyzer.media] SKIPPED: ${REASON}`);
if (!REASON && AVF_REASON) console.warn(`[analyzer.media] AVFoundation rows SKIPPED: ${AVF_REASON}`);

type Row = { status: string; check: string; value: string; detail?: unknown };
type Result = Awaited<ReturnType<typeof analyzeSync>>;

function row(rows: Row[], prefix: string): Row {
  const found = rows.find((r) => r.check.startsWith(prefix));
  if (!found) throw new Error(`no row "${prefix}"`);
  return found;
}

function offsets(result: Result, decoder: "ffmpeg" | "avfoundation"): number[] {
  const decode = result.measure[decoder];
  return decode ? decode.pairs.map((p: { audioMinusVideoMs: number }) => p.audioMinusVideoMs) : [];
}

describe("analyze-sync without its tools", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "hh-analyzer-skip-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives SKIPPED rows with the reason, and passes, when neither decoder is there", async () => {
    const file = path.join(dir, "any.mp4");
    writeFileSync(file, new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101]));
    const result = await analyzeSync(file, {
      tools: { ffmpeg: { ok: false, reason: "ffmpeg not found" }, avfoundation: { ok: false, reason: "AVFoundation needs macOS" } },
      rungFps: 60,
      expectSeconds: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.rows.every((r: Row) => r.status === "SKIPPED")).toBe(true);
    expect(result.rows.map((r: Row) => r.detail)).toContain("ffmpeg not found");
    expect(result.rows.map((r: Row) => r.detail)).toContain("AVFoundation needs macOS");
  });

  it("says why a tool is missing", () => {
    const tools = probeTools({ ffmpeg: "hh-no-such-ffmpeg", ffprobe: "hh-no-such-ffprobe", swiftc: "hh-no-such-swiftc", platform: "darwin" });
    expect(tools.ffmpeg).toEqual({ ok: false, reason: "ffmpeg not found" });
    expect(tools.avfoundation).toEqual({ ok: false, reason: "swiftc not found" });
    expect(probeTools({ platform: "win32" }).avfoundation).toEqual({ ok: false, reason: "AVFoundation needs macOS" });
  });

  it("refuses a file that does not exist", async () => {
    await expect(analyzeSync(path.join(dir, "missing.mp4"))).rejects.toThrow(/no such file/);
  });
});

describe.skipIf(REASON !== "")(`analyze-sync on ffmpeg fixtures with known offsets${REASON ? ` (SKIPPED: ${REASON})` : ""}`, () => {
  let dir: string;
  const results = new Map<string, Result>();
  const cases = {
    sync: { offsetMs: 0 },
    late20: { offsetMs: 20 },
    early60: { offsetMs: -60 },
    dropped: { offsetMs: 0, dropFrames: [60, 66] as [number, number] },
    // 60 fps for 3 s, then every second frame only: a governor step from the 60 to the 30 fps rung.
    stepped: { offsetMs: 0, fps: 60, rateStep: { from: 180, every: 2 } },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "hh-analyzer-"));
    await Promise.all(
      Object.entries(cases).map(async ([name, fixture]) => {
        const file = makeLabFixture(path.join(dir, `${name}.mp4`), { seconds: 6, fps: 30, ...fixture });
        results.set(name, await analyzeSync(file, { mode: "live", rungFps: 30, profile: "desktop", expectSeconds: 6, tools: TOOLS }));
      }),
    );
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ["sync", 0],
    ["late20", 20],
    ["early60", -60],
    ["dropped", 0],
    ["stepped", 0],
  ] as const)("reads the %s file's offset (%i ms) within 5 ms at every beep", (name, expected) => {
    const result = results.get(name)!;
    const ffmpeg = offsets(result, "ffmpeg");
    expect(ffmpeg).toHaveLength(6);
    for (const value of ffmpeg) expect(Math.abs(value - expected)).toBeLessThanOrEqual(5);
    if (!AVF_REASON) {
      const avf = offsets(result, "avfoundation");
      expect(avf).toHaveLength(6);
      for (const value of avf) expect(Math.abs(value - expected)).toBeLessThanOrEqual(5);
    }
  });

  it("passes the file in sync on every row", () => {
    const result = results.get("sync")!;
    expect(result.rows.filter((r: Row) => r.status === "FAIL")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(row(result.rows, "container").value).toBe("6.000 s");
    expect(row(result.rows, "capture fps").value).toBe("30.0 fps");
    expect(row(result.rows, "largest video gap (ffmpeg)").status).toBe("PASS");
    // The ffmpeg AAC encoder's 1024 priming samples: a player that ignores the edit list plays the sound about 21 ms late.
    const late = row(result.rows, "edit list ignored");
    expect(late.status).toBe("PASS");
    expect(late.value).toMatch(/^\+2[0-2]\.\d ms later$/);
    expect(result.beeps).toHaveLength(6);
  });

  it("passes a sound 20 ms late in live mode (inside BT.1359), and fails it as a synthetic file made in sync", async () => {
    const late = results.get("late20")!;
    expect(row(late.rows, "live A/V, BT.1359 (ffmpeg)").status).toBe("PASS");
    const strict = await analyzeSync(late.file, { mode: "synthetic", expectOffsetMs: 0, tools: TOOLS });
    expect(row(strict.rows, "container A/V (ffmpeg)").status).toBe("FAIL");
    expect(strict.ok).toBe(false);
    const matched = await analyzeSync(late.file, { mode: "synthetic", expectOffsetMs: 20, tools: TOOLS });
    expect(row(matched.rows, "container A/V (ffmpeg)").status).toBe("PASS");
  });

  it("fails a sound 60 ms early: more than the 45 ms lead that BT.1359 allows", () => {
    const early = results.get("early60")!;
    expect(row(early.rows, "live A/V, BT.1359 (ffmpeg)").status).toBe("FAIL");
    if (!AVF_REASON) expect(row(early.rows, "live A/V, BT.1359 (AVFoundation)").status).toBe("FAIL");
    expect(early.ok).toBe(false);
  });

  it("fails the dropped frames as a video gap, and keeps the sync rows green", () => {
    const dropped = results.get("dropped")!;
    const gap = row(dropped.rows, "largest video gap (ffmpeg)");
    expect(gap.status).toBe("FAIL");
    // Frames 60..66 are gone: 1.967 s to 2.233 s.
    expect(gap.value).toMatch(/^266\.\d ms at 1\.967 s$/);
    expect(row(dropped.rows, "live A/V, BT.1359 (ffmpeg)").status).toBe("PASS");
    expect(row(dropped.rows, "capture fps").status).toBe("PASS");
    expect(dropped.ok).toBe(false);
  });

  it("shows a rung step in the file, and judges the capture fps against the given rung, never a fixed 60", async () => {
    const stepped = results.get("stepped")!;
    const rates = row(stepped.rows, "frame rate over time (ffmpeg)");
    expect(rates.status).toBe("INFO");
    expect(rates.value).toBe("60 > 30 fps");
    // The step is at frame 180 (3.000 s): the first 30 fps interval starts there.
    expect(rates.detail).toMatch(/^60 fps 0\.00-3\.0[0-3] s, 30 fps 3\.0[0-3]-5\.97 s$/);
    expect(row(stepped.rows, "largest video gap (ffmpeg)").status).toBe("PASS");
    // 180 + 90 frames in 5.967 s: about 45 fps.
    const judge = async (rungFps: number) => row((await analyzeSync(stepped.file, { mode: "live", rungFps, expectSeconds: 6, tools: TOOLS })).rows, "capture fps");
    const claims60 = await judge(60);
    expect(claims60.status).toBe("FAIL");
    expect(claims60.value).toBe("45.1 fps");
    // Most intervals are 16.7 ms, so the cadence matches 60: the rate change is the clue.
    expect(claims60.detail).toBe("the rate changed in the file: 60 > 30 fps");
    // The time-weighted rung of the file (45 fps) passes, and so does the rung at the end (30).
    expect((await judge(45)).status).toBe("PASS");
    expect((await judge(30)).status).toBe("PASS");
  });

  it.skipIf(AVF_REASON !== "")(`agrees with AVFoundation, the decoder of iPhone Photos${AVF_REASON ? ` (SKIPPED: ${AVF_REASON})` : ""}`, () => {
    for (const result of results.values()) {
      expect(row(result.rows, "decoders agree").status).toBe("PASS");
    }
  });
});
