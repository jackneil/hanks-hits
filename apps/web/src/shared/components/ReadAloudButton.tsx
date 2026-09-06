"use client";

import { useReadAloud } from "../hooks/useReadAloud";

/**
 * Big "read it to me" button for players who cannot read yet.
 *
 * It speaks only when the player taps it. It never speaks on its own,
 * and it renders nothing when the browser has no voice support, so a
 * player never sees a button that does nothing.
 *
 * Two shapes:
 * - "full": a wide labelled button, for a start screen or a menu.
 * - "icon": a small round speaker, for the corner of a card.
 */
interface ReadAloudButtonProps {
  /** The words to read out loud. */
  text: string;
  className?: string;
  /** Button label while the voice is quiet. Full variant only. */
  label?: string;
  /** Button shape. Defaults to the wide labelled button. */
  variant?: "full" | "icon";
}

export function ReadAloudButton({
  text,
  className = "",
  label = "🔊 Read it to me",
  variant = "full",
}: ReadAloudButtonProps) {
  const { speak, stop, isSpeaking, isSupported } = useReadAloud();

  if (!isSupported) return null;

  const isIcon = variant === "icon";

  return (
    <button
      type="button"
      data-testid="read-aloud-button"
      aria-pressed={isSpeaking}
      aria-label={isSpeaking ? "Stop reading" : "Read it to me"}
      onClick={() => (isSpeaking ? stop() : speak(text))}
      className={
        isIcon
          ? `btn btn-circle btn-sm min-h-[44px] min-w-[44px] h-11 w-11 text-xl ${className}`
          : `btn border-base-300 bg-base-100 text-base-content shadow-md min-h-[56px] w-full text-lg ${className}`
      }
    >
      {isIcon ? (isSpeaking ? "⏹" : "🔊") : isSpeaking ? "⏹ Stop" : label}
    </button>
  );
}
