"use client";

/**
 * The 44 px read-aloud button on in-play toasts (plan 11.3: a reply to the
 * kid's own tap keeps a read-aloud button that takes taps during play).
 *
 * It looks and speaks like the shared ReadAloudButton (icon variant), but it
 * acts on the pointer (inPlayTap.ts): a second finger gets no click on a
 * phone, and a kid who holds the gas pedal must still be able to hear the
 * reply. It never takes keyboard focus from a pointer press, and its taps
 * never reach the game. Like ReadAloudButton, it renders nothing when the
 * browser has no voice.
 */

import { useReadAloud, type UseReadAloudResult } from "@/shared/hooks/useReadAloud";

import { READ_ALOUD_NAME } from "./copy";
import { useInPlayTap } from "./inPlayTap";

export interface InPlayReadAloudButtonProps {
  /** The words to read out loud. */
  text: string;
  /** A voice the parent already owns (so it can also speak on its own). Default: its own voice. */
  voice?: UseReadAloudResult;
  /** Runs on the press, before the voice starts (the toast stays up while it reads). */
  onPress?: () => void;
  className?: string;
}

export function InPlayReadAloudButton({ text, voice, onPress, className = "" }: InPlayReadAloudButtonProps) {
  const own = useReadAloud();
  const active = voice ?? own;
  const tap = useInPlayTap(() => {
    onPress?.();
    if (active.isSpeaking) active.stop();
    else active.speak(text);
  });
  if (!active.isSupported) return null;
  return (
    <button
      type="button"
      data-testid="read-aloud-button"
      aria-pressed={active.isSpeaking}
      aria-label={READ_ALOUD_NAME}
      {...tap}
      className={`btn btn-circle btn-sm pointer-events-auto h-11 min-h-[44px] w-11 min-w-[44px] touch-manipulation text-xl ${className}`}
    >
      {active.isSpeaking ? "⏹" : "🔊"}
    </button>
  );
}
