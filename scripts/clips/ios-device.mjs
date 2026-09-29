#!/usr/bin/env node
/**
 * Clips lab on a real iPhone or iPad over USB (plan 15.1 "Real devices", 15.3).
 *
 * Usage:
 *   node scripts/clips/ios-device.mjs <lab URL> [--flow clip|record] [--udid <UDID>] [--port 4444] [--out <dir>]
 *
 *   <lab URL>  the lab page, for example https://<tunnel>/clips-lab,
 *              https://<tunnel>/clips-lab?gl=2, or a tunnel URL with a
 *              per-session token path before it
 *              (https://<tunnel>/<token>/clips-lab). The server must have
 *              CLIPS_LAB=1. The page must be a SECURE context on the phone
 *              (https, never http://<LAN address>): Safari gives VideoEncoder
 *              and the origin private file system only to secure pages.
 *   --flow     clip (default): play 15 s, then Clip it! for 10 s.
 *              record: Record a video for 20 s.
 *   --udid     the device. Else CLIPS_IOS_UDID, else the first iPhone or
 *              iPad that `xcrun xctrace list devices` (full Xcode) or
 *              `idevice_id -l` (libimobiledevice) lists.
 *
 * What it does: it drives Safari on the device through Apple's safaridriver
 * (WebDriver on 127.0.0.1:<port>; it starts safaridriver when nothing
 * listens there), opens the lab, starts it with a real touch tap (the sound
 * unlock needs a user gesture), waits, makes the clip or the video with the
 * lab's buttons, pulls the file's bytes back through the WebDriver session
 * (base64 chunks from window.__clipsLab.readClipBase64, because a WebDriver
 * result has a size limit and the page's Content Security Policy blocks
 * fetch() of a blob: URL), and runs scripts/clips/analyze-sync.mjs on it
 * with the phone limits (effective frame rate at least 80% of the rung) and
 * the lab's beat log (the ground truth: which beats the file holds, and that
 * it ends at the press). A Record that the io worker stored in parts gets
 * each part pulled and analysed.
 *
 * BEFORE YOU START (one time):
 *   - On the phone: Settings > Apps > Safari > Advanced: turn on
 *     "Web Inspector" AND "Remote Automation". Connect the phone with USB,
 *     unlock it, and tap "Trust" on the phone.
 *   - On this Mac: run `safaridriver --enable` once (it asks for an admin
 *     password).
 *   - Keep the phone unlocked while the script runs. A WebDriver tap that
 *     does not reach the page (plan 3a saw this on some pages) is retried
 *     once; after that the script uses the lab's own action and says so.
 *     A button that is off (a clip is being made, the service is not
 *     ready) is never tapped: a FAIL row gives the lab status instead.
 *
 * Output: one PASS / FAIL / SKIPPED / INFO row per check, then the offset of
 * each beep. The file and a JSON of the lab status and the ground truth go
 * to --out (analyze-sync.mjs --truth reads that JSON again; default: the
 * system temp folder, hh-clips-ios). Exit status: 0 when no row failed
 * (SKIPPED rows never fail: not macOS, no safaridriver, no device), 1 when a
 * row failed, 2 on a usage error.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeSync } from "./analyze-sync.mjs";
import { formatBeepTable, formatRows } from "./lib/sync.mjs";

export const DEFAULT_PORT = 4444;
/** Bytes per chunk pulled through WebDriver (about 700 KB of base64, as in Phase 0). */
export const PULL_CHUNK = 512 * 1024;
export const PLAY_SECONDS = 15;
export const CLIP_SECONDS = 10;
export const RECORD_SECONDS = 20;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/**
 * The connected devices in `xcrun xctrace list devices` output: the lines
 * of the "== Devices ==" section that have an OS version and a UDID. The
 * Mac itself (no version) and every simulator are left out.
 *
 * @returns {Array<{ name: string, os: string, udid: string }>}
 */
export function parseXctraceDevices(text) {
  const devices = [];
  let section = "";
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    const header = /^==\s*(.+?)\s*==$/.exec(line);
    if (header) {
      section = header[1].toLowerCase();
      continue;
    }
    if (section !== "devices" || !line) continue;
    const match = /^(.*\S)\s+\(([\d.]+)\)\s+\(([0-9A-Fa-f][0-9A-Fa-f-]{7,})\)$/.exec(line);
    if (match && !/simulator/i.test(match[1])) devices.push({ name: match[1], os: match[2], udid: match[3] });
  }
  return devices;
}

/** The UDIDs in `idevice_id -l` output (one per line; "(Network)" entries are left out). */
export function parseIdeviceIds(text) {
  return String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[0-9A-Fa-f][0-9A-Fa-f-]{7,}$/.test(line));
}

/** The device to use: the one asked for, else the first iPhone or iPad, else the first device. */
export function pickDevice(devices, wanted) {
  if (wanted) return devices.find((d) => d.udid.toLowerCase() === wanted.toLowerCase()) ?? { name: "the asked device", os: "?", udid: wanted };
  return devices.find((d) => /iphone|ipad/i.test(d.name)) ?? devices[0] ?? null;
}

/** The W3C new-session body for Safari on a USB device. */
export function iosCapabilities(udid) {
  return { capabilities: { alwaysMatch: { platformName: "iOS", browserName: "Safari", "safari:deviceUDID": udid } } };
}

/** [offset, length] ranges that cover `total` bytes in chunks. */
export function chunkRanges(total, chunk = PULL_CHUNK) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(chunk) || chunk <= 0) throw new RangeError("total and chunk must be whole numbers");
  const ranges = [];
  for (let offset = 0; offset < total; offset += chunk) ranges.push([offset, Math.min(chunk, total - offset)]);
  return ranges;
}

/** The W3C actions body for one touch tap at (x, y) in viewport pixels. */
export function tapActions(x, y) {
  return {
    actions: [
      {
        type: "pointer",
        id: "finger",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", duration: 0, x: Math.round(x), y: Math.round(y), origin: "viewport" },
          { type: "pointerDown", button: 0 },
          { type: "pause", duration: 80 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ],
  };
}

export function parseArgs(argv) {
  const options = { url: null, flow: "clip", udid: process.env.CLIPS_IOS_UDID || null, port: DEFAULT_PORT, out: path.join(tmpdir(), "hh-clips-ios") };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--flow") {
      const flow = value();
      if (flow !== "clip" && flow !== "record") throw new Error("--flow is clip or record");
      options.flow = flow;
    } else if (arg === "--udid") options.udid = value();
    else if (arg === "--port") {
      const port = Number(value());
      if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("--port needs a port number");
      options.port = port;
    } else if (arg === "--out") options.out = value();
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else if (options.url === null) options.url = arg;
    else throw new Error(`one URL only (got ${options.url} and ${arg})`);
  }
  if (!options.url) throw new Error("give the lab URL, for example https://<tunnel>/clips-lab");
  let parsed;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new Error(`not a URL: ${options.url}`);
  }
  if (!LAB_PATH.test(parsed.pathname)) throw new Error("the URL must be the lab page, /clips-lab (a tunnel can put a token path before it)");
  return options;
}

/**
 * The lab page path: /clips-lab, or a path that ends in /clips-lab (plan
 * 15.3: a tunnel puts a per-session token path before it, for example
 * /t/<token>/clips-lab).
 */
export const LAB_PATH = /(^|\/)clips-lab\/?$/;

// ---------------------------------------------------------------------------
// WebDriver
// ---------------------------------------------------------------------------

class WebDriver {
  constructor(port) {
    this.base = `http://127.0.0.1:${port}`;
    this.session = null;
  }

  async call(method, route, body) {
    const url = this.session ? `${this.base}/session/${this.session}${route}` : `${this.base}${route}`;
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || (json.value && json.value.error)) {
      const error = new Error(`${json.value?.error ?? response.status}: ${json.value?.message ?? response.statusText}`);
      error.webdriver = json.value?.error ?? null;
      throw error;
    }
    return json.value;
  }

  async start(udid) {
    const value = await this.call("POST", "/session", iosCapabilities(udid));
    this.session = value.sessionId;
    await this.call("POST", "/timeouts", { script: 60_000, pageLoad: 180_000 });
    return value.capabilities ?? {};
  }

  execute(script, args = []) {
    return this.call("POST", "/execute/sync", { script, args });
  }

  /** Runs `body` with the done callback as `done`; the body resolves a promise into done. */
  executeAsync(body, args = []) {
    return this.call("POST", "/execute/async", { script: `const done = arguments[arguments.length - 1]; ${body}`, args });
  }

  async tap(x, y) {
    await this.call("POST", "/actions", tapActions(x, y));
    await this.call("DELETE", "/actions");
  }

  async stop() {
    if (!this.session) return;
    try {
      await this.call("DELETE", "");
    } catch {
      // The session is gone already.
    }
    this.session = null;
  }
}

async function listening(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/status`);
    return true;
  } catch {
    return false;
  }
}

async function ensureSafaridriver(port) {
  if (await listening(port)) return { started: null };
  const child = spawn("safaridriver", ["-p", String(port)], { stdio: "ignore" });
  const failed = await new Promise((resolve) => {
    child.once("error", (error) => resolve(error));
    setTimeout(() => resolve(null), 1500);
  });
  if (failed) return { started: null, error: failed.message };
  for (let i = 0; i < 20 && !(await listening(port)); i++) await new Promise((r) => setTimeout(r, 250));
  return (await listening(port)) ? { started: child } : { started: null, error: "safaridriver did not answer" };
}

function findDevice(wanted) {
  if (wanted) return { device: pickDevice([], wanted), source: "--udid / CLIPS_IOS_UDID" };
  const xctrace = spawnSync("xcrun", ["xctrace", "list", "devices"], { encoding: "utf8" });
  if (!xctrace.error && xctrace.status === 0) {
    const device = pickDevice(parseXctraceDevices(xctrace.stdout));
    if (device) return { device, source: "xcrun xctrace" };
  }
  const idevice = spawnSync("idevice_id", ["-l"], { encoding: "utf8" });
  if (!idevice.error && idevice.status === 0) {
    const ids = parseIdeviceIds(idevice.stdout);
    if (ids.length) return { device: { name: "USB device", os: "?", udid: ids[0] }, source: "idevice_id" };
  }
  return { device: null, source: null };
}

// ---------------------------------------------------------------------------
// The lab flow
// ---------------------------------------------------------------------------

const STATUS_SCRIPT = "return window.__clipsLab ? window.__clipsLab.status() : null;";

async function waitFor(driver, done, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let status = null;
  for (;;) {
    status = await driver.execute(STATUS_SCRIPT);
    if (status && done(status)) return { ok: true, status };
    if (Date.now() >= end) return { ok: false, status };
    await new Promise((r) => setTimeout(r, 500));
  }
}

function describe(status) {
  if (!status) return "no lab on the page";
  return `service ${status.service}, button ${status.button}, engine ${status.engine}, sound ${status.audio}, beeps ${status.beats}, footage ${Number(status.bufferedSec).toFixed(1)} s`;
}

/** Why a lab button is off, from the lab status: the button state, a running action and the last reason. */
export function disabledText(status) {
  if (!status) return "no lab on the page";
  const busy = status.busy ? `, busy (${status.busy})` : "";
  const reason = status.reason ? `, reason ${status.reason}` : "";
  return `button ${status.button}, service ${status.service}${busy}${reason}, recording ${status.recording ? "yes" : "no"}`;
}

/**
 * Finds the lab button with `testId`: null when it is not on the page, else
 * its middle point (viewport pixels) and whether it is disabled.
 */
async function findButton(driver, testId) {
  return driver.execute(
    `const el = document.querySelector('[data-testid="' + arguments[0] + '"]');
     if (!el) return null;
     el.scrollIntoView({ block: "center" });
     const r = el.getBoundingClientRect();
     return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: !!el.disabled };`,
    [testId],
  );
}

/**
 * Taps a lab button, and waits until `reached` says the page saw the tap.
 * - A button that is not on the page, or that is disabled, gives a FAIL row
 *   with the lab status, and no retry and no fallback: the lab would refuse
 *   the action too (a clip while one is being made, a clip before the
 *   service is ready), so a retry only hides the cause.
 * - A tap that does not reach the page (plan 3a saw this in WebDriver) is
 *   tried once more. After that, the lab's own action runs (when `fallback`
 *   names one), and an INFO row says so.
 * Returns true when the action started.
 */
export async function press(driver, rows, testId, reached, fallback, waitMs = 5_000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const point = await findButton(driver, testId);
    if (!point || point.disabled) {
      const status = await driver.execute(STATUS_SCRIPT);
      // A first tap that the page saw late can turn its own button off: that is not a failure.
      if (attempt > 1 && status && reached(status)) return true;
      rows.push({ status: "FAIL", check: `${testId} tap`, value: point ? "the button is off" : "the button is not on the page", limit: "an enabled button", detail: disabledText(status) });
      return false;
    }
    await driver.tap(point.x, point.y);
    const seen = await waitFor(driver, reached, waitMs);
    if (seen.ok) return true;
  }
  if (!fallback) return false;
  rows.push({ status: "INFO", check: `${testId} tap`, value: "the tap did not reach the page", limit: "-", detail: `used window.__clipsLab.${fallback}()` });
  await driver.executeAsync(`window.__clipsLab.${fallback}().then(() => done(true), (e) => done(String(e)));`);
  return true;
}

function check(rows, name, ok, value, limit = "-") {
  rows.push({ status: ok ? "PASS" : "FAIL", check: name, value: String(value), limit });
  return ok;
}

async function runFlow(driver, options, rows) {
  await driver.call("POST", "/url", { url: options.url });
  const secure = await driver.execute("return window.isSecureContext === true;");
  if (!check(rows, "secure page (https)", secure, secure ? "yes" : "no", "yes: VideoEncoder and OPFS need it")) return null;

  const loaded = await waitFor(driver, (s) => s.service !== "loading" && s.picture !== "none", 120_000);
  if (!check(rows, "clip service ready and attached", loaded.status?.service === "ready" && loaded.status.attached, describe(loaded.status), "ready")) return null;

  // Reached = the lab runs. Never tap Start again after that: a second tap is Stop.
  const started = await press(driver, rows, "lab-start", (s) => s.running, null);
  const sound = await waitFor(driver, (s) => s.audio === "running", 10_000);
  if (!check(rows, "game sound runs after a real tap", started && sound.ok, sound.status?.audio ?? "none", "running")) return null;
  const beatsAtStart = sound.status.beats;

  let seconds;
  let before;
  if (options.flow === "clip") {
    seconds = CLIP_SECONDS;
    const played = await waitFor(driver, (s) => s.beats >= beatsAtStart + PLAY_SECONDS && s.bufferedSec >= CLIP_SECONDS + 1 && s.button === "ready", (PLAY_SECONDS + 60) * 1000);
    check(rows, `played ${PLAY_SECONDS} s`, played.ok, describe(played.status), `>= ${PLAY_SECONDS} beeps, >= ${CLIP_SECONDS + 1} s of footage`);
    rows.push({ status: "INFO", check: "display", value: `${played.status?.displayHz ?? "?"} Hz, flash ${played.status?.holdFrames ?? "?"} frames, tier ${played.status?.tier ?? "?"}`, limit: "-" });
    before = played.status?.results ?? 0;
    if (!(await press(driver, rows, "lab-clip", (s) => s.busy !== null || s.results > before, "clip"))) return null;
  } else {
    seconds = RECORD_SECONDS;
    const warm = await waitFor(driver, (s) => s.button === "ready", 60_000);
    check(rows, "clip button ready", warm.ok, describe(warm.status), "ready");
    before = warm.status?.results ?? 0;
    if (!(await press(driver, rows, "lab-record-start", (s) => s.recording, "recordStart"))) return null;
    const recording = await waitFor(driver, (s) => s.recording, 10_000);
    if (!check(rows, "recording started", recording.ok, describe(recording.status), "recording")) return null;
    const from = recording.status.beats;
    const recorded = await waitFor(driver, (s) => s.beats >= from + RECORD_SECONDS, (RECORD_SECONDS + 30) * 1000);
    check(rows, `recorded ${RECORD_SECONDS} s`, recorded.ok, `${(recorded.status?.beats ?? 0) - from} beeps`, `>= ${RECORD_SECONDS}`);
    if (!(await press(driver, rows, "lab-record-stop", (s) => !s.recording, "recordStop"))) return null;
  }

  const made = await waitFor(driver, (s) => s.results > before && s.busy === null, 120_000);
  const last = made.status?.lastClip ?? null;
  if (!check(rows, options.flow === "clip" ? "clip made" : "video made", made.ok && last !== null && made.status.lastError === null, last ? `${last.bytes} bytes` : `failed: ${made.status?.lastError ?? "no result"}`)) return null;
  const record = last.record;
  check(rows, "library row has game sound", record.hasAudio, String(record.hasAudio), "true");
  rows.push({ status: "INFO", check: "library row", value: `${record.kind}, ${record.width}x${record.height}, ${record.fps} fps, ${(record.durationMs / 1000).toFixed(2)} s`, limit: "-" });

  // A Record can be stored in parts (plan 8.3): every part is pulled and analysed.
  const parts = Array.isArray(last.parts) && last.parts.length ? last.parts : [record];
  if (parts.length > 1) rows.push({ status: "INFO", check: "parts", value: `${parts.length} parts`, limit: "-", detail: "the io worker stored the recording in parts; each part is analysed" });
  if (last.failedParts > 0) check(rows, "every part stored", false, `${last.failedParts} parts not stored`, "0");
  const beats = await driver.execute("return window.__clipsLab.truth();");
  mkdirSync(options.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const files = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const prefix = parts.length > 1 ? `part ${index + 1}` : "file";
    const chunks = [];
    for (const [offset, length] of chunkRanges(part.bytes)) {
      const text = await driver.executeAsync(
        "window.__clipsLab.readClipBase64(arguments[0], arguments[1], arguments[2]).then(done, (e) => done({ error: String(e) }));",
        [offset, length, index],
      );
      if (typeof text !== "string") throw new Error(`reading ${prefix} failed at byte ${offset}: ${text?.error ?? "no data"}`);
      chunks.push(Buffer.from(text, "base64"));
    }
    const bytes = Buffer.concat(chunks);
    check(rows, `${prefix}: pulled bytes match the row`, bytes.length === part.bytes, `${bytes.length} bytes`, `${part.bytes} bytes`);
    const name = `ios-${options.flow}-${stamp}${parts.length > 1 ? `-part${index + 1}` : ""}`;
    const file = path.join(options.out, `${name}.mp4`);
    writeFileSync(file, bytes);
    // The ground truth: which beats the file holds, and (for the last part) that it ends at the press.
    const truth = { beats, endMs: index === parts.length - 1 ? last.pressedAtMs : null, displayHz: made.status.displayHz, maxStride: made.status.maxStride };
    writeFileSync(path.join(options.out, `${name}.json`), JSON.stringify({ status: made.status, truth }, null, 1));
    rows.push({ status: "INFO", check: `${prefix}: file`, value: file, limit: "-" });
    files.push({ file, record: part, prefix, truth });
  }
  return { files, seconds };
}

/** One line: WebDriver errors from safaridriver can span several lines. */
function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

/** Runs the whole check and gives the rows and the beep table. It never exits the process, so the cleanup always runs. */
async function run(options) {
  const rows = [];
  if (process.platform !== "darwin") {
    rows.push({ status: "SKIPPED", check: "iOS device (safaridriver)", value: "-", limit: "-", detail: "safaridriver needs macOS" });
    return { rows, beeps: "" };
  }
  const { device, source } = findDevice(options.udid);
  if (!device) {
    rows.push({ status: "SKIPPED", check: "iOS device", value: "-", limit: "-", detail: "no iPhone or iPad on USB (xcrun xctrace and idevice_id found none; give --udid)" });
    return { rows, beeps: "" };
  }
  rows.push({ status: "INFO", check: "device", value: `${device.name} (${device.os})`, limit: "-", detail: `from ${source}` });

  const server = await ensureSafaridriver(options.port);
  if (server.error) {
    rows.push({ status: "SKIPPED", check: "safaridriver", value: "-", limit: "-", detail: `${oneLine(server.error)} (run safaridriver --enable once)` });
    return { rows, beeps: "" };
  }
  const driver = new WebDriver(options.port);
  let beeps = "";
  try {
    let caps = null;
    try {
      caps = await driver.start(device.udid);
    } catch (error) {
      check(rows, "WebDriver session on the device", false, oneLine(error.message), "Web Inspector and Remote Automation on, phone unlocked and trusted");
    }
    if (caps) {
      rows.push({ status: "INFO", check: "Safari", value: `${caps.browserVersion ?? "?"} on ${caps.platformName ?? "iOS"}`, limit: "-" });
      const made = await runFlow(driver, options, rows);
      if (made) {
        const single = made.files.length === 1;
        let total = 0;
        for (const { file, record, prefix, truth } of made.files) {
          const result = await analyzeSync(file, { mode: "live", rungFps: record.fps || null, profile: "phone", expectSeconds: single ? made.seconds : null, truth });
          for (const r of result.rows) rows.push({ ...r, check: `${prefix}: ${r.check}` });
          beeps += `${single ? "" : `${prefix}:\n`}${formatBeepTable(result.beeps)}\n`;
          total += result.measure.container?.durationSec ?? record.durationMs / 1000;
        }
        // The parts together are the recording (plan 6.6 limits for the length).
        if (!single) check(rows, "length of all parts", total >= made.seconds - 1 && total <= made.seconds + 1.2, `${total.toFixed(2)} s`, `${(made.seconds - 1).toFixed(1)}..${(made.seconds + 1.2).toFixed(1)} s`);
      }
    }
  } catch (error) {
    check(rows, "lab flow", false, oneLine(error.message));
  } finally {
    await driver.stop();
    // Stopping safaridriver also stops its WebDriver HTTP service.
    server.started?.kill();
  }
  return { rows, beeps };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ios-device: ${error.message}\nUsage: node scripts/clips/ios-device.mjs <https://.../clips-lab> [--flow clip|record] [--udid UDID] [--port 4444] [--out DIR]`);
    process.exitCode = 2;
    return;
  }
  const { rows, beeps } = await run(options);
  console.log(formatRows(rows, `clips lab on iOS (${options.flow})`));
  if (beeps) console.log(`\nPer beep (sound minus picture):\n${beeps}`);
  process.exitCode = rows.some((r) => r.status === "FAIL") ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ios-device: ${error.stack || error}`);
    process.exit(2);
  });
}
