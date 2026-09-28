"use client";

/**
 * The clip buttons of the result chip (plan 11.4): Watch, "Make the whole
 * run a video", Record a video and Take a picture. They go in ResultChip's
 * children slot, and their words go in its spokenExtras:
 *
 *   const clipExtras = useResultChipClipSpokenExtras({ runSeconds });
 *   <ResultChip spokenExtras={clipExtras} ...>
 *     <ResultChipClipActions runSeconds={runSeconds} />
 *   </ResultChip>
 *
 * The result chip is a break, so every action runs at once:
 * - Watch opens the newest unwatched clip, or clips the last 30 seconds
 *   and opens that.
 * - "Make the whole run a video (m:ss)" shows only when the game gives the
 *   run length and the ring still holds the whole run. It clips the run and
 *   opens it. (A run longer than the ring needs the session timeline, PR 5.2.)
 * - Record a video starts a video; the next run records. While one records,
 *   the button stops it.
 * - Take a picture takes the result screen and opens it.
 *
 * The buttons are the size of the chip's own buttons (56 px, 44 px on a
 * short screen).
 */

import type React from "react";

import { useClipService, useClipSnapshot } from "../service/context";
import type { ClipSnapshot } from "../service/contract";
import { useClipUi } from "./ClipUiProvider";
import { MENU_COPY, RESULT_ACTION_COPY, wholeRunLabel } from "./copy";
import { formatDuration } from "./format";
import { PictureGlyph, PlayGlyph, RecordGlyph, StopGlyph } from "./glyphs";

export interface ResultChipClipActionsProps {
  /** The length of the run that just ended, in seconds, if the game knows it. */
  runSeconds?: number;
}

export type ResultChipClipActionId = "watch" | "wholeRun" | "record" | "picture";

export interface ResultChipClipAction {
  id: ResultChipClipActionId;
  label: string;
}

/** The actions to show, in screen order. Pure, so the spoken words always match the buttons. */
export function resultChipClipActions(
  snapshot: Pick<ClipSnapshot, "button" | "unwatchedClipId" | "bufferedSec" | "recording">,
  runSeconds?: number,
): ResultChipClipAction[] {
  const state = snapshot.button;
  if (state === "hidden") return [];
  const actions: ResultChipClipAction[] = [];
  const instant = state !== "record-only" && state !== "disabled";
  const canCapture = state !== "disabled";

  if (snapshot.unwatchedClipId || instant) actions.push({ id: "watch", label: RESULT_ACTION_COPY.watch });
  if (
    instant &&
    typeof runSeconds === "number" &&
    Number.isFinite(runSeconds) &&
    runSeconds >= 1 &&
    runSeconds <= snapshot.bufferedSec
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

/** The words of the clip buttons, for ResultChip's spokenExtras (screen order). */
export function useResultChipClipSpokenExtras({ runSeconds }: ResultChipClipActionsProps = {}): string[] {
  const service = useClipService();
  const snapshot = useClipSnapshot();
  if (!service) return [];
  return resultChipClipActions(snapshot, runSeconds).map((action) => action.label);
}

const ACTION_BUTTON =
  "btn h-14 min-h-14 short:h-11 short:min-h-11 gap-2 px-4 text-lg normal-case active:scale-[0.97] touch-manipulation";

const ICONS: Record<ResultChipClipActionId, React.ReactNode> = {
  watch: <PlayGlyph />,
  wholeRun: <PlayGlyph />,
  record: <RecordGlyph />,
  picture: <PictureGlyph />,
};

export function ResultChipClipActions({ runSeconds }: ResultChipClipActionsProps) {
  const ui = useClipUi();
  const service = useClipService();
  const snapshot = useClipSnapshot();
  if (!ui || !service) return null;

  const actions = resultChipClipActions(snapshot, runSeconds);
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
