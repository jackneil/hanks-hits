"use client";

/**
 * Math Attack sound effects, on the shared game-audio bus.
 *
 * Every sound goes into the "math-attack" channel, so a gameplay clip records
 * it, and the kid's sound switch is the channel's speaker gain (it mutes the
 * speakers only: a clip of a run with the sound off still has the sound).
 * Before this the game made no sound at all.
 *
 * getGameAudio() gives null on the server, in a browser with no Web Audio,
 * and in tests without the audio mock: then every sound does nothing.
 */

import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

export const MATH_ATTACK_AUDIO_ID = "math-attack";

export type MathAttackSound = "pop" | "wrong" | "lose-life" | "game-over";

let channel: GameAudioChannel | null = null;

/** The game's channel. It is made at the first sound (after a tap), not at page load. */
function soundChannel(): GameAudioChannel | null {
  if (channel && !channel.disposed) return channel;
  channel = getGameAudio()?.channel(MATH_ATTACK_AUDIO_ID) ?? null;
  return channel;
}

/** Plays one sound effect into the game's channel. */
export function playSound(type: MathAttackSound): void {
  const out = soundChannel();
  if (!out) return;
  try {
    const ctx = out.context;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(out.input);
    const now = ctx.currentTime;

    switch (type) {
      case "pop":
        // A right answer: a bright rising pop.
        oscillator.type = "triangle";
        gainNode.gain.value = 0.14;
        oscillator.frequency.setValueAtTime(660, now);
        oscillator.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
        oscillator.start();
        oscillator.stop(now + 0.14);
        break;
      case "wrong":
        // A soft "try again" buzz, never a harsh one.
        oscillator.type = "sine";
        gainNode.gain.value = 0.08;
        oscillator.frequency.setValueAtTime(220, now);
        oscillator.frequency.setValueAtTime(180, now + 0.08);
        oscillator.start();
        oscillator.stop(now + 0.16);
        break;
      case "lose-life":
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.12;
        oscillator.frequency.setValueAtTime(300, now);
        oscillator.frequency.exponentialRampToValueAtTime(120, now + 0.3);
        oscillator.start();
        oscillator.stop(now + 0.3);
        break;
      case "game-over":
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.15;
        oscillator.frequency.setValueAtTime(260, now);
        oscillator.frequency.exponentialRampToValueAtTime(55, now + 0.6);
        oscillator.start();
        oscillator.stop(now + 0.6);
        break;
    }
  } catch {
    // A sound that the browser cannot make is skipped: the game goes on.
  }
}

/** Takes the game's channel off the bus (the game unmounts). The next sound makes a new one. */
export function releaseSounds(): void {
  channel?.dispose();
  channel = null;
}
