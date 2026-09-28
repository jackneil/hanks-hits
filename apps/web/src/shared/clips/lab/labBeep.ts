/**
 * The lab beep: 1 kHz, 60 ms, through the shared game-audio bus (plan 6.3),
 * so the clip audio tap records it the same way it records a game sound.
 *
 * The oscillator starts at phase 0 and plays exactly 60 cycles, so the beep
 * starts and ends on a zero crossing (no click that could move the onset).
 */
import type { GameAudioChannel } from "@/shared/lib/audio";

export const BEEP_HZ = 1000;
export const BEEP_SECONDS = 0.06;
export const BEEP_GAIN = 0.5;

/** The app id of the lab's channel on the game-audio bus. */
export const LAB_AUDIO_APP_ID = "clips-lab";

/** Starts one beep at context time `at` on `channel`. The nodes disconnect when it ends. */
export function playBeep(channel: Pick<GameAudioChannel, "context" | "input">, at: number): void {
  const context = channel.context;
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = BEEP_HZ;
  const gain = context.createGain();
  gain.gain.value = BEEP_GAIN;
  oscillator.connect(gain);
  gain.connect(channel.input);
  // disconnect() with no argument never throws, also on a node with no connections.
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(at);
  oscillator.stop(at + BEEP_SECONDS);
}
