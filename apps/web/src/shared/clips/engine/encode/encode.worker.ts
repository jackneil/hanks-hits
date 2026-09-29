/**
 * Encode worker entry (plan 4 and 4.1).
 *
 * The worker wires the parts together:
 *   frames -> compositor -> VideoSession -> GopRing (and the Record tee)
 *   PCM + anchors + timeline -> Mixer -> PcmRing -> AacSession -> AacPacketRing
 *   "clip" -> assembleClip -> "clipReady" (buffers transferred)
 *
 * Every message goes through one serial queue, so commands apply in the order
 * they were sent. Most steps are synchronous. Only "closeEncoder" waits (the
 * flushes), and each flush has a time limit (FLUSH_TIMEOUT_MS), so a hung
 * codec never stops the queue. While a flush runs, the audio timer does not
 * mix: the timeline commands wait in the queue behind the flush, and a mix
 * from an old timeline would put audio at the wrong capture time. Send the
 * "timeline" pause before "closeEncoder" for the same reason.
 *
 * Arm opens the video encoder at once. The priming calibration runs beside
 * the queue, so frames flow at once. "armed" follows when the audio setup is
 * done, and never when the device refused the video config.
 *
 * The worker posts "consumed" after every frame message, also when it drops
 * the frame, so the frame pump on the main thread never loses its count.
 *
 * createEncodeWorker holds all logic, so tests drive it with the WebCodecs
 * fakes. The listener at the bottom attaches only inside a dedicated worker.
 */

import type { EncodeCmd, EncodeEvent, EngineStats, FrameIn, PcmBatch, RecordTeeMsg } from "../../protocol";
import { AUDIO_SAMPLE_RATE } from "../../protocol";
import { AacPacketRing, AacSession, PRIMING_CONSTANTS, PcmRing, type AacBackendFactory, type AacKind } from "./audio/aac";
import { createAacBackend, nativeAacSupported } from "./audio/aacBackends";
import { Mixer } from "./audio/mixer";
import { measurePriming, plausiblePriming } from "./audio/priming";
import { RecordTee, assembleClip, type AudioSource } from "./clipAssembler";
import { Compositor, CompositorInputError, type SurfaceFactory } from "./compositor";
import { GopRing, VIDEO_RING_BYTE_CEILING } from "./gopRing";
import { PageClock } from "./timeline";
import { VideoSession } from "./videoSession";

type ArmCmd = Extract<EncodeCmd, { t: "arm" }>;

export interface EncodeWorkerDeps {
  post(event: EncodeEvent, transfer?: Transferable[]): void;
  /** Worker-realm clock in milliseconds. */
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** AAC backends. Default: the native and WASM backends. */
  createAacBackend?: AacBackendFactory;
  /** AAC kinds to try, in order. Default: native when it works here, then WASM. */
  aacKinds?: (arm: ArmCmd) => Promise<AacKind[]>;
  /** Canvas factory for the compositor. Default: OffscreenCanvas. */
  surfaceFactory?: SurfaceFactory;
  /** Audio pump period. Default 40 ms. */
  audioTickMs?: number;
  /** Stats period. Default 1000 ms. */
  statsIntervalMs?: number;
  /** Longest wait for a codec flush. Default FLUSH_TIMEOUT_MS. */
  flushTimeoutMs?: number;
}

export interface EncodeWorker {
  /** Queues one message. The promise settles when the worker has handled it. */
  handle(message: EncodeCmd | PcmBatch): Promise<void>;
  /** Mixes the audio that is ready and feeds the AAC encoder (the audio timer calls this). Does nothing during a flush. */
  tickAudio(): void;
  /** Posts a "stats" event now (the stats timer calls this). */
  postStats(): void;
  readonly armed: boolean;
}

interface Session {
  arm: ArmCmd;
  compositor: Compositor;
  video: VideoSession;
  ring: GopRing;
  mixer: Mixer;
  pageClock: PageClock;
  pcm: PcmRing;
  aacRing: AacPacketRing;
  aac: AacSession | null;
  audioSource: AudioSource;
  tee: RecordTee | null;
  timers: unknown[];
  framesIn: number;
  framesRejected: number;
  /** Mix frames before this one belong to a purged owner and never reach the rings. */
  audioPurgeFrame: number;
  /** An unexpected compositor failure is reported once, then only counted. */
  compositorFailureReported: boolean;
  /** The page is hidden (closeEncoder "hidden"): no AAC stream may start until play resumes. */
  hidden: boolean;
  /** The device refused the video config. The session only waits for disarm. */
  dead: boolean;
}

/** Most history the worker keeps when arm asks for none or for nonsense. */
const DEFAULT_RING_SECONDS = 60;
/** Record Stop with no frame after it (a pause): the tee stops waiting for the encoder's newest frame after this. */
export const TEE_VIDEO_IDLE_MS = 200;

/** The AAC kinds to try: native only where arm.caps allows it (the lab's ?aac=wasm masks it) and the browser has it, then WASM. */
export async function defaultAacKinds(arm: ArmCmd): Promise<AacKind[]> {
  const kinds: AacKind[] = [];
  if (arm.caps.audioEncoderAac !== false && (await nativeAacSupported())) kinds.push("native");
  // The WASM encoder is always the fallback. If it cannot load, the session reports audio-encoder-missing.
  kinds.push("wasm");
  return kinds;
}

export function createEncodeWorker(deps: EncodeWorkerDeps): EncodeWorker {
  const now = deps.now ?? (() => performance.now());
  const setTimer = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const backendFactory = deps.createAacBackend ?? createAacBackend;
  const kindsFor = deps.aacKinds ?? defaultAacKinds;
  const post = (e: EncodeEvent, t?: Transferable[]) => deps.post(e, t);
  const error = (code: Extract<EncodeEvent, { t: "error" }>["code"], detail: string) => post({ t: "error", code, detail });

  let session: Session | null = null;
  let queue: Promise<void> = Promise.resolve();
  /** Flushes in progress. The audio timer does not mix while one runs (see the header). */
  let flushing = 0;

  function handle(message: EncodeCmd | PcmBatch): Promise<void> {
    const step = queue.then(() => process(message));
    queue = step.catch((e) => error("encoder-error", `encode worker: ${describe(e)}`));
    return queue;
  }

  async function process(m: EncodeCmd | PcmBatch): Promise<void> {
    switch (m.t) {
      case "arm":
        return arm(m);
      case "frame":
      case "pixels":
        return frame(m);
      case "anchor":
        if (session && !session.dead) {
          session.pageClock.observe(m.perfMs + m.timeOriginOffsetMs, now());
          session.mixer.anchor(m);
        }
        return;
      case "pcm":
        if (session && !session.dead) session.mixer.pushPcm(m);
        return;
      case "timeline":
        if (session && !session.dead) {
          session.pageClock.observe(m.atPerfMs, now());
          session.mixer.setTimeline(m.state, m.atPerfMs);
          if (m.state === "live") resumeAudio(session);
          mix(session);
        }
        return;
      case "clip":
        return clip(m);
      case "record":
        return record(m);
      case "closeEncoder":
        return closeEncoder(m.reason);
      case "purge":
        return purge();
      case "disarm":
        return disarm();
    }
  }

  function arm(cmd: ArmCmd): void {
    if (session) disarm();
    // One source of truth for the coded frame: the compositor canvas must be the encoder's size.
    if (cmd.video.width !== cmd.preset.width || cmd.video.height !== cmd.preset.height) {
      error(
        "config-unsupported",
        `preset ${cmd.preset.width}x${cmd.preset.height} does not match the encoder size ${cmd.video.width}x${cmd.video.height}`,
      );
      return;
    }
    const ringSeconds = cmd.ringSeconds > 0 && Number.isFinite(cmd.ringSeconds) ? cmd.ringSeconds : DEFAULT_RING_SECONDS;
    let compositor: Compositor;
    try {
      compositor = new Compositor(cmd.preset, cmd.brandHost, deps.surfaceFactory);
    } catch (e) {
      error("config-unsupported", `compositor: ${describe(e)}`);
      return;
    }
    // The hooks below run later (on encoder output), after `current` is set.
    let current: Session | null = null;
    const ring = new GopRing({
      ringSeconds,
      byteBudget: VIDEO_RING_BYTE_CEILING[cmd.caps.memoryClass] ?? VIDEO_RING_BYTE_CEILING.low,
      onTrim: () => current?.video.retainEpochs(ring.epochsInUse()),
    });
    const aacRing = new AacPacketRing(ringSeconds + 2);
    const video = new VideoSession(
      cmd.video,
      {
        onPacket: (p) => {
          ring.push(p);
          current?.tee?.onVideo(p);
        },
        onEpoch: (info) => post({ t: "epoch", info }, [info.description]),
        onError: (code, detail) => {
          error(code, detail);
          // The device cannot encode this config (often reported after configure returned).
          if (code === "config-unsupported" && current) shutDown(current);
        },
      },
      { now, flushTimeoutMs: deps.flushTimeoutMs },
    );
    const s: Session = {
      arm: cmd,
      compositor,
      ring,
      video,
      mixer: new Mixer(),
      pageClock: new PageClock(),
      pcm: new PcmRing(ringSeconds + 2),
      aacRing,
      aac: null,
      audioSource: {
        get packets() {
          return aacRing.packets;
        },
        get endFrame() {
          return aacRing.endFrame;
        },
      },
      tee: null,
      timers: [],
      framesIn: 0,
      framesRejected: 0,
      audioPurgeFrame: -Infinity,
      compositorFailureReported: false,
      hidden: false,
      dead: false,
    };
    current = s;
    session = s;
    if (cmd.audioPort) {
      cmd.audioPort.onmessage = (ev: MessageEvent) => {
        if (session === s && !s.dead) void handle(ev.data as PcmBatch);
      };
    }
    // Open the encoder now, so an unsupported config is reported at arm, not at the first frame.
    if (!s.video.start() || s.dead) return;
    s.timers.push(setTimer(tickAudio, deps.audioTickMs ?? 40), setTimer(postStats, deps.statsIntervalMs ?? 1000));
    // Priming calibration takes 50-300 ms. It runs beside the queue, so frames flow at once and
    // the mixer fills the PCM ring meanwhile. The AAC session encodes that backlog when it starts.
    void setupAudio(s, cmd);
  }

  /** Stops the pipeline of a session the device cannot encode: no timers, no audio, no "armed". */
  function shutDown(s: Session): void {
    if (s.dead) return;
    s.dead = true;
    for (const t of s.timers) clearTimer(t);
    s.timers = [];
    s.aac?.close();
    s.aac = null;
    if (s.arm.audioPort) s.arm.audioPort.onmessage = null;
  }

  async function setupAudio(s: Session, cmd: ArmCmd): Promise<void> {
    const alive = () => session === s && !s.dead && !s.video.failed;
    try {
      let kinds: AacKind[] = [];
      try {
        kinds = await kindsFor(cmd);
      } catch {
        kinds = [];
      }
      if (!alive()) return;
      const priming: Partial<Record<AacKind, number>> = {};
      if (cmd.primingSamples !== undefined) {
        for (const k of kinds) priming[k] = cmd.primingSamples;
      } else if (kinds[0] === "native") {
        // Only native is calibrated: the WASM delay is fixed by the pinned FFmpeg encoder (1024).
        const measured = await measurePriming((sink) => backendFactory("native", sink));
        if (!alive()) return;
        priming.native = plausiblePriming(measured, PRIMING_CONSTANTS.native) ?? PRIMING_CONSTANTS.native;
      }
      s.aac = new AacSession({
        kinds,
        primingSamples: priming,
        createBackend: backendFactory,
        pcm: s.pcm,
        ring: s.aacRing,
        onPacket: (p) => s.tee?.onAudio(p),
        onError: (code, detail) => error(code, detail),
        now,
        flushTimeoutMs: deps.flushTimeoutMs,
      });
      // Hidden while the setup ran: no stream until play resumes (plan 7.1).
      if (s.hidden) void s.aac.suspend();
      tickAudio();
      post({ t: "armed", video: cmd.video, primingSamples: s.aac.primingSamples });
    } catch (e) {
      if (alive()) error("audio-encoder-missing", `audio setup: ${describe(e)}`);
    }
  }

  /** Play resumed after a hidden close: AAC streams may start again. */
  function resumeAudio(s: Session): void {
    if (!s.hidden) return;
    s.hidden = false;
    s.aac?.resume();
  }

  function frame(m: FrameIn): void {
    const s = session;
    try {
      if (!s) {
        if (m.t === "frame") m.frame.close();
        return;
      }
      s.framesIn++;
      if (s.video.failed) {
        // The device cannot encode this config (already reported). Do not paint frames for nothing.
        s.framesRejected++;
        if (m.t === "frame") m.frame.close();
        return;
      }
      // A frame after a hidden close means play is back (the first frame after the hidden close).
      resumeAudio(s);
      // Do not paint a frame that the encoder queue would drop. The session counts the drop.
      if (!s.video.admit(m.tsUs)) {
        if (m.t === "frame") m.frame.close();
        return;
      }
      let out: VideoFrame;
      try {
        out = s.compositor.compose(m);
      } catch (e) {
        s.framesRejected++;
        if (e instanceof RangeError || (e as { name?: string })?.name === "QuotaExceededError") {
          error("out-of-memory", `compositor: ${describe(e)}`);
        } else if (!(e instanceof CompositorInputError) && !s.compositorFailureReported) {
          // A platform failure would drop every frame. Say so once; stats keep the count.
          s.compositorFailureReported = true;
          error("encoder-error", `compositor: ${describe(e)}`);
        }
        return;
      }
      s.video.encode(out);
    } finally {
      post({ t: "consumed" });
    }
  }

  function clip(m: Extract<EncodeCmd, { t: "clip" }>): void {
    const s = session;
    if (!s) {
      post({
        t: "clipReady",
        packets: {
          requestId: m.requestId,
          video: [],
          audio: [],
          videoEpochs: [],
          audioConfig: null,
          primingSamples: 0,
          startUs: 0,
          endUs: 0,
          cutToNewestEpoch: false,
          coveredSec: 0,
        },
      });
      return;
    }
    mix(s);
    const built = assembleClip(m, {
      ring: s.ring,
      epochInfo: (e) => s.video.epochInfo(e),
      audio: audioFor(s),
      primingSamples: s.aac?.primingSamples ?? 0,
    });
    post({ t: "clipReady", packets: built.packets }, built.transfer);
  }

  /** The audio a clip may use: none when audio never started or the encoder is gone for good. */
  function audioFor(s: Session): AudioSource | null {
    if (!s.aac || !s.aac.enabled || !s.mixer.timeline.started) return null;
    return s.audioSource;
  }

  function record(m: Extract<EncodeCmd, { t: "record" }>): void {
    const s = session;
    if (!s) return;
    if (m.on) {
      s.tee?.stop(s.ring.endUs, { wait: false });
      const port = m.port;
      s.tee = new RecordTee({
        recordingId: m.recordingId,
        port: { postMessage: (msg: RecordTeeMsg, transfer: Transferable[]) => port.postMessage(msg, transfer) },
        epochInfo: (e) => s.video.epochInfo(e),
        primingSamples: () => s.aac?.primingSamples ?? 0,
        // While audio setup runs, expect audio. Only a session with no AAC encoder records without it.
        audio: s.aac && !s.aac.enabled ? null : s.audioSource,
        seed: s.ring.newest?.packets ?? null,
        now,
        live: () => s.mixer.timeline.live,
      });
    } else if (s.tee) {
      mix(s);
      // Stop at the end of the newest frame the encoder took. Frames still inside the encoder
      // (and the packet the epoch guard holds) still reach the recording.
      const mark = s.video.tailMark();
      const stopMs = now();
      const stopAt = Number.isFinite(s.video.submittedEndUs) ? s.video.submittedEndUs : s.ring.endUs;
      // In a pause no frame follows the stop, and the encoder can keep its newest frame until one does.
      const noFrameSince = () => s.video.tailMark().lastTs === mark.lastTs && now() - stopMs >= TEE_VIDEO_IDLE_MS;
      s.tee.stop(Number.isFinite(stopAt) ? stopAt : 0, { videoTailDone: () => s.video.releaseTail(mark, noFrameSince()) });
      if (s.tee.finished) s.tee = null;
    }
  }

  async function closeEncoder(reason: "export" | "hidden"): Promise<void> {
    const s = session;
    if (!s || s.dead) return;
    flushing++;
    try {
      if (reason === "hidden") s.hidden = true;
      await s.video.closeEncoder();
      if (reason === "hidden" && session === s) {
        // Plan 7.1: iOS hidden closes both encoders at once. Mix what is ready first, so the
        // flush takes it; the rest waits in the PCM ring for the next stream.
        mix(s);
        await s.aac?.suspend();
      }
    } finally {
      flushing--;
    }
  }

  function purge(): void {
    const s = session;
    if (!s) return;
    s.tee?.stop(s.ring.endUs, { wait: false });
    s.tee = null;
    s.video.purge();
    s.ring.clear();
    s.aacRing.clear();
    s.pcm.clear();
    s.aac?.purge();
    s.video.retainEpochs(new Set());
    // The mixer renders behind real time. Audio it renders later for times before now is the old owner's.
    const pageNow = s.pageClock.pageNow(now());
    // Without page time the timeline has not started, so the mixer has nothing old to render.
    s.audioPurgeFrame =
      pageNow !== null && s.mixer.timeline.started
        ? Math.ceil((s.mixer.timeline.captureUsAtPerf(pageNow) * AUDIO_SAMPLE_RATE) / 1e6)
        : -Infinity;
  }

  function disarm(): void {
    const s = session;
    if (!s) return;
    session = null;
    for (const t of s.timers) clearTimer(t);
    s.tee?.stop(s.ring.endUs, { wait: false });
    s.video.close();
    s.aac?.close();
    s.compositor.close();
    if (s.arm.audioPort) {
      s.arm.audioPort.onmessage = null;
      s.arm.audioPort.close();
    }
  }

  /** The audio timer. It skips while a flush runs, because the timeline may be stale then. */
  function tickAudio(): void {
    const s = session;
    if (!s || flushing > 0) return;
    mix(s);
  }

  /** Mixes the audio that is ready into the PCM ring, pumps the AAC session and checks the Record tee. */
  function mix(s: Session): void {
    if (s.dead) return;
    const pageNow = s.pageClock.pageNow(now());
    if (pageNow !== null) {
      for (const b of s.mixer.render(pageNow)) {
        const cut = s.audioPurgeFrame - b.startFrame;
        if (cut >= b.data.length / 2) continue;
        if (cut > 0) b.data.fill(0, 0, cut * 2);
        s.pcm.write(b.startFrame, b.data);
      }
      // Pump on every tick: a catch-up and the AAC health checks move forward also without new audio.
      s.aac?.pump();
    }
    if (s.tee?.tick()) s.tee = null;
  }

  function postStats(): void {
    const s = session;
    if (!s) return;
    const v = s.video.stats;
    const m = s.mixer.stats;
    const stats: EngineStats = {
      framesIn: s.framesIn,
      framesEncoded: v.framesEncoded,
      framesDropped: v.framesDropped + s.framesRejected,
      outOfOrder: v.outOfOrder,
      encodeQueueMax: v.encodeQueueMax,
      ringSeconds: s.ring.coverage?.seconds ?? 0,
      ringBytes: s.ring.bytes + s.aacRing.bytes + s.pcm.bytes,
      audioStreams: m.contributing,
      audioUnderrunMs: (m.underrunFrames / AUDIO_SAMPLE_RATE) * 1000,
      ttfcMs: v.ttfcMs,
    };
    post({ t: "stats", stats });
  }

  return {
    handle,
    tickAudio,
    postStats,
    get armed() {
      return session !== null;
    },
  };
}

function describe(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const err = e as { name?: string; message?: string };
    return `${err.name ?? "Error"}: ${err.message ?? ""}`;
  }
  return String(e);
}

// ---------------------------------------------------------------------------
// Dedicated worker binding. Nothing here runs on the server or the main thread.
// ---------------------------------------------------------------------------

interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
}

function dedicatedWorkerScope(): WorkerScope | null {
  const g = globalThis as unknown as { WorkerGlobalScope?: unknown };
  if (typeof g.WorkerGlobalScope !== "function") return null;
  if (!(globalThis instanceof (g.WorkerGlobalScope as new () => unknown))) return null;
  return globalThis as unknown as WorkerScope;
}

const scope = dedicatedWorkerScope();
if (scope) {
  const worker = createEncodeWorker({ post: (event, transfer) => scope.postMessage(event, transfer ?? []) });
  scope.addEventListener("message", (ev) => void worker.handle(ev.data as EncodeCmd));
}
