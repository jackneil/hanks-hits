/**
 * Bomberman sound effects on the shared game-audio bus (design/ARCHITECTURE.md,
 * section "Audio").
 *
 * Every sound goes into the "bomberman" channel of the bus, so a gameplay
 * clip records it. The kid's sound switch is the channel's speaker gain
 * (setGameSpeakerEnabled in Game.tsx): it mutes the speakers only, so a clip
 * of a run with the sound off still has the game's sound.
 *
 * Before this, the store made its own AudioContext and played to
 * ctx.destination, so no clip could hear the game (LEGACY_AUDIO_SITES).
 *
 * getGameAudio() gives null on the server, in a browser with no Web Audio,
 * and in tests without the audio mock. Then every sound does nothing.
 */

import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

export const BOMBERMAN_AUDIO_ID = "bomberman";

export type BombermanSound = "place" | "explode" | "powerup" | "death" | "win" | "step";

let channel: GameAudioChannel | null = null;

/** The game's channel. It is made at the first sound (after a tap), not at page load. */
function soundChannel(): GameAudioChannel | null {
  if (channel && !channel.disposed) return channel;
  channel = getGameAudio()?.channel(BOMBERMAN_AUDIO_ID) ?? null;
  return channel;
}

/** Plays one sound effect into the game's channel. */
export function playSound(type: BombermanSound): void {
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
      case "place":
        osc.frequency.value = 200;
        osc.type = "square";
        gain.gain.value = 0.1;
        osc.start();
        osc.stop(now + 0.1);
        break;
      case "explode":
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.3);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start();
        osc.stop(now + 0.3);
        break;
      case "powerup":
        osc.type = "sine";
        gain.gain.value = 0.1;
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.setValueAtTime(800, now + 0.1);
        osc.frequency.setValueAtTime(1000, now + 0.15);
        osc.start();
        osc.stop(now + 0.2);
        break;
      case "death":
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.5);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start();
        osc.stop(now + 0.5);
        break;
      case "win":
        osc.type = "sine";
        gain.gain.value = 0.1;
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.setValueAtTime(659, now + 0.15);
        osc.frequency.setValueAtTime(784, now + 0.3);
        osc.frequency.setValueAtTime(1047, now + 0.45);
        osc.start();
        osc.stop(now + 0.6);
        break;
      case "step":
        osc.frequency.value = 100;
        osc.type = "sine";
        gain.gain.value = 0.03;
        osc.start();
        osc.stop(now + 0.05);
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
