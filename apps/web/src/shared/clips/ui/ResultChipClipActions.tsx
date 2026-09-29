"use client";

/**
 * The clip buttons of the result chip (plan 11.4, decision D1). ResultChip
 * mounts them itself (through the shell mount, see ClipUiRuntime.tsx),
 * after its own buttons, and its read-aloud button says them in screen
 * order. A game only mounts ResultChip at game over and reports its runs
 * with runPhase("start" | "end"); it never puts these buttons in the chip's
 * children.
 *
 * The result chip is a break, so every action runs at once:
 * - When the buttons appear, they freeze the end of the run (a press token,
 *   like a tap on the clip button). The token also carries the run's own
 *   span on the capture timeline (PressToken.run). Both clip bounds come
 *   from that span, so a clip never holds the time the kid spends on the
 *   result screen, an earlier run, or the start card.
 * - A run of 30 seconds or less: one button, "Watch the whole run (m:ss)".
 *   It clips the run and opens it.
 * - A longer run: "Watch the end" clips the last 30 seconds of the run, and
 *   "Make the whole run a video (m:ss)" clips all of it. The whole-run
 *   button shows only when the ring still holds the run's start: the run
 *   plus any capture since the run ended must fit in the ring, give or take
 *   one keyframe gap and the age of the last ring report. (A run longer
 *   than the ring needs the session timeline, PR 5.2.) A short run whose
 *   start the ring lost gets "Watch the end" too.
 * - The m:ss on a button is the length of the clip that the kid gets: the
 *   run, less any start that the ring no longer holds.
 * - No run reported, or a run too short to clip: no clip button. Record a
 *   video and Take a picture are in the Capture menu (a hold on the clip
 *   button).
 *
 * The buttons are the size of the chip's own buttons (56 px, 44 px on a
 * short screen). Below 480 px each one takes the full width of the chip's
 * two-column grid. A pointer press does not leave keyboard focus on them,
 * so the game's own keys (Space for "play again") still reach the game.
 */

import { useEffect } from "react";
import type React from "react";

import { RESULT_CHIP_BUTTON, SECONDARY_ACTION } from "@/shared/components/buttonStyles";

import { useClipService, useClipSnapshot } from "../service/context";
import {
  DEFAULT_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  type ClipButtonState,
  type ClipSnapshot,
  type PressToken,
  type RunClipPart,
} from "../service/contract";
import { useClipUi, useClipUiState } from "./uiContext";
import { RESULT_ACTION_COPY, actionWithLength, watchRunLabel, wholeRunLabel } from "./copy";
import { formatDuration } from "./format";
import { PlayGlyph } from "./glyphs";
import { capturedSecSince } from "./uiStore";

export type ResultChipClipActionId = "watchRun" | "watchEnd" | "wholeRun";

export interface ResultChipClipAction {
  id: ResultChipClipActionId;
  /** The words on the button. */
  label: string;
  /** What the voice says for it (a length in words, not "0:16"). */
  spoken: string;
  /** The part of the run that it clips. */
  part: RunClipPart;
}

/** The run that the result chip shows, from the frozen end's token. */
export interface ChipRun {
  /** The run's length on the capture timeline, in seconds, up to its end. */
  seconds: number;
  /** Capture seconds from the run's start to the frozen end: the ring must hold them for the whole run. */
  spanSec: number;
}

/**
 * The run of the chip's frozen end, or null: the game reported no run, or
 * the run has no length.
 */
export function chipRunOf(token: PressToken | null | undefined): ChipRun | null {
  const run = token?.run;
  if (!token || !run) return null;
  const endUs = run.endUs === null ? token.endAtUs : Math.min(token.endAtUs, run.endUs);
  const seconds = (endUs - run.startUs) / 1e6;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return { seconds, spanSec: Math.max(seconds, (token.endAtUs - run.startUs) / 1e6) };
}

/**
 * The ring reports its length once a second (the encode worker's stats),
 * so bufferedSec can be up to this many seconds old. The first run of a
 * page also starts a moment before the ring's first keyframe.
 */
export const RING_REPORT_SLACK_SEC = 1;

/**
 * Button states where the ring has footage that a run clip can use (the
 * service's own rule), and a save that is still going (the buttons stay, so
 * the chip does not jump).
 */
const RUN_CLIP_STATES: ReadonlySet<ClipButtonState> = new Set(["ready", "made", "suspended", "resting", "saving"]);

/**
 * The actions to show, in screen order. Pure, so the spoken words always
 * match the buttons. `capturedSinceRunEnd` is the capture time since the
 * frozen end: that much of the ring's start is gone.
 */
export function resultChipClipActions(
  snapshot: Pick<ClipSnapshot, "button" | "bufferedSec" | "replayGranularitySec">,
  run: ChipRun | null,
  capturedSinceRunEnd = 0,
): ResultChipClipAction[] {
  if (!run || !RUN_CLIP_STATES.has(snapshot.button)) return [];
  // A run clip starts at the first keyframe at or after the run's start, so
  // it can be one keyframe gap shorter than the run. Too short to clip: none.
  const granularity = snapshot.replayGranularitySec ?? 1;
  if (run.seconds < MIN_CLIP_SECONDS + granularity) return [];
  const since = Number.isFinite(capturedSinceRunEnd) && capturedSinceRunEnd > 0 ? capturedSinceRunEnd : 0;
  // The ring still reaches back to the run's start: within one keyframe gap
  // (a run clip starts at the first keyframe at or after the start anyway)
  // and the age of the last ring report.
  const missingSec = Math.max(0, run.spanSec + since - snapshot.bufferedSec);
  const holdsRun = missingSec <= granularity + RING_REPORT_SLACK_SEC;
  // The length on the button is the length of the clip the kid gets: the
  // run, less any start that the ring no longer holds.
  const clipSec = run.seconds - missingSec;
  const length = formatDuration(clipSec);
  const watchEnd: ResultChipClipAction = {
    id: "watchEnd",
    label: RESULT_ACTION_COPY.watchEnd,
    spoken: RESULT_ACTION_COPY.watchEnd,
    part: "end",
  };
  if (run.seconds <= DEFAULT_CLIP_SECONDS) {
    if (!holdsRun) return [watchEnd];
    return [{ id: "watchRun", label: watchRunLabel(length), spoken: actionWithLength(RESULT_ACTION_COPY.watchRun, clipSec), part: "whole" }];
  }
  if (!holdsRun) return [watchEnd];
  return [
    watchEnd,
    { id: "wholeRun", label: wholeRunLabel(length), spoken: actionWithLength(RESULT_ACTION_COPY.wholeRun, clipSec), part: "whole" },
  ];
}

const ACTION_BUTTON = `btn ${SECONDARY_ACTION} gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} normal-case active:scale-[0.97] touch-manipulation max-[480px]:col-span-2`;

/** A mouse press must not leave focus on the button (the game's keys stay with the game). */
function keepFocusOff(event: React.MouseEvent) {
  event.preventDefault();
}

export function ResultChipClipActions() {
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

  const mark = uiState.resultMark;
  const actions = resultChipClipActions(snapshot, chipRunOf(mark?.token), capturedSecSince(mark));

  return (
    <>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          data-action={action.id}
          data-spoken={action.spoken}
          onMouseDown={keepFocusOff}
          onClick={() => ui.clipRun(action.part)}
          className={ACTION_BUTTON}
        >
          <PlayGlyph />
          {action.label}
        </button>
      ))}
    </>
  );
}
