"use client";

/**
 * The clip buttons of the result chip (plan 11.4): Watch, "Make the whole
 * run a video", Record a video and Take a picture. ResultChip mounts them
 * itself (through the shell mount, see ClipUiRuntime.tsx), after its own
 * buttons, and its read-aloud button says their visible labels in screen
 * order. A game only mounts ResultChip at game over and gives it
 * `runSeconds`; it never puts these buttons in the chip's children.
 *
 * The result chip is a break, so every action runs at once:
 * - When the buttons appear, they freeze the end of the run (a press token,
 *   like a tap on the clip button). Watch and "Make the whole run a video"
 *   clip up to that end, so the time the kid spends on the result screen
 *   never cuts the start of the run or adds result-screen footage.
 * - Watch opens the newest unwatched clip, or clips the last 30 seconds of
 *   the run and opens that.
 * - "Make the whole run a video (m:ss)" shows only when the game gives the
 *   run length and the ring still holds the whole run: the run plus any
 *   capture since the run ended must fit in the ring. It clips the run and
 *   opens it. (A run longer than the ring needs the session timeline, PR 5.2.)
 * - Record a video starts a video; the next run records. While one records,
 *   the button stops it.
 * - Take a picture takes the result screen and opens it.
 *
 * The buttons are the size of the chip's own buttons (56 px, 44 px on a
 * short screen). A pointer press does not leave keyboard focus on them, so
 * the game's own keys (Space for "play again") still reach the game.
 */

import { useEffect } from "react";
import type React from "react";

import { useClipService, useClipSnapshot } from "../service/context";
import type { ClipSnapshot } from "../service/contract";
import { useClipUi, useClipUiState } from "./uiContext";
import { MENU_COPY, RESULT_ACTION_COPY, wholeRunLabel } from "./copy";
import { formatDuration } from "./format";
import { PictureGlyph, PlayGlyph, RecordGlyph, StopGlyph } from "./glyphs";
import { capturedSecSince } from "./uiStore";

export interface ResultChipClipActionsProps {
  /** The length of the run that just ended, in seconds, if the game knows it. */
  runSeconds?: number;
}

export type ResultChipClipActionId = "watch" | "wholeRun" | "record" | "picture";

export interface ResultChipClipAction {
  id: ResultChipClipActionId;
  label: string;
}

/**
 * The actions to show, in screen order. Pure, so the spoken words always
 * match the buttons. `capturedSinceRunEnd` is the capture time since the
 * run ended: that much of the ring's start is gone.
 */
export function resultChipClipActions(
  snapshot: Pick<ClipSnapshot, "button" | "unwatchedClipId" | "bufferedSec" | "recording">,
  runSeconds?: number,
  capturedSinceRunEnd = 0,
): ResultChipClipAction[] {
  const state = snapshot.button;
  if (state === "hidden") return [];
  const actions: ResultChipClipAction[] = [];
  const instant = state !== "record-only" && state !== "disabled";
  const canCapture = state !== "disabled";
  const since = Number.isFinite(capturedSinceRunEnd) && capturedSinceRunEnd > 0 ? capturedSinceRunEnd : 0;

  if (snapshot.unwatchedClipId || instant) actions.push({ id: "watch", label: RESULT_ACTION_COPY.watch });
  if (
    instant &&
    typeof runSeconds === "number" &&
    Number.isFinite(runSeconds) &&
    runSeconds >= 1 &&
    runSeconds + since <= snapshot.bufferedSec
  ) {
    actions.push({ id: "wholeRun", label: wholeRunLabel(formatDuration(runSeconds)) });
  }
  if (canCapture) {
    actions.push({
      id: "record",
      label: snapshot.recording ? MENU_COPY.stopRecording : RESULT_ACTION_COPY.record,
    });
    actions.push({ id: "picture", label: RESULT_ACTION_COPY.picture });
  }
  return actions;
}

const ACTION_BUTTON =
  "btn h-14 min-h-14 short:h-11 short:min-h-11 gap-2 px-4 text-lg normal-case active:scale-[0.97] touch-manipulation";

const ICONS: Record<ResultChipClipActionId, React.ReactNode> = {
  watch: <PlayGlyph />,
  wholeRun: <PlayGlyph />,
  record: <RecordGlyph />,
  picture: <PictureGlyph />,
};

/** A mouse press must not leave focus on the button (the game's keys stay with the game). */
function keepFocusOff(event: React.MouseEvent) {
  event.preventDefault();
}

export function ResultChipClipActions({ runSeconds }: ResultChipClipActionsProps) {
  const ui = useClipUi();
  const service = useClipService();
  const snapshot = useClipSnapshot();
  const uiState = useClipUiState();

  // Freeze the end of the run while the result chip is on screen.
  const hasService = service !== null;
  useEffect(() => {
    if (!ui || !hasService) return;
    ui.beginResultMark();
    return () => ui.endResultMark();
  }, [ui, hasService]);

  if (!ui || !service) return null;

  const actions = resultChipClipActions(snapshot, runSeconds, capturedSecSince(uiState.resultMark));
  const run = (id: ResultChipClipActionId) => {
    switch (id) {
      case "watch":
        ui.watch();
        return;
      case "wholeRun":
        if (typeof runSeconds === "number") ui.wholeRunVideo(runSeconds);
        return;
      case "record":
        if (snapshot.recording) ui.toggleRecord();
        else ui.recordFromChip();
        return;
      case "picture":
        ui.pictureFromChip();
        return;
    }
  };

  return (
    <>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          data-action={action.id}
          onMouseDown={keepFocusOff}
          onClick={() => run(action.id)}
          className={ACTION_BUTTON}
        >
          {action.id === "record" && snapshot.recording ? <StopGlyph /> : ICONS[action.id]}
          {action.label}
        </button>
      ))}
    </>
  );
}
