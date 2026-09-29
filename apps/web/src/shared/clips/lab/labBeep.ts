/**
 * The lab beep: 1 kHz through the shared game-audio bus (plan 6.3), so the
 * clip audio tap records it the same way it records a game sound.
 *
 * The beep length carries the beat's mark bit (labSchedule.ts "Beat marks"):
 * 60 ms for mark 0 and 120 ms for mark 1. The onset is the same for both
 * marks, so the A/V measure does not change.
 *
 * The oscillator starts at phase 0 and plays a whole number of cycles (60 or
 * 120), so the beep starts and ends on a zero crossing (no click that could
 * move the onset or the end).
 */
import type { GameAudioChannel } from "@/shared/lib/audio";

export const BEEP_HZ = 1000;
/** The beep length for mark 0 (s). */
export const BEEP_SECONDS = 0.06;
/** The beep length for mark 1 (s). The analyzer reads a beep of 90 ms or more as mark 1 (sync.mjs DETECT.markSplitMs). */
export const BEEP_MARK_SECONDS = 0.12;
export const BEEP_GAIN = 0.5;

/** The app id of the lab's channel on the game-audio bus. */
export const LAB_AUDIO_APP_ID = "clips-lab";

/** The beep length (s) for a mark bit. */
export function beepSeconds(mark: 0 | 1): number {
  return mark === 1 ? BEEP_MARK_SECONDS : BEEP_SECONDS;
}

/** Starts one beep at context time `at` on `channel`. The nodes disconnect when it ends. */
export function playBeep(channel: Pick<GameAudioChannel, "context" | "input">, at: number, mark: 0 | 1 = 0): void {
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
  oscillator.stop(at + beepSeconds(mark));
}
