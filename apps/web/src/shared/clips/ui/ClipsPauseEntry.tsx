"use client";

/**
 * The visible "Clips" button of the pause menu (plan 11.4). It goes in
 * PauseMenu's children slot, through GameShell's pauseMenuChildren:
 *
 *   <GameShell pauseMenuChildren={<ClipsPauseEntry />} ...>
 *
 * and its words go in PauseMenu's spokenExtras, so the read-aloud button
 * says it: spokenExtras={[CLIPS_PAUSE_ENTRY_SPOKEN]}. (PauseMenu also reads
 * the visible label of each child button when spokenExtras is left out.)
 *
 * A tap opens the Capture menu above the pause menu. The game is paused
 * already, so "Clip the last 30 seconds" clips the footage before the pause.
 * It renders nothing when clips are off for this game.
 */

import { useClipService, useClipSnapshot } from "../service/context";
import { useClipUi } from "./ClipUiProvider";
import { PAUSE_ENTRY_LABEL } from "./copy";

/** The words the pause menu's read-aloud button says for this entry. */
export const CLIPS_PAUSE_ENTRY_SPOKEN = PAUSE_ENTRY_LABEL;

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
      className={`btn btn-lg w-full gap-3 border-base-300 bg-base-100 text-xl text-base-content shadow-lg hover:scale-105 transition-transform ${className}`}
    >
      {/* An emoji paired with a word is a picture for kids who cannot read (plan decision 11). */}
      <span aria-hidden="true" className="text-2xl">
        🎬
      </span>
      {PAUSE_ENTRY_LABEL}
    </button>
  );
}
