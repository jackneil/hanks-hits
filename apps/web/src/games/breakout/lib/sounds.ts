/**
 * Breakout sound effects on the shared game-audio bus
 * (design/ARCHITECTURE.md, section "Audio").
 *
 * Every sound goes into the "breakout" channel of the bus, so a gameplay
 * clip records it. The kid's sound switch is the channel's speaker gain
 * (setGameSpeakerEnabled in Game.tsx): it mutes the speakers only, so a
 * clip of a run with the sound off still has the game's sound.
 *
 * Before this, the store made its own AudioContext and played to
 * ctx.destination, so no clip could hear it, and a sound with the switch
 * off was never made at all.
 *
 * getGameAudio() gives null on the server, in a browser with no Web Audio,
 * and in tests without the audio mock. Then every sound does nothing.
 */

import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

export const BREAKOUT_AUDIO_ID = "breakout";

export type BreakoutSound = "bounce" | "break" | "powerup" | "lose-life" | "level-complete" | "game-over";

let channel: GameAudioChannel | null = null;

/** The game's channel. It is made at the first sound (after a tap), not at page load. */
function soundChannel(): GameAudioChannel | null {
  if (channel && !channel.disposed) return channel;
  channel = getGameAudio()?.channel(BREAKOUT_AUDIO_ID) ?? null;
  return channel;
}

/** Plays one sound effect into the game's channel. */
export function playSound(type: BreakoutSound): void {
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
      case "bounce":
        oscillator.frequency.value = 440;
        oscillator.type = "square";
        gainNode.gain.value = 0.1;
        oscillator.start();
        oscillator.stop(now + 0.05);
        break;
      case "break":
        oscillator.frequency.value = 660;
        oscillator.type = "square";
        gainNode.gain.value = 0.15;
        oscillator.start();
        oscillator.stop(now + 0.1);
        break;
      case "powerup":
        oscillator.frequency.value = 880;
        oscillator.type = "sine";
        gainNode.gain.value = 0.2;
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        oscillator.start();
        oscillator.stop(now + 0.3);
        break;
      case "lose-life":
        oscillator.frequency.value = 200;
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.2;
        oscillator.frequency.exponentialRampToValueAtTime(100, now + 0.3);
        oscillator.start();
        oscillator.stop(now + 0.3);
        break;
      case "level-complete":
        oscillator.type = "sine";
        gainNode.gain.value = 0.2;
        oscillator.frequency.setValueAtTime(523, now);
        oscillator.frequency.setValueAtTime(659, now + 0.1);
        oscillator.frequency.setValueAtTime(784, now + 0.2);
        oscillator.start();
        oscillator.stop(now + 0.4);
        break;
      case "game-over":
        oscillator.frequency.value = 300;
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.2;
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
