"use client";

/**
 * The visible "Clips" button of the pause menu (plan 11.4). GameShell puts
 * it first in PauseMenu's children through the shell mount (see
 * ClipUiRuntime.tsx), and PauseMenu's read-aloud button says the visible
 * label of each child button. A game adds nothing for it.
 *
 * Its picture is a small copy of the header's clip button (the same drawn
 * clapperboard in its ring), not the 🎬 emoji: the kid learns one picture
 * for one control.
 *
 * A tap opens the Capture menu above the pause menu. The game is paused
 * already, so "Clip the last 30 seconds" clips the footage before the pause.
 * It renders nothing when clips are off for this game.
 */

import { SECONDARY_ACTION } from "@/shared/components/buttonStyles";

import { useClipService, useClipSnapshot } from "../service/context";
import { ClipButtonPicture } from "./ClipWords";
import { useClipUi } from "./uiContext";
import { PAUSE_ENTRY_LABEL } from "./copy";

export interface ClipsPauseEntryProps {
  className?: string;
}

export function ClipsPauseEntry({ className = "" }: ClipsPauseEntryProps) {
  const ui = useClipUi();
  const service = useClipService();
  const snapshot = useClipSnapshot();
  if (!ui || !service || snapshot.button === "hidden") return null;

  return (
    <button
      type="button"
      data-testid="clips-pause-entry"
      aria-haspopup="dialog"
      onClick={() => ui.openMenu(null, "pause-menu")}
      className={`btn btn-lg w-full gap-3 ${SECONDARY_ACTION} text-xl shadow-lg hover:scale-105 transition-transform ${className}`}
    >
      {/* A picture paired with a word is a pre-reader aid (plan decision 11). */}
      <ClipButtonPicture size={32} />
      {PAUSE_ENTRY_LABEL}
    </button>
  );
}
