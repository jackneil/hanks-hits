import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeVideoFrame, flushMicrotasks, installWebCodecsMock, rgbaPixels, type WebCodecsMock } from "@/__tests__/webcodecs-mock";
import {
  PRESETS,
  type Capabilities,
  type ClipPackets,
  type EncodeCmd,
  type EncodeEvent,
  type PcmBatch,
  type RecordTeeMsg,
  type VideoEncoderChoice,
} from "../../../protocol";
import type { AacKind } from "../audio/aac";
import { createEncodeWorker, type EncodeWorker } from "../encode.worker";

const CAPS: Capabilities = {
  tier: "W",
  videoEncoderH264: true,
  h264Levels: ["1f"],
  hardwareEncoder: true,
  audioEncoderAac: true,
  audioData: true,
  audioDecoder: true,
  mediaRecorderMp4: true,
  mediaRecorderWebm: false,
  webgl2AsyncReadback: true,
  opfsSyncAccess: true,
  shareFiles: true,
  memoryClass: "mid",
  displayHz: 60,
};
const VIDEO: VideoEncoderChoice = {
  codec: "avc1.64001f",
  width: 720,
  height: 1280,
  bitrate: 2_000_000,
  framerate: 30,
  latencyMode: "quality",
  hardwareAcceleration: "prefer-hardware",
};
const HUD = { gameName: "Breakout", emoji: "🧱", score: "10" };
/** The worker realm started 5 s after the page: its now() is 5000 ms ahead of page time. */
const WORKER_AHEAD_MS = 5000;
const ORIGIN = 1000;

class FakePort {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  closed = false;
  readonly posted: Array<{ msg: RecordTeeMsg; transfer: Transferable[] }> = [];
  postMessage(msg: RecordTeeMsg, transfer: Transferable[] = []): void {
    this.posted.push({ msg, transfer });
  }
  close(): void {
    this.closed = true;
  }
  /** Delivers a message as the tap worklet would. */
  deliver(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

interface Harness {
  worker: EncodeWorker;
  events: Array<{ e: EncodeEvent; transfer?: Transferable[] }>;
  pageNow: () => number;
  setPage: (ms: number) => void;
  timers: Map<number, { fn: () => void; ms: number }>;
  audioPort: FakePort;
}

let mock: WebCodecsMock;
beforeEach(() => {
  mock = installWebCodecsMock();
});
afterEach(() => {
  expect(mock.openFrames()).toBe(0);
  mock.uninstall();
});

function harness(kinds: AacKind[] = ["native"]): Harness {
  let page = 0;
  const events: Harness["events"] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let timerId = 0;
  const worker = createEncodeWorker({
    post: (e, transfer) => events.push({ e, transfer }),
    now: () => page + WORKER_AHEAD_MS,
    setInterval: (fn, ms) => {
      timers.set(++timerId, { fn, ms });
      return timerId;
    },
    clearInterval: (h) => timers.delete(h as number),
    aacKinds: async () => kinds,
  });
  return { worker, events, pageNow: () => page, setPage: (ms) => (page = ms), timers, audioPort: new FakePort() };
}

function armCmd(h: Harness, extra: Partial<Extract<EncodeCmd, { t: "arm" }>> = {}): EncodeCmd {
  return {
    t: "arm",
    caps: CAPS,
    video: VIDEO,
    preset: { ...PRESETS.tall, targetFps: 30, orientation: "tall" },
    ringSeconds: 60,
    audioPort: h.audioPort as unknown as MessagePort,
    brandHost: "hankshits.com",
    ...extra,
  };
}

function frameCmd(tsUs: number): EncodeCmd {
  const frame = new FakeVideoFrame(rgbaPixels(64, 96), { format: "RGBA", codedWidth: 64, codedHeight: 96, timestamp: tsUs }) as unknown as VideoFrame;
  return { t: "frame", frame, tsUs, durUs: 33_333, hud: HUD };
}

const ofType = <T extends EncodeEvent["t"]>(h: Harness, t: T) =>
  h.events.filter((x) => x.e.t === t).map((x) => x.e as Extract<EncodeEvent, { t: T }>);

/**
 * Plays page time forward in 10 ms steps: a 30 fps frame per capture slot, an
 * audio stream (a 1 kHz tone) with anchors every 250 ms and 2048-frame batches
 * through the audio port, and the audio timer.
 */
async function play(h: Harness, fromMs: number, toMs: number, opts: { audio?: boolean; frames?: boolean; pausedMs?: number } = {}) {
  const audio = opts.audio ?? true;
  const frames = opts.frames ?? true;
  for (let t = fromMs; t < toMs; t += 10) {
    h.setPage(t);
    // Capture time skips removed pauses (plan 6.2).
    const capUs = (t - ORIGIN - (opts.pausedMs ?? 0)) * 1000;
    if (frames && capUs >= 0 && Math.floor(t / 33.333) !== Math.floor((t - 10) / 33.333)) {
      const slot = Math.round(capUs / 33_333);
      await h.worker.handle(frameCmd(slot * 33_333));
    }
    if (audio) {
      if (t % 250 === 0) await h.worker.handle({ t: "anchor", streamId: "page", perfMs: t, ctxTimeSec: t / 1000, timeOriginOffsetMs: 0, state: "running" });
      const framesNow = Math.floor((t / 1000) * 48000);
      while ((sent + 1) * 2048 <= framesNow) {
        const pcm = new Int16Array(4096);
        for (let f = 0; f < 2048; f++) pcm[f * 2] = pcm[f * 2 + 1] = Math.round(8000 * Math.sin((2 * Math.PI * 1000 * (sent * 2048 + f)) / 48000));
        const batch: PcmBatch = { t: "pcm", streamId: "page", firstFrame: sent * 2048, sampleRate: 48000, data: pcm.buffer };
        h.audioPort.deliver(batch);
        sent++;
      }
    }
    if (t % 40 === 0) {
      await flushMicrotasks(5);
      h.worker.tickAudio();
    }
    await flushMicrotasks(5);
  }
  await flushMicrotasks();
}
let sent = 0;

async function armed(h: Harness, extra: Partial<Extract<EncodeCmd, { t: "arm" }>> = {}) {
  sent = Math.floor(((ORIGIN - 500) / 1000) * 48000 / 2048);
  h.setPage(ORIGIN - 500);
  await h.worker.handle(armCmd(h, extra));
  // A timeline command carries the time the state changed, never a future time.
  h.setPage(ORIGIN);
  await h.worker.handle({ t: "timeline", state: "live", atPerfMs: ORIGIN });
  // Audio setup (priming calibration) runs beside the queue. Let it finish.
  const armedBefore = ofType(h, "armed").length;
  for (let i = 0; i < 500 && ofType(h, "armed").length === armedBefore; i++) await Promise.resolve();
}

async function clip(h: Harness, seconds: number): Promise<{ packets: ClipPackets; transfer?: Transferable[] }> {
  await h.worker.handle({ t: "clip", requestId: `c${seconds}`, seconds });
  const ev = h.events.filter((x) => x.e.t === "clipReady").pop()!;
  return { packets: (ev.e as Extract<EncodeEvent, { t: "clipReady" }>).packets, transfer: ev.transfer };
}

describe("encode worker", () => {
  it("arms with the measured priming and starts its timers", async () => {
    const h = harness();
    await armed(h);
    expect(ofType(h, "armed")).toEqual([{ t: "armed", video: VIDEO, primingSamples: 2114 }]);
    expect([...h.timers.values()].map((t) => t.ms).sort((a, b) => a - b)).toEqual([40, 1000]);
    expect(h.worker.armed).toBe(true);
    await h.worker.handle({ t: "disarm" });
    expect(h.timers.size).toBe(0);
    expect(h.audioPort.closed).toBe(true);
  });

  it("uses the arm override for the priming (tests and replays)", async () => {
    const h = harness();
    await armed(h, { primingSamples: 1500 });
    expect(ofType(h, "armed")[0].primingSamples).toBe(1500);
    expect(mock.audioDecoders).toHaveLength(0);
    await h.worker.handle({ t: "disarm" });
  });

  it("posts consumed after every frame, and makes a clip with video, audio and the rebuilt ASC", async () => {
    const h = harness();
    await armed(h);
    await play(h, ORIGIN, ORIGIN + 4000);
    const frames = ofType(h, "consumed").length;
    expect(frames).toBeGreaterThanOrEqual(119);
    expect(ofType(h, "epoch")).toHaveLength(1);

    const { packets, transfer } = await clip(h, 2);
    expect(packets.video[0].type).toBe("key");
    expect(packets.video.length).toBeGreaterThan(60);
    expect(packets.audio.length).toBeGreaterThan(90);
    expect(Array.from(new Uint8Array(packets.audioConfig!.description))).toEqual([0x11, 0x90]);
    expect(packets.primingSamples).toBe(2114);
    expect(packets.coveredSec).toBeGreaterThanOrEqual(2);
    expect(packets.coveredSec).toBeLessThan(3.1);
    // The clip ends at the AAC watermark, which is behind the newest video.
    const lastVideo = packets.video[packets.video.length - 1];
    expect(packets.endUs).toBeLessThanOrEqual(lastVideo.tsUs + lastVideo.durUs);
    expect(packets.endUs).toBeGreaterThan(3.5e6);
    const audioEnd = packets.audio[packets.audio.length - 1].tsUs + packets.audio[packets.audio.length - 1].durUs;
    expect(audioEnd).toBeGreaterThanOrEqual(packets.endUs);
    expect(transfer!.length).toBe(packets.video.length + packets.audio.length + packets.videoEpochs.length + 1);

    h.worker.postStats();
    const stats = ofType(h, "stats").pop()!.stats;
    expect(stats.framesIn).toBe(frames);
    expect(stats.framesEncoded).toBeGreaterThan(110);
    expect(stats.framesDropped).toBe(0);
    expect(stats.outOfOrder).toBe(0);
    expect(stats.audioStreams).toBe(1);
    expect(stats.ringSeconds).toBeGreaterThan(3.8);
    expect(stats.ringBytes).toBeGreaterThan(0);
    expect(stats.ttfcMs).not.toBeNull();
    await h.worker.handle({ t: "disarm" });
  });

  it("builds frames from path E pixels too", async () => {
    const h = harness();
    await armed(h);
    h.setPage(ORIGIN + 10);
    await h.worker.handle({ t: "pixels", data: rgbaPixels(640, 360), width: 640, height: 360, tsUs: 0, durUs: 33_333, hud: HUD });
    await h.worker.handle({ t: "pixels", data: new ArrayBuffer(3), width: 640, height: 360, tsUs: 33_333, durUs: 33_333, hud: HUD });
    expect(ofType(h, "consumed")).toHaveLength(2);
    h.worker.postStats();
    expect(ofType(h, "stats").pop()!.stats.framesDropped).toBe(1);
    await h.worker.handle({ t: "disarm" });
  });

  it("reports an unexpected compositor failure once, and a bad pixel buffer never", async () => {
    const h = harness();
    await armed(h);
    await h.worker.handle({ t: "pixels", data: new ArrayBuffer(3), width: 640, height: 360, tsUs: 0, durUs: 33_333, hud: HUD });
    expect(ofType(h, "error")).toEqual([]);
    const ctx = mock.canvases[0].context;
    ctx.drawImage = () => {
      throw new TypeError("platform drawImage bug");
    };
    await h.worker.handle(frameCmd(33_333));
    await h.worker.handle(frameCmd(66_666));
    expect(ofType(h, "error").map((e) => e.code)).toEqual(["encoder-error"]);
    expect(ofType(h, "consumed")).toHaveLength(3);
    h.worker.postStats();
    expect(ofType(h, "stats").pop()!.stats.framesDropped).toBe(3);
    await h.worker.handle({ t: "disarm" });
  });

  it("closes frames and still posts consumed when not armed", async () => {
    const h = harness();
    await h.worker.handle(frameCmd(0));
    expect(ofType(h, "consumed")).toHaveLength(1);
    await h.worker.handle({ t: "clip", requestId: "x", seconds: 5 });
    expect(ofType(h, "clipReady")[0].packets).toMatchObject({ requestId: "x", coveredSec: 0, video: [] });
  });

  it("closes the encoders when hidden and resumes on a new epoch with gapless audio", async () => {
    const h = harness();
    await armed(h);
    await play(h, ORIGIN, ORIGIN + 2000);
    h.setPage(ORIGIN + 2000);
    await h.worker.handle({ t: "timeline", state: "paused", atPerfMs: ORIGIN + 2000 });
    await h.worker.handle({ t: "closeEncoder", reason: "hidden" });
    expect(mock.videoEncoders[0].state).toBe("closed");
    expect(mock.audioEncoders.some((e) => e.state === "closed")).toBe(true);
    h.setPage(ORIGIN + 3000);
    await h.worker.handle({ t: "timeline", state: "live", atPerfMs: ORIGIN + 3000 });
    await play(h, ORIGIN + 3000, ORIGIN + 5000, { pausedMs: 1000 });
    expect(ofType(h, "epoch").map((e) => e.info.epoch)).toEqual([0, 1]);
    const { packets } = await clip(h, 10);
    // Two identical epochs splice: the clip covers both sides of the pause.
    expect(packets.cutToNewestEpoch).toBe(false);
    expect(packets.startUs).toBe(0);
    for (let i = 1; i < packets.audio.length; i++) expect(packets.audio[i].tsUs - packets.audio[i - 1].tsUs).toBeGreaterThanOrEqual(21_333);
    for (let i = 1; i < packets.audio.length; i++) expect(packets.audio[i].tsUs - packets.audio[i - 1].tsUs).toBeLessThanOrEqual(21_334);
    // The paused second is gone from the capture timeline: about 4 s of content.
    expect(packets.coveredSec).toBeLessThan(4.1);
    await h.worker.handle({ t: "disarm" });
  });

  it("reports a reclaim and recreates the encoder on the next frame", async () => {
    const h = harness();
    await armed(h);
    await play(h, ORIGIN, ORIGIN + 500, { audio: false });
    mock.videoEncoders[0].reclaim();
    await play(h, ORIGIN + 500, ORIGIN + 1000, { audio: false });
    expect(ofType(h, "error").map((e) => e.code)).toEqual(["encoder-reclaimed"]);
    expect(mock.videoEncoders).toHaveLength(2);
    expect(ofType(h, "epoch").map((e) => e.info.epoch)).toEqual([0, 1]);
    await h.worker.handle({ t: "disarm" });
  });

  it("purges the rings on an owner change", async () => {
    const h = harness();
    await armed(h);
    await play(h, ORIGIN, ORIGIN + 2000);
    const lastBefore = mock.videoEncoders[0].encodeCalls[mock.videoEncoders[0].encodeCalls.length - 1].timestamp;
    const purgeUs = (h.pageNow() - ORIGIN) * 1000;
    await h.worker.handle({ t: "purge" });
    expect((await clip(h, 5)).packets.coveredSec).toBe(0);
    await play(h, ORIGIN + 2000, ORIGIN + 3500);
    const after = (await clip(h, 5)).packets;
    // Nothing from before the purge: not the frame the guard held, not the frames inside the encoder.
    expect(after.startUs).toBeGreaterThan(lastBefore);
    expect(after.video[0].type).toBe("key");
    // The purge asked for a keyframe at once, so the new ring starts at the next frame.
    expect(after.startUs).toBeLessThanOrEqual(lastBefore + 2 * 33_334);
    // Audio: the mixer runs behind real time, but nothing it renders for times before the purge is kept.
    // The first packet may start early only by the encoder priming plus the pre-pad (its content is silence).
    const priming = (2114 + 1024) / 48000 * 1e6;
    expect(after.audio[0].tsUs).toBeGreaterThanOrEqual(purgeUs - priming - 21_334);
    await h.worker.handle({ t: "disarm" });
  });

  it("tees Record packets to the io worker port, one chunk per GOP, then end", async () => {
    const h = harness();
    await armed(h);
    await play(h, ORIGIN, ORIGIN + 1500);
    const port = new FakePort();
    await h.worker.handle({ t: "record", on: true, recordingId: "rec", port: port as unknown as MessagePort });
    await play(h, ORIGIN + 1500, ORIGIN + 4200);
    await h.worker.handle({ t: "record", on: false });
    await play(h, ORIGIN + 4200, ORIGIN + 4600, { frames: false });
    const msgs = port.posted.map((p) => p.msg);
    expect(msgs[msgs.length - 1]).toMatchObject({ t: "end", recordingId: "rec" });
    const chunks = msgs.flatMap((m) => (m.t === "chunk" ? [m.packets] : []));
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const video = chunks.flatMap((c) => c.video);
    expect(video[0]).toMatchObject({ type: "key", tsUs: 1_000_000 - 10 });
    for (let i = 1; i < video.length; i++) expect(video[i].tsUs).toBeGreaterThan(video[i - 1].tsUs);
    const audio = chunks.flatMap((c) => c.audio);
    for (let i = 1; i < audio.length; i++) expect(audio[i].tsUs - audio[i - 1].tsUs).toBeGreaterThanOrEqual(21_333);
    expect(audio[audio.length - 1].tsUs).toBeGreaterThan(3.1e6);
    await h.worker.handle({ t: "disarm" });
  });

  it("reports config-unsupported and does not arm when VideoEncoder is missing", async () => {
    mock.uninstall();
    mock = installWebCodecsMock({ videoEncoder: false });
    const h = harness();
    await armed(h);
    expect(ofType(h, "error").map((e) => e.code)).toEqual(["config-unsupported"]);
    expect(ofType(h, "armed")).toEqual([]);
    await h.worker.handle(frameCmd(0));
    expect(ofType(h, "consumed")).toHaveLength(1);
    await h.worker.handle({ t: "disarm" });
  });

  it("arms without audio when no AAC encoder exists, and clips carry no audio", async () => {
    const h = harness([]);
    await armed(h);
    expect(ofType(h, "error").map((e) => e.code)).toEqual(["audio-encoder-missing"]);
    expect(ofType(h, "armed")).toHaveLength(1);
    await play(h, ORIGIN, ORIGIN + 1500);
    const { packets } = await clip(h, 5);
    expect(packets.audioConfig).toBeNull();
    expect(packets.audio).toEqual([]);
    expect(packets.video.length).toBeGreaterThan(30);
    await h.worker.handle({ t: "disarm" });
  });

  it("handles commands in order: frames sent after closeEncoder wait for the flush", async () => {
    const h = harness();
    await armed(h);
    await play(h, ORIGIN, ORIGIN + 300, { audio: false });
    const a = h.worker.handle({ t: "closeEncoder", reason: "export" });
    const b = h.worker.handle(frameCmd(400_000));
    await Promise.all([a, b]);
    await flushMicrotasks();
    // The export close finished before the frame, so the frame opened a new encoder.
    expect(mock.videoEncoders).toHaveLength(2);
    expect(mock.videoEncoders[0].state).toBe("closed");
    await h.worker.handle({ t: "disarm" });
  });

  it("keeps frames flowing while the audio setup is still running", async () => {
    let release: (k: AacKind[]) => void = () => {};
    const h = harness();
    const slow = createEncodeWorker({
      post: (e, transfer) => h.events.push({ e, transfer }),
      now: () => h.pageNow() + WORKER_AHEAD_MS,
      setInterval: () => 0,
      clearInterval: () => {},
      aacKinds: () => new Promise<AacKind[]>((r) => (release = r)),
    });
    h.worker = slow;
    h.setPage(ORIGIN);
    await slow.handle(armCmd(h));
    await slow.handle({ t: "timeline", state: "live", atPerfMs: ORIGIN });
    await play(h, ORIGIN, ORIGIN + 1000, { audio: true });
    expect(ofType(h, "armed")).toEqual([]);
    expect(ofType(h, "consumed").length).toBeGreaterThanOrEqual(29);
    expect(mock.videoEncoders[0].encodeCalls.length).toBeGreaterThanOrEqual(29);
    // A clip taken now has video only; the audio pipeline is not ready.
    expect((await clip(h, 5)).packets.audioConfig).toBeNull();
    release(["native"]);
    for (let i = 0; i < 500 && ofType(h, "armed").length === 0; i++) await Promise.resolve();
    expect(ofType(h, "armed")).toHaveLength(1);
    // The AAC session starts from the PCM backlog the mixer made meanwhile: no audio is lost.
    await play(h, ORIGIN + 1000, ORIGIN + 2000);
    const { packets } = await clip(h, 10);
    expect(packets.audio[0].tsUs).toBeLessThan(0);
    for (let i = 1; i < packets.audio.length; i++) expect(packets.audio[i].tsUs - packets.audio[i - 1].tsUs).toBeLessThanOrEqual(21_334);
    await slow.handle({ t: "disarm" });
  });

  it("does not paint frames after the device refused the video config", async () => {
    mock.video.supportedCodec = /^never$/;
    const h = harness();
    await armed(h);
    await flushMicrotasks();
    expect(ofType(h, "error").map((e) => e.code)).toEqual(["config-unsupported"]);
    const opsBefore = mock.canvases[0].context.ops.length;
    await h.worker.handle(frameCmd(0));
    await h.worker.handle(frameCmd(33_333));
    expect(mock.canvases[0].context.ops.length).toBe(opsBefore);
    expect(ofType(h, "consumed")).toHaveLength(2);
    h.worker.postStats();
    expect(ofType(h, "stats").pop()!.stats.framesDropped).toBe(2);
    await h.worker.handle({ t: "disarm" });
  });

  it("re-arming replaces the old session", async () => {
    const h = harness();
    await armed(h);
    const firstPort = h.audioPort;
    h.audioPort = new FakePort();
    await armed(h);
    expect(firstPort.closed).toBe(true);
    expect(ofType(h, "armed")).toHaveLength(2);
    expect(h.timers.size).toBe(2);
    await h.worker.handle({ t: "disarm" });
  });
});
