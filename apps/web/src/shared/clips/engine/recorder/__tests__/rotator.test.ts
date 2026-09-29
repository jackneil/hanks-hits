// @vitest-environment node
/**
 * Rotating MediaRecorders (tiers M and V, plan 5): rotation timing, the
 * hand-off overlap, hand-offs on demand, and every failure path, on the
 * MediaRecorder double and one test clock.
 */
import { describe, expect, it } from "vitest";
import {
  FakeMediaStream,
  fakeRecorderFactory,
  type FakeMediaRecorder,
  type FakeRecorderBehavior,
} from "../../../../../__tests__/mediarecorder-mock";
import { HANDOFF_OVERLAP_MS, ROTATION_MS } from "../constants";
import { Rotator, type FinishedSegment, type MediaRecorderLike, type RotatorFailure } from "../rotator";
import { TestClock } from "./testClock";

const START = 10_000;

function setup(behaviors: FakeRecorderBehavior[] = []) {
  const clock = new TestClock(START);
  const captureUs = () => (clock.t - START) * 1000;
  const segments: FinishedSegment[] = [];
  const failures: Array<{ kind: RotatorFailure; current: boolean }> = [];
  let started = 0;
  const factory = fakeRecorderFactory({
    schedule: clock.schedule,
    captureUs,
    segment: (recorder) => new Blob([`segment ${recorder.id}`], { type: recorder.mimeType }),
    behaviors,
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
    onSegment: (segment) => segments.push(segment),
    onStarted: () => started++,
    onFailure: (kind, info) => failures.push({ kind, current: info.current }),
  });
  const at = (ms: number) => clock.advanceTo(START + ms);
  const spans = () => segments.map((s) => [s.startUs / 1000, s.endUs / 1000, s.nextStartUs === null ? null : s.nextStartUs / 1000]);
  const live = (made: FakeMediaRecorder[]) => made.filter((r) => r.state === "recording").length;
  return { clock, rotator, segments, failures, factory, at, spans, live, started: () => started };
}

describe("rotation", () => {
  it("starts a new recorder every ROTATION_MS; each segment ends HANDOFF_OVERLAP_MS after the next one starts", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(0);
    expect(h.rotator.running).toBe(true);
    await h.at(21_000);
    expect(ROTATION_MS).toBe(5000);
    expect(h.spans()).toEqual([
      [0, 5250, 5000],
      [5000, 10_250, 10_000],
      [10_000, 15_250, 15_000],
      [15_000, 20_250, 20_000],
    ]);
    // Every segment is a whole file from its own recorder.
    expect(h.factory.made).toHaveLength(5);
    expect(await h.segments[1].blob.text()).toBe(`segment ${h.factory.made[1].id}`);
    expect(h.segments.every((s) => s.mimeType === "video/webm;codecs=vp8,opus")).toBe(true);
    expect(h.failures).toEqual([]);
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
    // Only inside [5000, 5250), [10000, 10250), [15000, 15250).
    expect(doubled.every((ms) => [5000, 10_000, 15_000].some((h0) => ms >= h0 && ms < h0 + HANDOFF_OVERLAP_MS))).toBe(true);
    expect(doubled).toContain(5100);
    expect(h.live(h.factory.made)).toBe(1);
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
    await h.at(7300);
    // The next rotation is ROTATION_MS after the new recorder's start (2000 + 5000).
    expect(h.spans()).toEqual([
      [0, 2250, 2000],
      [2000, 7250, 7000],
    ]);
  });

  it("with no recorder, it only starts one", async () => {
    const h = setup();
    await h.rotator.handOff();
    await h.at(0);
    expect(h.rotator.running).toBe(true);
    expect(h.segments).toEqual([]);
  });
});

describe("failures", () => {
  it("a new recorder that fails in a hand-off leaves the old one recording, and the hand-off is tried again", async () => {
    const h = setup([{}, { errorAtStart: true }]);
    h.rotator.start();
    await h.at(5100);
    expect(h.failures).toEqual([{ kind: "start", current: false }]);
    expect(h.rotator.running).toBe(true);
    expect(h.segments).toEqual([]);
    // The retry (1000 ms later) works: the old segment ends 250 ms after it.
    await h.at(6400);
    expect(h.spans()).toEqual([[0, 6250, 6000]]);
  });

  it("a device that runs one recorder at a time: after two failed overlaps, hand-offs stop the old recorder first", async () => {
    // Recorder 1 works; every second recorder next to it fails; alone they work.
    const h = setup([{}, { errorAtStart: true }, { errorAtStart: true }, {}, {}]);
    h.rotator.start();
    await h.at(5100);
    expect(h.rotator.sequential).toBe(false);
    await h.at(6100);
    expect(h.failures).toEqual([
      { kind: "start", current: false },
      { kind: "start", current: false },
    ]);
    expect(h.rotator.sequential).toBe(true);
    // The retry at 7000 is sequential: the old one stops at 7000, the new one starts then.
    await h.at(7100);
    expect(h.spans()).toEqual([[0, 7000, null]]);
    expect(h.rotator.running).toBe(true);
    expect(h.rotator.liveCount).toBe(1);
    // Rotation goes on without overlap: the next hand-off at 12 000.
    let most = 0;
    for (let ms = 7100; ms <= 13_000; ms += 50) {
      await h.at(ms);
      most = Math.max(most, h.factory.made.filter((r) => r.state === "recording").length);
    }
    expect(most).toBe(1);
    expect(h.spans()).toEqual([
      [0, 7000, null],
      [7000, 12_000, null],
    ]);
  });

  it("a recorder with no start event fails after the start timeout", async () => {
    const h = setup([{ noStartEvent: true }]);
    h.rotator.start();
    await h.at(2999);
    expect(h.failures).toEqual([]);
    await h.at(3000);
    expect(h.failures).toEqual([{ kind: "start", current: true }]);
    expect(h.rotator.running).toBe(false);
  });

  it("the current recorder that errors is dropped with its footage, and the rotator stops", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(1000);
    h.factory.made[0].fail();
    await h.at(1100);
    expect(h.failures).toEqual([{ kind: "record", current: true }]);
    expect(h.segments).toEqual([]);
    expect(h.rotator.running).toBe(false);
    // No rotation runs for the dropped recorder.
    await h.at(10_000);
    expect(h.factory.made).toHaveLength(1);
  });

  it("a recorder that gives no data at stop is a failure, and no segment comes", async () => {
    const h = setup([{ noData: true }]);
    h.rotator.start();
    await h.at(5500);
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

  it("stop() in the middle of a hand-off ends both recorders, with no gap", async () => {
    const h = setup();
    h.rotator.start();
    await h.at(5100);
    expect(h.rotator.liveCount).toBe(2);
    // stop() does not wait for the rest of the overlap: it settles as soon as both segments are out.
    await Promise.all([h.rotator.stop(), h.at(5100)]);
    await h.at(5200);
    expect(h.spans()).toEqual([
      [0, 5100, null],
      [5000, 5100, null],
    ]);
    expect(h.failures).toEqual([]);
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
