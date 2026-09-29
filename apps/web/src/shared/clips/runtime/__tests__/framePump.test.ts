import { describe, expect, it } from "vitest";
import type { EncodeCmd, FrameIn, HudState } from "../../protocol";
import { FramePump, type FrameSink } from "../framePump";

const HUD: HudState = { gameName: "Test", emoji: "🎮" };

class FakeFrame {
  closed = false;
  constructor(readonly contentMs: number) {}
  close(): void {
    this.closed = true;
  }
}

/** Records posts. The test decides when the worker replies "consumed". */
class Sink implements FrameSink {
  messages: EncodeCmd[] = [];
  transfers: Transferable[][] = [];
  unconsumed = 0;
  postMessage(message: EncodeCmd, transfer: Transferable[]): void {
    this.messages.push(message);
    this.transfers.push(transfer);
    if (message.t === "frame" || message.t === "pixels") this.unconsumed++;
  }
  frames(): Extract<FrameIn, { t: "frame" }>[] {
    return this.messages.filter((m): m is Extract<FrameIn, { t: "frame" }> => m.t === "frame");
  }
  timeline(): Extract<EncodeCmd, { t: "timeline" }>[] {
    return this.messages.filter((m): m is Extract<EncodeCmd, { t: "timeline" }> => m.t === "timeline");
  }
  /** Worker replies to every frame it has. */
  consumeAll(pump: FramePump): void {
    while (this.unconsumed > 0) {
      this.unconsumed--;
      pump.consumed();
    }
  }
}

/** Deterministic pseudo-random numbers in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Path D style: offer and submit in the same frame. */
function captureAt(pump: FramePump, t: number, frames: FakeFrame[]): void {
  const ticket = pump.offer(t);
  if (!ticket) return;
  const f = new FakeFrame(t);
  frames.push(f);
  pump.submit(ticket, { t: "frame", frame: f as unknown as VideoFrame }, HUD);
}

function expectContiguous(frames: Extract<FrameIn, { t: "frame" }>[]): void {
  for (let i = 1; i < frames.length; i++) {
    expect(frames[i].tsUs).toBe(frames[i - 1].tsUs + frames[i - 1].durUs);
  }
}

describe("FramePump timing", () => {
  for (const target of [30, 60] as const) {
    it(`a 41 fps irregular trace over 30 s at a ${target} fps target: video as long as the wall time, stamps from time`, () => {
      const sink = new Sink();
      const pump = new FramePump({ sink, displayHz: 60, targetFps: target });
      const rnd = lcg(41);
      const v = 1000 / 60;
      const made: FakeFrame[] = [];
      let n = 0;
      const times: number[] = [];
      const t0 = 5000;
      while (n * v < 30000) {
        const jitter = (rnd() - 0.5) * 1.6;
        const t = t0 + n * v + jitter;
        times.push(t);
        sink.consumeAll(pump);
        captureAt(pump, t, made);
        n += rnd() < 0.537 ? 1 : 2;
      }
      const gameFps = (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000);
      expect(gameFps).toBeGreaterThan(39);
      expect(gameFps).toBeLessThan(43);
      sink.consumeAll(pump);
      pump.flush();
      const frames = sink.frames();
      expectContiguous(frames);
      const first = frames[0];
      const last = frames[frames.length - 1];
      const videoMs = (last.tsUs + last.durUs - first.tsUs) / 1000;
      const wallMs = times[times.length - 1] - times[0];
      expect(Math.abs(videoMs - wallMs)).toBeLessThanOrEqual(pump.slotUs / 1000);
      // Each frame is stamped at the middle of the k vsyncs of its slot:
      // (k - 1) / 2 vsyncs before the slot start that holds its content time.
      // So content minus stamp is between (k - 1) / 2 and (k - 1) * 1.5
      // vsyncs, plus the jitter of this frame and of the first one (0.8 ms
      // each). The first frame is clamped at 0. A pump that counted frames
      // instead would drift by seconds at a 60 fps target, where a third of
      // the slots are empty.
      const base = (first.frame as unknown as FakeFrame).contentMs;
      const jitterUs = 1700;
      const centerUs = ((pump.stride - 1) / 2) * v * 1000;
      const bound = (pump.stride - 1) * v * 1000 + centerUs + jitterUs;
      expect(first.tsUs).toBe(0);
      for (const f of frames.slice(1)) {
        const contentUs = ((f.frame as unknown as FakeFrame).contentMs - base) * 1000;
        expect(contentUs - f.tsUs).toBeGreaterThanOrEqual(centerUs - jitterUs);
        expect(contentUs - f.tsUs).toBeLessThanOrEqual(bound);
      }
      // Every duration after the first is a whole number of slots. The first
      // is (k - 1) / 2 vsyncs shorter (it starts at media time 0).
      expect(Math.abs(first.durUs - (pump.slotUs * Math.round((first.durUs + centerUs) / pump.slotUs) - centerUs))).toBeLessThanOrEqual(1);
      for (const f of frames.slice(1)) {
        const slots = f.durUs / pump.slotUs;
        expect(Math.abs(slots - Math.round(slots))).toBeLessThan(0.001);
        expect(Math.round(slots)).toBeGreaterThanOrEqual(1);
      }
      // The capture rate never exceeds the target.
      expect(frames.length).toBeLessThanOrEqual(Math.ceil(wallMs / (1000 / target)) + 1);
      if (target === 60) expect(frames.some((f) => f.durUs > pump.slotUs + 1)).toBe(true);
      expect(pump.stats().dropsBackpressure).toBe(0);
    });
  }

  for (const hz of [50, 60, 75, 90, 120, 144, 165]) {
    for (const target of [30, 60] as const) {
      it(`gives uniform durations at ${hz} Hz for a ${target} fps target`, () => {
        const sink = new Sink();
        const pump = new FramePump({ sink, displayHz: hz, targetFps: target });
        const v = 1000 / hz;
        const rnd = lcg(hz * target);
        const made: FakeFrame[] = [];
        for (let n = 0; n < hz * 10; n++) {
          sink.consumeAll(pump);
          // Jitter of up to 20% of a vsync on every timestamp (the first one
          // included) must not move a frame to another slot.
          captureAt(pump, 100 + n * v + (rnd() - 0.5) * 0.4 * v, made);
        }
        const frames = sink.frames();
        expect(frames.length).toBeGreaterThan(10);
        expectContiguous(frames);
        // The first frame starts at media time 0, (k - 1) / 2 vsyncs short of a slot.
        const centerUs = ((pump.stride - 1) / 2) * v * 1000;
        expect(Math.abs(frames[0].durUs - (pump.slotUs - centerUs))).toBeLessThanOrEqual(1);
        for (const f of frames.slice(1)) expect(Math.abs(f.durUs - pump.slotUs)).toBeLessThanOrEqual(1);
        const fps = 1e6 / pump.slotUs;
        expect(fps).toBeLessThanOrEqual(target + 1e-9);
        // Taken frames are the frames on the slot starts, stamped (k - 1) / 2 vsyncs earlier.
        const base = (frames[0].frame as unknown as FakeFrame).contentMs;
        for (const f of frames.slice(1)) {
          const content = (f.frame as unknown as FakeFrame).contentMs - base;
          expect(Math.abs(content * 1000 - centerUs - f.tsUs)).toBeLessThanOrEqual(0.4 * v * 1000 + 1);
        }
      });
    }
  }

  it("does not burst after a 500 ms stall of the game", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30 });
    const v = 1000 / 60;
    const made: FakeFrame[] = [];
    let t = 0;
    for (; t < 2000; t += v) {
      sink.consumeAll(pump);
      captureAt(pump, t, made);
    }
    const stallStart = t - v;
    t = stallStart + 500 + v;
    const afterStall = t;
    for (; t < 4000; t += v) {
      sink.consumeAll(pump);
      captureAt(pump, t, made);
    }
    sink.consumeAll(pump);
    pump.flush();
    const frames = sink.frames();
    expectContiguous(frames);
    const long = frames.filter((f) => f.durUs > pump.slotUs + 1);
    expect(long).toHaveLength(1);
    expect(long[0].durUs / 1000).toBeGreaterThan(500);
    // After the stall the cadence is the normal one: no catch-up frames.
    const taken = made.filter((f) => f.contentMs >= afterStall && f.contentMs < afterStall + 200);
    expect(taken.length).toBeLessThanOrEqual(Math.floor(200 / (1000 / 30)) + 1);
    // The first frame starts at media time 0 (see the centering rule); every other frame lasts a slot or more.
    for (const f of frames.slice(1)) expect(f.durUs).toBeGreaterThanOrEqual(pump.slotUs - 1);
  });

  it("holds at most 2 frames in flight, counts drops, and does not burst after a worker stall", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30 });
    const v = 1000 / 60;
    const made: FakeFrame[] = [];
    let maxSeen = 0;
    for (let t = 0; t < 3000; t += v) {
      const workerStalled = t >= 1000 && t < 1500;
      if (!workerStalled) sink.consumeAll(pump);
      captureAt(pump, t, made);
      maxSeen = Math.max(maxSeen, pump.stats().inFlight);
    }
    expect(maxSeen).toBeLessThanOrEqual(2);
    const s = pump.stats();
    expect(s.dropsBackpressure).toBeGreaterThan(10);
    expect(s.dropsBackpressure).toBeLessThanOrEqual(16);
    const frames = sink.frames();
    expectContiguous(frames);
    const long = frames.filter((f) => f.durUs > pump.slotUs + 1);
    expect(long.length).toBe(1);
    expect(long[0].durUs / 1000).toBeGreaterThan(400);
    // Every taken frame is either sent, held, or closed; none leaks.
    const sentOrHeld = frames.length + 1;
    expect(made.filter((f) => !f.closed).length).toBe(sentOrHeld);
  });

  it("removes paused time and posts the timeline to the worker", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30 });
    const v = 1000 / 60;
    const made: FakeFrame[] = [];
    for (let t = 1000; t < 2000; t += v) {
      sink.consumeAll(pump);
      captureAt(pump, t, made);
    }
    pump.pause(2000);
    // The game keeps drawing its pause screen; nothing is taken.
    for (let t = 2000; t < 5000; t += v) captureAt(pump, t, made);
    sink.consumeAll(pump);
    pump.resume(5000);
    for (let t = 5000 + v; t < 6000; t += v) {
      sink.consumeAll(pump);
      captureAt(pump, t, made);
    }
    sink.consumeAll(pump);
    pump.flush();
    const frames = sink.frames();
    expectContiguous(frames);
    const total = (frames[frames.length - 1].tsUs + frames[frames.length - 1].durUs) / 1000;
    expect(Math.abs(total - 2000)).toBeLessThanOrEqual(2 * v);
    expect(sink.timeline()).toEqual([
      { t: "timeline", state: "live", atPerfMs: 1000 },
      { t: "timeline", state: "paused", atPerfMs: 2000 },
      { t: "timeline", state: "live", atPerfMs: 5000 },
    ]);
    // The frame before the pause ends at the pause point.
    const beforePause = frames.filter((f) => f.tsUs < 1000 * 1000);
    const lastBefore = beforePause[beforePause.length - 1];
    expect(Math.abs(lastBefore.tsUs + lastBefore.durUs - 1000 * 1000)).toBeLessThanOrEqual(v * 1000);
  });

  it("pause before the first frame removes nothing and posts nothing", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30 });
    pump.pause(10);
    expect(pump.offer(20)).toBeNull();
    pump.resume(500);
    expect(sink.messages).toHaveLength(0);
    const ticket = pump.offer(600);
    expect(ticket?.tsUs).toBe(0);
  });

  it("keeps the later frame when two frames get the same timestamp", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30 });
    const a = new FakeFrame(0);
    const b = new FakeFrame(1);
    const ta = pump.offer(0)!;
    pump.submit(ta, { t: "frame", frame: a as unknown as VideoFrame }, HUD);
    // A rung change starts a new segment; the next frame lands on the same vsync.
    pump.configure({ stride: 3 });
    const tb = pump.offer(0.4)!;
    expect(tb.tsUs).toBe(ta.tsUs);
    pump.submit(tb, { t: "frame", frame: b as unknown as VideoFrame }, HUD);
    expect(a.closed).toBe(true);
    expect(pump.stats().replaced).toBe(1);
    const tc = pump.offer(50)!;
    pump.submit(tc, { t: "frame", frame: new FakeFrame(50) as unknown as VideoFrame }, HUD);
    const frames = sink.frames();
    expect(frames).toHaveLength(1);
    expect(frames[0].frame).toBe(b);
    // The next slot starts at vsync 3; at stride 3 it is stamped one vsync earlier (the middle of its 3 vsyncs).
    expect(frames[0].durUs).toBe(33333);
  });

  // FINDING 2 of the lab (plan 15.2): an event between two captures shows in
  // the next capture. With the frame stamped at its slot start, the picture
  // trailed the sound by up to k - 1 vsyncs (50 ms at 15 fps on 60 Hz, past
  // the BT.1359 45 ms lead limit). Centered, it is off by at most (k - 1) / 2.
  for (const hz of [60, 75, 120, 144]) {
    for (const k of [1, 2, 3, 4, 8]) {
      it(`an event on any vsync shows at most (k - 1) / 2 vsyncs off its time (${hz} Hz, stride ${k})`, () => {
        const sink = new Sink();
        const pump = new FramePump({ sink, displayHz: hz, targetFps: Math.max(1, Math.floor(hz / k)), stride: k });
        const v = 1000 / hz;
        const vUs = v * 1000;
        const made: FakeFrame[] = [];
        const vsyncs = 12 * k + 7;
        for (let n = 0; n < vsyncs; n++) {
          sink.consumeAll(pump);
          captureAt(pump, 1000 + n * v, made);
        }
        sink.consumeAll(pump);
        pump.flush();
        const frames = sink.frames();
        const contentVsync = (f: (typeof frames)[number]) => Math.round(((f.frame as unknown as FakeFrame).contentMs - 1000) / v);
        let worstLate = -Infinity;
        let worstEarly = Infinity;
        // Skip the first slot: the first frame is clamped at media time 0.
        for (let event = k; event < vsyncs - k; event++) {
          // The event starts at vsync `event`: the first frame whose content is at or after it shows it.
          const shown = frames.find((f) => contentVsync(f) >= event)!;
          const errorUs = shown.tsUs - event * vUs;
          worstLate = Math.max(worstLate, errorUs);
          worstEarly = Math.min(worstEarly, errorUs);
        }
        const limitUs = ((k - 1) / 2) * vUs + 1;
        expect(worstLate).toBeLessThanOrEqual(limitUs);
        expect(worstEarly).toBeGreaterThanOrEqual(-limitUs);
        // Both ends are reached: the error is centered, not shifted to one side.
        if (k > 1) {
          expect(worstLate).toBeGreaterThan(limitUs - vUs);
          expect(worstEarly).toBeLessThan(-(limitUs - vUs));
        }
      });
    }
  }

  it("changes rung mid-stream with contiguous timestamps", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30 });
    const v = 1000 / 60;
    const made: FakeFrame[] = [];
    let t = 0;
    for (; t < 1000; t += v) {
      sink.consumeAll(pump);
      captureAt(pump, t, made);
    }
    pump.configure({ stride: 3 });
    for (; t < 2000; t += v) {
      sink.consumeAll(pump);
      captureAt(pump, t, made);
    }
    sink.consumeAll(pump);
    pump.flush();
    const frames = sink.frames();
    expectContiguous(frames);
    const late = frames.filter((f) => f.tsUs > 1_100_000 && f.tsUs < 1_900_000);
    for (const f of late) expect(Math.abs(f.durUs - 50000)).toBeLessThanOrEqual(1);
    expect(() => pump.configure({ stride: 0 })).toThrow(RangeError);
  });

  it("sends pixels payloads with their buffer in the transfer list", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30 });
    const t1 = pump.offer(0)!;
    const buf = new ArrayBuffer(16);
    pump.submit(t1, { t: "pixels", data: buf, width: 2, height: 2 }, HUD);
    pump.flush();
    const msg = sink.messages.find((m) => m.t === "pixels");
    expect(msg).toMatchObject({ t: "pixels", width: 2, height: 2, tsUs: 0, durUs: 33333 });
    expect(sink.transfers[sink.messages.indexOf(msg!)]).toEqual([buf]);
  });

  it("closes out-of-order and stale payloads, and abandon keeps order", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30 });
    const t1 = pump.offer(0)!;
    const t2 = pump.offer(40)!;
    pump.abandon(t1);
    const late = new FakeFrame(0);
    pump.submit(t1, { t: "frame", frame: late as unknown as VideoFrame }, HUD);
    expect(late.closed).toBe(true);
    expect(pump.stats().outOfOrder).toBe(1);
    expect(pump.stats().abandoned).toBe(1);
    const ok = new FakeFrame(40);
    pump.submit(t2, { t: "frame", frame: ok as unknown as VideoFrame }, HUD);
    expect(ok.closed).toBe(false);
    // A made-up ticket the pump never gave out is refused.
    const fake = new FakeFrame(1);
    pump.submit({ seq: 999, tsUs: 0 }, { t: "frame", frame: fake as unknown as VideoFrame }, HUD);
    expect(fake.closed).toBe(true);
  });

  it("abandoning a newer ticket keeps the older open tickets valid (path E busy slot)", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 60 });
    const v = 1000 / 60;
    const t1 = pump.offer(0)!;
    const t2 = pump.offer(v)!;
    const t3 = pump.offer(2 * v)!;
    // The newest readback cannot be queued; the two older ones are in flight.
    pump.abandon(t3);
    const a = new FakeFrame(0);
    const b = new FakeFrame(v);
    pump.submit(t1, { t: "frame", frame: a as unknown as VideoFrame }, HUD);
    pump.submit(t2, { t: "frame", frame: b as unknown as VideoFrame }, HUD);
    expect(a.closed).toBe(false);
    expect(b.closed).toBe(false);
    expect(pump.stats()).toMatchObject({ captured: 2, abandoned: 1, outOfOrder: 0 });
    // Abandoning twice counts once; an unknown ticket is ignored.
    pump.abandon(t3);
    pump.abandon({ seq: 999, tsUs: 0 });
    expect(pump.stats().abandoned).toBe(1);
  });

  it("submitting a newer ticket makes the older open ones stale", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 60 });
    const t1 = pump.offer(0)!;
    const t2 = pump.offer(20)!;
    pump.submit(t2, { t: "frame", frame: new FakeFrame(20) as unknown as VideoFrame }, HUD);
    const late = new FakeFrame(0);
    pump.submit(t1, { t: "frame", frame: late as unknown as VideoFrame }, HUD);
    expect(late.closed).toBe(true);
    expect(pump.stats().outOfOrder).toBe(1);
    // A stale ticket cannot be abandoned into the count either.
    pump.abandon(t1);
    expect(pump.stats().abandoned).toBe(0);
  });

  it("configure with no real change keeps the stride and the slot grid", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30 });
    pump.configure({ stride: 4 });
    const made: FakeFrame[] = [];
    captureAt(pump, 0, made);
    pump.configure({ targetFps: 30 });
    pump.configure({ displayHz: 60, targetFps: 30 });
    pump.configure({});
    expect(pump.stride).toBe(4);
    // Still the same grid: a frame one vsync later is in the same slot.
    expect(pump.offer(1000 / 60)).toBeNull();
    // A new target resets to its top rung.
    pump.configure({ targetFps: 60 });
    expect(pump.stride).toBe(1);
    expect(pump.started).toBe(true);
  });

  it("stop closes a held frame that cannot be sent and refuses later frames", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30, maxInFlight: 1 });
    const made: FakeFrame[] = [];
    captureAt(pump, 0, made);
    captureAt(pump, 34, made);
    expect(pump.stats().inFlight).toBe(1);
    pump.stop();
    expect(made[1].closed).toBe(true);
    expect(pump.offer(100)).toBeNull();
    const after = new FakeFrame(200);
    pump.submit({ seq: 3, tsUs: 0 }, { t: "frame", frame: after as unknown as VideoFrame }, HUD);
    expect(after.closed).toBe(true);
    pump.consumed();
    pump.consumed();
    expect(pump.stats().inFlight).toBe(0);
  });

  it("a sealed frame waits for a consumed reply, then goes out", () => {
    const sink = new Sink();
    const pump = new FramePump({ sink, displayHz: 60, targetFps: 30, maxInFlight: 1 });
    const made: FakeFrame[] = [];
    captureAt(pump, 0, made);
    captureAt(pump, 34, made);
    pump.pause(50);
    expect(sink.frames()).toHaveLength(1);
    pump.consumed();
    expect(sink.frames()).toHaveLength(2);
    expect(sink.frames()[1].tsUs + sink.frames()[1].durUs).toBe(50000);
  });

  it("counts a failed post as a drop and closes the frame", () => {
    const pump = new FramePump({
      sink: {
        postMessage: (m: EncodeCmd) => {
          if (m.t === "frame") throw new DOMException("detached", "DataCloneError");
        },
      },
      displayHz: 60,
      targetFps: 30,
    });
    const made: FakeFrame[] = [];
    captureAt(pump, 0, made);
    pump.flush();
    expect(made[0].closed).toBe(true);
    expect(pump.stats().dropsLate).toBe(1);
    expect(pump.stats().sent).toBe(0);
  });
});
