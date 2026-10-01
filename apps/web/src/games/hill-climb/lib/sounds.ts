/**
 * Hill Climb sound on the shared game-audio bus (design/ARCHITECTURE.md,
 * section "Audio").
 *
 * Every sound goes into the "hill-climb" channel of the bus, so a gameplay
 * clip records it. The kid's sound switch is the channel's speaker gain
 * (setGameSpeakerEnabled in Game.tsx): it mutes the speakers only, so a
 * clip of a run with the sound off still has the game's sound.
 *
 * The engine is a small motor, not a naked tone: a low sawtooth and a
 * square an octave up, chopped by a tremolo (the putt-putt of a cylinder),
 * then a low-pass filter that opens with the revs, into a soft master
 * gain. The revs follow the truck's speed and the gas pedal with a short
 * smoothing, so a tap on GAS swells instead of clicking.
 *
 * getGameAudio() gives null on the server, in a browser with no Web Audio,
 * and in tests without the audio mock. Then every sound does nothing.
 */

import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

export const HILL_CLIMB_AUDIO_ID = "hill-climb";

export type HillClimbSound = "coin" | "fuel" | "crash" | "flip" | "land" | "nitro";

/** The engine at idle and at full revs. */
export const ENGINE = Object.freeze({
  IDLE_HZ: 42,
  REVS_HZ: 118,
  IDLE_GAIN: 0.045,
  REVS_GAIN: 0.11,
  FILTER_IDLE_HZ: 320,
  FILTER_REVS_HZ: 1500,
  PUTT_IDLE_HZ: 9,
  PUTT_REVS_HZ: 38,
  /** The time constant of the rev change, in seconds (a swell, not a click). */
  SMOOTH_S: 0.09,
});

let channel: GameAudioChannel | null = null;

interface Engine {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  filter: BiquadFilterNode;
  master: GainNode;
}

let engine: Engine | null = null;

/** The game's channel. It is made at the first sound (after a tap), not at page load. */
function soundChannel(): GameAudioChannel | null {
  if (channel && !channel.disposed) return channel;
  channel = getGameAudio()?.channel(HILL_CLIMB_AUDIO_ID) ?? null;
  // A new channel means a new context: an old engine graph is gone with it.
  engine = null;
  return channel;
}

/** Starts the engine at idle. A second call while it runs does nothing. */
export function startEngine(): void {
  const out = soundChannel();
  if (!out || engine) return;
  try {
    const ctx = out.context;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const pulse = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const master = ctx.createGain();

    osc1.type = "sawtooth";
    osc1.frequency.value = ENGINE.IDLE_HZ;
    osc2.type = "square";
    osc2.frequency.value = ENGINE.IDLE_HZ * 2;
    // The putt-putt: a slow square chops the mix between 0.35 and 1.
    lfo.type = "square";
    lfo.frequency.value = ENGINE.PUTT_IDLE_HZ;
    lfoGain.gain.value = 0.33;
    pulse.gain.value = 0.67;
    filter.type = "lowpass";
    filter.frequency.value = ENGINE.FILTER_IDLE_HZ;
    filter.Q.value = 0.9;
    master.gain.value = ENGINE.IDLE_GAIN;

    osc1.connect(pulse);
    osc2.connect(pulse);
    lfo.connect(lfoGain);
    lfoGain.connect(pulse.gain);
    pulse.connect(filter);
    filter.connect(master);
    master.connect(out.input);

    osc1.start();
    osc2.start();
    lfo.start();
    engine = { osc1, osc2, lfo, lfoGain, filter, master };
  } catch {
    // A sound that the browser cannot make is skipped: the game goes on.
    engine = null;
  }
}

/**
 * Sets the revs. `speed` is the truck's speed in km/h and `throttle` is
 * true while GAS is held: the revs rise with the speed, and a held pedal
 * adds a third on top, so the engine strains up a hill at low speed too.
 */
export function setEngine(speed: number, throttle: boolean, nitro = false): void {
  if (!engine || !channel) return;
  try {
    const revs = Math.min(1, Math.max(0, speed / 90) * 0.75 + (throttle ? 0.3 : 0) + (nitro ? 0.2 : 0));
    const t = channel.context.currentTime;
    const hz = ENGINE.IDLE_HZ + (ENGINE.REVS_HZ - ENGINE.IDLE_HZ) * revs;
    engine.osc1.frequency.setTargetAtTime(hz, t, ENGINE.SMOOTH_S);
    engine.osc2.frequency.setTargetAtTime(hz * 2, t, ENGINE.SMOOTH_S);
    engine.lfo.frequency.setTargetAtTime(ENGINE.PUTT_IDLE_HZ + (ENGINE.PUTT_REVS_HZ - ENGINE.PUTT_IDLE_HZ) * revs, t, ENGINE.SMOOTH_S);
    engine.filter.frequency.setTargetAtTime(ENGINE.FILTER_IDLE_HZ + (ENGINE.FILTER_REVS_HZ - ENGINE.FILTER_IDLE_HZ) * revs, t, ENGINE.SMOOTH_S);
    engine.master.gain.setTargetAtTime(ENGINE.IDLE_GAIN + (ENGINE.REVS_GAIN - ENGINE.IDLE_GAIN) * revs, t, ENGINE.SMOOTH_S);
  } catch {
    // Ignore: a parameter the browser cannot set.
  }
}

/** Stops the engine (a pause, the end of a run). The next start makes a new one. */
export function stopEngine(): void {
  const running = engine;
  engine = null;
  if (!running) return;
  try {
    running.osc1.stop();
    running.osc2.stop();
    running.lfo.stop();
    running.master.disconnect();
  } catch {
    // Already stopped.
  }
}

/** True while the engine runs (for tests and the pause hook). */
export function isEngineRunning(): boolean {
  return engine !== null;
}

/** Plays one sound effect into the game's channel. */
export function playSound(type: HillClimbSound): void {
  const out = soundChannel();
  if (!out) return;
  try {
    const ctx = out.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(out.input);
    const now = ctx.currentTime;

    switch (type) {
      case "coin":
        // A bright two-note chime.
        osc.type = "sine";
        osc.frequency.setValueAtTime(988, now);
        osc.frequency.setValueAtTime(1319, now + 0.07);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
        break;
      case "fuel":
        // A glug that rises.
        osc.type = "triangle";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.25);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      case "crash":
        // A low thud that falls away.
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(28, now + 0.45);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
        break;
      case "flip":
        // A quick rising sweep for a flip.
        osc.type = "square";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(1760, now + 0.18);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      case "land":
        // A soft bump on landing.
        osc.type = "sine";
        osc.frequency.setValueAtTime(90, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.12);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.start(now);
        osc.stop(now + 0.14);
        break;
      case "nitro":
        // A whoosh that climbs while the boost kicks in.
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(900, now + 0.3);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
        break;
    }
  } catch {
    // A sound that the browser cannot make is skipped: the game goes on.
  }
}

/** Takes the game's channel off the bus (the game unmounts). The next sound makes a new one. */
export function releaseSounds(): void {
  stopEngine();
  channel?.dispose();
  channel = null;
}
