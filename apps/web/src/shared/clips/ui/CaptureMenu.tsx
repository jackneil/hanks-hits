"use client";
import { SHARING_COPY } from "./copy";

/**
 * The Capture menu (plan 11.4). It opens from a hold on the clip button, a
 * right-click, the pause menu's Clips button and the result chip.
 *
 * Rows, in order:
 * - Resting: "Turn the clip button back on" comes first (plan 11.3).
 * - Record only (device fallback): the reason in kid words, then only
 *   "Record a video" and "Take a picture".
 * - Disabled (crash breaker): the reason, then only the rows that need no
 *   capture.
 * - Otherwise: Clip the last 30 seconds (it uses the press token, so it
 *   clips the moment of the press), Record a video (Stop the video while
 *   one records), Take a picture, My clips from this game, Clip settings.
 *
 * ClipUiRuntime renders it; open it with controller.openMenu().
 *
 * The close control says where it goes: "Back to the game" when the menu
 * paused the game (closing gives play back), and "Back" when it opened at a
 * break (the pause menu, a start or result card). The voice says the same.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { SECONDARY_ACTION } from "@/shared/components/buttonStyles";

import { useClipService, useClipSnapshot } from "../service/context";
import type { PressToken } from "../service/contract";
import { useClipUi, useClipUiState } from "./uiContext";
import { closeResumesPlay } from "./uiStore";
import { ClipWords } from "./ClipWords";
import { MENU_COPY, REASON_COPY } from "./copy";
import {
  ClipGlyph,
  PictureGlyph,
  PowerGlyph,
  RecordGlyph,
  SlidersGlyph,
  StopGlyph,
  TilesGlyph,
} from "./glyphs";
import { Sheet } from "./Sheet";
import { currentSessionUser } from "../service/registry";
import { useClipSession } from "./useClipSession";

export interface CaptureMenuProps {
  /** The press that opened the menu. "Clip the last 30 seconds" clips up to its frozen end. */
  token: PressToken | null;
}

interface MenuRow {
  id: "wake" | "clipLast" | "record" | "stop" | "picture" | "myClips" | "settings";
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

// h-auto + whitespace-normal: a long label wraps to two lines on a 320 px
// phone instead of being cut off. min-h-14 keeps a 56 px target.
const ROW_BASE =
  "btn btn-block h-auto min-h-14 justify-start gap-3 px-4 py-2 text-lg font-semibold normal-case touch-manipulation";

export function CaptureMenu({ token }: CaptureMenuProps) {
  const ui = useClipUi();
  const session = useClipSession();
  const [preparation, setPreparation] = useState<{ owner: typeof session; busy: boolean; error: string } | null>(null);
  const preparing = preparation?.owner === session && preparation.busy;
  const prepareError = preparation?.owner === session ? preparation.error : "";
  const request = useRef<symbol | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current = null; };
  }, []);
  useEffect(() => () => { request.current = null; }, [session]);
  const service = useClipService();
  const snapshot = useClipSnapshot();
  const sheet = useClipUiState().sheet;
  if (!ui || !service) return null;
  const closeLabel = closeResumesPlay(sheet) ? MENU_COPY.close : MENU_COPY.back;

  const state = snapshot.button;
  const recording = state === "recording" || snapshot.recording !== null;
  const gameId = snapshot.appId;

  const rows: MenuRow[] = [];
  const note = state === "record-only" ? REASON_COPY["record-only"] : state === "disabled" ? REASON_COPY.breaker : null;

  const wake: MenuRow = { id: "wake", label: MENU_COPY.wake, icon: <PowerGlyph />, onSelect: () => ui.wakeFromMenu() };
  const clipLast: MenuRow = {
    id: "clipLast",
    label: MENU_COPY.clipLast,
    icon: <ClipGlyph />,
    onSelect: () => ui.clipLastFromMenu(token),
  };
  const record: MenuRow = recording
    ? { id: "stop", label: MENU_COPY.stopRecording, icon: <StopGlyph />, onSelect: () => ui.stopRecordingFromMenu() }
    : { id: "record", label: MENU_COPY.record, icon: <RecordGlyph />, onSelect: () => ui.recordFromMenu() };
  const picture: MenuRow = {
    id: "picture",
    label: MENU_COPY.picture,
    icon: <PictureGlyph />,
    onSelect: () => ui.pictureFromMenu(),
  };
  const myClips: MenuRow | null = gameId
    ? {
        id: "myClips",
        label: MENU_COPY.myClips,
        icon: <TilesGlyph />,
        onSelect: () => ui.replaceSheet({ kind: "viewer", target: { kind: "game", gameId } }),
      }
    : null;
  const settings: MenuRow = {
    id: "settings",
    label: MENU_COPY.settings,
    icon: <SlidersGlyph />,
    onSelect: () => ui.replaceSheet({ kind: "settings" }),
  };

  if (state === "record-only") {
    rows.push(record, picture);
  } else if (state === "disabled") {
    if (myClips) rows.push(myClips);
    rows.push(settings);
  } else {
    if (state === "resting") rows.push(wake);
    rows.push(clipLast, record, picture);
    if (myClips) rows.push(myClips);
    rows.push(settings);
  }

  const prepare = async () => {
    if (request.current) return;
    const operation = Symbol("prepare");
    const captured = session;
    const originalSheet = ui.store.getState().sheet;
    request.current = operation;
    const current = () => mounted.current && request.current === operation && currentSessionUser() === captured && ui.store.getState().sheet === originalSheet;
    setPreparation({ owner: captured, busy: true, error: "" });
    try {
      const result = await service.clipLast(30, token ?? undefined);
      if (!current()) return;
      if (result.ok) ui.replaceSheet({ kind: "viewer", target: { kind: "clip", id: result.record.id } });
      else if (!result.refused) setPreparation({ owner: captured, busy: false, error: SHARING_COPY.thereIsNotAVideoReadyYet });
    } catch {
      if (current()) setPreparation({ owner: captured, busy: false, error: SHARING_COPY.theVideoCouldNotBePreparedKeep });
    } finally {
      if (current()) setPreparation((before) => before?.owner === captured ? { ...before, busy: false } : before);
      if (request.current === operation) request.current = null;
    }
  };
  const readAloudText = () =>
    [MENU_COPY.title, SHARING_COPY.prepareAGameplayVideoWatchItThen, SHARING_COPY.previewLast30SecondsToPublish, note ? `${note.say} ${note.next}` : null, ...rows.map((row) => row.label), closeLabel]
      .filter(Boolean)
      .join(". ");

  return (
    <Sheet
      title={MENU_COPY.title}
      variant="menu"
      testId="capture-menu"
      onClose={() => ui.closeSheet()}
      closeLabel={closeLabel}
      readAloudText={readAloudText}
    >
      <p className="mb-3">{SHARING_COPY.prepareAGameplayVideoWatchItThen2}</p>
      <button className="btn btn-primary mb-3 min-h-14 h-auto whitespace-normal" disabled={preparing || recording} onClick={() => void prepare()}>{preparing ? SHARING_COPY.preparingVideo : SHARING_COPY.previewLast30SecondsToPublish}</button>
      {prepareError && <p role="status" className="mb-3">{prepareError}</p>}
      {note && (
        <p data-testid="capture-menu-reason" className="mb-3 rounded-xl bg-base-200 px-4 py-3 text-base leading-snug">
          <ClipWords text={`${note.say} ${note.next}`} />
        </p>
      )}
      <ul className="flex flex-col gap-2" aria-label={MENU_COPY.title}>
        {rows.map((row, index) => (
          <li key={row.id}>
            <button
              type="button"
              data-row={row.id}
              data-autofocus={index === 0 ? "true" : undefined}
              onClick={row.onSelect}
              className={`${ROW_BASE} ${index === 0 ? "btn-primary" : SECONDARY_ACTION}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">{row.icon}</span>
              <span className="min-w-0 whitespace-normal text-left leading-tight">{row.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
