/**
 * A fake ClipServiceApi with controllable state, for the clip UI tests.
 *
 * It follows the contract's rules (service/contract.ts, plan 11.1), so a UI
 * that passes against it does the right thing against the real service:
 * - beginPress freezes a press token; endPress ends it ONCE.
 * - endPress: a hold of HOLD_FOR_MENU_MS or more without movement gives
 *   "menu" and commits nothing; a cancelled press commits nothing; a busy
 *   or limited state gives "ignored" with its reason; a press within
 *   EXTEND_WINDOW_MS of the last clip extends it.
 * - Every clip action adds a library row and sets lastResult, button "made"
 *   and unwatchedClipId, and tells subscribers.
 * - A capture clock (captureUs) stands for the capture-timeline end. A press
 *   token freezes it, with the latest run's span (runPhase, or playRun);
 *   clipLast and clipRun record the length they were asked for, the end
 *   they clip to and the run's start bound (clipRequests), so a test can
 *   check WHICH footage a clip holds, not only that a clip was made.
 *
 * Every method is a vi.fn, so tests read calls and order. Time is
 * performance.now(), the same clock the UI uses, so fake timers move both.
 */

import { vi } from "vitest";

import type { ClipKind, ClipRecord } from "../../protocol";
import {
  DEFAULT_CLIP_SECONDS,
  EXTEND_WINDOW_MS,
  HIDDEN_SNAPSHOT,
  HOLD_FOR_MENU_MS,
  type AttachedGame,
  type ClipActionResult,
  type ClipReasonCode,
  type ClipServiceApi,
  type ClipSnapshot,
  type PressOutcome,
  type PressToken,
  type RunClipPart,
  type RunSpan,
  type SaveOutcome,
  type ShareOutcome,
} from "../../service/contract";

export interface FakeClipServiceOptions {
  snapshot?: Partial<ClipSnapshot>;
  records?: ClipRecord[];
}

let recordSeq = 0;

/** A library row with sensible defaults. */
export function makeRecord(overrides: Partial<ClipRecord> = {}): ClipRecord {
  recordSeq += 1;
  const kind: ClipKind = overrides.kind ?? "clip";
  return {
    id: `clip-${recordSeq}`,
    ownerKey: "guest",
    gameId: "snake",
    kind,
    createdAt: 1_760_000_000_000 + recordSeq,
    durationMs: kind === "picture" ? 0 : 30_000,
    width: 1280,
    height: 720,
    fps: 30,
    hasAudio: kind !== "picture",
    mime: kind === "picture" ? "image/png" : "video/mp4",
    bytes: 2_000_000,
    kept: false,
    watched: false,
    storage: "opfs",
    posterDataUrl: "data:image/jpeg;base64,AAAA",
    moments: [],
    ...overrides,
  };
}

/** The snapshot of a game that is playing with a full ring. */
export const PLAYING: Partial<ClipSnapshot> = {
  button: "ready",
  engine: "buffering",
  appId: "snake",
  tier: "W",
  warmProgress: 1,
  bufferedSec: 45,
  gameCanPause: true,
  atBreak: false,
};

export function createFakeClipService(options: FakeClipServiceOptions = {}) {
  let snapshot: ClipSnapshot = { ...HIDDEN_SNAPSHOT, ...PLAYING, version: 1, ...options.snapshot };
  const listeners = new Set<() => void>();
  const libraryListeners = new Set<() => void>();
  const records: ClipRecord[] = [...(options.records ?? [])];
  const files = new Map<string, File>();
  const openPresses = new Set<string>();
  let pressSeq = 0;
  let lastClipAtMs = Number.NEGATIVE_INFINITY;
  let failNext: ClipReasonCode | null = null;
  let shareOutcome: ShareOutcome = { kind: "shared" };
  let saveOutcome: SaveOutcome = { kind: "saved" };
  /** The capture-timeline end now, in microseconds. */
  let captureUs = Math.round(snapshot.bufferedSec * 1e6);
  /** The latest run on the capture timeline (runPhase), like the real service. */
  let run: RunSpan | null = null;
  const clipRequests: Array<{ seconds: number; endAtUs: number; frozen: boolean; notBeforeUs?: number }> = [];
  /** Record videos saved from a tab that closed while it recorded (plan 8.4), waiting to be taken. */
  let recovered: ClipRecord[] = [];

  const now = () => performance.now();

  const set = (next: Partial<ClipSnapshot>) => {
    snapshot = { ...snapshot, ...next, version: snapshot.version + 1 };
    listeners.forEach((listener) => listener());
  };

  const notifyLibrary = () => libraryListeners.forEach((listener) => listener());

  /** Make a clip action: a new row, or a failure when failNext is set. */
  const act = (action: ClipActionResult["action"], kind: ClipKind, seconds?: number): Promise<ClipActionResult> => {
    const atMs = now();
    if (failNext) {
      const reason = failNext;
      failNext = null;
      const result: ClipActionResult = { ok: false, action, reason, atMs };
      set({ lastResult: result });
      return Promise.resolve(result);
    }
    const record = makeRecord({
      kind,
      gameId: snapshot.appId ?? "unknown",
      ...(seconds !== undefined ? { durationMs: seconds * 1000 } : {}),
    });
    records.push(record);
    const result: ClipActionResult = { ok: true, action, record, atMs };
    if (action === "clip" || action === "extend") lastClipAtMs = atMs;
    set({ lastResult: result, unwatchedClipId: record.id, button: snapshot.button === "recording" ? "recording" : "made" });
    notifyLibrary();
    return Promise.resolve(result);
  };

  const attached: AttachedGame = {
    registerCanvas: vi.fn(() => () => {}),
    autoDiscover: vi.fn(() => () => {}),
    // The real rule (ClipService.runPhase): the span of the latest run on the capture timeline.
    runPhase: vi.fn((phase: "start" | "end") => {
      if (phase === "start") run = { startUs: captureUs, endUs: null };
      else if (run && run.endUs === null) run = { startUs: run.startUs, endUs: captureUs };
    }),
    markMoment: vi.fn(),
    setAtBreak: vi.fn((atBreak: boolean) => set({ atBreak })),
    detach: vi.fn(),
  };

  const service: ClipServiceApi = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => HIDDEN_SNAPSHOT,

    attach: vi.fn(() => attached),

    beginPress: vi.fn((): PressToken | null => {
      if (snapshot.button === "hidden") return null;
      pressSeq += 1;
      const token: PressToken = { pressId: `press-${pressSeq}`, downAtMs: now(), endAtUs: captureUs, run: run ? { ...run } : null };
      openPresses.add(token.pressId);
      return token;
    }),

    endPress: vi.fn((token: PressToken, info: { upAtMs: number; moved: boolean; cancelled?: boolean }): PressOutcome => {
      if (!openPresses.delete(token.pressId)) return { kind: "ignored", reason: "busy" };
      // The real rule (contract.ts PressOutcome): a cancelled press commits nothing, whatever its length.
      if (info.cancelled) return { kind: "ignored", reason: "cancelled" };
      if (info.upAtMs - token.downAtMs >= HOLD_FOR_MENU_MS && !info.moved) return { kind: "menu" };
      switch (snapshot.button) {
        case "warming":
        case "source-lost":
        case "recovering":
          return { kind: "ignored", reason: "warming" };
        case "saving":
        case "exporting":
          return { kind: "ignored", reason: "busy" };
        case "resting":
          return { kind: "ignored", reason: "resting" };
        case "record-only":
          return { kind: "ignored", reason: "record-only" };
        case "disabled":
          return { kind: "ignored", reason: "breaker" };
        case "error":
          return { kind: "ignored", reason: snapshot.reason ?? "encoder-error" };
        default:
          break;
      }
      if (now() - lastClipAtMs <= EXTEND_WINDOW_MS) return { kind: "extend", result: act("extend", "clip") };
      return { kind: "clip", result: act("clip", "clip") };
    }),

    clipLast: vi.fn((seconds: number = DEFAULT_CLIP_SECONDS, token?: PressToken) => {
      clipRequests.push({ seconds, endAtUs: token ? token.endAtUs : captureUs, frozen: token !== undefined });
      return act("clip", "clip", seconds);
    }),
    // The real rule (ClipService.clipRun): the run's own bounds, never before its start.
    clipRun: vi.fn((token: PressToken, part: RunClipPart) => {
      const span = token.run;
      if (!span) {
        const result: ClipActionResult = { ok: false, action: "clip", reason: "warming", atMs: now() };
        set({ lastResult: result });
        return Promise.resolve(result);
      }
      const endAtUs = span.endUs === null ? token.endAtUs : Math.min(token.endAtUs, span.endUs);
      const runSec = Math.max(0, (endAtUs - span.startUs) / 1e6);
      const seconds = part === "whole" ? runSec : Math.min(DEFAULT_CLIP_SECONDS, runSec);
      clipRequests.push({ seconds, endAtUs, frozen: true, notBeforeUs: span.startUs });
      return act("clip", "clip", seconds);
    }),
    startRecording: vi.fn(async (): Promise<ClipActionResult | null> => {
      if (failNext) {
        const reason = failNext;
        failNext = null;
        return { ok: false, action: "record", reason, atMs: now() };
      }
      set({
        button: "recording",
        engine: "recording",
        recording: { recordingId: "rec-1", startedAtMs: now(), elapsedSec: 0, stars: 0 },
      });
      return null;
    }),
    stopRecording: vi.fn(async () => {
      set({ recording: null, engine: "buffering", button: "ready" });
      return act("record", "record");
    }),
    addStar: vi.fn(() => {
      if (snapshot.recording) set({ recording: { ...snapshot.recording, stars: snapshot.recording.stars + 1 } });
    }),
    takePicture: vi.fn(() => act("picture", "picture")),

    markWatched: vi.fn((id: string) => {
      if (snapshot.unwatchedClipId === id) set({ unwatchedClipId: null });
    }),
    // The real rule (ClipService.takeRecovered): each video once, and the chip points at the newest.
    takeRecovered: vi.fn(async () => {
      const taken = recovered;
      recovered = [];
      if (taken.length === 0) return [];
      const newest = taken.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
      set({ unwatchedClipId: newest.id });
      return taken;
    }),
    wake: vi.fn(() => set({ button: "ready", engine: "buffering", reason: null })),

    share: vi.fn(() => Promise.resolve(shareOutcome)),
    saveToDevice: vi.fn(() => Promise.resolve(saveOutcome)),
    fileNameFor: vi.fn((record: ClipRecord) => {
      const ext = record.mime === "image/png" ? "png" : record.mime === "video/webm" ? "webm" : "mp4";
      return `hankshits-${record.gameId}-20260928-1200.${ext}`;
    }),

    library: {
      list: vi.fn(async (filter?: { gameId?: string; kind?: ClipKind; kept?: boolean }) =>
        records.filter(
          (record) =>
            (filter?.gameId === undefined || record.gameId === filter.gameId) &&
            (filter?.kind === undefined || record.kind === filter.kind) &&
            (filter?.kept === undefined || record.kept === filter.kept),
        ).map((record) => ({ ...record })),
      ),
      file: vi.fn(async (id: string) => {
        const record = records.find((item) => item.id === id);
        if (!record) throw Object.assign(new Error("gone"), { name: "NotFoundError" });
        let file = files.get(id);
        if (!file) {
          file = new File([new Uint8Array([0, 0, 0, 24])], `${id}.bin`, { type: record.mime });
          files.set(id, file);
        }
        return file;
      }),
      setKept: vi.fn(async (id: string, kept: boolean) => {
        const record = records.find((item) => item.id === id);
        if (record) record.kept = kept;
        notifyLibrary();
      }),
      markWatched: vi.fn(async (id: string) => {
        const record = records.find((item) => item.id === id);
        if (record) record.watched = true;
        notifyLibrary();
      }),
      remove: vi.fn(async (id: string) => {
        const index = records.findIndex((item) => item.id === id);
        if (index >= 0) records.splice(index, 1);
        notifyLibrary();
      }),
      usage: vi.fn(async () => ({
        bytes: records.reduce((sum, record) => sum + record.bytes, 0),
        budget: 4_000_000_000,
        count: records.length,
      })),
      subscribe: vi.fn((listener: () => void) => {
        libraryListeners.add(listener);
        return () => libraryListeners.delete(listener);
      }),
    },
  };

  return {
    service,
    attached,
    records,
    /** Change the snapshot and tell subscribers (wrap in act() in React tests). */
    set,
    snapshot: () => snapshot,
    /**
     * A Record video comes back from a tab that closed while it recorded
     * (plan 8.4): it is in the library, and the service holds it for the UI.
     * The library tells its listeners, like the real "recovered" event.
     */
    recover(record: ClipRecord, options: { notify?: boolean } = {}) {
      records.push(record);
      recovered.push(record);
      if (options.notify !== false) notifyLibrary();
    },
    /** The next clip action fails with this reason. */
    failNext(reason: ClipReasonCode) {
      failNext = reason;
    },
    setShareOutcome(outcome: ShareOutcome) {
      shareOutcome = outcome;
    },
    setSaveOutcome(outcome: SaveOutcome) {
      saveOutcome = outcome;
    },
    openPressCount: () => openPresses.size,
    listenerCount: () => listeners.size,
    /** Capture runs on: the capture-timeline end moves by `seconds`. */
    advanceCapture(seconds: number) {
      captureUs += Math.round(seconds * 1e6);
    },
    captureUs: () => captureUs,
    /**
     * A run that started `seconds` ago on the capture timeline and ended now,
     * like a game's runPhase("start") and runPhase("end").
     */
    playRun(seconds: number) {
      run = { startUs: captureUs - Math.round(seconds * 1e6), endUs: captureUs };
    },
    run: () => run,
    /** Every clipLast and clipRun call: the length asked for, the end it clips to, and the run's start bound. */
    clipRequests,
  };
}

export type FakeClipService = ReturnType<typeof createFakeClipService>;
