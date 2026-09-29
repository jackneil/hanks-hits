/**
 * Asteroids sound effects on the shared game-audio bus (design/ARCHITECTURE.md,
 * section "Audio").
 *
 * Every sound goes into the "asteroids" channel of the bus, so a gameplay
 * clip records it. The kid's sound switch is the channel's speaker gain
 * (setGameSpeakerEnabled in Game.tsx): it mutes the speakers only, so a clip
 * of a run with the sound off still has the game's sound.
 *
 * getGameAudio() gives null on the server, in a browser with no Web Audio,
 * and in tests without the audio mock. Then every sound does nothing.
 */

import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

export const ASTEROIDS_AUDIO_ID = "asteroids";

export type AsteroidsSound = "shoot" | "thrust" | "explode" | "hyperspace" | "death" | "wave";

let channel: GameAudioChannel | null = null;

/** The game's channel. It is made at the first sound (after a tap), not at page load. */
function soundChannel(): GameAudioChannel | null {
  if (channel && !channel.disposed) return channel;
  channel = getGameAudio()?.channel(ASTEROIDS_AUDIO_ID) ?? null;
  return channel;
}

/** Plays one sound effect into the game's channel. */
export function playSound(type: AsteroidsSound): void {
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
      case "shoot":
        oscillator.frequency.value = 600;
        oscillator.type = "square";
        gainNode.gain.value = 0.08;
        oscillator.start();
        oscillator.stop(now + 0.05);
        break;
      case "thrust":
        oscillator.frequency.value = 80;
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.05;
        oscillator.start();
        oscillator.stop(now + 0.1);
        break;
      case "explode":
        oscillator.frequency.value = 150;
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.15;
        oscillator.frequency.exponentialRampToValueAtTime(30, now + 0.3);
        oscillator.start();
        oscillator.stop(now + 0.3);
        break;
      case "hyperspace":
        oscillator.frequency.value = 200;
        oscillator.type = "sine";
        gainNode.gain.value = 0.1;
        oscillator.frequency.exponentialRampToValueAtTime(1000, now + 0.2);
        oscillator.start();
        oscillator.stop(now + 0.2);
        break;
      case "death":
        oscillator.frequency.value = 400;
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.2;
        oscillator.frequency.exponentialRampToValueAtTime(50, now + 0.5);
        oscillator.start();
        oscillator.stop(now + 0.5);
        break;
      case "wave":
        oscillator.frequency.value = 440;
        oscillator.type = "sine";
        gainNode.gain.value = 0.1;
        oscillator.frequency.setValueAtTime(440, now);
        oscillator.frequency.setValueAtTime(554, now + 0.1);
        oscillator.frequency.setValueAtTime(659, now + 0.2);
        oscillator.frequency.setValueAtTime(880, now + 0.3);
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
