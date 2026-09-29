/**
 * Drives the clips lab page (/clips-lab) in a browser for the E2E specs.
 *
 * - launchLabBrowser: Chrome with sound allowed to start without a gesture
 *   (the spec still starts it with a real click). A browser that is not
 *   installed gives a SKIPPED row, never a failure.
 * - labStatus / waitForStatus: read window.__clipsLab (labHandle.ts).
 * - pullClip: reads the last clip's bytes in base64 chunks. The page's
 *   Content Security Policy blocks fetch() of a blob: URL, so the bytes come
 *   through window.__clipsLab.readClipBase64.
 * - analyzeFile: runs scripts/clips/analyze-sync.mjs on the pulled file.
 * - watchPressure / readPressure: the Compute Pressure that the governor
 *   reads (plan 7), so a rung step in a file has its cause in the report.
 *
 * Environment:
 *   CLIPS_E2E_CHANNEL  "chrome" (default, branded Chrome), "msedge", or
 *                      "chromium" (the browser that Playwright downloads)
 *   CLIPS_E2E_HEADED   "1" shows the browser window
 *   CLIPS_E2E_AUDIBLE  "1" plays the beeps on the speakers. By default
 *                      Playwright starts Chrome with --mute-audio, which
 *                      mutes the output only: the clip tap is before it.
 *   CLIPS_E2E_OUT      where the pulled clips and JSON go (default: the
 *                      system temp folder, hh-clips-e2e)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "playwright/test";

import type { ClipsLabHandle, LabStatus } from "../../../apps/web/src/shared/clips/lab/labHandle";
import type { Row, RowReport } from "./report";

export type { LabStatus };

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const OUT_DIR = process.env.CLIPS_E2E_OUT ?? path.join(tmpdir(), "hh-clips-e2e");

/** Bytes per read of window.__clipsLab.readClipBase64 (the lab allows up to 4 MB). */
export const PULL_CHUNK = 2 * 1024 * 1024;

const MISSING_BROWSER = /Executable doesn't exist|is not found|is not installed|Looks like Playwright|No such file/i;

/** Launches the browser, or gives a SKIPPED row (browser not installed) and null. */
export async function launchLabBrowser(report: RowReport): Promise<Browser | null> {
  const channel = process.env.CLIPS_E2E_CHANNEL ?? "chrome";
  try {
    const browser = await chromium.launch({
      channel: channel === "chromium" ? undefined : channel,
      headless: process.env.CLIPS_E2E_HEADED !== "1",
      args: ["--autoplay-policy=no-user-gesture-required"],
      ignoreDefaultArgs: process.env.CLIPS_E2E_AUDIBLE === "1" ? ["--mute-audio"] : [],
    });
    report.info("browser", `${channel} ${browser.version()}`, process.env.CLIPS_E2E_AUDIBLE === "1" ? "audible" : "output muted (--mute-audio)");
    return browser;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (MISSING_BROWSER.test(message)) {
      report.skipped(`browser (${channel})`, `${channel} is not installed here (set CLIPS_E2E_CHANNEL=chromium and run npx playwright install chromium)`);
      return null;
    }
    report.check(`browser (${channel}) starts`, false, message.split("\n")[0]);
    return null;
  }
}

/** The lab's status, or null when the page has no lab hook (404, a crash, another page). */
export async function labStatus(page: Page): Promise<LabStatus | null> {
  return page.evaluate(() => {
    const lab = (window as unknown as { __clipsLab?: ClipsLabHandle }).__clipsLab;
    return lab ? lab.status() : null;
  });
}

/**
 * Polls the lab status until `done` says yes or the time runs out. It gives
 * the last status either way, so the caller can make a row that shows it.
 */
export async function waitForStatus(page: Page, done: (status: LabStatus) => boolean, timeoutMs: number): Promise<{ ok: boolean; status: LabStatus | null }> {
  const end = Date.now() + timeoutMs;
  let status: LabStatus | null = null;
  for (;;) {
    status = await labStatus(page);
    if (status && done(status)) return { ok: true, status };
    if (Date.now() >= end) return { ok: false, status };
    await page.waitForTimeout(250);
  }
}

/** One Compute Pressure reading: page time (performance.now(), ms) and the state. */
export interface PressureReading {
  atMs: number;
  state: string;
}

/**
 * Starts a Compute Pressure ("cpu") watch in the page. The clip governor
 * reads the same pressure: "serious" steps the capture rung down one step,
 * "critical" rests capture (plan 7). The readings go to
 * window.__hhPressure. Gives false when the browser has no PressureObserver
 * (Safari, Firefox) or refuses the watch.
 */
export async function watchPressure(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    interface PressureRecordLike {
      state: string;
      time: number;
    }
    type ObserverCtor = new (callback: (records: PressureRecordLike[]) => void) => {
      observe(source: "cpu", options?: { sampleInterval?: number }): Promise<void>;
    };
    const w = window as unknown as { PressureObserver?: ObserverCtor; __hhPressure?: Array<{ atMs: number; state: string }> };
    if (typeof w.PressureObserver !== "function") return false;
    const readings: Array<{ atMs: number; state: string }> = [];
    try {
      const observer = new w.PressureObserver((records) => {
        for (const record of records) readings.push({ atMs: record.time, state: record.state });
      });
      await observer.observe("cpu", { sampleInterval: 500 });
    } catch {
      return false;
    }
    w.__hhPressure = readings;
    return true;
  });
}

/** The readings of watchPressure so far, or null when no watch runs. */
export async function readPressure(page: Page): Promise<PressureReading[] | null> {
  return page.evaluate(() => {
    const readings = (window as unknown as { __hhPressure?: Array<{ atMs: number; state: string }> }).__hhPressure;
    return readings ? readings.slice() : null;
  });
}

/** The page's performance.now() (ms), for times relative to a step of the flow. */
export async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** Reads the last clip of the lab, byte for byte. */
export async function pullClip(page: Page, bytes: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < bytes; offset += PULL_CHUNK) {
    const text = await page.evaluate(
      ({ offset, length }) => (window as unknown as { __clipsLab: ClipsLabHandle }).__clipsLab.readClipBase64(offset, length),
      { offset, length: PULL_CHUNK },
    );
    parts.push(Buffer.from(text, "base64"));
  }
  return Buffer.concat(parts);
}

/** Writes `data` to OUT_DIR/name and gives the path. */
export function keep(name: string, data: Buffer | string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  writeFileSync(file, data);
  return file;
}

export interface AnalyzerResult {
  file: string;
  ok: boolean;
  rows: Row[];
  beeps: unknown[];
  measure: unknown;
}

interface AnalyzerModule {
  analyzeSync(file: string, options: Record<string, unknown>): Promise<AnalyzerResult>;
}

interface SyncModule {
  formatBeepTable(table: unknown[]): string;
}

/** Runs the A/V analyzer (scripts/clips/analyze-sync.mjs) on a pulled file. */
export async function analyzeFile(file: string, options: Record<string, unknown>): Promise<AnalyzerResult & { beepText: string }> {
  const analyzer = (await import(pathToFileURL(path.join(REPO_ROOT, "scripts/clips/analyze-sync.mjs")).href)) as AnalyzerModule;
  const sync = (await import(pathToFileURL(path.join(REPO_ROOT, "scripts/clips/lib/sync.mjs")).href)) as SyncModule;
  const result = await analyzer.analyzeSync(file, options);
  return { ...result, beepText: sync.formatBeepTable(result.beeps) };
}

export interface PressureTimeline {
  value: string;
  changes: Array<{ atSec: number; state: string }>;
  worst: string | null;
}

interface PressureModule {
  pressureTimeline(readings: PressureReading[], zeroMs: number): PressureTimeline;
}

/** The pressure changes, with times in seconds from zeroMs (scripts/clips/lib/pressure.mjs). */
export async function pressureTimeline(readings: PressureReading[], zeroMs: number): Promise<PressureTimeline> {
  const pressure = (await import(pathToFileURL(path.join(REPO_ROOT, "scripts/clips/lib/pressure.mjs")).href)) as PressureModule;
  return pressure.pressureTimeline(readings, zeroMs);
}

/** A short text of a status for a row value. */
export function describeStatus(status: LabStatus | null): string {
  if (!status) return "no lab on the page";
  return `service ${status.service}, button ${status.button}, engine ${status.engine}, sound ${status.audio}, beeps ${status.beats}, footage ${status.bufferedSec.toFixed(1)} s`;
}
