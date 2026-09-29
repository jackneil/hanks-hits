// @vitest-environment node
/**
 * Cross-engine A/V check (plan 15.1 "Node" tier, 15.2): the encode worker and
 * the io worker together, on real media.
 *
 * The encode worker (engine/encode, createEncodeWorker) runs in this process
 * with its real parts: compositor, VideoSession, GopRing, Mixer, PcmRing,
 * AacSession with the REAL FFmpeg AAC WASM encoder (tier W+), the AAC ring and
 * assembleClip. Only the video encoder is a fake, and its output is real: for
 * the frame at capture time t it gives the H.264 access unit that libx264 made
 * for time t of a fixture (a white flash at 0.5 s of every second, a keyframe
 * at every whole second, no B-frames, as the session asks). The sound comes in
 * the way the tap worklet sends it: PCM batches of the page's audio stream with
 * clock anchors, and a 1 kHz beep at 0.5 s of every capture second.
 *
 * The "clip" command then gives the ClipPackets that the io worker gets, and
 * the io worker's muxClip and addAacRollGroups make the file. The checks:
 *   - ffmpeg decodes the file with no errors, with H.264 video and AAC sound;
 *   - ffmpeg reads every beep within 5 ms of its flash (plan 15.2 container
 *     A/V on synthetic-timestamp files);
 *   - AVFoundation (the decoder of iPhone Photos and Messages) reads the same
 *     within 5 ms (macOS with swiftc, else skipped with the reason);
 *   - a player that ignores the edit list plays the sound at most 45 ms late.
 * No engine branch could hold this test: it needs both workers.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BufferSource, EncodedPacketSink, Input, MP4 } from "mediabunny";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FakeVideoFrame, installWebCodecsMock, rgbaPixels, type WebCodecsMock } from "@/__tests__/webcodecs-mock";

import type { Capabilities, ClipPackets, EncodeCmd, EncodeEvent, PcmBatch, VideoEncoderChoice } from "../../protocol";
import { PRE_PAD_FRAMES, PRIMING_CONSTANTS, type AacSink } from "../encode/audio/aac";
import { createWasmBackend, type AacWasmModule } from "../encode/audio/aacBackends";
import { loadAacWasmFromDisk } from "../encode/__tests__/aacWasmModule";
import { createEncodeWorker, type EncodeWorker } from "../encode/encode.worker";
import { addAacRollGroups } from "../io/moovPatch";
import { muxClip } from "../io/mux";
import { AVSYNC, FFMPEG_REASON, TOOL_TIMEOUT_MS, avsyncOffsets, buildAvsync, ffmpegSync, run } from "./avTools";

const TOLERANCE_MS = 5;
const IGNORE_EDITLIST_MAX_LATE_MS = 45;
const FPS = 30;
const FIXTURE_SECONDS = 12;
const WIDTH = 320;
const HEIGHT = 240;
/** Page time (ms) when the capture timeline starts (media time 0). */
const ORIGIN = 1000;
/** The worker realm started 5 s after the page. */
const WORKER_AHEAD_MS = 5000;
const PLAY_MS = 9500;
const CLIP_SECONDS = 6;

const CAPS: Capabilities = {
  tier: "W+",
  videoEncoderH264: true,
  h264Levels: ["1f"],
  hardwareEncoder: true,
  audioEncoderAac: false,
  audioData: false,
  audioDecoder: false,
  mediaRecorderMp4: true,
  mediaRecorderWebm: false,
  webgl2AsyncReadback: true,
  opfsSyncAccess: true,
  shareFiles: true,
  memoryClass: "mid",
  displayHz: 60,
};

interface FixturePacket {
  type: "key" | "delta";
  data: Uint8Array;
}

interface Fixture {
  packets: FixturePacket[];
  config: { codec: string; description: Uint8Array; codedWidth: number; codedHeight: number; colorSpace?: VideoColorSpaceInit };
}

/** Makes the video fixture with ffmpeg and reads its H.264 access units back with mediabunny. */
async function makeFixture(dir: string): Promise<Fixture> {
  const file = path.join(dir, "fixture.mp4");
  // Flash on frame 15 of each second (0.5 s), keyframes at whole seconds, no B-frames.
  const flash = `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${FIXTURE_SECONDS},drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(mod(n\\,${FPS})\\,${FPS / 2})',format=yuv420p`;
  const made = run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", flash,
    "-c:v", "libx264", "-preset", "veryfast", "-g", String(FPS), "-keyint_min", String(FPS), "-bf", "0", "-sc_threshold", "0",
    "-profile:v", "high", "-an", file,
  ], { timeout: TOOL_TIMEOUT_MS });
  if (made.status !== 0) throw new Error(`ffmpeg could not make the fixture: ${made.stderr}`);
  const input = new Input({ formats: [MP4], source: new BufferSource(new Uint8Array(readFileSync(file))) });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    const config = (await track.getDecoderConfig())!;
    const packets: FixturePacket[] = [];
    for await (const packet of new EncodedPacketSink(track).packets()) packets.push({ type: packet.type, data: packet.data.slice() });
    return {
      packets,
      config: {
        codec: config.codec,
        description: new Uint8Array(config.description as ArrayBuffer).slice(),
        codedWidth: config.codedWidth!,
        codedHeight: config.codedHeight!,
        ...(config.colorSpace ? { colorSpace: config.colorSpace } : {}),
      },
    };
  } finally {
    input.dispose();
  }
}

/**
 * A VideoEncoder with the real API shape whose output is the fixture's real
 * H.264: the access unit for the frame's time. A keyframe request that the
 * fixture cannot honor (not a whole second) fails the test: the fake never
 * hands out a delta as a keyframe.
 */
function fixtureEncoderClass(fixture: Fixture, requests: { key: number; frames: number }) {
  return class FixtureVideoEncoder {
    state: "unconfigured" | "configured" | "closed" = "unconfigured";
    encodeQueueSize = 0;
    private configSent = false;
    private readonly output: (chunk: unknown, meta?: unknown) => void;
    private readonly onError: (error: unknown) => void;

    constructor(init: { output: (chunk: unknown, meta?: unknown) => void; error: (error: unknown) => void }) {
      this.output = init.output;
      this.onError = init.error;
    }

    configure(): void {
      this.state = "configured";
      this.configSent = false;
    }

    encode(frame: { timestamp: number; duration: number | null }, options?: { keyFrame?: boolean }): void {
      if (this.state !== "configured") throw new Error("encode on an encoder that is not configured");
      const index = Math.round((frame.timestamp * FPS) / 1e6);
      const packet = fixture.packets[index];
      requests.frames++;
      if (!packet) {
        this.onError(new Error(`no fixture frame ${index}`));
        return;
      }
      if (options?.keyFrame) {
        requests.key++;
        if (packet.type !== "key") throw new Error(`a keyframe was asked for frame ${index}, which the fixture has as a delta`);
      }
      this.encodeQueueSize++;
      const timestamp = frame.timestamp;
      const duration = frame.duration ?? Math.round(1e6 / FPS);
      const meta = this.configSent
        ? undefined
        : {
            decoderConfig: {
              codec: fixture.config.codec,
              description: fixture.config.description.slice(),
              codedWidth: fixture.config.codedWidth,
              codedHeight: fixture.config.codedHeight,
              colorSpace: fixture.config.colorSpace,
            },
          };
      this.configSent = true;
      // "quality" mode: the output comes after the call, never inside it.
      queueMicrotask(() => {
        this.encodeQueueSize--;
        if (this.state !== "configured") return;
        const bytes = packet.data;
        this.output(
          {
            type: packet.type,
            timestamp,
            duration,
            byteLength: bytes.byteLength,
            copyTo: (dest: ArrayBuffer | ArrayBufferView) => {
              const view = dest instanceof ArrayBuffer ? new Uint8Array(dest) : new Uint8Array(dest.buffer, dest.byteOffset, dest.byteLength);
              view.set(bytes);
            },
          },
          meta,
        );
      });
    }

    async flush(): Promise<void> {
      await Promise.resolve();
      await Promise.resolve();
    }

    reset(): void {
      this.state = "unconfigured";
      this.encodeQueueSize = 0;
    }

    close(): void {
      this.state = "closed";
    }
  };
}

/** The page's audio: silence, and a 1 kHz beep for 50 ms at 0.5 s of each capture second. */
function pageSignal(streamFrame: number): number {
  // The stream's context time equals page time here: frame f is page ms f / 48.
  const captureSec = streamFrame / 48000 - ORIGIN / 1000;
  if (captureSec < 0) return 0;
  const inSecond = captureSec - Math.floor(captureSec);
  if (inSecond < 0.5 || inSecond >= 0.55) return 0;
  return 0.6 * Math.sin((2 * Math.PI * 1000 * streamFrame) / 48000);
}

interface Harness {
  worker: EncodeWorker;
  events: EncodeEvent[];
  setPage(ms: number): void;
  audioPort: { onmessage: ((ev: MessageEvent) => void) | null; close(): void; deliver(data: unknown): void };
  /** Runs the WASM encoder's scheduled slices now. */
  drainAac(): void;
}

function harness(mod: AacWasmModule): Harness {
  let page = 0;
  const events: EncodeEvent[] = [];
  const scheduled: Array<() => void> = [];
  const audioPort = {
    onmessage: null as ((ev: MessageEvent) => void) | null,
    close() {},
    deliver(data: unknown) {
      this.onmessage?.({ data } as MessageEvent);
    },
  };
  const worker = createEncodeWorker({
    post: (event) => events.push(event),
    now: () => page + WORKER_AHEAD_MS,
    setInterval: () => 0,
    clearInterval: () => undefined,
    aacKinds: async () => ["wasm"],
    createAacBackend: (_kind, sink: AacSink) =>
      createWasmBackend(sink, {
        load: async () => mod,
        retire: () => undefined,
        // The slices run when the test drains them, so the encoder keeps up with the test's clock.
        schedule: (fn) => void scheduled.push(fn),
        sliceMs: Number.POSITIVE_INFINITY,
      }),
  });
  return {
    worker,
    events,
    setPage: (ms) => (page = ms),
    audioPort,
    drainAac: () => {
      while (scheduled.length > 0) scheduled.shift()!();
    },
  };
}

async function microtasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

const VIDEO: VideoEncoderChoice = {
  codec: "avc1.64000d",
  width: WIDTH,
  height: HEIGHT,
  bitrate: 1_000_000,
  framerate: FPS,
  latencyMode: "quality",
  hardwareAcceleration: "prefer-hardware",
};

/** Arms, plays PLAY_MS of page time (frames at 30 fps, audio batches and anchors), and clips. */
async function playAndClip(h: Harness): Promise<ClipPackets> {
  let sent = Math.floor((((ORIGIN - 500) / 1000) * 48000) / 2048);
  h.setPage(ORIGIN - 500);
  const arm: EncodeCmd = {
    t: "arm",
    caps: CAPS,
    video: VIDEO,
    preset: { width: WIDTH, height: HEIGHT, targetFps: 30, orientation: "wide" },
    ringSeconds: 30,
    audioPort: h.audioPort as unknown as MessagePort,
    brandHost: "hankshits.com",
  };
  await h.worker.handle(arm);
  h.setPage(ORIGIN);
  await h.worker.handle({ t: "timeline", state: "live", atPerfMs: ORIGIN });
  for (let i = 0; i < 200 && !h.events.some((e) => e.t === "armed"); i++) await microtasks(1);
  expect(h.events.find((e) => e.t === "armed")).toMatchObject({ primingSamples: PRIMING_CONSTANTS.wasm });

  const hud = { gameName: "Pipeline", emoji: "🎬" };
  for (let t = ORIGIN; t < ORIGIN + PLAY_MS; t += 10) {
    h.setPage(t);
    const capUs = (t - ORIGIN) * 1000;
    if (Math.floor(t / (1000 / FPS)) !== Math.floor((t - 10) / (1000 / FPS))) {
      const slot = Math.round(capUs / (1e6 / FPS));
      const tsUs = Math.round((slot * 1e6) / FPS);
      const frame = new FakeVideoFrame(rgbaPixels(64, 48), { format: "RGBA", codedWidth: 64, codedHeight: 48, timestamp: tsUs }) as unknown as VideoFrame;
      await h.worker.handle({ t: "frame", frame, tsUs, durUs: Math.round(1e6 / FPS), hud });
    }
    if (t % 250 === 0) {
      await h.worker.handle({ t: "anchor", streamId: "page", perfMs: t, ctxTimeSec: t / 1000, timeOriginOffsetMs: 0, state: "running" });
    }
    const framesNow = Math.floor((t / 1000) * 48000);
    while ((sent + 1) * 2048 <= framesNow) {
      const pcm = new Int16Array(4096);
      for (let f = 0; f < 2048; f++) pcm[f * 2] = pcm[f * 2 + 1] = Math.round(32767 * pageSignal(sent * 2048 + f));
      const batch: PcmBatch = { t: "pcm", streamId: "page", firstFrame: sent * 2048, sampleRate: 48000, data: pcm.buffer };
      h.audioPort.deliver(batch);
      sent++;
    }
    if (t % 40 === 0) {
      await microtasks();
      h.worker.tickAudio();
      h.drainAac();
    }
    await microtasks();
  }
  // Let the AAC encoder finish what it was given (its lookahead stays inside).
  for (let i = 0; i < 20; i++) {
    h.worker.tickAudio();
    h.drainAac();
    await microtasks();
  }
  await h.worker.handle({ t: "clip", requestId: "pipeline", seconds: CLIP_SECONDS });
  const ready = h.events.filter((e): e is Extract<EncodeEvent, { t: "clipReady" }> => e.t === "clipReady").pop();
  expect(ready).toBeDefined();
  await h.worker.handle({ t: "disarm" });
  return ready!.packets;
}

describe.skipIf(!!FFMPEG_REASON)(`encode worker + io worker on real media${FFMPEG_REASON ? ` (skipped: ${FFMPEG_REASON})` : ""}`, () => {
  let dir = "";
  let mock: WebCodecsMock | null = null;
  let packets: ClipPackets;
  let file = "";
  let requests = { key: 0, frames: 0 };
  let avsync: { binary: string | null; error: string } = { binary: null, error: "" };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "hh-clips-pipeline-"));
    const fixture = await makeFixture(dir);
    expect(fixture.packets).toHaveLength(FIXTURE_SECONDS * FPS);
    mock = installWebCodecsMock();
    requests = { key: 0, frames: 0 };
    Object.defineProperty(globalThis, "VideoEncoder", { configurable: true, writable: true, value: fixtureEncoderClass(fixture, requests) });
    const mod = await loadAacWasmFromDisk();
    packets = await playAndClip(harness(mod));
    const muxed = await muxClip(packets);
    const patched = addAacRollGroups(muxed.bytes);
    expect(patched.patchedTracks).toBe(1);
    file = path.join(dir, "pipeline-clip.mp4");
    writeFileSync(file, patched.bytes);
    if (AVSYNC.source) avsync = buildAvsync();
  }, 300_000);

  afterAll(() => {
    mock?.uninstall();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("the engine asked for keyframes at whole seconds only, and made a clip with video and real AAC", () => {
    expect(requests.frames).toBeGreaterThan(250);
    expect(requests.key).toBeGreaterThanOrEqual(9);
    expect(packets.video[0].type).toBe("key");
    expect(packets.audio.length).toBeGreaterThan(200);
    expect(packets.audioConfig).not.toBeNull();
    // The WASM encoder's delay is fixed: every packet sits on the grid of D = 1024 + the pre-pad.
    const d = PRIMING_CONSTANTS.wasm + PRE_PAD_FRAMES;
    for (const p of packets.audio) {
      const frame = Math.round((p.tsUs * 48000) / 1e6);
      expect((((frame + d) % 1024) + 1024) % 1024).toBe(0);
    }
    expect(packets.coveredSec).toBeGreaterThanOrEqual(CLIP_SECONDS);
    expect(packets.coveredSec).toBeLessThanOrEqual(CLIP_SECONDS + 1.05);
  });

  it("ffmpeg decodes the file with no errors: H.264 and AAC", () => {
    const decode = run("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { timeout: TOOL_TIMEOUT_MS });
    expect(decode.status).toBe(0);
    expect(decode.stderr.trim()).toBe("");
    const probe = run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file], { timeout: TOOL_TIMEOUT_MS });
    expect(probe.stdout.trim().split("\n")).toEqual(["h264", "aac"]);
  }, TOOL_TIMEOUT_MS);

  it(`ffmpeg reads every beep within ${TOLERANCE_MS} ms of its flash`, () => {
    const sync = ffmpegSync(file);
    // One flash per whole second in the clip, and every one has its beep.
    expect(sync.flashes.length).toBeGreaterThanOrEqual(CLIP_SECONDS);
    expect(sync.beeps.length).toBe(sync.flashes.length);
    for (const pair of sync.pairs) expect(Math.abs(pair.ms), `flash ${pair.flash} s`).toBeLessThanOrEqual(TOLERANCE_MS);
  }, TOOL_TIMEOUT_MS);

  it(`a player that ignores the edit list plays the sound at most ${IGNORE_EDITLIST_MAX_LATE_MS} ms late`, () => {
    const sync = ffmpegSync(file, true);
    expect(sync.pairs.length).toBeGreaterThanOrEqual(CLIP_SECONDS);
    for (const pair of sync.pairs) {
      expect(pair.ms).toBeGreaterThanOrEqual(-TOLERANCE_MS);
      expect(pair.ms).toBeLessThanOrEqual(IGNORE_EDITLIST_MAX_LATE_MS);
    }
  }, TOOL_TIMEOUT_MS);

  it.skipIf(!AVSYNC.source)(
    `AVFoundation reads every beep within ${TOLERANCE_MS} ms of its flash${AVSYNC.reason ? ` (skipped: ${AVSYNC.reason})` : ""}`,
    (context) => {
      if (!avsync.binary) context.skip(avsync.error || "avsync did not build");
      const offsets = avsyncOffsets(avsync.binary!, file);
      expect(offsets.length).toBeGreaterThanOrEqual(CLIP_SECONDS);
      for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(TOLERANCE_MS);
    },
    120_000,
  );
});
