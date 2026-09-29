/**
 * A fake clip service for the lab tests. It implements the service contract
 * (service/contract.ts) with vi.fn actions and a snapshot store that follows
 * the contract rules: immutable snapshots, a new object at each change, and
 * subscribe/getSnapshot/getServerSnapshot callable without a receiver.
 */
import { File as NodeFile } from "node:buffer";
import { vi } from "vitest";

import type { ClipRecord } from "../../protocol";
import {
  HIDDEN_SNAPSHOT,
  type AttachedGame,
  type ClipActionResult,
  type ClipLibraryApi,
  type ClipServiceApi,
  type ClipSnapshot,
  type GameAttachment,
} from "../../service/contract";

export function clipRecord(overrides: Partial<ClipRecord> = {}): ClipRecord {
  return {
    id: "c-1",
    ownerKey: "guest",
    gameId: "clips-lab",
    kind: "clip",
    createdAt: 1_790_000_000_000,
    durationMs: 10_400,
    width: 1280,
    height: 720,
    fps: 60,
    hasAudio: true,
    mime: "video/mp4",
    bytes: 6,
    kept: false,
    watched: false,
    storage: "opfs",
    posterDataUrl: "data:image/jpeg;base64,AA==",
    moments: [],
    ...overrides,
  };
}

/** A File with real bytes. jsdom's Blob has no arrayBuffer(), so the bytes come from Node's File. */
export function clipFile(bytes: Uint8Array, name = "clip.mp4"): File {
  return new NodeFile([bytes], name, { type: "video/mp4" }) as unknown as File;
}

export class FakeAttachedGame implements AttachedGame {
  readonly registered: Array<{ canvas: HTMLCanvasElement; options?: { targetFps?: 30 | 60 } }> = [];
  readonly released: HTMLCanvasElement[] = [];
  constructor(readonly game: GameAttachment) {}
  registerCanvas = vi.fn((canvas: HTMLCanvasElement, options?: { targetFps?: 30 | 60 }) => {
    this.registered.push({ canvas, options });
    return () => {
      this.released.push(canvas);
    };
  });
  autoDiscover = vi.fn(() => () => undefined);
  runPhase = vi.fn();
  markMoment = vi.fn();
  setAtBreak = vi.fn();
  detach = vi.fn();
}

export class FakeLabService implements ClipServiceApi {
  private snapshot: ClipSnapshot = { ...HIDDEN_SNAPSHOT, version: 1, button: "warming", engine: "warming", tier: "W" };
  private readonly listeners = new Set<() => void>();
  readonly games: FakeAttachedGame[] = [];
  readonly files = new Map<string, File>();
  /** What clipLast gives next. */
  clipResult: ClipActionResult = { ok: true, action: "clip", record: clipRecord(), atMs: 1 };
  /** What stopRecording gives next. */
  recordResult: ClipActionResult = { ok: true, action: "record", record: clipRecord({ id: "r-1", kind: "record", durationMs: 20_100 }), atMs: 2 };
  /** What startRecording gives: null starts the recording. */
  startResult: ClipActionResult | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => HIDDEN_SNAPSHOT;

  /** Changes the snapshot the way the service does: a new object, then the listeners. */
  set(patch: Partial<ClipSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, version: this.snapshot.version + 1 };
    for (const listener of [...this.listeners]) listener();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  attach = vi.fn((game: GameAttachment): AttachedGame => {
    const attached = new FakeAttachedGame(game);
    this.games.push(attached);
    this.set({ appId: game.appId });
    return attached;
  });

  beginPress = vi.fn(() => null);
  endPress = vi.fn(() => ({ kind: "ignored" as const, reason: "warming" as const }));
  clipLast = vi.fn(async (seconds?: number) => {
    void seconds;
    return this.clipResult;
  });
  startRecording = vi.fn(async () => {
    if (this.startResult) return this.startResult;
    this.set({ recording: { recordingId: "r-1", startedAtMs: 1, elapsedSec: 0, stars: 0 }, button: "recording", engine: "recording" });
    return null;
  });
  stopRecording = vi.fn(async () => {
    this.set({ recording: null, button: "ready", engine: "buffering" });
    return this.recordResult;
  });
  addStar = vi.fn();
  takePicture = vi.fn(async () => this.clipResult);
  markWatched = vi.fn();
  takeRecovered = vi.fn(async () => []);
  wake = vi.fn();
  share = vi.fn(async () => ({ kind: "shared" as const }));
  saveToDevice = vi.fn(async () => ({ kind: "saved" as const }));
  fileNameFor = vi.fn(() => "localhost-clips-lab-20260928-1800.mp4");

  library: ClipLibraryApi = {
    list: vi.fn(async () => []),
    file: vi.fn(async (id: string) => {
      const file = this.files.get(id);
      if (!file) throw new Error("not-found");
      return file;
    }),
    setKept: vi.fn(async () => undefined),
    markWatched: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    usage: vi.fn(async () => ({ bytes: 0, budget: 0, count: 0 })),
    subscribe: vi.fn(() => () => undefined),
  };
}
