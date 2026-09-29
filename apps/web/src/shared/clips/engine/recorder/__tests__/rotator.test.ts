// @vitest-environment node
/**
 * Rotating MediaRecorders (tiers M and V, plan 5): rotation timing, the
 * hand-off overlap, hand-offs on demand, and every failure path, on the
 * MediaRecorder double and one test clock. Every test also checks the
 * rotator's promise: no recorder records outside rotation (at most one
 * current recorder, and a second one only inside a hand-off).
 */
import { describe, expect, it } from "vitest";
import {
  FakeMediaStream,
  fakeRecorderFactory,
  type FakeMediaRecorder,
  type FakeRecorderBehavior,
} from "../../../../../__tests__/mediarecorder-mock";
import { HANDOFF_OVERLAP_MS, ROTATION_MS, TAKEOVER_GRACE_MS } from "../constants";
import { Rotator, type FinishedSegment, type MediaRecorderLike, type RotatorFailure } from "../rotator";
import { TestClock } from "./testClock";

const START = 10_000;

function setup(behaviors: FakeRecorderBehavior[] = [], extra: { maxRecording?: number } = {}) {
  const clock = new TestClock(START);
  const captureUs = () => (clock.t - START) * 1000;
  const segments: FinishedSegment[] = [];
  const failures: Array<{ kind: RotatorFailure; current: boolean }> = [];
  const logs: string[] = [];
  let started = 0;
  let startCalls = 0;
  const factory = fakeRecorderFactory({
    schedule: clock.schedule,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    captureUs,
    segment: (recorder) => new Blob([`segment ${recorder.id}`], { type: recorder.mimeType }),
    behaviors,
    maxRecording: extra.maxRecording,
  });
  const rotator = new Rotator({
    createRecorder: () => factory.create(new FakeMediaStream([]), { mimeType: "video/webm;codecs=vp8,opus" }) as unknown as MediaRecorderLike,
    now: clock.now,
    captureUs,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    rotationMs: ROTATION_MS,
    overlapMs: HANDOFF_OVERLAP_MS,
    startTimeoutMs: 3000,
    stopTimeoutMs: 5000,
    retryMs: 1000,
    sequentialAfterFailures: 2,
    takeoverGraceMs: TAKEOVER_GRACE_MS,
    onSegment: (segment) => segments.push(segment),
    onStarted: () => started++,
    onStartCall: () => startCalls++,
    onFailure: (kind, info) => failures.push({ kind, current: info.current }),
    log: (m) => logs.push(m),
  });
  const at = (ms: number) => clock.advanceTo(START + ms);
  const spans = () => segments.map((s) => [s.startUs / 1000, s.endUs / 1000, s.nextStartUs === null ? null : s.nextStartUs / 1000]);
  const recording = (made: FakeMediaRecorder[]) => made.filter((r) => r.state === "recording").length;
  /** Steps the clock to `ms` in 25 ms steps and gives the most recorders that recorded at once. */
  const sweep = async (ms: number) => {
    let most = 0;
    while (clock.t - START < ms) {
      await clock.advance(25);
      most = Math.max(most, recording(factory.made), rotator.liveCount);
    }
    return most;
  };
  return { clock, rotator, segments, failures, logs, factory, at, spans, recording, sweep, started: () => started, startCalls: () => startCalls };
}

describe("rotation", () => {
  it("starts a new recorder every ROTATION_MS; each segment ends HANDOFF_OVERLAP_MS after the next one starts", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(0);
    expect(h.rotator.running).toBe(true);
    expect(h.rotator.currentStartUs).toBe(0);
    await h.at(19_000);
    expect(ROTATION_MS).toBe(4500);
    expect(h.spans()).toEqual([
      [0, 4750, 4500],
      [4500, 9250, 9000],
      [9000, 13_750, 13_500],
      [13_500, 18_250, 18_000],
    ]);
    // Each segment knows its start() call too (the anchor's candidate).
    expect(h.segments.map((s) => s.startCallUs / 1000)).toEqual([0, 4500, 9000, 13_500]);
    // Every segment is a whole file from its own recorder.
    expect(h.factory.made).toHaveLength(5);
    expect(await h.segments[1].blob.text()).toBe(`segment ${h.factory.made[1].id}`);
    expect(h.segments.every((s) => s.mimeType === "video/webm;codecs=vp8,opus")).toBe(true);
    expect(h.failures).toEqual([]);
    // Each start() asked the engine for a frame.
    expect(h.startCalls()).toBe(5);
  });

  it("runs two recorders only across the hand-off", async () => {
    const h = setup();
    h.rotator.start();
    const samples: Array<[number, number]> = [];
    for (let ms = 0; ms <= 16_000; ms += 50) {
      await h.at(ms);
      samples.push([ms, h.rotator.liveCount]);
    }
    expect(Math.max(...samples.map(([, n]) => n))).toBe(2);
    const doubled = samples.filter(([, n]) => n === 2).map(([ms]) => ms);
    expect(doubled.every((ms) => [4500, 9000, 13_500].some((h0) => ms >= h0 && ms < h0 + HANDOFF_OVERLAP_MS))).toBe(true);
    expect(doubled).toContain(4600);
    expect(h.recording(h.factory.made)).toBe(1);
  });

  it("covers the capture timeline with no gap: each segment reaches past the next one's start", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(30_000);
    for (let i = 1; i < h.segments.length; i++) {
      expect(h.segments[i - 1].endUs).toBeGreaterThan(h.segments[i].startUs);
      expect(h.segments[i - 1].nextStartUs).toBe(h.segments[i].startUs);
    }
  });
});

describe("hand-off on demand", () => {
  it("ends the current segment now and restarts the rotation from the new recorder", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(2000);
    const done = h.rotator.handOff();
    // A second call shares the same hand-off.
    expect(h.rotator.handOff()).toBe(done);
    await h.at(2300);
    await done;
    expect(h.spans()).toEqual([[0, 2250, 2000]]);
    expect(h.factory.made).toHaveLength(2);
    await h.at(6800);
    // The next rotation is ROTATION_MS after the new recorder's start() (2000 + 4500).
    expect(h.spans()).toEqual([
      [0, 2250, 2000],
      [2000, 6750, 6500],
    ]);
  });

  it("with no recorder, it only starts one", async () => {
    const h = setup();
    await h.rotator.handOff();
    await h.at(0);
    expect(h.rotator.running).toBe(true);
    expect(h.segments).toEqual([]);
  });

  it("while the current recorder still starts, it waits for it: never two current recorders", async () => {
    const h = setup();
    h.rotator.start();
    // The first recorder's "start" event has not come yet.
    const done = h.rotator.handOff();
    expect(h.factory.made).toHaveLength(1);
    const most = await h.sweep(400);
    await done;
    expect(most).toBe(2);
    expect(h.spans()).toEqual([[0, 250, 0]]);
    expect(h.rotator.liveCount).toBe(1);
    expect(h.recording(h.factory.made)).toBe(1);
  });

  it("while the current recorder never starts, the hand-off ends with it and leaves nothing recording", async () => {
    const h = setup([{ noStartEvent: true }]);
    h.rotator.start();
    const done = h.rotator.handOff();
    await h.at(3100);
    await done;
    expect(h.failures).toEqual([{ kind: "start", current: true }]);
    expect(h.factory.made).toHaveLength(1);
    expect(h.rotator.idle).toBe(true);
    expect(h.recording(h.factory.made)).toBe(0);
  });
});

describe("failures in a hand-off", () => {
  it("a new recorder that fails to start leaves the old one recording, and the hand-off is tried again", async () => {
    const h = setup([{}, { errorAtStart: true }]);
    h.rotator.start();
    await h.at(4600);
    expect(h.failures).toEqual([{ kind: "start", current: false }]);
    expect(h.rotator.running).toBe(true);
    expect(h.segments).toEqual([]);
    // The retry (1000 ms later) works: the old segment ends 250 ms after it.
    await h.at(5900);
    expect(h.spans()).toEqual([[0, 5750, 5500]]);
  });

  it("Chromium order: a new recorder that fires start and then error keeps the old one as the current recorder", async () => {
    // The fault this guards: the failed recorder was made current and the old one stopped, so capture died silently.
    const h = setup([{}, { errorAfterStart: true }, {}]);
    h.rotator.start();
    await h.at(4600);
    expect(h.failures).toEqual([{ kind: "record", current: false }]);
    expect(h.factory.made[0].state).toBe("recording");
    expect(h.rotator.running).toBe(true);
    expect(h.rotator.currentStartUs).toBe(0);
    // The retry hands off to a good recorder.
    await h.at(5900);
    expect(h.spans()).toEqual([[0, 5750, 5500]]);
    expect(h.rotator.running).toBe(true);
    expect(h.rotator.sequential).toBe(false);
  });

  it("two Chromium-order failures in a row turn on the hand-off with no overlap", async () => {
    const h = setup([{}, { errorAfterStart: true }, { errorAfterStart: true }, {}, {}]);
    h.rotator.start();
    await h.at(5600);
    expect(h.rotator.sequential).toBe(true);
    expect(h.failures.map((f) => f.current)).toEqual([false, false]);
    // The next try stops the old recorder first.
    const most = await h.sweep(12_000);
    expect(most).toBe(1);
    expect(h.rotator.running).toBe(true);
    expect(h.spans()[0]).toEqual([0, 6500, null]);
  });

  it("a new recorder that fails just after it took over counts as a failed hand-off", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(4800);
    // Recorder 2 took over at 4750; it fails 50 ms later (inside TAKEOVER_GRACE_MS).
    h.factory.made[1].fail();
    await h.at(4900);
    expect(h.failures).toEqual([{ kind: "record", current: true }]);
    expect(h.rotator.idle).toBe(true);
    expect(h.rotator.sequential).toBe(false);
    // The engine starts a recorder again; its successor fails the same way: now one recorder at a time.
    h.rotator.start();
    await h.at(9400 + 100);
    expect(h.factory.made).toHaveLength(4);
    h.factory.made[3].fail();
    await h.at(9700);
    expect(h.rotator.sequential).toBe(true);
    expect(h.logs.some((m) => m.includes("one recorder at a time"))).toBe(true);
  });

  it("an old recorder that fails inside the overlap leaves the new one as the current recorder: no orphan", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(4600);
    expect(h.rotator.liveCount).toBe(2);
    h.factory.made[0].fail();
    await h.at(4700);
    // The footage goes on in the new recorder: not a lost current recorder.
    expect(h.failures).toEqual([{ kind: "record", current: false }]);
    expect(h.rotator.running).toBe(true);
    expect(h.rotator.currentStartUs).toBe(4_500_000);
    // It rotates as usual, and only one recorder records outside the hand-offs.
    const most = await h.sweep(20_000);
    expect(most).toBe(2);
    expect(h.recording(h.factory.made)).toBe(1);
    expect(h.spans()).toEqual([
      [4500, 9250, 9000],
      [9000, 13_750, 13_500],
      [13_500, 18_250, 18_000],
    ]);
  });

  it("a device with one encoder session: the fallback waits for the old encoder to be released", async () => {
    // A recorder holds its session until its "stop" event: a new one that starts before that fails.
    const h = setup([], { maxRecording: 1 });
    h.rotator.start();
    await h.at(6000);
    expect(h.rotator.sequential).toBe(true);
    const failuresBefore = h.failures.length;
    const most = await h.sweep(20_000);
    expect(most).toBe(1);
    // No more failures: each new recorder opened after the old one gave its file.
    expect(h.failures).toHaveLength(failuresBefore);
    expect(h.rotator.running).toBe(true);
    const spans = h.spans();
    expect(spans.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1] as number);
  });
});

describe("other failures", () => {
  it("a recorder with no start event fails after the start timeout", async () => {
    const h = setup([{ noStartEvent: true }]);
    h.rotator.start();
    await h.at(2999);
    expect(h.failures).toEqual([]);
    await h.at(3000);
    expect(h.failures).toEqual([{ kind: "start", current: true }]);
    expect(h.rotator.running).toBe(false);
    expect(h.rotator.idle).toBe(true);
  });

  it("the current recorder that errors is dropped with its footage, and the rotator stops", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(1000);
    h.factory.made[0].fail();
    await h.at(1100);
    expect(h.failures).toEqual([{ kind: "record", current: true }]);
    expect(h.segments).toEqual([]);
    expect(h.rotator.idle).toBe(true);
    // No rotation runs for the dropped recorder.
    await h.at(10_000);
    expect(h.factory.made).toHaveLength(1);
  });

  it("a recorder that gives no data at stop is a failure, and no segment comes", async () => {
    const h = setup([{ noData: true }]);
    h.rotator.start();
    await h.at(5000);
    expect(h.failures).toEqual([{ kind: "stop", current: false }]);
    expect(h.segments).toEqual([]);
    // The recorder after it carries on.
    expect(h.rotator.running).toBe(true);
  });

  it("a recorder that cannot be made is reported", async () => {
    const h = setup([{ throwOnCreate: true }]);
    h.rotator.start();
    await h.at(0);
    expect(h.failures).toEqual([{ kind: "create", current: false }]);
    expect(h.rotator.running).toBe(false);
  });

  it("a recorder that the browser stops by itself keeps its footage, then says the current recorder is gone", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(3000);
    h.factory.made[0].stop();
    await h.at(3100);
    expect(h.spans()).toEqual([[0, 3000, null]]);
    expect(h.failures).toEqual([{ kind: "record", current: true }]);
    expect(h.rotator.running).toBe(false);
  });
});

describe("stop and dispose", () => {
  it("stop() ends every recorder and settles when the segments are out", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(3000);
    const stopped = h.rotator.stop();
    await h.at(3000);
    await stopped;
    expect(h.spans()).toEqual([[0, 3000, null]]);
    expect(h.rotator.running).toBe(false);
    // Start again later: a new segment from then on.
    h.rotator.start();
    await h.at(4000);
    const again = h.rotator.stop();
    await h.at(4000);
    await again;
    expect(h.spans()).toEqual([
      [0, 3000, null],
      [3000, 4000, null],
    ]);
  });

  it("stop() in the middle of a hand-off ends both recorders; the old one is used only up to the new one's start", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(4600);
    expect(h.rotator.liveCount).toBe(2);
    // stop() does not wait for the rest of the overlap: it settles as soon as both segments are out.
    await Promise.all([h.rotator.stop(), h.at(4600)]);
    await h.at(4700);
    // The old window ends where the new segment starts, so the two windows never overlap (Record joins them).
    expect(h.spans()).toEqual([
      [0, 4600, 4500],
      [4500, 4600, null],
    ]);
    expect(h.failures).toEqual([]);
  });

  it("stop() while a hand-off's new recorder still starts is not a failed hand-off", async () => {
    // Two pauses, each while a new recorder starts: before the fix they turned on the one-recorder fallback for good.
    const h = setup([{}, { noStartEvent: true }, {}, { noStartEvent: true }]);
    h.rotator.start();
    await h.at(4550);
    await Promise.all([h.rotator.stop(), h.at(4600)]);
    h.rotator.start();
    await h.at(9150);
    await Promise.all([h.rotator.stop(), h.at(9200)]);
    expect(h.rotator.sequential).toBe(false);
    expect(h.failures).toEqual([]);
    expect(h.rotator.liveCount).toBe(0);
  });

  it("dispose() drops everything: no segment and no failure after it", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(2000);
    h.rotator.dispose();
    await h.at(20_000);
    expect(h.segments).toEqual([]);
    expect(h.failures).toEqual([]);
    expect(h.rotator.running).toBe(false);
  });
});
