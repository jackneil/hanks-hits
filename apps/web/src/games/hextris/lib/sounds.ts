"use client";

/**
 * Hextris sound effects, on the shared game-audio bus.
 *
 * Every sound goes into the "hextris" channel, so a gameplay clip records
 * it, and the kid's sound switch is the channel's speaker gain (it mutes the
 * speakers only: a clip of a run with the sound off still has the sound).
 * Before this the store made its own AudioContext and played to
 * ctx.destination, so no clip could hear the game (LEGACY_AUDIO_SITES).
 *
 * getGameAudio() gives null on the server, in a browser with no Web Audio,
 * and in tests without the audio mock: then every sound does nothing.
 */

import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

export const HEXTRIS_AUDIO_ID = "hextris";

export type HextrisSound = "rotate" | "land" | "match" | "game-over";

let channel: GameAudioChannel | null = null;

/** The game's channel. It is made at the first sound (after a tap), not at page load. */
function soundChannel(): GameAudioChannel | null {
  if (channel && !channel.disposed) return channel;
  channel = getGameAudio()?.channel(HEXTRIS_AUDIO_ID) ?? null;
  return channel;
}

/** Plays one sound effect into the game's channel. */
export function playSound(type: HextrisSound): void {
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
      case "rotate":
        oscillator.frequency.value = 220;
        oscillator.type = "sine";
        gainNode.gain.value = 0.05;
        oscillator.start();
        oscillator.stop(now + 0.05);
        break;
      case "land":
        oscillator.frequency.value = 330;
        oscillator.type = "triangle";
        gainNode.gain.value = 0.1;
        oscillator.start();
        oscillator.stop(now + 0.1);
        break;
      case "match":
        oscillator.type = "sine";
        gainNode.gain.value = 0.15;
        oscillator.frequency.setValueAtTime(523, now);
        oscillator.frequency.setValueAtTime(659, now + 0.05);
        oscillator.frequency.setValueAtTime(784, now + 0.1);
        oscillator.start();
        oscillator.stop(now + 0.2);
        break;
      case "game-over":
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.15;
        oscillator.frequency.setValueAtTime(200, now);
        oscillator.frequency.exponentialRampToValueAtTime(50, now + 0.5);
        oscillator.start();
        oscillator.stop(now + 0.5);
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
