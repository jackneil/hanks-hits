// @vitest-environment node
/**
 * The game sound recorder of tiers M and V (soundRecorder.ts), on the
 * MediaRecorder double and one test clock: one run that does not restart
 * while capture runs, its messages to the io worker in order, the newest
 * bytes on request, and its failures.
 */
import { describe, expect, it } from "vitest";
import { FakeMediaStream, FakeTrack, fakeRecorderFactory, type FakeMediaRecorder, type FakeRecorderBehavior } from "../../../../../__tests__/mediarecorder-mock";
import { SOUND_FAILURE_LIMIT, SOUND_TIMESLICE_MS, SOUND_TYPES } from "../constants";
import type { MediaRecorderLike } from "../rotator";
import { SoundRecorder, type SoundIo } from "../soundRecorder";
import { TestClock } from "./testClock";

type Call = [string, ...unknown[]];

/** A Blob whose bytes come after `delayMs` on the test clock (a real Blob read is async too). */
function slowBlob(clock: TestClock, text: string, delayMs: number): Blob {
  const blob = new Blob([text]);
  Object.defineProperty(blob, "arrayBuffer", {
    value: () => new Promise<ArrayBuffer>((resolve) => clock.setTimeout(() => resolve(new TextEncoder().encode(text).buffer as ArrayBuffer), delayMs)),
  });
  return blob;
}

function setup(options: { behaviors?: FakeRecorderBehavior[]; supported?: (t: string) => boolean; throwFor?: string[]; delays?: number[] } = {}) {
  const clock = new TestClock(0);
  const calls: Call[] = [];
  const logs: string[] = [];
  let chunkNo = 0;
  const io: SoundIo = {
    audioRun: (...args) => void calls.push(["run", ...args]),
    audioAppend: (runId, bytes) => void calls.push(["append", runId, new TextDecoder().decode(bytes)]),
    audioEnd: (runId) => void calls.push(["end", runId]),
  };
  const factory = fakeRecorderFactory({
    schedule: clock.schedule,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    captureUs: () => clock.t * 1000,
    segment: () => new Blob([]),
    chunk: (_recorder, final) => {
      chunkNo++;
      const delay = options.delays?.[chunkNo - 1] ?? 0;
      return slowBlob(clock, `${final ? "last" : "chunk"}-${chunkNo}`, delay);
    },
    behaviors: options.behaviors,
  });
  const recorder = new SoundRecorder({
    createRecorder: (stream, o) => {
      if (options.throwFor?.includes(o.mimeType)) throw new DOMException("no", "NotSupportedError");
      return factory.create(stream as unknown as FakeMediaStream, o as unknown as Record<string, unknown> & { mimeType: string }) as unknown as MediaRecorderLike;
    },
    createStream: (tracks) => new FakeMediaStream(tracks) as unknown as MediaStream,
    isTypeSupported: options.supported ?? (() => true),
    types: SOUND_TYPES.V,
    container: "webm",
    timeline: 4,
    keepSeconds: 60,
    captureUs: () => clock.t * 1000,
    io,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    log: (m) => logs.push(m),
  });
  const track = new FakeTrack("audio");
  return { clock, calls, logs, factory, recorder, track, made: factory.made as FakeMediaRecorder[] };
}

describe("SoundRecorder", () => {
  it("one run: its start, its chunks and its end reach the io worker in order, even when a chunk's bytes come late", async () => {
    // Chunk 1's bytes take 400 ms; chunk 2's come at once: the order must hold.
    const h = setup({ delays: [400, 0, 0] });
    h.clock.t = 1000;
    h.recorder.start(h.track as unknown as MediaStreamTrack);
    expect(h.made).toHaveLength(1);
    expect(h.made[0].timeslice).toBe(SOUND_TIMESLICE_MS);
    expect(h.made[0].options).toMatchObject({ mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128_000 });
    // The stream has only the sound track.
    expect(h.made[0].stream.getTracks()).toEqual([h.track]);
    await h.clock.advance(2 * SOUND_TIMESLICE_MS + 10);
    h.recorder.stop();
    await h.clock.advance(1000);
    const runId = h.calls[0][1] as number;
    expect(h.calls).toEqual([
      ["run", runId, 4, "webm", 1_000_000, 60],
      ["append", runId, "chunk-1"],
      ["append", runId, "chunk-2"],
      ["append", runId, "last-3"],
      ["end", runId],
    ]);
    expect(h.recorder.running).toBe(false);
    expect(h.logs).toEqual([]);
  });

  it("does not restart while it runs, and a new run after a stop gets a new id", async () => {
    const h = setup();
    h.recorder.start(h.track as unknown as MediaStreamTrack);
    h.recorder.start(h.track as unknown as MediaStreamTrack);
    expect(h.made).toHaveLength(1);
    await h.clock.advance(100);
    h.recorder.stop();
    await h.clock.advance(100);
    h.recorder.start(h.track as unknown as MediaStreamTrack);
    await h.clock.advance(100);
    const runs = h.calls.filter((c) => c[0] === "run").map((c) => c[1]);
    expect(runs).toHaveLength(2);
    expect(runs[1]).not.toBe(runs[0]);
  });

  it("flush() asks for the newest bytes now (before a clip)", async () => {
    const h = setup();
    h.recorder.start(h.track as unknown as MediaStreamTrack);
    await h.clock.advance(100);
    expect(h.calls.filter((c) => c[0] === "append")).toHaveLength(0);
    h.recorder.flush();
    await h.clock.advance(1);
    expect(h.calls.filter((c) => c[0] === "append")).toHaveLength(1);
  });

  it("takes the first type the browser records, and the next one when a constructor refuses", () => {
    const h = setup({ supported: (t) => t !== "audio/webm;codecs=opus" });
    h.recorder.start(h.track as unknown as MediaStreamTrack);
    expect(h.made[0].mimeType).toBe(SOUND_TYPES.V[1]);
    const g = setup({ throwFor: ["audio/webm;codecs=opus"] });
    g.recorder.start(g.track as unknown as MediaStreamTrack);
    expect(g.made[0].mimeType).toBe(SOUND_TYPES.V[1]);
  });

  it("a recorder that fails ends its run and starts again after a wait; too many failures turn the sound off", async () => {
    const behaviors: FakeRecorderBehavior[] = Array.from({ length: SOUND_FAILURE_LIMIT + 2 }, () => ({ errorAtStart: true }));
    const h = setup({ behaviors });
    h.recorder.start(h.track as unknown as MediaStreamTrack);
    await h.clock.advance(60_000);
    expect(h.made).toHaveLength(SOUND_FAILURE_LIMIT);
    expect(h.recorder.off).toBe(true);
    expect(h.recorder.running).toBe(false);
    // Each failed run was ended at the io worker.
    const runs = h.calls.filter((c) => c[0] === "run").map((c) => c[1]);
    const ends = h.calls.filter((c) => c[0] === "end").map((c) => c[1]);
    expect(ends).toEqual(runs);
    expect(h.logs.at(-1)).toMatch(/no game sound/);
    // A start now does nothing.
    h.recorder.start(h.track as unknown as MediaStreamTrack);
    expect(h.made).toHaveLength(SOUND_FAILURE_LIMIT);
  });

  it("a stop during the wait after a failure cancels the next try; an ended track is never tried again", async () => {
    const h = setup({ behaviors: [{ errorAtStart: true }] });
    h.recorder.start(h.track as unknown as MediaStreamTrack);
    await h.clock.advance(10);
    h.recorder.stop();
    await h.clock.advance(10_000);
    expect(h.made).toHaveLength(1);
    const g = setup({ behaviors: [{ errorAtStart: true }] });
    g.recorder.start(g.track as unknown as MediaStreamTrack);
    g.track.stop();
    await g.clock.advance(10_000);
    expect(g.made).toHaveLength(1);
  });

  it("no type the browser records: no sound, said once, and the video is not touched", () => {
    const h = setup({ supported: () => false });
    h.recorder.start(h.track as unknown as MediaStreamTrack);
    expect(h.made).toHaveLength(0);
    expect(h.recorder.running).toBe(false);
    expect(h.logs[0]).toMatch(/no sound recorder could start/);
  });
});
