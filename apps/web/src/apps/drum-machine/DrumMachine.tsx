"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useDrumMachineStore } from "./lib/store";
import {
  DRUM_KITS,
  MIN_BPM,
  MAX_BPM,
  COLORS,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer, useShortViewport } from "@/shared/hooks";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { AppNotesSlot } from "@/shared/components/AppNotesSlot";
import { DRUM_MACHINE_INSTRUCTIONS } from "./lib/readAloud";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";

// ============================================
// DRUM PAD COMPONENT
// ============================================

/**
 * A pad in the pad box: the biggest square that lets 4 x 2 pads (gap-3,
 * 12 px) fit the box, never under the 44 px a finger needs (the box
 * scrolls then) and never over the 96 px of a big screen.
 */
const FIT_PAD = "clamp(2.75rem, min((100cqw - 2.25rem) / 4, (100cqh - 0.75rem) / 2), 6rem)";
/** The pad's name grows and shrinks with the pad ("Tom Hi" ran past a 50 px pad). */
const FIT_PAD_TEXT = `clamp(0.6875rem, ${FIT_PAD} * 0.22, 1rem)`;

function DrumPad({
  soundId,
  name,
  color,
  isActive,
  fit = false,
}: {
  soundId: string;
  name: string;
  color: string;
  isActive: boolean;
  /** Size the pad to the pad box (a size container) instead of 80 / 96 px. */
  fit?: boolean;
}) {
  const padRef = useRef<HTMLButtonElement>(null);

  // Stable handlers keyed on soundId: reading the store via getState() keeps
  // the native-listener effect below from re-attaching on every parent
  // render (the sequencer re-renders every 16th note during playback).
  const onTrigger = useCallback(() => {
    useDrumMachineStore.getState().triggerPad(soundId);
  }, [soundId]);
  const onRelease = useCallback(() => {
    useDrumMachineStore.getState().releasePad(soundId);
  }, [soundId]);

  // Touch handlers attach natively with { passive: false } so preventDefault
  // actually runs — React's synthetic onTouch* props are passive, so the old
  // inline preventDefault silently failed: every tap logged a console error
  // AND still fired the compatibility mousedown, double-triggering the pad.
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;

    const handleStart = (e: TouchEvent) => {
      e.preventDefault();
      onTrigger();
    };
    const handleEnd = (e: TouchEvent) => {
      e.preventDefault();
      onRelease();
    };

    pad.addEventListener("touchstart", handleStart, { passive: false });
    pad.addEventListener("touchend", handleEnd, { passive: false });
    pad.addEventListener("touchcancel", handleEnd, { passive: false });
    return () => {
      pad.removeEventListener("touchstart", handleStart);
      pad.removeEventListener("touchend", handleEnd);
      pad.removeEventListener("touchcancel", handleEnd);
    };
  }, [onTrigger, onRelease]);

  return (
    <button
      ref={padRef}
      onMouseDown={onTrigger}
      onMouseUp={onRelease}
      onMouseLeave={onRelease}
      className={`
        ${fit ? "" : "w-20 h-20 md:w-24 md:h-24"} rounded-xl
        flex flex-col items-center justify-center
        font-bold text-black
        transition-all duration-75
        shadow-lg
        ${isActive ? "scale-95 brightness-150" : "hover:scale-105"}
      `}
      style={{
        ...(fit ? { width: FIT_PAD, height: FIT_PAD } : null),
        backgroundColor: color,
        boxShadow: isActive ? `0 0 20px ${color}` : undefined,
      }}
    >
      <span
        className={fit ? "px-0.5 text-center leading-tight" : "text-sm md:text-base"}
        style={fit ? { fontSize: FIT_PAD_TEXT } : undefined}
      >
        {name}
      </span>
    </button>
  );
}

// ============================================
// SEQUENCER GRID
// ============================================
function SequencerGrid() {
  const store = useDrumMachineStore();
  const kit = DRUM_KITS.find(k => k.id === store.currentKitId);
  const { patternLength } = store;

  if (!kit) return null;

  return (
    <div className="overflow-x-auto pb-4">
      <div className="inline-block min-w-full">
        {/* Step numbers */}
        <div className="flex gap-1 mb-2 ml-20">
          {Array.from({ length: patternLength }, (_, i) => (
            <div
              key={i}
              className={`
                w-11 h-6 shrink-0 flex items-center justify-center text-sm
                ${store.currentStep === i && store.isPlaying ? "text-green-400 font-bold" : "text-slate-400"}
                ${i % 4 === 0 ? "text-slate-200" : ""}
              `}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Playhead */}
        {store.isPlaying && (
          <div
            className="h-1 bg-green-500 rounded transition-all duration-75 ml-20"
            style={{
              width: `${(store.currentStep / patternLength) * 100}%`,
              maxWidth: `${patternLength * 48}px`,
            }}
          />
        )}

        {/* Grid rows */}
        {kit.sounds.map(sound => (
          <div key={sound.id} className="flex items-center gap-1 mb-1">
            {/* Sound label */}
            <div
              className="sticky left-0 z-[1] w-16 h-11 shrink-0 rounded flex items-center justify-center text-sm font-bold text-black truncate"
              style={{ backgroundColor: sound.color }}
            >
              {sound.name}
            </div>

            {/* Steps */}
            {Array.from({ length: patternLength }, (_, step) => {
              const isActive = store.pattern[sound.id]?.[step] || false;
              const isCurrent = store.currentStep === step && store.isPlaying;

              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => store.toggleStep(sound.id, step)}
                  aria-label={`${sound.name} step ${step + 1}`}
                  aria-pressed={isActive}
                  className={`
                    h-11 w-11 shrink-0 rounded
                    transition-all duration-75
                    ${isActive
                      ? "scale-95"
                      : "hover:bg-slate-600"
                    }
                    ${step % 4 === 0 ? "ml-1" : ""}
                  `}
                  style={{
                    backgroundColor: isActive ? sound.color : COLORS.GRID_INACTIVE,
                    boxShadow: isCurrent && isActive ? `0 0 10px ${sound.color}` : undefined,
                    opacity: isCurrent ? 1 : isActive ? 0.9 : 0.5,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
export function DrumMachine() {
  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<number | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [beatName, setBeatName] = useState("");
  const [showBeatsModal, setShowBeatsModal] = useState(false);

  const store = useDrumMachineStore();
  const kit = DRUM_KITS.find(k => k.id === store.currentKitId);
  const isCoarsePointer = useCoarsePointer();
  // A phone held sideways: the controls go in a column beside the pads.
  const short = useShortViewport();

  // Auth sync
  useAuthSync({
    appId: "drum-machine",
    localStorageKey: "drum-machine-state",
    getState: store.getProgress,
    setState: store.setProgress,
    debounceMs: 3000,
  });

  // Sequencer playback timer
  useEffect(() => {
    if (store.isPlaying) {
      const msPerStep = (60 / store.bpm / 4) * 1000; // 16th notes

      intervalRef.current = window.setInterval(() => {
        useDrumMachineStore.getState().advanceStep();
      }, msPerStep);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [store.isPlaying, store.bpm]);

  // Keyboard shortcuts. The handlers read the store when a key goes down:
  // `store` is the whole state, a new object on every step of the beat, so
  // depending on it took the listeners off and put them back 8 times a
  // second while a beat played.
  useEffect(() => {
    const keyMap: Record<string, string> = {
      "1": kit?.sounds[0]?.id || "",
      "2": kit?.sounds[1]?.id || "",
      "3": kit?.sounds[2]?.id || "",
      "4": kit?.sounds[3]?.id || "",
      "q": kit?.sounds[4]?.id || "",
      "w": kit?.sounds[5]?.id || "",
      "e": kit?.sounds[6]?.id || "",
      "r": kit?.sounds[7]?.id || "",
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // Don't trigger drums when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const state = useDrumMachineStore.getState();
      const soundId = keyMap[e.key.toLowerCase()];
      if (soundId) {
        e.preventDefault();
        state.triggerPad(soundId);
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (state.isPlaying) {
          state.stopPlayback();
        } else {
          state.startPlayback();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const soundId = keyMap[e.key.toLowerCase()];
      if (soundId) {
        useDrumMachineStore.getState().releasePad(soundId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [kit]);

  const handleSaveBeat = () => {
    if (beatName.trim()) {
      store.saveBeat(beatName.trim());
      setBeatName("");
      setShowSaveModal(false);
    }
  };

  const toggleSound = () => {
    store.setProgress({
      ...store.progress,
      settings: {
        ...store.progress.settings,
        soundEnabled: !store.progress.settings.soundEnabled,
      },
    });
  };

  if (!kit) return null;

  // The controls: the kit, the speed, pads or the beat grid, and the steps.
  const controls = (
    <div className={`flex flex-wrap items-center ${short ? "justify-start gap-1.5" : "justify-center gap-2"}`}>
      <ReadAloudButton text={DRUM_MACHINE_INSTRUCTIONS} variant="icon" />
      {/* Kit selector */}
      <select
        value={store.currentKitId}
        onChange={(e) => store.setKit(e.target.value)}
        aria-label="Drum kit"
        className="min-h-11 rounded-lg bg-slate-700 px-3 text-base font-bold text-white"
      >
        {DRUM_KITS.map(k => (
          <option key={k.id} value={k.id}>{k.name}</option>
        ))}
      </select>

      {/* Mode toggle: a segmented control, 44 px (it was 40) */}
      <div role="group" aria-label="Pads or beat grid" className="flex overflow-hidden rounded-lg bg-slate-700">
        {(["pads", "sequencer"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={store.mode === m}
            onClick={() => store.setMode(m)}
            className={`min-h-11 px-3 text-base font-bold ${store.mode === m ? "bg-blue-600 text-white" : "text-slate-200"}`}
          >
            {m === "pads" ? "🥁 Pads" : "🎼 Beat grid"}
          </button>
        ))}
      </div>

      {/* BPM: the whole 44 px band takes a finger (the slider was 16 px) */}
      <label className="flex min-h-11 items-center gap-2 text-base font-bold text-white">
        <span>BPM</span>
        <input
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          value={store.bpm}
          onChange={(e) => store.setBpm(parseInt(e.target.value))}
          aria-label="Speed in beats a minute"
          className="h-11 w-28 accent-blue-500"
        />
        <span className="w-9 tabular-nums">{store.bpm}</span>
      </label>

      {/* Pattern length (only in sequencer mode) */}
      {store.mode === "sequencer" && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => store.shrinkPattern()}
            disabled={store.patternLength <= 16}
            aria-label="Fewer steps"
            className={`h-11 w-11 rounded font-bold ${
              store.patternLength <= 16
                ? "cursor-not-allowed bg-slate-800 text-slate-500"
                : "bg-slate-600 text-white hover:bg-slate-500"
            }`}
          >
            −
          </button>
          <span className="min-w-[72px] text-center text-base font-bold text-white">
            {store.patternLength} steps
          </span>
          <button
            type="button"
            onClick={() => store.extendPattern()}
            aria-label="More steps"
            className="h-11 w-11 rounded bg-slate-600 font-bold text-white hover:bg-slate-500"
          >
            +
          </button>
        </div>
      )}
    </div>
  );

  const pads = (gap: string, fit = false) => (
    <div className={`grid grid-cols-4 justify-items-center ${gap}`}>
      {kit.sounds.map(sound => (
        <DrumPad
          key={sound.id}
          soundId={sound.id}
          name={sound.name}
          color={sound.color}
          isActive={store.activePads.has(sound.id)}
          fit={fit}
        />
      ))}
    </div>
  );

  // Play, record, clear, save, load and the sound: a dock that is part of
  // the layout (it was sticky, and sideways it sat on the pads, so a tap on
  // Kick hit Stop).
  const transport = (
    <div
      data-testid="drum-transport"
      className={`flex items-center justify-center ${short ? "gap-1" : "gap-3"}`}
    >
      <button
        type="button"
        onClick={() => store.isPlaying ? store.stopPlayback() : store.startPlayback()}
        aria-label={store.isPlaying ? "Stop" : "Play"}
        className={`h-14 w-14 shrink-0 rounded-full text-2xl font-bold text-white short:h-11 short:w-11 short:text-xl ${store.isPlaying ? "bg-red-600 hover:bg-red-500" : "bg-green-600 hover:bg-green-500"}`}
      >
        {store.isPlaying ? "⏹" : "▶"}
      </button>
      <button
        type="button"
        onClick={() => store.toggleRecording()}
        aria-label={store.isRecording ? "Stop recording" : "Record"}
        aria-pressed={store.isRecording}
        className={`h-12 w-12 shrink-0 rounded-full text-xl font-bold text-white transition-all short:h-11 short:w-11 ${
          store.isRecording ? "bg-red-600 ring-4 ring-red-400" : "bg-slate-600 hover:bg-red-600"
        }`}
        title="Record - tap pads while loop plays"
      >
        ⏺
      </button>
      <button
        type="button"
        onClick={() => store.clearPattern()}
        aria-label="Clear the beat"
        className="h-12 w-12 shrink-0 rounded-full bg-slate-600 font-bold text-white hover:bg-slate-500 short:h-11 short:w-11"
        title="Clear pattern"
      >
        🗑
      </button>
      <button
        type="button"
        onClick={() => setShowSaveModal(true)}
        aria-label="Save the beat"
        className="h-12 w-12 shrink-0 rounded-full bg-blue-600 font-bold text-white hover:bg-blue-500 short:h-11 short:w-11"
        title="Save beat"
      >
        💾
      </button>
      <button
        type="button"
        onClick={() => setShowBeatsModal(true)}
        aria-label="Load a beat"
        className="h-12 w-12 shrink-0 rounded-full bg-purple-600 font-bold text-white hover:bg-purple-500 short:h-11 short:w-11"
        title="Load beat"
      >
        📂
      </button>
      <button
        type="button"
        onClick={toggleSound}
        aria-label={store.progress.settings.soundEnabled ? "Sound on" : "Sound off"}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-700 text-white hover:bg-slate-600 short:h-11 short:w-11"
      >
        {store.progress.settings.soundEnabled ? "🔊" : "🔇"}
      </button>
    </div>
  );

  const hint = (
    <p className="text-center text-base text-slate-300">
      {store.isRecording
        ? "🔴 Recording: tap pads to add beats!"
        : isCoarsePointer
          ? "Tap the pads to play. Hit ⏺ then tap pads to build a beat!"
          : "Keys: 1-4 / Q-R = Drums | Space = Play/Stop. Hit ⏺ then play to build a beat!"}
    </p>
  );

  const main = (
    <div data-testid="drum-main" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      {/* The install pill and a trophy show here, as rows of the page,
          never over the pads. */}
      <IOSInstallPrompt />
      <AppNotesSlot className="mb-2" />
      {store.mode === "pads" ? (
        // The pads take the room the install pill and a trophy leave (a
        // min-h-full box under them always ran past the screen by their
        // height), and size to it: the pad box is a size container.
        <div className="flex min-h-0 flex-1 flex-col gap-3 py-2">
          <div data-testid="drum-pad-box" className="flex min-h-0 flex-1 items-center justify-center" style={{ containerType: "size" }}>
            {pads("gap-3", true)}
          </div>
          {!short && hint}
        </div>
      ) : (
        <div className="space-y-3 py-2">
          <SequencerGrid />
          {pads("gap-2")}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={containerRef}
      data-testid="drum-root"
      className={`flex h-full select-none bg-slate-900 ${short ? "flex-row gap-3 p-2" : "flex-col gap-2 p-3"}`}
    >
      {short ? (
        <>
          {main}
          {/* Sideways: the controls and the transport are a column beside
              the pads, never on them. */}
          {/* justify-center-safe: when the beat grid's step row makes the
              column taller than a small phone, it scrolls from its top
              instead of losing the top under the header. */}
          <div data-testid="drum-side" className="flex w-[18rem] shrink-0 flex-col justify-center-safe gap-2 overflow-y-auto">
            {controls}
            {transport}
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0">{controls}</div>
          {main}
          <div className="shrink-0 border-t border-slate-700 pt-2">{transport}</div>
        </>
      )}

      {/* Save modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 w-80">
            <h2 className="text-xl font-bold text-white mb-4">Save Beat</h2>
            <input
              type="text"
              value={beatName}
              onChange={(e) => setBeatName(e.target.value)}
              placeholder="Beat name..."
              className="w-full bg-slate-700 text-white px-4 py-2 rounded-lg mb-4"
              autoFocus
            />
            <div className="flex gap-4">
              <button
                onClick={() => setShowSaveModal(false)}
                className="flex-1 bg-slate-600 hover:bg-slate-500 text-white py-2 rounded-lg font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBeat}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg font-bold"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Beats modal */}
      {showBeatsModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 w-96 max-h-96 overflow-y-auto">
            <h2 className="text-xl font-bold text-white mb-4">Saved Beats</h2>
            {store.progress.savedBeats.length === 0 ? (
              <p className="text-slate-400 text-center py-8">No saved beats yet</p>
            ) : (
              <div className="space-y-2">
                {store.progress.savedBeats.map(beat => (
                  <div
                    key={beat.id}
                    className="flex items-center justify-between bg-slate-700 rounded-lg p-3"
                  >
                    <div>
                      <div className="text-white font-bold">{beat.name}</div>
                      <div className="text-slate-400 text-sm">
                        {beat.bpm} BPM • {DRUM_KITS.find(k => k.id === beat.kitId)?.name}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          store.loadBeat(beat);
                          setShowBeatsModal(false);
                        }}
                        className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded font-bold text-sm"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => store.deleteBeat(beat.id)}
                        className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded font-bold text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowBeatsModal(false)}
              className="w-full mt-4 bg-slate-600 hover:bg-slate-500 text-white py-2 rounded-lg font-bold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DrumMachine;
