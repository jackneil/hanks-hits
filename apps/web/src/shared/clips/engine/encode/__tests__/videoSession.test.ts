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

function harness(choice = CHOICE, now = () => 0) {
  const packets: VideoPacket[] = [];
  const epochs: EpochInfo[] = [];
  const errors: Array<{ code: EngineErrorCode; detail: string }> = [];
  const session = new VideoSession(choice, { onPacket: (p) => packets.push(p), onEpoch: (e) => epochs.push(e), onError: (code, detail) => errors.push({ code, detail }) }, { now });
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
    // The first unanswered request was frame 30; the reset happens at the first frame 3 s after it.
    const resetAt = Math.ceil((30 * FRAME_US + KEYFRAME_STARVATION_US) / FRAME_US) * FRAME_US;
    expect(keysOf(h.packets)).toEqual([0, resetAt]);
    expect(h.epochs.map((e) => e.epoch)).toEqual([0, 1]);
    expect(h.packets.filter((p) => p.tsUs >= resetAt).every((p) => p.epoch === 1)).toBe(true);
    expect(h.session.stats.starvations).toBe(1);
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
