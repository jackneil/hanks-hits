"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useDrumMachineStore, playDrumSound, type DrumMachineProgress } from "./lib/store";
import {
  DRUM_KITS,
  GRID_STEPS,
  MIN_BPM,
  MAX_BPM,
  COLORS,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

// ============================================
// DRUM PAD COMPONENT
// ============================================
function DrumPad({
  soundId,
  name,
  color,
  isActive,
  onTrigger,
  onRelease,
}: {
  soundId: string;
  name: string;
  color: string;
  isActive: boolean;
  onTrigger: () => void;
  onRelease: () => void;
}) {
  return (
    <button
      onMouseDown={onTrigger}
      onMouseUp={onRelease}
      onMouseLeave={onRelease}
      onTouchStart={(e) => {
        e.preventDefault();
        onTrigger();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        onRelease();
      }}
      className={`
        w-20 h-20 md:w-24 md:h-24 rounded-xl
        flex flex-col items-center justify-center
        font-bold text-black
        transition-all duration-75
        shadow-lg
        ${isActive ? "scale-95 brightness-150" : "hover:scale-105"}
      `}
      style={{
        backgroundColor: color,
        boxShadow: isActive ? `0 0 20px ${color}` : undefined,
      }}
    >
      <span className="text-sm md:text-base">{name}</span>
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
                w-8 h-6 flex items-center justify-center text-xs
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
              maxWidth: `${patternLength * 36}px`,
            }}
          />
        )}

        {/* Grid rows */}
        {kit.sounds.map(sound => (
          <div key={sound.id} className="flex items-center gap-1 mb-1">
            {/* Sound label */}
            <div
              className="w-16 h-8 rounded flex items-center justify-center text-xs font-bold text-black truncate"
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
                  onClick={() => store.toggleStep(sound.id, step)}
                  className={`
                    w-8 h-8 rounded
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
        store.advanceStep();
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

  // Keyboard shortcuts
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
      // Don't trigger drums when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const soundId = keyMap[e.key.toLowerCase()];
      if (soundId) {
        e.preventDefault();
        store.triggerPad(soundId);
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (store.isPlaying) {
          store.stopPlayback();
        } else {
          store.startPlayback();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const soundId = keyMap[e.key.toLowerCase()];
      if (soundId) {
        store.releasePad(soundId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [kit, store]);

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

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center min-h-screen bg-slate-900 p-4 select-none"
    >
      {/* Header */}
      <div className="text-center mb-4">
        <h1 className="text-3xl font-bold text-white mb-2">Drum Machine</h1>
        <div className="flex items-center justify-center gap-4 text-slate-400 text-sm">
          <span>Beats: {store.progress.stats.beatsCreated}</span>
          <span>|</span>
          <span>Pads Hit: {store.progress.stats.padsHit}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-4 mb-6">
        {/* Kit selector */}
        <select
          value={store.currentKitId}
          onChange={(e) => store.setKit(e.target.value)}
          className="bg-slate-700 text-white px-4 py-2 rounded-lg font-bold"
        >
          {DRUM_KITS.map(k => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </select>

        {/* BPM */}
        <div className="flex items-center gap-2">
          <span className="text-white font-bold">BPM:</span>
          <input
            type="range"
            min={MIN_BPM}
            max={MAX_BPM}
            value={store.bpm}
            onChange={(e) => store.setBpm(parseInt(e.target.value))}
            className="w-24"
          />
          <span className="text-white w-10">{store.bpm}</span>
        </div>

        {/* Pattern length (only in sequencer mode) */}
        {store.mode === "sequencer" && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => store.shrinkPattern()}
              disabled={store.patternLength <= 16}
              className={`w-8 h-8 rounded font-bold ${
                store.patternLength <= 16
                  ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                  : "bg-slate-600 hover:bg-slate-500 text-white"
              }`}
            >
              −
            </button>
            <span className="text-white font-bold min-w-[80px] text-center">
              {store.patternLength} steps
            </span>
            <button
              onClick={() => store.extendPattern()}
              className="w-8 h-8 bg-slate-600 hover:bg-slate-500 rounded font-bold text-white"
            >
              +
            </button>
          </div>
        )}

        {/* Mode toggle */}
        <div className="flex bg-slate-700 rounded-lg overflow-hidden">
          <button
            onClick={() => store.setMode("pads")}
            className={`px-4 py-2 font-bold ${
              store.mode === "pads" ? "bg-blue-600 text-white" : "text-slate-300"
            }`}
          >
            Pads
          </button>
          <button
            onClick={() => store.setMode("sequencer")}
            className={`px-4 py-2 font-bold ${
              store.mode === "sequencer" ? "bg-blue-600 text-white" : "text-slate-300"
            }`}
          >
            Sequencer
          </button>
        </div>
      </div>

      {/* Main content */}
      {store.mode === "pads" ? (
        // PAD MODE
        <div className="grid grid-cols-4 gap-3">
          {kit.sounds.map(sound => (
            <DrumPad
              key={sound.id}
              soundId={sound.id}
              name={sound.name}
              color={sound.color}
              isActive={store.activePads.has(sound.id)}
              onTrigger={() => store.triggerPad(sound.id)}
              onRelease={() => store.releasePad(sound.id)}
            />
          ))}
        </div>
      ) : (
        // SEQUENCER MODE - show pads too when recording
        <div className="w-full max-w-3xl space-y-6">
          <SequencerGrid />

          {/* Show pads below sequencer for live recording */}
          <div className="border-t border-slate-700 pt-4">
            <div className="text-center text-slate-400 text-sm mb-3">
              {store.isRecording ? "🎯 Tap pads to record!" : "💡 Hit Record to add beats with pads"}
            </div>
            <div className="grid grid-cols-4 gap-2 justify-items-center">
              {kit.sounds.map(sound => (
                <DrumPad
                  key={sound.id}
                  soundId={sound.id}
                  name={sound.name}
                  color={sound.color}
                  isActive={store.activePads.has(sound.id)}
                  onTrigger={() => store.triggerPad(sound.id)}
                  onRelease={() => store.releasePad(sound.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recording indicator */}
      {store.isRecording && (
        <div className="flex items-center gap-2 text-red-500 font-bold animate-pulse">
          <span className="w-3 h-3 bg-red-500 rounded-full" />
          Recording... tap pads to add beats!
        </div>
      )}

      {/* Transport controls */}
      <div className="flex items-center gap-4 mt-4">
        <button
          onClick={() => store.isPlaying ? store.stopPlayback() : store.startPlayback()}
          className={`
            w-16 h-16 rounded-full font-bold text-2xl text-white
            ${store.isPlaying ? "bg-red-600 hover:bg-red-500" : "bg-green-600 hover:bg-green-500"}
          `}
        >
          {store.isPlaying ? "⏹" : "▶"}
        </button>

        {/* Record button */}
        <button
          onClick={() => store.toggleRecording()}
          className={`
            w-14 h-14 rounded-full font-bold text-xl text-white
            transition-all
            ${store.isRecording
              ? "bg-red-600 ring-4 ring-red-400 animate-pulse"
              : "bg-slate-600 hover:bg-red-600"
            }
          `}
          title="Record - tap pads while loop plays"
        >
          ⏺
        </button>

        <button
          onClick={() => store.clearPattern()}
          className="w-12 h-12 bg-slate-600 hover:bg-slate-500 rounded-full text-white font-bold"
          title="Clear pattern"
        >
          🗑
        </button>
        <button
          onClick={() => setShowSaveModal(true)}
          className="w-12 h-12 bg-blue-600 hover:bg-blue-500 rounded-full text-white font-bold"
          title="Save beat"
        >
          💾
        </button>
        <button
          onClick={() => setShowBeatsModal(true)}
          className="w-12 h-12 bg-purple-600 hover:bg-purple-500 rounded-full text-white font-bold"
          title="Load beat"
        >
          📂
        </button>
      </div>

      {/* Bottom controls */}
      <div className="flex items-center gap-4 mt-6">
        <button
          onClick={toggleSound}
          className="w-12 h-12 bg-slate-700 hover:bg-slate-600 text-white rounded-full flex items-center justify-center"
        >
          {store.progress.settings.soundEnabled ? "🔊" : "🔇"}
        </button>
        <IOSInstallPrompt />
      </div>

      {/* Keyboard hints */}
      <div className="mt-4 text-slate-400 text-center text-sm">
        <p>Keys: 1-4 / Q-R = Drums | Space = Play/Stop</p>
        <p className="text-slate-500">Hit ⏺ Record then tap pads to build your beat!</p>
      </div>

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
