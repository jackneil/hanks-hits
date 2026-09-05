"use client";

import { useReadAloud } from "../hooks/useReadAloud";

/**
 * Big "read it to me" button for players who cannot read yet.
 *
 * It speaks only when the player taps it. It never speaks on its own,
 * and it renders nothing when the browser has no voice support, so a
 * player never sees a button that does nothing.
 */
interface ReadAloudButtonProps {
  /** The words to read out loud. */
  text: string;
  className?: string;
  /** Button label while the voice is quiet. */
  label?: string;
}

export function ReadAloudButton({
  text,
  className = "",
  label = "🔊 Read it to me",
}: ReadAloudButtonProps) {
  const { speak, stop, isSpeaking, isSupported } = useReadAloud();

  if (!isSupported) return null;

  return (
    <button
      type="button"
      data-testid="read-aloud-button"
      aria-pressed={isSpeaking}
      aria-label={isSpeaking ? "Stop reading" : "Read it to me"}
      onClick={() => (isSpeaking ? stop() : speak(text))}
      className={`btn btn-outline min-h-[56px] w-full text-lg ${className}`}
    >
      {isSpeaking ? "⏹ Stop" : label}
    </button>
  );
}
