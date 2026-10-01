"use client";

/**
 * Memory Match sound effects, on the shared game-audio bus.
 *
 * Every sound goes into the "memory-match" channel, so a gameplay clip records
 * it, and the kid's sound switch is the channel's speaker gain (it mutes the
 * speakers only: a clip of a run with the sound off still has the sound).
 * Before this the game had a sound switch (a placeholder floating over a
 * card) and made no sound at all.
 *
 * getGameAudio() gives null on the server, in a browser with no Web Audio,
 * and in tests without the audio mock: then every sound does nothing.
 */

import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

export const MEMORY_MATCH_AUDIO_ID = "memory-match";

export type MemoryMatchSound = "flip" | "match" | "miss" | "win";

let channel: GameAudioChannel | null = null;

/** The game's channel. It is made at the first sound (after a tap), not at page load. */
function soundChannel(): GameAudioChannel | null {
  if (channel && !channel.disposed) return channel;
  channel = getGameAudio()?.channel(MEMORY_MATCH_AUDIO_ID) ?? null;
  return channel;
}

/** Plays one sound effect into the game's channel. */
export function playSound(type: MemoryMatchSound): void {
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
      case "flip":
        // A soft card flick.
        oscillator.type = "triangle";
        gainNode.gain.value = 0.07;
        oscillator.frequency.setValueAtTime(700, now);
        oscillator.frequency.exponentialRampToValueAtTime(900, now + 0.05);
        oscillator.start();
        oscillator.stop(now + 0.06);
        break;
      case "match":
        // Two happy notes.
        oscillator.type = "sine";
        gainNode.gain.value = 0.14;
        oscillator.frequency.setValueAtTime(660, now);
        oscillator.frequency.setValueAtTime(880, now + 0.1);
        oscillator.start();
        oscillator.stop(now + 0.22);
        break;
      case "miss":
        // A gentle "not quite", never a harsh buzz.
        oscillator.type = "sine";
        gainNode.gain.value = 0.06;
        oscillator.frequency.setValueAtTime(330, now);
        oscillator.frequency.exponentialRampToValueAtTime(260, now + 0.15);
        oscillator.start();
        oscillator.stop(now + 0.16);
        break;
      case "win":
        // A rising fanfare.
        oscillator.type = "triangle";
        gainNode.gain.value = 0.16;
        oscillator.frequency.setValueAtTime(523, now);
        oscillator.frequency.setValueAtTime(659, now + 0.12);
        oscillator.frequency.setValueAtTime(784, now + 0.24);
        oscillator.frequency.setValueAtTime(1047, now + 0.36);
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
