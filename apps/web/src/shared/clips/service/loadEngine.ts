/**
 * Picks the capture engine for this device (plan 5), behind the CaptureEngine
 * seam (engine.ts). ClipService loads this module with a dynamic import, only
 * when a clip-enabled game attaches and clips are on.
 *
 * - The capability probe runs once here (while no encoder session is live).
 * - Tier W, W+ or none: the WebCodecs engine (engineHost.ts). Its prepare()
 *   gets this probe's report, and each later arm probes again (plan 5:
 *   probes re-run at every arm). A device with no tier gets the WebCodecs
 *   engine too; its prepare() says "not supported" (the "no-tier" state).
 * - Tier M or V: the MediaRecorder engine (engine/recorder/), with this
 *   probe's report, inside an engine switch. The probe treats a video
 *   encoder that timed out, failed or gave no output as a passing state (a
 *   cold or busy hardware encoder), so one probe must not keep a W device on
 *   MediaRecorder: the MediaRecorder engine probes again at each arm, and
 *   when a fresh probe finds tier W or W+, the switch moves the game to the
 *   WebCodecs engine before any encoder session starts. It says so with a
 *   "tier" event.
 * Each engine module loads with its own dynamic import, and neither one
 * imports the other (the shared parts are in engineShared.ts), so a device
 * loads only the engine it uses.
 */

import type { ClipMeta, ClipRecord } from "../protocol";
import { probeCapabilityReport, type CapabilityReport } from "../runtime/capabilities";
import type { CaptureEngine, ClipRequest, EngineEvent, EngineGame, MadeClip, PauseReason, PrepareResult, RecordingHandle } from "./engine";

type Probe = (options: { force?: boolean }) => Promise<CapabilityReport>;

/** Asks the engine switch to move to the WebCodecs engine. Settles true when it did. */
export type TierChange = (report: CapabilityReport) => Promise<boolean>;

export interface LoadEngineDeps {
  probe?: Probe;
  loadRecorderEngine?: (report: CapabilityReport, onTierChange: TierChange) => Promise<CaptureEngine>;
  loadHostEngine?: (probe: Probe) => Promise<CaptureEngine>;
}

function defaultRecorder(report: CapabilityReport, onTierChange: TierChange): Promise<CaptureEngine> {
  return import("../engine/recorder/recorderEngine").then(({ RecorderEngine }) => new RecorderEngine({ report, onTierChange }));
}

function defaultHost(probe: Probe): Promise<CaptureEngine> {
  return import("./engineHost").then(({ EngineHost }) => new EngineHost({ probe }));
}

/**
 * A probe that gives `report` to its first call (prepare()), and runs a real
 * probe for every later call (each arm) and for a forced call.
 */
export function probeOnceFrom(report: CapabilityReport, probe: Probe): Probe {
  let first: CapabilityReport | null = report;
  return (options) => {
    const kept = first;
    first = null;
    if (kept && !options.force) return Promise.resolve(kept);
    return probe(options);
  };
}

interface Source {
  kind: "canvas" | "discover";
  canvas: HTMLCanvasElement | null;
  root: Element | null;
  options: { targetFps?: 30 | 60 } | undefined;
  /** The unregister function of the engine that holds it now. */
  stop: (() => void) | null;
}

/**
 * The engine switch: one CaptureEngine for the service that forwards every
 * call to the engine that runs now, and keeps what a new engine needs (the
 * game, the start level, the pause reasons and the sources) so that it can
 * move them to another engine.
 */
export class EngineSwitch implements CaptureEngine {
  private inner: CaptureEngine;
  private stopInner: () => void;
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private readonly sources = new Set<Source>();
  private readonly pauses = new Set<PauseReason>();
  private game: EngineGame | null = null;
  private startLevel: number | null = null;
  private disposed = false;

  constructor(first: CaptureEngine) {
    this.inner = first;
    this.stopInner = first.subscribe((event) => this.forward(first, event));
  }

  /** The engine that runs now. */
  get current(): CaptureEngine {
    return this.inner;
  }

  /**
   * Moves everything to the engine that `load` makes, when its prepare() says
   * it can capture. The old engine is disposed. Settles true when it moved.
   * Call it only while the old engine has no encoder session (at arm).
   */
  async switchTo(load: () => Promise<CaptureEngine>): Promise<boolean> {
    if (this.disposed) return false;
    let next: CaptureEngine;
    try {
      next = await load();
    } catch {
      return false;
    }
    let prepared: PrepareResult;
    try {
      prepared = await next.prepare();
    } catch {
      next.dispose();
      return false;
    }
    if (!prepared.supported || this.disposed) {
      next.dispose();
      return false;
    }
    const old = this.inner;
    this.stopInner();
    for (const source of this.sources) {
      source.stop?.();
      source.stop = null;
    }
    old.dispose();
    this.inner = next;
    this.stopInner = next.subscribe((event) => this.forward(next, event));
    if (this.startLevel !== null) next.setStartLevel(this.startLevel);
    for (const reason of this.pauses) next.setPaused(reason, true);
    if (this.game) next.setGame(this.game);
    for (const source of this.sources) this.attach(source);
    this.emit({ t: "tier", tier: prepared.tier });
    return true;
  }

  prepare(): Promise<PrepareResult> {
    return this.inner.prepare();
  }

  setGame(game: EngineGame | null): void {
    this.game = game;
    this.inner.setGame(game);
  }

  registerCanvas(canvas: HTMLCanvasElement, options?: { targetFps?: 30 | 60 }): () => void {
    return this.add({ kind: "canvas", canvas, root: null, options, stop: null });
  }

  autoDiscover(root: Element): () => void {
    return this.add({ kind: "discover", canvas: null, root, options: undefined, stop: null });
  }

  setPaused(reason: PauseReason, paused: boolean): void {
    if (paused) this.pauses.add(reason);
    else this.pauses.delete(reason);
    this.inner.setPaused(reason, paused);
  }

  closeEncoder(reason: "hidden" | "export"): void {
    this.inner.closeEncoder(reason);
  }

  mediaEndUs(): number {
    return this.inner.mediaEndUs();
  }

  clip(request: ClipRequest): Promise<MadeClip> {
    return this.inner.clip(request);
  }

  picture(meta: ClipMeta): Promise<ClipRecord> {
    return this.inner.picture(meta);
  }

  startRecording(meta: ClipMeta): Promise<RecordingHandle> {
    return this.inner.startRecording(meta);
  }

  purge(): void {
    this.inner.purge();
  }

  park(): void {
    this.inner.park();
  }

  wake(): boolean {
    return this.inner.wake();
  }

  setStartLevel(level: number): void {
    this.startLevel = level;
    this.inner.setStartLevel(level);
  }

  disarm(): void {
    this.inner.disarm();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.inner.dispose();
    this.stopInner();
    this.listeners.clear();
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private add(source: Source): () => void {
    this.sources.add(source);
    this.attach(source);
    return () => {
      if (!this.sources.delete(source)) return;
      const stop = source.stop;
      source.stop = null;
      stop?.();
    };
  }

  private attach(source: Source): void {
    source.stop =
      source.kind === "canvas" && source.canvas ? this.inner.registerCanvas(source.canvas, source.options) : this.inner.autoDiscover(source.root!);
  }

  private forward(from: CaptureEngine, event: EngineEvent): void {
    // An engine that was switched out says nothing more.
    if (from !== this.inner) return;
    this.emit(event);
  }

  private emit(event: EngineEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // One bad listener must not stop the others.
      }
    }
  }
}

export async function loadCaptureEngine(deps: LoadEngineDeps = {}): Promise<CaptureEngine> {
  const probe = deps.probe ?? ((options) => probeCapabilityReport(options));
  const loadHost = deps.loadHostEngine ?? defaultHost;
  const report = await probe({});
  const tier = report.caps.tier;
  if (tier !== "M" && tier !== "V") return loadHost(probeOnceFrom(report, probe));
  let engineSwitch: EngineSwitch | null = null;
  const onTierChange: TierChange = (fresh) => (engineSwitch ? engineSwitch.switchTo(() => loadHost(probeOnceFrom(fresh, probe))) : Promise.resolve(false));
  const recorder = await (deps.loadRecorderEngine ?? defaultRecorder)(report, onTierChange);
  engineSwitch = new EngineSwitch(recorder);
  return engineSwitch;
}
