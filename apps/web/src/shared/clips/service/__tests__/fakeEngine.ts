/**
 * A CaptureEngine double for the ClipService tests. The test drives it: it
 * emits the engine's events, moves the capture timeline, and decides how
 * each clip, picture and recording ends. engineHost.test.ts covers the real
 * engine against the real worker handlers.
 */
import type { ClipMeta, ClipRecord } from "../../protocol";
import type { CaptureEngine, ClipRequest, EngineEvent, EngineGame, MadeClip, PauseReason, PrepareResult, RecordingHandle } from "../engine";

export function recordFor(meta: ClipMeta, extra: Partial<ClipRecord> = {}): ClipRecord {
  return { ...meta, bytes: 1000, storage: "opfs", posterDataUrl: "data:,", durationMs: meta.durationMs || 30_000, ...extra };
}

export class FakeEngine implements CaptureEngine {
  prepared: PrepareResult = { tier: "W", supported: true };
  readonly listeners = new Set<(event: EngineEvent) => void>();
  readonly paused = new Set<PauseReason>();
  readonly closed: Array<"hidden" | "export"> = [];
  readonly clipRequests: ClipRequest[] = [];
  readonly recordings: Array<{ meta: ClipMeta; stopped: boolean; parts: Array<{ record: ClipRecord; startUs: number; endUs: number }> }> = [];
  readonly canvases = new Set<HTMLCanvasElement | Element>();
  purges = 0;
  disarms = 0;
  wakes = 0;
  startLevel = 0;
  game: EngineGame | null = null;
  mediaEnd = 0;
  disposed = false;
  /** How the next clip ends. Default: stored, spanning the requested seconds back from its end. */
  clipResult: (request: ClipRequest) => Promise<MadeClip> = async (request) => {
    const endUs = request.endAtUs ?? this.mediaEnd;
    const startUs = Math.max(0, endUs - request.seconds * 1e6);
    const moments = request.moments ? request.moments(startUs, endUs) : [];
    request.onProgress?.(0.5);
    return { record: recordFor({ ...request.meta, moments, durationMs: Math.round((endUs - startUs) / 1000) }), startUs, endUs };
  };
  pictureResult: (meta: ClipMeta) => Promise<ClipRecord> = async (meta) => recordFor(meta, { mime: "image/png", durationMs: 0 });
  recordStart: (meta: ClipMeta) => Promise<void> = async () => undefined;

  async prepare(): Promise<PrepareResult> {
    return this.prepared;
  }

  /** Like the real engine: a different game purges the ring and ends the session. */
  setGame(game: EngineGame | null): void {
    const changed = !!game && !!this.game && game.appId !== this.game.appId;
    this.game = game;
    if (changed) {
      this.purge();
      this.disarm();
    }
  }

  registerCanvas(canvas: HTMLCanvasElement): () => void {
    this.canvases.add(canvas);
    this.emit({ t: "source", present: true });
    return () => {
      if (!this.canvases.delete(canvas)) return;
      if (this.canvases.size === 0) this.emit({ t: "source", present: false });
    };
  }

  autoDiscover(root: Element): () => void {
    this.canvases.add(root);
    this.emit({ t: "source", present: true });
    return () => {
      if (!this.canvases.delete(root)) return;
      if (this.canvases.size === 0) this.emit({ t: "source", present: false });
    };
  }

  setPaused(reason: PauseReason, paused: boolean): void {
    if (paused) this.paused.add(reason);
    else this.paused.delete(reason);
  }

  closeEncoder(reason: "hidden" | "export"): void {
    this.closed.push(reason);
  }

  mediaEndUs(): number {
    return this.mediaEnd;
  }

  clip(request: ClipRequest): Promise<MadeClip> {
    this.clipRequests.push(request);
    return this.clipResult(request);
  }

  picture(meta: ClipMeta): Promise<ClipRecord> {
    return this.pictureResult(meta);
  }

  async startRecording(meta: ClipMeta): Promise<RecordingHandle> {
    await this.recordStart(meta);
    const startUs = this.mediaEnd;
    const entry = { meta, stopped: false, parts: [] as Array<{ record: ClipRecord; startUs: number; endUs: number }> };
    this.recordings.push(entry);
    return {
      recordingId: meta.id,
      stop: async () => {
        entry.stopped = true;
        const part = { record: recordFor({ ...meta, kind: "record" }), startUs, endUs: this.mediaEnd };
        entry.parts = entry.parts.length ? entry.parts : [part];
        return { parts: entry.parts, failed: 0 };
      },
    };
  }

  purge(): void {
    this.purges++;
  }

  wake(): boolean {
    this.wakes++;
    this.emit({ t: "governor", level: { kind: "low-power", k: 4, fps: 15, scale: 0.5, keepSeconds: 15 }, resting: false });
    return true;
  }

  setStartLevel(level: number): void {
    this.startLevel = level;
  }

  disarm(): void {
    this.disarms++;
    this.mediaEnd = 0;
    this.emit({ t: "reset" });
  }

  dispose(): void {
    this.disposed = true;
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: EngineEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  /** Moves the capture timeline and reports the ring like the encoder stats do. */
  play(seconds: number): void {
    this.mediaEnd += seconds * 1e6;
    this.emit({ t: "buffered", seconds: Math.min(60, this.mediaEnd / 1e6) });
  }
}
