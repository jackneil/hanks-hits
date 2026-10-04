import { readBeatName, writeBeatName } from "./localWords";
import { createWordProjection } from "@/lib/progress-words";
import { localWords } from "@/lib/local-words";
import { bindWordConsumer } from "@/lib/local-words/consumer";
import { bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import {
  type GameStatus,
  type SequencerPattern,
  type SavedBeat,
  DRUM_KITS,
  DEFAULT_BPM,
  GRID_STEPS,
  MAX_PATTERN_STEPS,
  createEmptyPattern,
} from "./constants";

// Progress data (persisted)
export type DrumMachineProgress = {
  savedBeats: SavedBeat[];
  favoriteKitId: string;
  settings: {
    defaultBpm: number;
    defaultKitId: string;
    soundEnabled: boolean;
    volume: number;
  };
  stats: {
    beatsCreated: number;
    totalPlayTime: number;
    padsHit: number;
  };
  lastModified: number;
};

// Full state
export type DrumMachineState = {
  status: GameStatus;
  mode: "pads" | "sequencer";

  currentKitId: string;
  bpm: number;
  pattern: SequencerPattern;
  patternLength: number; // Dynamic pattern length (default 16)

  currentStep: number;
  isPlaying: boolean;
  isRecording: boolean; // Live loop recording

  activePads: Set<string>; // Currently pressed pads (for visual feedback)

  progress: DrumMachineProgress;
};

type DrumMachineActions = {
  setMode: (mode: "pads" | "sequencer") => void;
  setKit: (kitId: string) => void;
  setBpm: (bpm: number) => void;

  // Pad mode
  triggerPad: (soundId: string) => void;
  releasePad: (soundId: string) => void;

  // Sequencer mode
  toggleStep: (soundId: string, step: number) => void;
  clearPattern: () => void;
  extendPattern: () => void;
  shrinkPattern: () => void;

  // Playback
  startPlayback: () => void;
  stopPlayback: () => void;
  advanceStep: () => void;
  toggleRecording: () => void;

  // Beats
  saveBeat: (name: string) => void;
  loadBeat: (beat: SavedBeat) => void;
  deleteBeat: (beatId: string) => void;

  /** The sound switch: a player's choice, so it stamps the time. */
  toggleSound: () => void;

  // Progress
  getProgress: () => DrumMachineProgress;
  setProgress: (data: DrumMachineProgress) => void;
};

const projectWords = createWordProjection<DrumMachineProgress>("drum-machine");

const defaultProgress: DrumMachineProgress = {
  savedBeats: [],
  favoriteKitId: "hip-hop",
  settings: {
    defaultBpm: DEFAULT_BPM,
    defaultKitId: "hip-hop",
    soundEnabled: true,
    volume: 0.8,
  },
  stats: {
    beatsCreated: 0,
    totalPlayTime: 0,
    padsHit: 0,
  },
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// The sound switch did not stamp the time before the sync-time fix.
const UNTOUCHED = defineUntouchedProgress("drum-machine", {
  defaults: defaultProgress,
  ignore: ["settings"],
  // The items that a player makes (addListItems: an item made here and not
  // saved yet joins progress that the page takes). `max` is the schema's
  // bound (progress-schemas.ts); saveBeat adds at the end.
  lists: { savedBeats: { id: "id", max: 100, order: "newestLast", time: "createdAt" } },
});

function createInitialState(): Partial<DrumMachineState> {
  return {
    status: "idle",
    mode: "pads",
    currentKitId: "hip-hop",
    bpm: DEFAULT_BPM,
    pattern: createEmptyPattern(),
    patternLength: GRID_STEPS,
    currentStep: 0,
    isPlaying: false,
    isRecording: false,
    activePads: new Set(),
  };
}

// Audio engine
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext)();
  }

  // iOS requires resume on user gesture - this is called from tap handlers
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

export function playDrumSound(
  kitId: string,
  soundId: string,
  volume: number,
  enabled: boolean
) {
  if (!enabled) return;

  const kit = DRUM_KITS.find(k => k.id === kitId);
  if (!kit) return;

  const sound = kit.sounds.find(s => s.id === soundId);
  if (!sound) return;

  try {
    const ctx = getAudioContext();
    const masterGain = ctx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(ctx.destination);

    if (sound.noise) {
      // Create noise for hi-hats, snares, etc.
      const bufferSize = ctx.sampleRate * sound.decay;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      // Filter for tone
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = sound.frequency;
      filter.Q.value = 1;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.5, ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + sound.decay);

      noise.connect(filter);
      filter.connect(env);
      env.connect(masterGain);

      noise.start();
      noise.stop(ctx.currentTime + sound.decay);
    } else {
      // Oscillator-based sounds
      const osc = ctx.createOscillator();
      osc.type = sound.type;
      osc.frequency.setValueAtTime(sound.frequency, ctx.currentTime);

      // Pitch bend for kick drums
      if (sound.frequency < 100) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(sound.frequency * 0.5, 20),
          ctx.currentTime + sound.decay
        );
      }

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.8, ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + sound.decay);

      // Optional filter
      if (sound.filterFreq) {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = sound.filterFreq;
        osc.connect(filter);
        filter.connect(env);
      } else {
        osc.connect(env);
      }

      env.connect(masterGain);

      osc.start();
      osc.stop(ctx.currentTime + sound.decay + 0.1);
    }
  } catch {
    // Audio not supported
  }
}

export const useDrumMachineStore = create<DrumMachineState & DrumMachineActions>()(
  persist(
    (set, get) => ({
      ...createInitialState() as DrumMachineState,
      progress: defaultProgress,

      setMode: (mode) => set({ mode }),

      setKit: (kitId) => {
        const kit = DRUM_KITS.find(k => k.id === kitId);
        if (!kit) return;

        const state = get();
        // Reset pattern for new kit but keep pattern length
        const pattern: SequencerPattern = {};
        kit.sounds.forEach(sound => {
          pattern[sound.id] = new Array(state.patternLength).fill(false);
        });

        set({ currentKitId: kitId, pattern });
      },

      setBpm: (bpm) => set({ bpm }),

      triggerPad: (soundId) => {
        const state = get();
        playDrumSound(
          state.currentKitId,
          soundId,
          state.progress.settings.volume,
          state.progress.settings.soundEnabled
        );

        const activePads = new Set(state.activePads);
        activePads.add(soundId);

        // If recording during playback, add hit to pattern at current step
        let pattern = state.pattern;
        if (state.isPlaying && state.isRecording) {
          pattern = { ...state.pattern };
          if (!pattern[soundId]) {
            pattern[soundId] = new Array(state.patternLength).fill(false);
          }
          pattern[soundId] = [...pattern[soundId]];
          pattern[soundId][state.currentStep] = true;
        }

        set({
          activePads,
          pattern,
          progress: {
            ...state.progress,
            stats: {
              ...state.progress.stats,
              padsHit: state.progress.stats.padsHit + 1,
            },
            lastModified: Date.now(),
          },
        });
      },

      releasePad: (soundId) => {
        const state = get();
        const activePads = new Set(state.activePads);
        activePads.delete(soundId);
        set({ activePads });
      },

      toggleStep: (soundId, step) => {
        const state = get();
        const pattern = { ...state.pattern };
        if (!pattern[soundId]) {
          pattern[soundId] = new Array(state.patternLength).fill(false);
        }
        pattern[soundId] = [...pattern[soundId]];
        pattern[soundId][step] = !pattern[soundId][step];
        set({ pattern });
      },

      clearPattern: () => {
        const state = get();
        const kit = DRUM_KITS.find(k => k.id === state.currentKitId);
        if (!kit) return;

        const pattern: SequencerPattern = {};
        kit.sounds.forEach(sound => {
          pattern[sound.id] = new Array(state.patternLength).fill(false);
        });
        set({ pattern });
      },

      extendPattern: () => {
        const state = get();
        const kit = DRUM_KITS.find(k => k.id === state.currentKitId);
        if (!kit || state.patternLength >= MAX_PATTERN_STEPS) return;

        const newLength = state.patternLength + 16;
        const pattern = { ...state.pattern };

        // Extend each sound's array
        kit.sounds.forEach(sound => {
          if (!pattern[sound.id]) {
            pattern[sound.id] = new Array(newLength).fill(false);
          } else {
            pattern[sound.id] = [
              ...pattern[sound.id],
              ...new Array(16).fill(false),
            ];
          }
        });

        set({ pattern, patternLength: newLength });
      },

      shrinkPattern: () => {
        const state = get();
        if (state.patternLength <= 16) return; // Can't go below 16

        const newLength = state.patternLength - 16;
        const pattern = { ...state.pattern };

        // Shrink each sound's array
        for (const soundId of Object.keys(pattern)) {
          pattern[soundId] = pattern[soundId].slice(0, newLength);
        }

        // Reset currentStep if it's beyond new length
        const currentStep =
          state.currentStep >= newLength ? 0 : state.currentStep;

        set({ pattern, patternLength: newLength, currentStep });
      },

      startPlayback: () => {
        set({ isPlaying: true, currentStep: 0 });
      },

      stopPlayback: () => {
        set({ isPlaying: false, isRecording: false, currentStep: 0 });
      },

      toggleRecording: () => {
        const state = get();
        // If not playing, start playback when enabling record
        if (!state.isRecording && !state.isPlaying) {
          set({ isRecording: true, isPlaying: true, currentStep: 0 });
        } else {
          set({ isRecording: !state.isRecording });
        }
      },

      advanceStep: () => {
        const state = get();
        if (!state.isPlaying) return;

        const nextStep = (state.currentStep + 1) % state.patternLength;

        // Trigger sounds for this step
        const kit = DRUM_KITS.find(k => k.id === state.currentKitId);
        if (kit) {
          kit.sounds.forEach(sound => {
            if (state.pattern[sound.id]?.[state.currentStep]) {
              playDrumSound(
                state.currentKitId,
                sound.id,
                state.progress.settings.volume,
                state.progress.settings.soundEnabled
              );
            }
          });
        }

        set({ currentStep: nextStep });
      },

      saveBeat: (name) => {
        const state = get();
        const beat: SavedBeat = {
          id: Date.now().toString(),
          name,
          kitId: state.currentKitId,
          bpm: state.bpm,
          pattern: { ...state.pattern },
          patternLength: state.patternLength,
          createdAt: new Date().toISOString(),
        };

        const lease = localWords.captureLease();
        if (lease) void writeBeatName(lease, beat.id, name);

        set({
          progress: {
            ...state.progress,
            savedBeats: [...state.progress.savedBeats, beat],
            stats: {
              ...state.progress.stats,
              beatsCreated: state.progress.stats.beatsCreated + 1,
            },
            lastModified: Date.now(),
          },
        });
      },

      loadBeat: (beat) => {
        // Calculate pattern length from saved beat or pattern array
        let patternLength = beat.patternLength;
        if (!patternLength) {
          // Backwards compatibility: calculate from pattern array length
          const firstSoundPattern = Object.values(beat.pattern)[0];
          patternLength = firstSoundPattern?.length || GRID_STEPS;
        }

        set({
          currentKitId: beat.kitId,
          bpm: beat.bpm,
          pattern: { ...beat.pattern },
          patternLength,
          isPlaying: false,
          currentStep: 0,
        });
      },

      deleteBeat: (beatId) => {
        const state = get();
        if (!state.progress.savedBeats.some(b => b.id === beatId)) return;
        set({
          progress: {
            ...state.progress,
            savedBeats: state.progress.savedBeats.filter(b => b.id !== beatId),
            lastModified: Date.now(),
          },
        });
      },

      toggleSound: () =>
        set((state) => ({
          progress: {
            ...state.progress,
            settings: { ...state.progress.settings, soundEnabled: !state.progress.settings.soundEnabled },
            lastModified: Date.now(),
          },
        })),

      getProgress: () => projectWords(get().progress),
      setProgress: (data) => set({ progress: data }),
    }),
    {
      storage: createOwnerPersistStorage("drum-machine-state", "drum-machine"),
      skipHydration: true,
      name: "drum-machine-state",
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      partialize: (state) => markSaved({
        progress: projectWords(state.progress),
      }),
    }
  )
);

bindPersistedStore("drum-machine-state", useDrumMachineStore.persist, () => useDrumMachineStore.setState({}));

bindWordConsumer("drum-machine", useDrumMachineStore.subscribe, (_records, lease) => {
  const { progress } = useDrumMachineStore.getState();
  const savedBeats = progress.savedBeats.map((beat, index) => {
    const name = (lease ? readBeatName(lease, beat.id) : undefined) ?? `Beat ${index + 1}`;
    return beat.name === name ? beat : { ...beat, name };
  });
  if (savedBeats.some((beat, i) => beat !== progress.savedBeats[i])) useDrumMachineStore.setState({ progress: { ...progress, savedBeats } });
});
