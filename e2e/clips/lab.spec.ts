/**
 * Clips lab end-to-end A/V checks (plan 15.2, 15.3).
 *
 * Each test opens /clips-lab in Chrome, starts the lab with a real click
 * (the sound unlock needs a real user gesture), makes a file with the real
 * clip service, pulls the file's bytes out of the page, and runs the A/V
 * analyzer (scripts/clips/analyze-sync.mjs) on it:
 *   1. 2D canvas (capture path P): play 15 s, then Clip it! for 10 s.
 *   2. WebGL2 canvas (?gl=2, capture path E): the same.
 *   3. 2D canvas: Record a video for 20 s.
 * Every test prints one PASS / FAIL / SKIPPED / INFO row per check, then the
 * offset of each beep. The INFO rows "CPU pressure" and "frame rate over
 * time" show why the capture rung changed: a busy machine makes the
 * governor step down (plan 7), and the capture fps row then judges the file
 * against the rung that the library row gives. A missing tool (the
 * browser, ffmpeg, swiftc) gives a SKIPPED row and never fails the run. Any
 * FAIL row fails the test.
 */
import { cpus, loadavg } from "node:os";

import { expect, test } from "playwright/test";

import {
  analyzeFile,
  describeStatus,
  keep,
  labStatus,
  launchLabBrowser,
  pageNow,
  pressureTimeline,
  pullClip,
  readPressure,
  waitForStatus,
  watchPressure,
  type LabStatus,
} from "./lib/lab";
import { RowReport } from "./lib/report";

const PLAY_SECONDS = 15;
const CLIP_SECONDS = 10;
const RECORD_SECONDS = 20;

interface Flow {
  name: string;
  slug: string;
  query: string;
  picture: "2d" | "webgl2";
  action: "clip" | "record";
}

/** The machine load: the governor rests capture when the game loses frames, so a busy machine can fail the timing rows. */
function noteLoad(report: RowReport, when: string): void {
  const load = loadavg()[0];
  const cores = cpus().length;
  report.info(`machine load ${when}`, `${load.toFixed(1)} (1 min), ${cores} cores`, load > cores ? "busy: frame-rate and resting rows can fail from the load, not from clips" : undefined);
}

async function runLab(flow: Flow, baseURL: string): Promise<{ report: RowReport; beeps: string }> {
  const report = new RowReport(flow.name);
  let beeps = "";
  noteLoad(report, "at the start");
  const browser = await launchLabBrowser(report);
  if (!browser) return { report, beeps };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(`${baseURL}/clips-lab${flow.query}`, { timeout: 240_000 });
    const code = response?.status() ?? 0;
    if (!report.check("lab page answers", code === 200, `status ${code}`, "200 (the server needs CLIPS_LAB=1)")) return { report, beeps };

    const loaded = await waitForStatus(page, (s) => s.service !== "loading" && s.picture !== "none", 120_000);
    report.check("lab picture", loaded.status?.picture === flow.picture, loaded.status?.picture ?? "none", flow.picture);
    if (
      !report.check(
        "clip service ready and attached",
        loaded.status?.service === "ready" && loaded.status.attached,
        describeStatus(loaded.status),
        "ready (CLIPS_MODE=on, and a build with the clip service)",
      )
    ) {
      return { report, beeps };
    }

    // The governor reads Compute Pressure (plan 7): watch it too, so a rung step has its cause in the report.
    const watching = await watchPressure(page);

    // A real click: the lab starts the game-audio bus inside it.
    await page.getByTestId("lab-start").click();
    const zeroMs = await pageNow(page);
    let recordAtSec: number | null = null;
    const sound = await waitForStatus(page, (s) => s.audio === "running" && s.running, 15_000);
    if (!report.check("game sound runs after a real click", sound.ok, sound.status?.audio ?? "none", "running")) return { report, beeps };
    const started = sound.status as LabStatus;
    // Capture starts when the engine is ready (flag, service, capability probe, encoder).
    const clickedAt = Date.now();
    const footage = await waitForStatus(page, (s) => s.bufferedSec > 0, 30_000);
    report.info("first footage after Start", footage.ok ? `${((Date.now() - clickedAt) / 1000).toFixed(1)} s` : "none in 30 s", "includes the capability probe and the encoder start; not the plan 15.2 TTFC measure");

    let seconds: number;
    let before: number;
    if (flow.action === "clip") {
      seconds = CLIP_SECONDS;
      // Play 15 s, and at least long enough that the ring holds the whole clip (a clip starts at a keyframe up to 1 s earlier).
      const played = await waitForStatus(
        page,
        (s) => s.beats >= started.beats + PLAY_SECONDS && s.bufferedSec >= CLIP_SECONDS + 1 && s.button === "ready",
        (PLAY_SECONDS + 45) * 1000,
      );
      report.check(`played ${PLAY_SECONDS} s`, played.ok, describeStatus(played.status), `>= ${PLAY_SECONDS} beeps, >= ${CLIP_SECONDS + 1} s of footage, clip button ready`);
      report.info("display", `${played.status?.displayHz ?? "?"} Hz, flash ${played.status?.holdFrames ?? "?"} frames, target ${played.status?.targetFps ?? "?"} fps, tier ${played.status?.tier ?? "?"}`);
      before = played.status?.results ?? 0;
      await page.getByTestId("lab-clip").click();
    } else {
      seconds = RECORD_SECONDS;
      const warm = await waitForStatus(page, (s) => s.button === "ready", 45_000);
      report.check("clip button ready", warm.ok, describeStatus(warm.status), "ready");
      report.info("display", `${warm.status?.displayHz ?? "?"} Hz, flash ${warm.status?.holdFrames ?? "?"} frames, target ${warm.status?.targetFps ?? "?"} fps, tier ${warm.status?.tier ?? "?"}`);
      before = warm.status?.results ?? 0;
      recordAtSec = ((await pageNow(page)) - zeroMs) / 1000;
      await page.getByTestId("lab-record-start").click();
      const recording = await waitForStatus(page, (s) => s.recording, 15_000);
      if (!report.check("recording started", recording.ok, describeStatus(recording.status), "recording")) return { report, beeps };
      const from = recording.status?.beats ?? 0;
      const recorded = await waitForStatus(page, (s) => s.beats >= from + RECORD_SECONDS, (RECORD_SECONDS + 30) * 1000);
      report.check(`recorded ${RECORD_SECONDS} s`, recorded.ok, `${(recorded.status?.beats ?? 0) - from} beeps`, `>= ${RECORD_SECONDS}`);
      await page.getByTestId("lab-record-stop").click();
    }

    const made = await waitForStatus(page, (s) => s.results > before && s.busy === null, 90_000);
    const last = made.status?.lastClip ?? null;
    const madeName = flow.action === "clip" ? "clip made" : "video made";
    if (!report.check(madeName, made.ok && last !== null && made.status?.lastError === null, last ? `${last.bytes} bytes` : `failed: ${made.status?.lastError ?? "no result"}`)) {
      return { report, beeps };
    }
    const record = last!.record;
    report.check("library row kind", record.kind === (flow.action === "clip" ? "clip" : "record"), record.kind);
    report.check("library row type", record.mime === "video/mp4", record.mime, "video/mp4");
    report.check("library row has game sound", record.hasAudio, String(record.hasAudio), "true");
    report.info("library row", `${record.width}x${record.height}, ${record.fps} fps, ${(record.durationMs / 1000).toFixed(2)} s, ${record.bytes} bytes`);
    // The value names the changes that the governor acts on; the detail lists every change.
    const readings = watching ? await readPressure(page) : null;
    const pressure = readings ? await pressureTimeline(readings, zeroMs) : null;
    const recordText = recordAtSec === null ? "" : `, Record at +${recordAtSec.toFixed(1)} s`;
    report.info(
      "CPU pressure (Compute Pressure)",
      pressure ? pressure.value : "not in this browser",
      pressure
        ? `serious steps the capture rung down, critical rests capture (plan 7); times from Start${recordText}; all changes: ${pressure.all}`
        : "the governor has no pressure signal here",
    );

    const bytes = await pullClip(page, last!.bytes);
    report.check("pulled bytes match the file and the row", bytes.length === last!.bytes && bytes.length === record.bytes, `${bytes.length} bytes`, `${record.bytes} bytes`);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = keep(`${flow.slug}-${stamp}.mp4`, bytes);
    report.info("file", file);
    const truth = await page.evaluate(() => (window as unknown as { __clipsLab: { truth(): unknown[] } }).__clipsLab.truth());
    keep(`${flow.slug}-${stamp}.json`, JSON.stringify({ status: await labStatus(page), truth }, null, 1));

    const result = await analyzeFile(file, { mode: "live", rungFps: record.fps || null, profile: "desktop", expectSeconds: seconds });
    report.add(result.rows, "file");
    beeps = result.beepText;
    report.check("no page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "none", "none");
  } finally {
    noteLoad(report, "at the end");
    await browser.close();
  }
  return { report, beeps };
}

function publish(report: RowReport, beeps: string): void {
  const text = beeps ? `${report.text()}\n\nPer beep (sound minus picture):\n${beeps}` : report.text();
  console.log(`\n${text}\n`);
  void test.info().attach("rows", { body: text, contentType: "text/plain" });
  const skipped = report.rows.find((row) => row.status === "SKIPPED" && row.check.startsWith("browser"));
  test.skip(Boolean(skipped) && report.failures().length === 0, typeof skipped?.detail === "string" ? skipped.detail : "a tool is missing");
  expect(report.failures(), text).toEqual([]);
}

test("2D canvas (path P): play 15 s, Clip it! 10 s, A/V in sync", async ({ baseURL }) => {
  const { report, beeps } = await runLab({ name: "clips lab, 2D canvas, Clip it!", slug: "lab-2d-clip", query: "", picture: "2d", action: "clip" }, baseURL!);
  publish(report, beeps);
});

test("WebGL2 canvas (path E, ?gl=2): play 15 s, Clip it! 10 s, A/V in sync", async ({ baseURL }) => {
  const { report, beeps } = await runLab({ name: "clips lab, WebGL2 canvas, Clip it!", slug: "lab-gl2-clip", query: "?gl=2", picture: "webgl2", action: "clip" }, baseURL!);
  publish(report, beeps);
});

test("2D canvas: Record a video for 20 s, A/V in sync", async ({ baseURL }) => {
  const { report, beeps } = await runLab({ name: "clips lab, 2D canvas, Record a video", slug: "lab-2d-record", query: "", picture: "2d", action: "record" }, baseURL!);
  publish(report, beeps);
});
