import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeVideoFrame,
  fakeAccessUnitTimestamp,
  flushMicrotasks,
  installWebCodecsMock,
  rgbaPixels,
  type WebCodecsMock,
} from "@/__tests__/webcodecs-mock";
import type { EngineErrorCode, EpochInfo, VideoEncoderChoice } from "../../../protocol";
import { KEYFRAME_STARVATION_US, VideoSession, encoderConfigFor, sameDecoderConfig, type VideoPacket } from "../videoSession";

const CHOICE: VideoEncoderChoice = {
  codec: "avc1.64001f",
  width: 720,
  height: 1280,
  bitrate: 2_000_000,
  framerate: 30,
  latencyMode: "quality",
  hardwareAcceleration: "prefer-hardware",
};
const FRAME_US = 33_333;

let mock: WebCodecsMock;
beforeEach(() => {
  mock = installWebCodecsMock();
});
afterEach(() => {
  expect(mock.openFrames()).toBe(0);
  mock.uninstall();
});

function vf(tsUs: number): VideoFrame {
  return new FakeVideoFrame(rgbaPixels(4, 4), { format: "RGBA", codedWidth: 4, codedHeight: 4, timestamp: tsUs, duration: FRAME_US }) as unknown as VideoFrame;
}

function harness(choice = CHOICE, now = () => 0, options: { flushTimeoutMs?: number } = {}) {
  const packets: VideoPacket[] = [];
  const epochs: EpochInfo[] = [];
  const errors: Array<{ code: EngineErrorCode; detail: string }> = [];
  const session = new VideoSession(
    choice,
    { onPacket: (p) => packets.push(p), onEpoch: (e) => epochs.push(e), onError: (code, detail) => errors.push({ code, detail }) },
    { now, flushTimeoutMs: options.flushTimeoutMs },
  );
  /** Encodes frames at 30 fps from startUs for count frames, letting the fake codec work after each. */
  async function run(startUs: number, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      session.encode(vf(startUs + i * FRAME_US));
      await flushMicrotasks(3);
    }
  }
  return { session, packets, epochs, errors, run };
}

const keysOf = (ps: VideoPacket[]) => ps.filter((p) => p.type === "key").map((p) => p.tsUs);

describe("encoderConfigFor", () => {
  it("always uses quality latency, VBR and the avc format", () => {
    expect(encoderConfigFor({ ...CHOICE, hardwareAcceleration: "no-preference" })).toEqual({
      codec: "avc1.64001f",
      width: 720,
      height: 1280,
      bitrate: 2_000_000,
      bitrateMode: "variable",
      framerate: 30,
      latencyMode: "quality",
      hardwareAcceleration: "no-preference",
      avc: { format: "avc" },
    });
  });
});

describe("VideoSession", () => {
  it("requests a keyframe every second and verifies each one", async () => {
    const h = harness();
    await h.run(0, 105); // 3.5 s
    await h.session.closeEncoder();
    const enc = mock.videoEncoders[0];
    const requested = enc.encodeCalls.filter((c) => c.keyFrame).map((c) => c.timestamp);
    expect(requested).toEqual([0, 30 * FRAME_US, 60 * FRAME_US, 90 * FRAME_US]);
    expect(keysOf(h.packets)).toEqual(requested);
    expect(h.session.stats.keyMismatches).toBe(0);
    expect(h.session.stats.framesEncoded).toBe(105);
    expect(h.packets.every((p) => p.data instanceof ArrayBuffer && p.epoch === 0)).toBe(true);
    expect(h.packets.map((p) => fakeAccessUnitTimestamp(p.data))).toEqual(h.packets.map((p) => p.tsUs));
  });

  it("does not let a key without an IDR start a GOP (mediabunny #365)", async () => {
    mock.video.labelFault = (i) => (i === 30 ? "key-without-idr" : i === 45 ? "idr-as-delta" : null);
    const h = harness();
    await h.run(0, 80);
    await h.session.closeEncoder();
    // Frame 30 said "key" with no IDR: not a GOP start. Frame 45 was an IDR marked "delta": a GOP start,
    // and it answers the open request, so the next request is 1 s after it (frame 75).
    expect(keysOf(h.packets)).toEqual([0, 45 * FRAME_US, 75 * FRAME_US]);
    expect(h.session.stats.keyMismatches).toBe(2);
    expect(h.errors).toEqual([]);
  });

  it("drops a frame when two are already queued, and never queues it", async () => {
    const h = harness();
    h.session.start();
    mock.videoEncoders[0].stall(true);
    for (let i = 0; i < 5; i++) expect(h.session.encode(vf(i * FRAME_US))).toBe(i < 2);
    expect(h.session.stats.framesDropped).toBe(3);
    expect(h.session.stats.encodeQueueMax).toBe(2);
    mock.videoEncoders[0].stall(false);
    await flushMicrotasks();
    // The keyframe request stays with the first frame that the encoder takes.
    expect(mock.videoEncoders[0].encodeCalls[0].keyFrame).toBe(true);
    await h.session.closeEncoder();
  });

  it("recovers from keyframe starvation with reset() plus configure() and a new epoch", async () => {
    mock.video.honorKeyFrameRequests = false; // Chromium Android: a 3000-frame GOP
    const h = harness();
    await h.run(0, 150); // 5 s
    await h.session.closeEncoder();
    const enc = mock.videoEncoders[0];
    expect(mock.videoEncoders).toHaveLength(1);
    expect(enc.resetCalls).toBe(1);
    expect(enc.configureCalls).toHaveLength(2);
    expect(h.errors.map((e) => e.code)).toEqual(["keyframe-starved"]);
    // Frame 30 asked for a keyframe and came out as a delta when frame 31 went in (latency 1): the
    // encoder skipped the request. The reset happens at the first frame 3 s after that.
    const resetAt = Math.ceil((31 * FRAME_US + KEYFRAME_STARVATION_US) / FRAME_US) * FRAME_US;
    expect(keysOf(h.packets)).toEqual([0, resetAt]);
    expect(h.epochs.map((e) => e.epoch)).toEqual([0, 1]);
    expect(h.packets.filter((p) => p.tsUs >= resetAt).every((p) => p.epoch === 1)).toBe(true);
    expect(h.session.stats.starvations).toBe(1);
  });

  it("recovers a hung encoder whose queue never drains: the health check runs before the backpressure drop", async () => {
    // Android MediaCodec that stops returning input buffers: encodeQueueSize stays at 2, no output, no error.
    const h = harness();
    await h.run(0, 30); // output flows first: the session is past its cold start
    const enc = mock.videoEncoders[0];
    enc.stall(true);
    await h.run(30 * FRAME_US, 150); // 5 s of frames into the hung encoder
    expect(enc.resetCalls).toBe(1);
    expect(h.errors.map((e) => e.code)).toEqual(["keyframe-starved"]);
    expect(h.errors[0].detail).toMatch(/no output/);
    expect(h.session.stats.starvations).toBe(1);
    // The reset emptied the queue. Once the codec works again, the new epoch starts at a keyframe.
    enc.stall(false);
    await h.run(180 * FRAME_US, 30);
    await h.session.closeEncoder();
    const epoch1 = h.packets.filter((p) => p.epoch === 1);
    expect(epoch1.length).toBeGreaterThan(20);
    expect(epoch1[0].type).toBe("key");
    expect(h.epochs.map((e) => e.epoch)).toEqual([0, 1]);
    // Still hung after the reset: the new session is warming, so no reset loop.
    expect(enc.resetCalls).toBe(1);
  });

  it("never resets a warming encoder, even with a first output after 4 s (cold start)", async () => {
    mock.video.outputLatencyFrames = 120; // about 4 s at 30 fps before the first output
    const h = harness();
    await h.run(0, 600); // 20 s
    const enc = mock.videoEncoders[0];
    expect(h.errors).toEqual([]);
    expect(enc.resetCalls).toBe(0);
    expect(mock.videoEncoders).toHaveLength(1);
    expect(h.packets[0]).toMatchObject({ type: "key", tsUs: 0, epoch: 0 });
    expect(h.packets.length).toBeGreaterThan(400);
    await h.session.closeEncoder();
  });

  it("stays warming (no reset) while an encoder gives no output at all; the main thread decides", async () => {
    const h = harness();
    h.session.start();
    mock.videoEncoders[0].stall(true);
    await h.run(0, 300); // 10 s
    expect(mock.videoEncoders[0].resetCalls).toBe(0);
    expect(h.session.warming).toBe(true);
    expect(h.errors).toEqual([]);
    h.session.close();
  });

  it("closes a hung encoder when its flush does not finish in time, so the caller never waits forever", async () => {
    const h = harness(CHOICE, () => 0, { flushTimeoutMs: 30 });
    await h.run(0, 10);
    const enc = mock.videoEncoders[0];
    enc.stall(true);
    h.session.encode(vf(10 * FRAME_US));
    const started = Date.now();
    await h.session.closeEncoder();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(enc.state).toBe("closed");
    expect(h.errors.map((e) => e.code)).toEqual(["encoder-error"]);
    expect(h.errors[0].detail).toMatch(/flush did not finish/);
    expect(h.session.stats.flushTimeouts).toBe(1);
    // The next frame opens a new encoder on a new epoch.
    await h.run(11 * FRAME_US, 5);
    await h.session.closeEncoder();
    expect(mock.videoEncoders).toHaveLength(2);
    expect(h.packets.filter((p) => p.epoch === 1)[0]).toMatchObject({ type: "key", tsUs: 11 * FRAME_US });
  });

  it("admits a frame before painting only when encode() will take it, and counts a refusal as a drop", async () => {
    const h = harness();
    expect(h.session.admit(0)).toBe(true);
    const enc = mock.videoEncoders[0];
    enc.stall(true);
    h.session.encode(vf(0));
    h.session.encode(vf(FRAME_US));
    expect(h.session.admit(2 * FRAME_US)).toBe(false);
    expect(h.session.stats.framesDropped).toBe(1);
    expect(h.session.stats.framesIn).toBe(3);
    enc.stall(false);
    await flushMicrotasks();
    expect(h.session.admit(3 * FRAME_US)).toBe(true);
    h.session.close();
  });

  it("releases the Record tail: the frames before the stop mark, with the held delta, and gives up in a pause", async () => {
    const h = harness();
    await h.run(0, 10);
    const mark = h.session.tailMark();
    expect(mark.lastTs).toBe(9 * FRAME_US);
    // The encoder keeps the newest frame until the next input (latency 1), and the guard holds one more.
    expect(h.packets.map((p) => p.tsUs)).not.toContain(9 * FRAME_US);
    expect(h.session.releaseTail(mark)).toBe(false);
    // No frame follows (a pause): give up, and commit what is out.
    expect(h.session.releaseTail(mark, true)).toBe(true);
    expect(h.packets[h.packets.length - 1].tsUs).toBe(8 * FRAME_US);
    // With play going on, the tail comes out on its own.
    h.session.encode(vf(10 * FRAME_US));
    await flushMicrotasks(3);
    expect(h.session.releaseTail(mark)).toBe(true);
    expect(h.packets[h.packets.length - 1].tsUs).toBe(9 * FRAME_US);
    // A mark from an encoder session that ended is always released.
    await h.session.closeEncoder();
    expect(h.session.releaseTail(mark)).toBe(true);
    expect(h.session.submittedEndUs).toBe(10 * FRAME_US + FRAME_US);
  });

  it("would not recover with an identical configure() alone (the Chromium no-op the reset avoids)", async () => {
    mock.video.honorKeyFrameRequests = false;
    mock.video.outputLatencyFrames = 0;
    const enc = new (globalThis as unknown as { VideoEncoder: typeof VideoEncoder }).VideoEncoder({ output: () => {}, error: () => {} });
    enc.configure(encoderConfigFor(CHOICE));
    const a = vf(0);
    enc.encode(a, { keyFrame: true });
    a.close();
    await enc.flush();
    enc.configure(encoderConfigFor(CHOICE));
    const b = vf(FRAME_US);
    enc.encode(b, { keyFrame: true });
    b.close();
    await enc.flush();
    const outs = mock.videoEncoders[0].outputs;
    expect(outs[0]).toMatchObject({ type: "key", hadConfig: true });
    // The second configure changed nothing: no new session, no config, no forced keyframe.
    expect(outs[1]).toMatchObject({ type: "delta", hadConfig: false });
    enc.close();
  });

  it("starts a new encoder and epoch after an encoder error", async () => {
    const h = harness();
    await h.run(0, 40);
    mock.videoEncoders[0].fail();
    expect(h.errors.map((e) => e.code)).toEqual(["encoder-error"]);
    await h.run(40 * FRAME_US, 40);
    await h.session.closeEncoder();
    expect(mock.videoEncoders).toHaveLength(2);
    expect(h.epochs.map((e) => e.epoch)).toEqual([0, 1]);
    const epoch1 = h.packets.filter((p) => p.epoch === 1);
    expect(epoch1[0].type).toBe("key");
    expect(epoch1[0].tsUs).toBe(40 * FRAME_US);
    expect(h.session.stats.epochsStarted).toBe(2);
  });

  it("reports a reclaim (QuotaExceededError) and recreates", async () => {
    const h = harness();
    await h.run(0, 10);
    mock.videoEncoders[0].reclaim();
    await h.run(10 * FRAME_US, 5);
    await h.session.closeEncoder();
    expect(h.errors.map((e) => e.code)).toEqual(["encoder-reclaimed"]);
    expect(mock.videoEncoders).toHaveLength(2);
  });

  it("gives up on a config the device cannot encode", async () => {
    const h = harness({ ...CHOICE, codec: "hev1.1.6.L93.B0" });
    await h.run(0, 5);
    expect(h.errors.map((e) => e.code)).toEqual(["config-unsupported"]);
    expect(h.session.failed).toBe(true);
    expect(mock.videoEncoders).toHaveLength(1);
    expect(h.session.stats.framesDropped).toBeGreaterThanOrEqual(4);
  });

  it("reports config-unsupported when VideoEncoder is missing", () => {
    mock.uninstall();
    mock = installWebCodecsMock({ videoEncoder: false });
    const h = harness();
    expect(h.session.start()).toBe(false);
    h.session.encode(vf(0));
    expect(h.errors.map((e) => e.code)).toEqual(["config-unsupported"]);
  });

  it("flushes and closes on closeEncoder, then opens a new epoch on the next frame", async () => {
    const h = harness();
    await h.run(0, 20);
    await h.session.closeEncoder();
    expect(mock.videoEncoders[0].state).toBe("closed");
    expect(h.packets).toHaveLength(20); // the flush delivered the held frame
    await h.run(20 * FRAME_US, 10);
    await h.session.closeEncoder();
    expect(mock.videoEncoders).toHaveLength(2);
    expect(h.packets.filter((p) => p.epoch === 1)[0]).toMatchObject({ type: "key", tsUs: 20 * FRAME_US });
  });

  it("drops a lone IDR at the end of an epoch, so two IDRs never meet at a boundary", async () => {
    const h = harness();
    await h.run(0, 31); // frame 30 (1.0 s) is a requested keyframe and the last frame of the epoch
    await h.session.closeEncoder();
    expect(h.session.stats.loneKeysDropped).toBe(1);
    expect(h.packets).toHaveLength(30);
    expect(h.packets[h.packets.length - 1]).toMatchObject({ type: "delta", tsUs: 29 * FRAME_US });
    await h.run(31 * FRAME_US, 5);
    await h.session.closeEncoder();
    // At the boundary a delta of epoch 0 meets the IDR of epoch 1.
    const i = h.packets.findIndex((p) => p.epoch === 1);
    expect(h.packets[i - 1].type).toBe("delta");
    expect(h.packets[i].type).toBe("key");
  });

  it("counts outputs that arrive out of timestamp order", async () => {
    mock.video.reorder = true;
    const h = harness();
    await h.run(0, 10);
    await h.session.closeEncoder();
    expect(h.session.stats.outOfOrder).toBeGreaterThan(0);
  });

  it("keeps a private copy of each epoch config and forgets unused ones", async () => {
    const h = harness();
    await h.run(0, 5);
    mock.videoEncoders[0].fail();
    await h.run(5 * FRAME_US, 5);
    await h.session.closeEncoder();
    const info0 = h.session.epochInfo(0)!;
    expect(sameDecoderConfig(info0, h.epochs[0])).toBe(true);
    expect(info0.description).not.toBe(h.epochs[0].description);
    expect(sameDecoderConfig(info0, h.session.epochInfo(1)!)).toBe(true); // same size and variant: splice-able
    h.session.retainEpochs(new Set([1]));
    expect(h.session.epochInfo(0)).toBeUndefined();
    expect(h.session.epochInfo(1)).toBeDefined();
  });

  it("keeps the encoder's color space per epoch, and never splices two epochs that differ only in it", async () => {
    const h = harness();
    await h.run(0, 5);
    expect(h.session.epochInfo(0)!.colorSpace).toEqual({ primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false });
    mock.video.colorSpace = { primaries: "smpte170m", transfer: "smpte170m", matrix: "smpte170m", fullRange: false };
    mock.videoEncoders[0].fail();
    await h.run(5 * FRAME_US, 5);
    await h.session.closeEncoder();
    const a = h.session.epochInfo(0)!;
    const b = h.session.epochInfo(1)!;
    expect(new Uint8Array(a.description)).toEqual(new Uint8Array(b.description));
    expect(sameDecoderConfig(a, b)).toBe(false);
    expect(h.epochs[1].colorSpace?.matrix).toBe("smpte170m");
    // No color space on either side (an encoder that reports none) still compares equal.
    expect(sameDecoderConfig({ ...a, colorSpace: undefined }, { ...a, colorSpace: undefined })).toBe(true);
  });

  it("starts a new epoch when the encoder changes its config inside a session", async () => {
    const h = harness();
    await h.run(0, 5);
    // Simulate a mid-session config change: the next session output carries different avcC bytes.
    const enc = mock.videoEncoders[0];
    enc.behavior.avcCVariant = 7;
    enc.reset();
    enc.configure(encoderConfigFor(CHOICE));
    await h.run(5 * FRAME_US, 5);
    await h.session.closeEncoder();
    expect(h.epochs.map((e) => e.epoch)).toEqual([0, 1]);
    expect(sameDecoderConfig(h.epochs[0], h.epochs[1])).toBe(false);
  });

  it("drops everything from before a purge, also frames still inside the encoder", async () => {
    mock.video.outputLatencyFrames = 3;
    const h = harness();
    await h.run(0, 40);
    h.session.purge();
    const cut = h.packets.length;
    await h.run(40 * FRAME_US, 20);
    await h.session.closeEncoder();
    const after = h.packets.slice(cut);
    expect(after[0]).toMatchObject({ type: "key", tsUs: 40 * FRAME_US });
    expect(after.every((p) => p.tsUs >= 40 * FRAME_US)).toBe(true);
    expect(after).toHaveLength(20);
  });

  it("measures time to first chunk", async () => {
    let t = 100;
    const h = harness(CHOICE, () => t);
    h.session.encode(vf(0));
    t = 160;
    h.session.encode(vf(FRAME_US));
    await flushMicrotasks();
    expect(h.session.stats.ttfcMs).toBe(60);
    await h.session.closeEncoder();
  });

  it("closes every frame, including dropped ones and frames after close()", async () => {
    const h = harness();
    await h.run(0, 3);
    h.session.close();
    expect(h.session.encode(vf(1_000_000))).toBe(false);
    expect(mock.openFrames()).toBe(0);
  });
});
