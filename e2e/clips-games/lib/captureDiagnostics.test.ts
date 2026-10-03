import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserContext, Page, TestInfo } from "playwright/test";
import { captureDiagnostics } from "./captureDiagnostics";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./captureDiagnostics.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function harness() {
  type Callback = (...values: unknown[]) => unknown;
  class Encoder {
    static isConfigSupported = async () => ({ supported: true });
    encodeQueueSize = 2;
    configured: unknown;
    constructor(readonly init: Record<string, Callback>) {}
    configure(config: unknown) { this.configured = config; }
    encode(frame: unknown) {
      if (frame === "bad") throw new TypeError("private content must never appear");
      this.init.output(frame, {});
      return frame;
    }
    flush() { return Promise.resolve(); }
    close() {}
    reset() {}
  }
  class Context {
    constructor(readonly canvas: { width: number; height: number }) {}
    fillRect() { return 17; }
    drawImage() { return 23; }
  }
  const timers: Array<() => void> = [];
  let raf: ((time: number) => void) | undefined;
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  const sandbox = {
    exports, require: createRequire(import.meta.url), performance: { now: () => 100 }, Promise,
    setInterval: (callback: () => void) => { timers.push(callback); return 1; },
    requestAnimationFrame: (callback: (time: number) => void) => { raf = callback; return 42; },
    VideoEncoder: Encoder,
    CanvasRenderingContext2D: Context,
    __hhCaptureDiagnostics: undefined as unknown as { read(): { latest: { codecs: Array<{ counts: Record<string, number>; errors: Record<string, number>; config: unknown; installedBeforeConstruction: boolean }>; canvases: Array<{ draws: Record<string, number>; width: number; height: number }>; rafDelivered: number }; samples: unknown[] } },
  };
  runInNewContext(compiled, sandbox);
  return { sandbox, install: () => exports.installCaptureDiagnosticsInRealm(), timers, fireRaf: () => raf?.(16), Encoder, Context };
}

test("codec wrappers preserve native behavior and only retain allowlisted diagnostics", async () => {
  const h = harness();
  h.install();
  let delivered = 0;
  const encoder = new h.sandbox.VideoEncoder({ output: () => { delivered++; }, error: () => {} });
  assert.ok(encoder instanceof h.Encoder);
  const config = { codec: "avc1.42e01e", width: 720, height: 1280, privateName: "private content must never appear" };
  encoder.configure(config);
  assert.equal(encoder.configured, config);
  const frame = { timestamp: 3000 };
  assert.equal(encoder.encode(frame), frame);
  assert.equal(delivered, 1);
  assert.throws(() => encoder.encode("bad"), TypeError);
  await encoder.flush();
  await h.sandbox.VideoEncoder.isConfigSupported();
  await Promise.resolve();
  const data = h.sandbox.__hhCaptureDiagnostics.read();
  const row = data.latest.codecs.find((r) => r.counts.configure === 1)!;
  assert.equal(row.counts.encode, 2);
  assert.equal(row.counts.output, 1);
  assert.equal(row.errors.TypeError, 1);
  assert.equal(row.counts.flushResolved, 1);
  assert.equal(row.installedBeforeConstruction, true);
  assert.equal(JSON.stringify(data).includes("private content"), false);
  assert.equal(JSON.stringify(data).includes("privateName"), false);
});

test("late installation counts existing contexts and encoders without obtaining a canvas context", () => {
  const h = harness();
  const encoder = new h.Encoder({ output: () => {}, error: () => {} });
  const context = new h.Context({ width: 400, height: 300 });
  h.install();
  assert.equal(context.fillRect(), 17);
  encoder.configure({ codec: "avc1.42e01e" });
  const data = h.sandbox.__hhCaptureDiagnostics.read();
  assert.equal(data.latest.canvases[0].width, 400);
  assert.equal(data.latest.canvases[0].height, 300);
  assert.equal(data.latest.canvases[0].draws.fillRect, 1);
  assert.equal(data.latest.codecs.find((r) => r.counts.configure)?.installedBeforeConstruction, false);
});

test("rAF callbacks keep their native ID and timing; samples stay bounded", () => {
  const h = harness();
  h.install();
  let timestamp = 0;
  assert.equal(h.sandbox.requestAnimationFrame((time) => { timestamp = time; }), 42);
  h.fireRaf();
  assert.equal(timestamp, 16);
  for (let n = 0; n < 200; n++) h.timers[0]();
  const data = h.sandbox.__hhCaptureDiagnostics.read();
  assert.equal(data.latest.rafDelivered, 1);
  assert.equal(data.samples.length, 180);
  h.install();
  assert.equal(h.timers.length, 1);
});


test("persists a readable JSON file even with a list-only Playwright reporter", async () => {
  const previous = process.env.E2E_DIAGNOSTICS;
  process.env.E2E_DIAGNOSTICS = "1";
  const directory = mkdtempSync(path.join(tmpdir(), "capture-diagnostics-"));
  const artifact = path.join(directory, "capture-diagnostics.json");
  let attached: unknown;
  try {
    const context = { addInitScript: async () => {}, on: () => {} } as unknown as BrowserContext;
    const save = await captureDiagnostics(context);
    const page = { frames: () => [{ evaluate: async () => ({ latest: { rafDelivered: 12 } }) }] } as unknown as Page;
    const info = { outputPath: () => artifact, attach: async (_name: string, options: unknown) => { attached = options; } } as unknown as TestInfo;
    await save(page, info);
    const written = JSON.parse(readFileSync(artifact, "utf8"));
    assert.equal(written.frames[0].latest.rafDelivered, 12);
    assert.deepEqual(attached, { path: artifact, contentType: "application/json" });
  } finally {
    if (previous === undefined) delete process.env.E2E_DIAGNOSTICS;
    else process.env.E2E_DIAGNOSTICS = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
