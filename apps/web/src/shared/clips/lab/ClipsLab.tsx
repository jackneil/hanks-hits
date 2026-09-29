"use client";

/**
 * The clips lab (plan 15.1 lab pattern, 15.3): a tiny game for A/V tests.
 *
 * - A canvas draws every animation frame, as a game does: a dark picture
 *   with a moving bar. It is a 2D canvas (capture path P), or WebGL2 with
 *   ?gl=2 (capture path E).
 * - After Start, about once each second of AudioContext time, the whole
 *   frame is white for one captured frame and a 1 kHz beep starts on the
 *   shared game-audio bus, in the same task (labSchedule.ts). The intended
 *   offset of the sound from the picture is 0 ms.
 * - The lab uses the public clip service API only: the service and the
 *   attached game come from LabClipScope through the clip contexts, the
 *   canvas goes to AttachedGame.registerCanvas, and the buttons call
 *   clipLast, startRecording, stopRecording, wake, library.list and
 *   library.file.
 * - A Record can be stored in parts (plan 8.3). The lab keeps every part of
 *   the last Record (labParts.ts), so the drivers analyse each part.
 * - Drivers read the lab through window.__clipsLab (labHandle.ts) and the
 *   hidden element data-testid="lab-last-clip".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { getGameAudio, unlockGameAudio, wantGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

import { useAttachedGame, useClipService, useClipSnapshot } from "../service/context";
import type { ClipActionResult, ClipSnapshot, GameAttachment } from "../service/contract";
import { LabClipScope, useLabServiceState } from "./LabClipScope";
import { LAB_AUDIO_APP_ID, playBeep } from "./labBeep";
import { LAB_COPY, reasonText } from "./labCopy";
import { createLabHandle, installLabHandle, type LabLastClip, type LabPart, type LabStatus } from "./labHandle";
import type { ClipsLabOptions } from "./labParams";
import { declaredFailedParts, declaredParts, recordParts } from "./labParts";
import { LAB_CANVAS_HEIGHT, LAB_CANVAS_WIDTH, createLabRenderer } from "./labRenderer";
import { LabMetronome } from "./labSchedule";
import { loadLabService, type LabServiceLoader } from "./labService";

/** Seconds that Clip it! asks for (plan 15.3: play 15 s, clip 10 s). */
export const LAB_CLIP_SECONDS = 10;

/** The lab game, as the service sees it. The band shows its name and emoji. */
export const LAB_GAME: GameAttachment = Object.freeze({
  appId: "clips-lab",
  gameName: "Clips lab",
  emoji: "🧪",
  canPause: false,
});

export interface ClipsLabPageProps {
  options: ClipsLabOptions;
  /** Tests give a fake service here. The page uses loadLabService. */
  loadService?: LabServiceLoader;
}

/** The whole lab: the clip scope and the lab game in it. */
export function ClipsLabPage({ options, loadService = loadLabService }: ClipsLabPageProps) {
  return (
    <LabClipScope game={LAB_GAME} loadService={loadService}>
      <ClipsLab options={options} />
    </LabClipScope>
  );
}

type Busy = "clip" | "record" | null;

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-base-300 py-1.5">
      <dt className="text-base-content/70">{term}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function ClipsLab({ options }: { options: ClipsLabOptions }) {
  const service = useClipService();
  const game = useAttachedGame();
  const snapshot = useClipSnapshot();
  const serviceState = useLabServiceState();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [metronome] = useState(() => new LabMetronome({ targetFps: options.targetFps, hold: options.hold }));
  const channelRef = useRef<GameAudioChannel | null>(null);
  const [picture, setPicture] = useState<"2d" | "webgl2" | "none" | null>(null);
  const [running, setRunning] = useState(false);
  const [beats, setBeats] = useState(0);
  const [audioState, setAudioState] = useState("none");
  const [holdFrames, setHoldFrames] = useState<number | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // The same as `busy`, set at once: a second action in the same frame (a double tap, a driver) must see it.
  const busyRef = useRef<Busy>(null);
  const [lastClip, setLastClip] = useState<LabLastClip | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState(0);

  // The newest values for the driver hook and the action handlers.
  const live = useRef({ service, game, snapshot, serviceState, picture, running, audioState, lastClip, lastError, results });
  useEffect(() => {
    live.current = { service, game, snapshot, serviceState, picture, running, audioState, lastClip, lastError, results };
  });

  // The first tap anywhere makes the game-audio bus (shared/lib/audio rule).
  useEffect(() => wantGameAudio(), []);

  // The game loop: one tick of the metronome and one draw per animation frame.
  // It calls the global requestAnimationFrame each frame, so the clip
  // runtime's rAF dispatcher sees every frame (plan 3a).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createLabRenderer(canvas, options.gl ? "webgl2" : "2d");
    let frame = 0;
    let id = 0;
    let stopped = false;
    let lastAudio = "";
    let lastHold = 0;
    const step = (rafTs: number) => {
      if (stopped) return;
      if (frame === 0) setPicture(renderer ? renderer.kind : "none");
      const channel = channelRef.current;
      const context = channel && !channel.disposed ? channel.context : null;
      const audioNow = context ? context.state : channel ? "closed" : "none";
      if (audioNow !== lastAudio) {
        lastAudio = audioNow;
        setAudioState(audioNow);
      }
      const tick = metronome.tick({
        rafTs,
        perfNow: performance.now(),
        audio: context ? { time: context.currentTime, state: context.state } : null,
      });
      renderer?.draw({ flash: tick.flash, frame, beat: metronome.beatCount - 1 });
      if (metronome.holdFrames !== lastHold) {
        lastHold = metronome.holdFrames;
        setHoldFrames(lastHold);
      }
      frame += 1;
      if (tick.beat && channel && !channel.disposed) {
        playBeep(channel, tick.beat.ctxTime, tick.beat.mark);
        setBeats(metronome.beatCount);
      }
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => {
      stopped = true;
      cancelAnimationFrame(id);
    };
  }, [metronome, options.gl]);

  // The lab's channel on the bus goes away with the page.
  useEffect(
    () => () => {
      channelRef.current?.dispose();
      channelRef.current = null;
    },
    [],
  );

  // The canvas goes to the clip service once the lab game is attached.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!game || !canvas) return;
    return game.registerCanvas(canvas, { targetFps: options.targetFps });
  }, [game, options.targetFps]);

  // Capture runs only while the beeps run. Before Start and after Stop, the lab is at a break.
  useEffect(() => {
    game?.setAtBreak(!running);
  }, [game, running]);

  // The blob URL of the last clip lives as long as the clip is the last one.
  useEffect(() => {
    if (!lastClip) return;
    return () => URL.revokeObjectURL(lastClip.url);
  }, [lastClip]);

  const start = useCallback(() => {
    // Inside the tap: the browser lets the sound start only here.
    unlockGameAudio();
    const current = channelRef.current;
    if (!current || current.disposed) channelRef.current = getGameAudio()?.channel(LAB_AUDIO_APP_ID) ?? null;
    setMessage(channelRef.current ? null : LAB_COPY.soundMissing);
    if (metronome.running) return;
    metronome.start();
    setRunning(true);
    live.current.game?.runPhase("start");
  }, [metronome]);

  const stop = useCallback(() => {
    if (!metronome.running) return;
    metronome.stop();
    setRunning(false);
    live.current.game?.runPhase("end");
  }, [metronome]);

  /**
   * Shows a result and, for a made clip, keeps its files for the drivers:
   * the clip, or every part of a Record (labParts.ts). pressedAtMs is the
   * page time of the press, where the file ends.
   */
  const takeResult = useCallback(async (action: "clip" | "record", result: ClipActionResult | null, pressedAtMs: number) => {
    const current = live.current.service;
    if (!result) return;
    if (!result.ok) {
      setLastError(result.reason);
      setMessage(reasonText(result.reason));
      setResults((n) => n + 1);
      return;
    }
    try {
      if (!current) throw new Error("no service");
      const file = await current.library.file(result.record.id);
      const parts: LabPart[] = [{ record: result.record, file }];
      if (action === "record") {
        const declared = declaredParts(result);
        const listed = declared ? [] : await current.library.list({ gameId: result.record.gameId, kind: "record" });
        for (const record of recordParts(result.record, declared, listed).slice(1)) {
          parts.push({ record, file: await current.library.file(record.id) });
        }
      }
      setLastClip({ action, record: result.record, file, url: URL.createObjectURL(file), pressedAtMs, parts, failedParts: declaredFailedParts(result) });
      setLastError(null);
      setMessage(action === "clip" ? LAB_COPY.clipMade : LAB_COPY.videoMade);
    } catch {
      setLastError("mux-failed");
      setMessage(reasonText("mux-failed"));
    }
    setResults((n) => n + 1);
  }, []);

  const beginBusy = useCallback((kind: Exclude<Busy, null>): boolean => {
    if (busyRef.current) return false;
    busyRef.current = kind;
    setBusy(kind);
    return true;
  }, []);

  const endBusy = useCallback(() => {
    busyRef.current = null;
    setBusy(null);
  }, []);

  const clip = useCallback(async (): Promise<ClipActionResult | null> => {
    const current = live.current.service;
    if (!current || !beginBusy("clip")) return null;
    setMessage(LAB_COPY.working);
    try {
      const pressedAtMs = performance.now();
      const result = await current.clipLast(LAB_CLIP_SECONDS);
      await takeResult("clip", result, pressedAtMs);
      return result;
    } finally {
      endBusy();
    }
  }, [takeResult, beginBusy, endBusy]);

  const recordStart = useCallback(async (): Promise<ClipActionResult | null> => {
    const current = live.current.service;
    if (!current) return null;
    const result = await current.startRecording();
    // null: the recording started (or was already on). A result: it could not start.
    if (result && !result.ok) {
      setLastError(result.reason);
      setMessage(reasonText(result.reason));
    } else {
      setMessage(null);
    }
    return result;
  }, []);

  const recordStop = useCallback(async (): Promise<ClipActionResult | null> => {
    const current = live.current.service;
    if (!current || !beginBusy("record")) return null;
    setMessage(LAB_COPY.working);
    try {
      const pressedAtMs = performance.now();
      const result = await current.stopRecording();
      await takeResult("record", result, pressedAtMs);
      return result;
    } finally {
      endBusy();
    }
  }, [takeResult, beginBusy, endBusy]);

  /** "Turn the clip button back on": capture comes back after the governor rested it (plan 11.3). */
  const wake = useCallback(() => {
    live.current.service?.wake();
    setMessage(null);
  }, []);

  // The driver hook (labHandle.ts).
  useEffect(() => {
    const status = (): LabStatus => {
      const s = live.current;
      const snap: ClipSnapshot = s.snapshot;
      return {
        service: s.serviceState,
        attached: s.game !== null,
        picture: s.picture ?? "none",
        running: s.running,
        audio: s.audioState,
        beats: metronome.beatCount,
        skippedBeats: metronome.skipped,
        displayHz: metronome.displayHz,
        holdFrames: metronome.holdFrames,
        beatIntervalSec: metronome.beatIntervalSec,
        maxStride: metronome.lowestStride,
        targetFps: options.targetFps,
        button: snap.button,
        engine: snap.engine,
        reason: snap.reason,
        tier: snap.tier,
        bufferedSec: snap.bufferedSec,
        recording: snap.recording !== null,
        busy: busyRef.current,
        results: s.results,
        lastClip: s.lastClip
          ? {
              action: s.lastClip.action,
              record: s.lastClip.record,
              bytes: s.lastClip.file.size,
              url: s.lastClip.url,
              pressedAtMs: s.lastClip.pressedAtMs,
              parts: s.lastClip.parts.map((part) => part.record),
              failedParts: s.lastClip.failedParts,
            }
          : null,
        lastError: s.lastError,
      };
    };
    const handle = createLabHandle({
      status,
      truth: () => metronome.truth,
      lastFile: (part) => live.current.lastClip?.parts[part]?.file ?? null,
      clip,
      recordStart,
      recordStop,
      wake,
    });
    return installLabHandle(window, handle);
  }, [metronome, options.targetFps, clip, recordStart, recordStop, wake]);

  const ready = serviceState === "ready" && service !== null;
  const recording = snapshot.recording !== null;
  const resting = snapshot.button === "resting" || snapshot.engine === "resting";
  const serviceLine =
    serviceState === "loading"
      ? LAB_COPY.serviceLoading
      : serviceState === "missing"
        ? LAB_COPY.serviceMissing
        : serviceState === "error"
          ? LAB_COPY.serviceError
          : null;
  const readAloudText = useMemo(
    () => [LAB_COPY.title, LAB_COPY.intro, serviceLine, message ?? (resting ? reasonText("resting") : null)].filter(Boolean).join(" "),
    [serviceLine, message, resting],
  );

  return (
    <main className="min-h-screen bg-base-200 px-4 py-6 text-base-content">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-extrabold">{LAB_COPY.title}</h1>
          <p className="text-lg">{LAB_COPY.intro}</p>
          <ReadAloudButton text={readAloudText} className="max-w-xs" />
        </header>

        <canvas
          ref={canvasRef}
          width={LAB_CANVAS_WIDTH}
          height={LAB_CANVAS_HEIGHT}
          data-testid="lab-canvas"
          data-path={options.gl ? "E" : "P"}
          className="aspect-video w-full max-w-[640px] rounded-lg bg-neutral"
        />

        {picture === "none" ? (
          <p role="alert" className="text-lg font-semibold">
            {LAB_COPY.noPicture}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            data-testid="lab-start"
            className="btn btn-primary min-h-[48px] min-w-[120px] text-lg"
            onClick={running ? stop : start}
            aria-pressed={running}
          >
            {running ? LAB_COPY.stop : LAB_COPY.start}
          </button>
          <button
            type="button"
            data-testid="lab-clip"
            className="btn btn-secondary min-h-[48px] min-w-[120px] text-lg"
            onClick={() => void clip()}
            disabled={!ready || busy !== null}
          >
            {LAB_COPY.clip}
          </button>
          <button
            type="button"
            data-testid="lab-record-start"
            className="btn min-h-[48px] min-w-[120px] text-lg"
            onClick={() => void recordStart()}
            disabled={!ready || recording || busy !== null}
          >
            {LAB_COPY.recordStart}
          </button>
          <button
            type="button"
            data-testid="lab-record-stop"
            className="btn min-h-[48px] min-w-[120px] text-lg"
            onClick={() => void recordStop()}
            disabled={!ready || !recording || busy !== null}
          >
            {LAB_COPY.recordStop}
          </button>
          <button
            type="button"
            data-testid="lab-wake"
            className="btn min-h-[48px] min-w-[120px] text-lg"
            onClick={wake}
            disabled={!ready || !resting}
          >
            {LAB_COPY.wake}
          </button>
        </div>

        <p aria-live="polite" data-testid="lab-message" className="min-h-[1.75rem] text-lg font-semibold">
          {message ?? serviceLine ?? (resting ? reasonText("resting") : running && audioState !== "running" ? LAB_COPY.soundOff : "")}
        </p>

        <section className="rounded-lg bg-base-100 p-4">
          <h2 className="mb-2 text-xl font-bold">{LAB_COPY.statusTitle}</h2>
          <dl
            data-testid="lab-status"
            data-service={serviceState}
            data-button={snapshot.button}
            data-engine={snapshot.engine}
            data-running={running ? "1" : "0"}
            data-audio={audioState}
            data-beats={beats}
            data-recording={recording ? "1" : "0"}
            className="text-base"
          >
            <Fact term="Clip service" value={serviceState} />
            <Fact term="Clip button" value={snapshot.button} />
            <Fact term="Engine" value={snapshot.engine} />
            <Fact term="Device tier" value={snapshot.tier} />
            <Fact term="Picture" value={options.gl ? "WebGL2 (path E)" : "2D canvas (path P)"} />
            <Fact term="Target" value={`${options.targetFps} fps`} />
            <Fact term="Flash length" value={holdFrames === null ? "-" : `${holdFrames} frames`} />
            <Fact term="Sound" value={audioState} />
            <Fact term="Beeps" value={String(beats)} />
            <Fact term="Footage" value={`${snapshot.bufferedSec.toFixed(1)} s`} />
            <Fact term="Recording" value={recording ? `${snapshot.recording?.elapsedSec ?? 0} s` : "no"} />
          </dl>
        </section>

        <section className="rounded-lg bg-base-100 p-4">
          <h2 className="mb-2 text-xl font-bold">{lastClip ? LAB_COPY.lastClipTitle : LAB_COPY.noClipTitle}</h2>
          {lastClip ? (
            <div className="flex flex-col gap-3">
              <video src={lastClip.url} controls preload="metadata" className="w-full max-w-[640px] rounded-lg bg-neutral" />
              <dl className="text-base">
                <Fact term="Kind" value={lastClip.record.kind} />
                <Fact term="Length" value={`${(lastClip.record.durationMs / 1000).toFixed(2)} s`} />
                <Fact term="Size" value={`${lastClip.record.width}x${lastClip.record.height}, ${lastClip.record.fps} fps`} />
                <Fact term="Sound" value={lastClip.record.hasAudio ? "yes" : "no"} />
                <Fact term="Bytes" value={String(lastClip.file.size)} />
                <Fact term="Parts" value={lastClip.failedParts > 0 ? `${lastClip.parts.length} (${lastClip.failedParts} could not be made)` : String(lastClip.parts.length)} />
              </dl>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-lg">{LAB_COPY.noClip}</p>
              <ReadAloudButton text={`${LAB_COPY.noClipTitle}. ${LAB_COPY.noClip}`} variant="icon" />
            </div>
          )}
        </section>

        <div
          hidden
          data-testid="lab-last-clip"
          data-state={lastClip ? "ready" : lastError ? "error" : "none"}
          data-results={results}
          data-action={lastClip?.action ?? ""}
          data-blob-url={lastClip?.url ?? ""}
          data-bytes={lastClip ? lastClip.file.size : 0}
          data-parts={lastClip ? lastClip.parts.length : 0}
          data-reason={lastError ?? ""}
        >
          <a data-testid="lab-last-clip-url" href={lastClip?.url}>
            {lastClip?.record.id ?? ""}
          </a>
          <pre data-testid="lab-last-record">{lastClip ? JSON.stringify(lastClip.record) : ""}</pre>
        </div>
      </div>
    </main>
  );
}
