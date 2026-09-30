"use client";

/**
 * Arkanoid's sound effects, on the shared game-audio bus.
 *
 * Every sound goes into the "arkanoid" channel, so a gameplay clip records
 * it, and the kid's sound switch is the channel's speaker gain. Before
 * this the game had a sound switch and no sound at all.
 *
 * getGameAudio() gives null on the server, in a browser with no Web Audio,
 * and in tests without the audio mock: then every sound does nothing.
 */

import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

export const ARKANOID_AUDIO_ID = "arkanoid";

export type ArkanoidSound = "launch" | "paddle" | "split" | "lose-life" | "game-over";

let channel: GameAudioChannel | null = null;

/** The game's channel. It is made at the first sound (after a tap), not at page load. */
function soundChannel(): GameAudioChannel | null {
  if (channel && !channel.disposed) return channel;
  channel = getGameAudio()?.channel(ARKANOID_AUDIO_ID) ?? null;
  return channel;
}

/** Plays one sound effect into the game's channel. */
export function playSound(type: ArkanoidSound): void {
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
      case "launch":
        oscillator.type = "sine";
        gainNode.gain.value = 0.18;
        oscillator.frequency.setValueAtTime(330, now);
        oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.15);
        oscillator.start();
        oscillator.stop(now + 0.15);
        break;
      case "paddle":
        oscillator.type = "square";
        oscillator.frequency.value = 520;
        gainNode.gain.value = 0.08;
        oscillator.start();
        oscillator.stop(now + 0.04);
        break;
      case "split":
        oscillator.type = "triangle";
        oscillator.frequency.value = 880;
        gainNode.gain.value = 0.1;
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        oscillator.start();
        oscillator.stop(now + 0.08);
        break;
      case "lose-life":
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.18;
        oscillator.frequency.setValueAtTime(260, now);
        oscillator.frequency.exponentialRampToValueAtTime(110, now + 0.35);
        oscillator.start();
        oscillator.stop(now + 0.35);
        break;
      case "game-over":
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.2;
        oscillator.frequency.setValueAtTime(300, now);
        oscillator.frequency.exponentialRampToValueAtTime(50, now + 0.6);
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
