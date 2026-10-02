// ==============================================
// DRUM MACHINE - CONSTANTS
// ==============================================

// Drum kit definitions
export interface DrumSound {
  id: string;
  name: string;
  color: string;
  // Web Audio synthesis parameters
  frequency: number;
  type: OscillatorType;
  decay: number; // seconds
  filterFreq?: number;
  noise?: boolean; // Use noise instead of oscillator
}

export interface DrumKit {
  id: string;
  name: string;
  sounds: DrumSound[];
}

export const DRUM_KITS: DrumKit[] = [
  {
    id: "hip-hop",
    name: "Hip Hop",
    sounds: [
      { id: "kick", name: "Kick", color: "#ef4444", frequency: 60, type: "sine", decay: 0.4, filterFreq: 100 },
      { id: "snare", name: "Snare", color: "#f97316", frequency: 180, type: "triangle", decay: 0.2, noise: true },
      { id: "hat", name: "Hi-Hat", color: "#eab308", frequency: 8000, type: "square", decay: 0.05, noise: true },
      { id: "clap", name: "Clap", color: "#22c55e", frequency: 1500, type: "triangle", decay: 0.15, noise: true },
      { id: "tom1", name: "Tom Hi", color: "#3b82f6", frequency: 200, type: "sine", decay: 0.25 },
      { id: "tom2", name: "Tom Lo", color: "#8b5cf6", frequency: 120, type: "sine", decay: 0.3 },
      { id: "crash", name: "Crash", color: "#f8fafc", frequency: 5000, type: "triangle", decay: 0.6, noise: true },
      { id: "ride", name: "Ride", color: "#a78bfa", frequency: 6000, type: "triangle", decay: 0.3, noise: true },
    ],
  },
  {
    id: "rock",
    name: "Rock",
    sounds: [
      { id: "kick", name: "Kick", color: "#ef4444", frequency: 55, type: "sine", decay: 0.35 },
      { id: "snare", name: "Snare", color: "#f97316", frequency: 200, type: "triangle", decay: 0.25, noise: true },
      { id: "hat", name: "Hi-Hat", color: "#eab308", frequency: 10000, type: "square", decay: 0.08, noise: true },
      { id: "clap", name: "Clap", color: "#22c55e", frequency: 1200, type: "sawtooth", decay: 0.12, noise: true },
      { id: "tom1", name: "Tom Hi", color: "#3b82f6", frequency: 220, type: "sine", decay: 0.3 },
      { id: "tom2", name: "Tom Lo", color: "#8b5cf6", frequency: 110, type: "sine", decay: 0.35 },
      { id: "crash", name: "Crash", color: "#f8fafc", frequency: 4000, type: "sawtooth", decay: 0.8, noise: true },
      { id: "ride", name: "Ride", color: "#a78bfa", frequency: 7000, type: "triangle", decay: 0.4, noise: true },
    ],
  },
  {
    id: "electronic",
    name: "Electronic",
    sounds: [
      { id: "kick", name: "808 Kick", color: "#ef4444", frequency: 45, type: "sine", decay: 0.6, filterFreq: 50 },
      { id: "snare", name: "Snare", color: "#f97316", frequency: 250, type: "square", decay: 0.15, noise: true },
      { id: "hat", name: "Hi-Hat", color: "#eab308", frequency: 12000, type: "square", decay: 0.03, noise: true },
      { id: "clap", name: "Clap", color: "#22c55e", frequency: 1800, type: "square", decay: 0.1, noise: true },
      { id: "tom1", name: "Tom", color: "#3b82f6", frequency: 180, type: "square", decay: 0.2 },
      { id: "tom2", name: "Sub", color: "#8b5cf6", frequency: 35, type: "sine", decay: 0.5 },
      { id: "crash", name: "Noise", color: "#f8fafc", frequency: 3000, type: "sawtooth", decay: 0.4, noise: true },
      { id: "ride", name: "Zap", color: "#a78bfa", frequency: 800, type: "sawtooth", decay: 0.15, filterFreq: 2000 },
    ],
  },
  {
    id: "retro",
    name: "8-Bit",
    sounds: [
      { id: "kick", name: "Kick", color: "#ef4444", frequency: 80, type: "square", decay: 0.15 },
      { id: "snare", name: "Snare", color: "#f97316", frequency: 300, type: "square", decay: 0.1, noise: true },
      { id: "hat", name: "Hat", color: "#eab308", frequency: 6000, type: "square", decay: 0.02, noise: true },
      { id: "clap", name: "Beep", color: "#22c55e", frequency: 880, type: "square", decay: 0.08 },
      { id: "tom1", name: "Boop", color: "#3b82f6", frequency: 440, type: "square", decay: 0.1 },
      { id: "tom2", name: "Bass", color: "#8b5cf6", frequency: 110, type: "square", decay: 0.2 },
      { id: "crash", name: "Noise", color: "#f8fafc", frequency: 4000, type: "square", decay: 0.2, noise: true },
      { id: "ride", name: "Blip", color: "#a78bfa", frequency: 1200, type: "square", decay: 0.05 },
    ],
  },
  {
    id: "silly",
    name: "Silly",
    sounds: [
      { id: "kick", name: "Boom", color: "#ef4444", frequency: 40, type: "sine", decay: 0.8 },
      { id: "snare", name: "Honk", color: "#f97316", frequency: 200, type: "sawtooth", decay: 0.3 },
      { id: "hat", name: "Tick", color: "#eab308", frequency: 2000, type: "square", decay: 0.01 },
      { id: "clap", name: "Boing", color: "#22c55e", frequency: 400, type: "sine", decay: 0.4, filterFreq: 800 },
      { id: "tom1", name: "Pop", color: "#3b82f6", frequency: 800, type: "sine", decay: 0.1 },
      { id: "tom2", name: "Thud", color: "#8b5cf6", frequency: 60, type: "triangle", decay: 0.5 },
      { id: "crash", name: "Woosh", color: "#f8fafc", frequency: 1000, type: "sawtooth", decay: 0.5, noise: true },
      { id: "ride", name: "Ding", color: "#a78bfa", frequency: 1500, type: "sine", decay: 0.8 },
    ],
  },
];

// Sequencer settings
export const DEFAULT_BPM = 120;
export const MIN_BPM = 60;
export const MAX_BPM = 200;
export const GRID_STEPS = 16;
/**
 * The longest pattern that the server takes in a saved beat: 1024 steps
 * (64 bars of 16 steps), see lib/progress-schemas.ts. The server once took
 * only 64 steps, but the "+" button (extendPattern) adds 16 steps with no
 * limit, so a beat of 5 bars or more made the server refuse every save of
 * the drum machine. 1024 steps keeps the largest drum save (100 beats of
 * 100 sounds) near the 60 MB of the largest drawing save.
 */
export const MAX_PATTERN_STEPS = 1024;

// UI
export const PAD_SIZE = 80;
export const COLORS = {
  BACKGROUND: "#0f172a",
  GRID_ACTIVE: "#60a5fa",
  GRID_INACTIVE: "#334155",
  PLAYHEAD: "#22c55e",
  TEXT: "#f8fafc",
};

// Types
export type GameStatus = "idle" | "playing";

export interface SequencerPattern {
  [soundId: string]: boolean[];
}

export function createEmptyPattern(): SequencerPattern {
  const pattern: SequencerPattern = {};
  DRUM_KITS[0].sounds.forEach(sound => {
    pattern[sound.id] = new Array(GRID_STEPS).fill(false);
  });
  return pattern;
}

export interface SavedBeat {
  id: string;
  name: string;
  kitId: string;
  bpm: number;
  pattern: SequencerPattern;
  patternLength?: number; // Optional for backwards compatibility
  createdAt: string;
}
