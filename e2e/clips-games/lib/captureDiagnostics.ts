import { writeFile } from "node:fs/promises";
import type { BrowserContext, Page, TestInfo, Worker } from "playwright/test";

/** Optional observer only. Never reads pixels, names, URLs, input, or media bytes. */
export function installCaptureDiagnosticsInRealm(): void {
  const realm = globalThis as unknown as Record<string | symbol, unknown>;
  const key = "__hhCaptureDiagnostics";
  if (realm[key]) return;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
  const code = (error: unknown): string => {
    const name = (error as { name?: unknown } | null)?.name;
    return typeof name === "string" && /^(Error|TypeError|RangeError|NotSupportedError|InvalidStateError|OperationError|EncodingError|DataError|AbortError|SecurityError|QuotaExceededError|NotAllowedError)$/.test(name) ? name : "other";
  };
  type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;
  type Counts = Record<string, number>;
  type CodecRow = {
    kind: string; installedBeforeConstruction: boolean; createdMs: number;
    counts: Counts; lastMs: Counts; errors: Counts; config: Record<string, number | string | null>;
    maxQueue: number; lastTimestamp: number | null;
  };
  const codecs: CodecRow[] = [];
  const codecInstances = new WeakMap<object, CodecRow>();
  const failures: Counts = {};
  const bump = (row: CodecRow, event: string) => {
    row.counts[event] = (row.counts[event] ?? 0) + 1;
    row.lastMs[event] = elapsed();
  };
  const error = (row: CodecRow, value: unknown) => {
    const name = code(value);
    row.errors[name] = (row.errors[name] ?? 0) + 1;
    bump(row, "error");
  };
  const makeCodec = (kind: string, early: boolean): CodecRow => {
    const row: CodecRow = { kind, installedBeforeConstruction: early, createdMs: elapsed(), counts: {}, lastMs: {}, errors: {}, config: {}, maxQueue: 0, lastTimestamp: null };
    if (codecs.length < 64) codecs.push(row);
    return row;
  };
  function patch(target: Record<string, unknown>, name: string, observe: (receiver: unknown, args: unknown[]) => void) {
    const original = target[name];
    if (typeof original !== "function") return;
    try {
      target[name] = function (this: unknown, ...args: unknown[]) {
        try { observe(this, args); } catch { failures.observer = (failures.observer ?? 0) + 1; }
        return (original as AnyFunction).apply(this, args);
      };
    } catch { failures.patch = (failures.patch ?? 0) + 1; }
  }
  for (const kind of ["VideoEncoder", "AudioEncoder"]) {
    const Native = realm[kind];
    if (typeof Native !== "function") continue;
    const proto = Native.prototype as Record<string, unknown>;
    const rowFor = (instance: object) => {
      let row = codecInstances.get(instance);
      if (!row) { row = makeCodec(kind, false); codecInstances.set(instance, row); }
      return row;
    };
    for (const method of ["configure", "encode", "flush", "reset", "close"]) {
      const original = proto[method];
      if (typeof original !== "function") continue;
      proto[method] = function (this: object, ...args: unknown[]) {
        const row = rowFor(this);
        bump(row, method);
        if (method === "configure") {
          const config = args[0] as Record<string, unknown>;
          const codec = typeof config?.codec === "string" ? config.codec : "";
          row.config = { codec: /^(avc1|avc3)/.test(codec) ? "avc" : /^(vp8|vp09|av01|mp4a|opus)/.exec(codec)?.[0] ?? "other" };
          for (const field of ["width", "height", "bitrate", "framerate", "sampleRate", "numberOfChannels"]) row.config[field] = number(config?.[field]);
        }
        if (method === "encode") {
          row.maxQueue = Math.max(row.maxQueue, number((this as { encodeQueueSize?: number }).encodeQueueSize) ?? 0);
          row.lastTimestamp = number((args[0] as { timestamp?: number } | null)?.timestamp);
        }
        try {
          const result = (original as AnyFunction).apply(this, args);
          if (method === "flush" && result instanceof Promise) void result.then(() => bump(row, "flushResolved"), (cause) => { bump(row, "flushRejected"); error(row, cause); });
          return result;
        } catch (cause) { error(row, cause); throw cause; }
      };
    }
    const support = (Native as unknown as Record<string, unknown>).isConfigSupported;
    if (typeof support === "function") {
      const probe = makeCodec(`${kind}:probe`, true);
      (Native as unknown as Record<string, unknown>).isConfigSupported = function (...args: unknown[]) {
        bump(probe, "requested");
        try {
          const result = (support as AnyFunction).apply(this, args);
          if (result instanceof Promise) void result.then((answer: { supported?: boolean }) => {
            bump(probe, "resolved");
            bump(probe, answer?.supported ? "supported" : "unsupported");
          }, (cause) => error(probe, cause));
          return result;
        } catch (cause) { error(probe, cause); throw cause; }
      };
    }
    realm[kind] = new Proxy(Native, {
      construct(target, args, newTarget) {
        const row = makeCodec(kind, true);
        const init = args[0] as Record<string, unknown>;
        const wrapped = { ...init };
        for (const callback of ["output", "error"]) {
          const original = init?.[callback];
          if (typeof original !== "function") continue;
          wrapped[callback] = function (this: unknown, ...values: unknown[]) {
            if (callback === "error") error(row, values[0]);
            else bump(row, callback);
            return (original as AnyFunction).apply(this, values);
          };
        }
        try {
          const instance = Reflect.construct(target, [wrapped, ...args.slice(1)], newTarget);
          codecInstances.set(instance, row);
          return instance;
        } catch (cause) { error(row, cause); throw cause; }
      },
    });
  }

  let rafRequested = 0, rafDelivered = 0;
  if (typeof realm.requestAnimationFrame === "function") {
    const original = realm.requestAnimationFrame as AnyFunction;
    realm.requestAnimationFrame = function (this: unknown, callback: FrameRequestCallback) {
      rafRequested++;
      return original.call(this, (timestamp: number) => { rafDelivered++; callback.call(globalThis, timestamp); });
    };
  }
  type CanvasRow = { id: number; canvas: { width?: number; height?: number; isConnected?: boolean }; draws: Counts; lastDrawMs: number; imageSource: { width: number | null; height: number | null } | null };
  const canvases: CanvasRow[] = [];
  const canvasRows = new WeakMap<object, CanvasRow>();
  const canvasRow = (canvas: object) => {
    let row = canvasRows.get(canvas);
    if (!row) {
      row = { id: canvases.length, canvas, draws: {}, lastDrawMs: 0, imageSource: null };
      canvasRows.set(canvas, row);
      if (canvases.length < 32) canvases.push(row);
    }
    return row;
  };
  for (const [name, methods] of [
    ["CanvasRenderingContext2D", ["fillRect", "strokeRect", "clearRect", "fill", "stroke", "drawImage", "putImageData"]],
    ["OffscreenCanvasRenderingContext2D", ["fillRect", "clearRect", "drawImage", "putImageData"]],
    ["WebGLRenderingContext", ["clear", "drawArrays", "drawElements"]],
    ["WebGL2RenderingContext", ["clear", "drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]],
  ] as const) {
    const ctor = realm[name] as { prototype?: Record<string, unknown> } | undefined;
    if (!ctor?.prototype) continue;
    for (const method of methods) patch(ctor.prototype, method, (context, args) => {
      const canvas = (context as { canvas?: object }).canvas;
      if (!canvas) return;
      const row = canvasRow(canvas);
      row.draws[method] = (row.draws[method] ?? 0) + 1;
      row.lastDrawMs = elapsed();
      if (method === "drawImage") {
        const source = args[0] as { width?: number; height?: number } | null;
        row.imageSource = { width: number(source?.width), height: number(source?.height) };
      }
    });
  }
  const samples: unknown[] = [];
  const snapshot = () => {
    const activity = realm[Symbol.for("hankshits.clips.canvasActivity")] as { active?: boolean; handles?: number; tick?: number; records?: WeakMap<object, { type?: unknown; drawSeq?: number; drawFrames?: number }> } | undefined;
    const dispatcher = realm[Symbol.for("hankshits.clips.rafDispatcher")] as { gameFrames?: number; pending?: Map<unknown, unknown>; pre?: Set<unknown>; post?: Set<unknown>; handles?: number } | undefined;
    const doc = realm.document as Document | undefined;
    // Only fixed product state enums and numeric coverage, never DOM text.
    const control = doc?.querySelector("[data-testid=clip-button]");
    const rawState = control?.getAttribute("data-state") ?? "";
    const state = /^(warming|ready|made|idle|disabled|recording|resting|suspended|record-only|source-lost|saving|exporting)$/.test(rawState) ? rawState : "unknown";
    return {
      elapsedMs: elapsed(), visibility: doc?.visibilityState ?? "worker", rafRequested, rafDelivered,
      activity: activity ? { active: activity.active, handles: number(activity.handles), tick: number(activity.tick) } : null,
      dispatcher: dispatcher ? { gameFrames: number(dispatcher.gameFrames), pending: dispatcher.pending?.size, preHooks: dispatcher.pre?.size, postHooks: dispatcher.post?.size, handles: number(dispatcher.handles) } : null,
      control: { state, progress: control?.querySelector("[data-progress]") ? number(Number(control.querySelector("[data-progress]")!.getAttribute("data-progress"))) : null },
      codecs: codecs.map((row) => ({ ...row, counts: { ...row.counts }, lastMs: { ...row.lastMs }, errors: { ...row.errors }, config: { ...row.config } })),
      canvases: canvases.map(({ canvas, ...row }) => {
        const record = activity?.records?.get(canvas);
        return { ...row, draws: { ...row.draws }, width: number(canvas.width), height: number(canvas.height), connected: canvas.isConnected ?? null,
          tracked: record ? { type: typeof record.type === "string" && /^(2d|webgl|webgl2|bitmaprenderer|other)$/.test(record.type) ? record.type : "unknown", drawSeq: number(record.drawSeq), drawFrames: number(record.drawFrames) } : null };
      }),
    };
  };
  realm[key] = { read: () => ({ version: 1, installedAtMs: Math.round(started), failures: { ...failures }, samples, latest: snapshot() }) };
  setInterval(() => { samples.push(snapshot()); if (samples.length > 180) samples.shift(); }, 2000);
}

export async function captureDiagnostics(context: BrowserContext): Promise<(page: Page, info: TestInfo) => Promise<void>> {
  if (process.env.E2E_DIAGNOSTICS !== "1") return async () => {};
  await context.addInitScript(installCaptureDiagnosticsInRealm);
  const workers: Worker[] = [];
  context.on("page", (page) => page.on("worker", (worker) => {
    workers.push(worker);
    void worker.evaluate(installCaptureDiagnosticsInRealm).catch(() => {});
  }));
  return async (page, info) => {
    const read = () => (globalThis as unknown as { __hhCaptureDiagnostics?: { read(): unknown } }).__hhCaptureDiagnostics?.read() ?? null;
    const frames = await Promise.all(page.frames().map((frame) => frame.evaluate(read).catch(() => ({ unavailable: true }))));
    const workerRows = await Promise.all(workers.map((worker) => worker.evaluate(read).catch(() => ({ unavailable: true }))));
    const artifact = info.outputPath("capture-diagnostics.json");
    await writeFile(artifact, JSON.stringify({ enabled: true, workerInstallMayFollowStartup: true, frames, workers: workerRows }, null, 2));
    await info.attach("capture-diagnostics", { path: artifact, contentType: "application/json" });
  };
}
