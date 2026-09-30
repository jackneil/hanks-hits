/**
 * Space Invaders sound effects on the shared game-audio bus
 * (design/ARCHITECTURE.md, section "Audio").
 *
 * Every sound goes into the "space-invaders" channel of the bus, so a
 * gameplay clip records it. The kid's sound switch is the channel's speaker
 * gain (setGameSpeakerEnabled in Game.tsx): it mutes the speakers only, so
 * a clip of a run with the sound off still has the game's sound.
 *
 * Before this, a SoundManager class made its own AudioContext at module
 * load (a browser warning on every page load, before any tap) and played
 * to ctx.destination, so no clip could hear it.
 *
 * getGameAudio() gives null on the server, in a browser with no Web Audio,
 * and in tests without the audio mock. Then every sound does nothing.
 */

import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

export const SPACE_INVADERS_AUDIO_ID = "space-invaders";

export type SpaceInvadersSound = "shoot" | "explosion" | "playerDeath" | "mystery" | "march" | "waveClear";

let channel: GameAudioChannel | null = null;
/** The timers of the sounds that play in parts (an explosion, a wave clear), so they stop with the game. */
const pending = new Set<ReturnType<typeof setTimeout>>();

/** The game's channel. It is made at the first sound (after a tap), not at page load. */
function soundChannel(): GameAudioChannel | null {
  if (channel && !channel.disposed) return channel;
  channel = getGameAudio()?.channel(SPACE_INVADERS_AUDIO_ID) ?? null;
  return channel;
}

/** One tone into the channel: `frequency` Hz for `duration` s, fading out. */
function tone(frequency: number, duration: number, type: OscillatorType, gain = 0.1): void {
  const out = soundChannel();
  if (!out) return;
  try {
    const ctx = out.context;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(out.input);
    oscillator.type = type;
    const now = ctx.currentTime;
    oscillator.frequency.setValueAtTime(frequency, now);
    gainNode.gain.setValueAtTime(gain, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);
    oscillator.start();
    oscillator.stop(now + duration);
  } catch {
    // A sound that the browser cannot make is skipped: the game goes on.
  }
}

/** A part of a sound that plays later (or now, at 0 ms). The timer is dropped when the game lets go. */
function later(ms: number, play: () => void): void {
  if (ms <= 0) {
    play();
    return;
  }
  const timer = setTimeout(() => {
    pending.delete(timer);
    play();
  }, ms);
  pending.add(timer);
}

/** Plays one sound effect into the game's channel. `step` is the march step (0 to 3). */
export function playSound(type: SpaceInvadersSound, step = 0): void {
  if (!soundChannel()) return;
  switch (type) {
    case "shoot":
      tone(880, 0.1, "square");
      break;
    case "explosion":
      // Three short noisy bursts, 30 ms apart.
      for (let i = 0; i < 3; i++) {
        later(i * 30, () => tone(100 + Math.random() * 200, 0.05, "sawtooth"));
      }
      break;
    case "playerDeath": {
      const out = soundChannel();
      if (!out) return;
      try {
        const ctx = out.context;
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(out.input);
        oscillator.type = "sawtooth";
        const now = ctx.currentTime;
        oscillator.frequency.setValueAtTime(400, now);
        oscillator.frequency.exponentialRampToValueAtTime(50, now + 0.5);
        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        oscillator.start();
        oscillator.stop(now + 0.5);
      } catch {
        // Skipped, the game goes on.
      }
      break;
    }
    case "mystery":
      tone(330, 0.2, "sine");
      later(100, () => tone(440, 0.2, "sine"));
      break;
    case "march": {
      const frequencies = [100, 90, 80, 70];
      tone(frequencies[((step % 4) + 4) % 4], 0.08, "square");
      break;
    }
    case "waveClear":
      [440, 554, 659, 880].forEach((frequency, i) => {
        later(i * 100, () => tone(frequency, 0.15, "square"));
      });
      break;
  }
}

/** Takes the game's channel off the bus (the game unmounts). The next sound makes a new one. */
export function releaseSounds(): void {
  for (const timer of pending) clearTimeout(timer);
  pending.clear();
  channel?.dispose();
  channel = null;
}
