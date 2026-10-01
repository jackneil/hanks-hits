"use client";

/**
 * Blitz Bomber sound effects, on the shared game-audio bus.
 *
 * Every sound goes into the "blitz-bomber" channel, so a gameplay clip records
 * it, and the kid's sound switch is the channel's speaker gain (it mutes the
 * speakers only: a clip of a run with the sound off still has the sound).
 * Before this the game had a sound setting and made no sound at all.
 *
 * getGameAudio() gives null on the server, in a browser with no Web Audio,
 * and in tests without the audio mock: then every sound does nothing.
 */

import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

export const BLITZ_BOMBER_AUDIO_ID = "blitz-bomber";

export type BlitzBomberSound = "drop" | "hit" | "crash" | "land";

let channel: GameAudioChannel | null = null;

/** The game's channel. It is made at the first sound (after a tap), not at page load. */
function soundChannel(): GameAudioChannel | null {
  if (channel && !channel.disposed) return channel;
  channel = getGameAudio()?.channel(BLITZ_BOMBER_AUDIO_ID) ?? null;
  return channel;
}

/** Plays one sound effect into the game's channel. */
export function playSound(type: BlitzBomberSound): void {
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
      case "drop":
        // A falling whistle.
        oscillator.type = "sine";
        gainNode.gain.value = 0.08;
        oscillator.frequency.setValueAtTime(900, now);
        oscillator.frequency.exponentialRampToValueAtTime(300, now + 0.25);
        oscillator.start();
        oscillator.stop(now + 0.25);
        break;
      case "hit":
        // A short boom.
        oscillator.type = "square";
        gainNode.gain.value = 0.12;
        oscillator.frequency.setValueAtTime(160, now);
        oscillator.frequency.exponentialRampToValueAtTime(40, now + 0.2);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        oscillator.start();
        oscillator.stop(now + 0.2);
        break;
      case "crash":
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.18;
        oscillator.frequency.setValueAtTime(260, now);
        oscillator.frequency.exponentialRampToValueAtTime(45, now + 0.7);
        oscillator.start();
        oscillator.stop(now + 0.7);
        break;
      case "land":
        // A happy rising chime.
        oscillator.type = "triangle";
        gainNode.gain.value = 0.15;
        oscillator.frequency.setValueAtTime(523, now);
        oscillator.frequency.setValueAtTime(659, now + 0.1);
        oscillator.frequency.setValueAtTime(784, now + 0.2);
        oscillator.frequency.setValueAtTime(1047, now + 0.3);
        oscillator.start();
        oscillator.stop(now + 0.45);
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
