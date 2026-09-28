"use client";

/**
 * The in-play toast slot (plan 11.1, 11.3, 11.4, 8.4): a strip directly
 * under the header, at the right, above the game (z-1050).
 *
 * What it holds:
 * - The new-clip chip: its own 44 px target. It shows until the kid watches
 *   the clip. A tap opens the newest clip; the game pauses first where it
 *   can. In a run that cannot pause it says "Your clip is ready when this
 *   run ends!" and the clip opens at the break.
 * - While a video records: the timer pill and the star button.
 * - Tap replies. A reply to the kid's own tap keeps a 44 px read-aloud
 *   button that takes taps even during play. Other toasts take no taps.
 * - At a break after the third clip: the one-time tip that teaches the hold.
 *
 * Contracts:
 * - Stacking: z-index 1050, portaled to document.body (plan 11.4).
 * - Taps: the strip itself takes no taps (pointer-events: none), so the
 *   game under it still gets them. Only the chip, the star, the read-aloud
 *   buttons and "Got it" take taps, and their events stop there.
 * - Fit: planToastSlot() sizes every row to the viewport, so nothing runs
 *   off a 320 px phone. Games keep their own controls out of this strip.
 *
 * Mount it once inside ClipUiProvider (GameShell, in the integration step).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";
import { createPortal } from "react-dom";

import { ReadAloudButton } from "@/shared/components/ReadAloudButton";

import { useClipService, useClipSnapshot } from "../service/context";
import { useClipUi, useClipUiState } from "./ClipUiProvider";
import { recordTimerName, TOAST_COPY } from "./copy";
import { formatDuration } from "./format";
import { PlayGlyph, StarGlyph } from "./glyphs";
import { nowMs, subscribeToNothing } from "./platform";

/** The stacking level of the toast slot (plan 11.4). */
export const TOAST_SLOT_Z_INDEX = 1050;

// Sizes the planner and the markup share (px).
export const TOAST_SLOT_PAD_PX = 12;
export const TOAST_GAP_PX = 8;
export const CHIP_FULL_WIDTH_PX = 128;
export const CHIP_ICON_WIDTH_PX = 44;
export const RECORD_PILL_WIDTH_PX = 104;
export const STAR_WIDTH_PX = 44;
export const REPLY_MAX_WIDTH_PX = 352;
/** The hold tip goes away by itself after this long. */
export const HOLD_TIP_MS = 20000;

export interface ToastSlotPlan {
  chip: "full" | "icon" | "none";
  /** Width of the chip and record row. */
  rowWidth: number;
  /** The widest a reply or tip may be. */
  replyMaxWidth: number;
  /** The room between the side paddings. */
  available: number;
}

/**
 * Lay out the strip for a viewport width. The chip drops its words when the
 * record row and the full chip do not fit side by side.
 */
export function planToastSlot(viewportWidth: number, content: { chip: boolean; recording: boolean }): ToastSlotPlan {
  const available = Math.max(0, viewportWidth - 2 * TOAST_SLOT_PAD_PX);
  const recordWidth = content.recording ? RECORD_PILL_WIDTH_PX + TOAST_GAP_PX + STAR_WIDTH_PX : 0;
  const rowWidth = (chip: ToastSlotPlan["chip"]) => {
    if (chip === "none") return recordWidth;
    const chipWidth = chip === "full" ? CHIP_FULL_WIDTH_PX : CHIP_ICON_WIDTH_PX;
    return recordWidth + (recordWidth > 0 ? TOAST_GAP_PX : 0) + chipWidth;
  };
  let chip: ToastSlotPlan["chip"] = content.chip ? "full" : "none";
  if (chip === "full" && rowWidth("full") > available) chip = "icon";
  return { chip, rowWidth: rowWidth(chip), replyMaxWidth: Math.min(REPLY_MAX_WIDTH_PX, available), available };
}

function subscribeToResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function stopHere(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

/**
 * True when nothing covers the middle of the element (a hit test). Where
 * the browser cannot hit-test, it counts as seen.
 */
export function isOnTop(element: HTMLElement | null): boolean {
  if (!element) return false;
  if (typeof document.elementFromPoint !== "function") return true;
  const rect = element.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return hit === null || element.contains(hit);
}

/**
 * Keeps a tap on a toast control from reaching the game. It has no onClick:
 * a control with its own onClick calls stopPropagation there, so a spread
 * never replaces the control's action.
 */
const STOP_HANDLERS = {
  onPointerDown: stopHere,
  onPointerUp: stopHere,
  onPointerCancel: stopHere,
  onMouseDown: stopHere,
  onMouseUp: stopHere,
  onTouchStart: stopHere,
  onTouchEnd: stopHere,
  onContextMenu: stopHere,
} as const;

const DARK_TOAST = "rounded-2xl bg-slate-900 text-white shadow-lg";

/**
 * The recording time. Between service updates it counts on while the video
 * records, stops while the game is paused, and goes on from the same time
 * after the pause. A new elapsedSec from the service starts the count again.
 */
function useRecordSeconds(recording: { recordingId: string; elapsedSec: number } | null, live: boolean): number {
  const key = recording ? `${recording.recordingId}:${recording.elapsedSec}` : null;
  const [extra, setExtra] = useState<{ key: string | null; sec: number }>({ key: null, sec: 0 });
  const counted = useRef<{ key: string | null; sec: number }>({ key: null, sec: 0 });
  useEffect(() => {
    if (!key || !live) return;
    const before = counted.current.key === key ? counted.current.sec : 0;
    const startedAt = nowMs();
    const timer = setInterval(() => {
      const next = { key, sec: before + (nowMs() - startedAt) / 1000 };
      counted.current = next;
      setExtra(next);
    }, 250);
    return () => clearInterval(timer);
  }, [key, live]);
  if (!recording) return 0;
  return recording.elapsedSec + (extra.key === key ? extra.sec : 0);
}

export function ToastSlot() {
  const ui = useClipUi();
  const service = useClipService();
  const snapshot = useClipSnapshot();
  const state = useClipUiState();
  const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const viewportWidth = useSyncExternalStore(subscribeToResize, () => window.innerWidth, () => 0);

  const atBreak = snapshot.atBreak;
  const holdTip = state.holdTip;

  // The hold tip waits for a break, and leaves when play starts again. It
  // counts as shown only when the kid can see it: a break can be the pause
  // menu, which covers this strip. Then the tip stays due for the next break.
  const tipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ui) return;
    if (atBreak && holdTip === "due" && isOnTop(tipRef.current)) ui.store.showHoldTip();
    if (!atBreak && holdTip === "showing") ui.store.dismissHoldTip();
  }, [ui, atBreak, holdTip]);
  useEffect(() => {
    if (!ui || holdTip !== "showing") return;
    const timer = setTimeout(() => ui.store.dismissHoldTip(), HOLD_TIP_MS);
    return () => clearTimeout(timer);
  }, [ui, holdTip]);

  const recording = snapshot.recording;
  const recordSeconds = useRecordSeconds(recording, snapshot.engine === "recording");

  if (!isClient || !ui || !service) return null;

  const showChip = snapshot.unwatchedClipId !== null && state.sheet === null && snapshot.button !== "hidden";
  const plan = planToastSlot(viewportWidth, { chip: showChip, recording: recording !== null });
  const reply = state.reply;
  // A due tip renders too, so the effect above can check that nothing covers it.
  const showTip = holdTip !== "none" && atBreak;

  if (!showChip && !recording && !reply && !showTip) return null;

  const time = formatDuration(recordSeconds);

  return createPortal(
    <div
      data-testid="clip-toast-slot"
      className="pointer-events-none fixed inset-x-0 top-12 z-[1050] flex flex-col items-end gap-2 px-3 pt-2 md:top-14"
    >
      {(showChip || recording) && (
        <div data-testid="clip-toast-row" className="flex items-center gap-2" style={{ maxWidth: plan.available }}>
          {recording && (
            <>
              <div
                role="timer"
                aria-label={recordTimerName(time, recording.stars)}
                data-testid="clip-record-pill"
                className={`pointer-events-none flex h-11 items-center justify-center gap-2 px-3 text-base font-bold tabular-nums ${DARK_TOAST}`}
                style={{ width: RECORD_PILL_WIDTH_PX }}
              >
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-red-500" />
                <span aria-hidden="true">{time}</span>
              </div>
              <button
                type="button"
                data-testid="clip-star-button"
                aria-label={TOAST_COPY.addStar}
                {...STOP_HANDLERS}
                onClick={(event) => {
                  event.stopPropagation();
                  service.addStar();
                }}
                className={`pointer-events-auto relative flex h-11 shrink-0 items-center justify-center touch-manipulation active:scale-95 transition-transform ${DARK_TOAST}`}
                style={{ width: STAR_WIDTH_PX }}
              >
                <StarGlyph size={22} className="text-amber-300" />
                {recording.stars > 0 && (
                  <span aria-hidden="true" className="absolute -bottom-1 -right-1 rounded-full bg-white px-1.5 text-xs font-bold text-slate-900">
                    {recording.stars}
                  </span>
                )}
              </button>
            </>
          )}
          {showChip && plan.chip !== "none" && (
            <button
              type="button"
              data-testid="clip-new-chip"
              data-chip={plan.chip}
              aria-label={TOAST_COPY.newClipName}
              {...STOP_HANDLERS}
              onClick={(event) => {
                event.stopPropagation();
                ui.openNewestClip();
              }}
              className="pointer-events-auto flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-3 text-base font-semibold text-slate-900 shadow-lg touch-manipulation active:scale-95 transition-transform"
              style={{ width: plan.chip === "full" ? CHIP_FULL_WIDTH_PX : CHIP_ICON_WIDTH_PX }}
            >
              <PlayGlyph size={20} className="shrink-0" />
              {plan.chip === "full" && <span className="whitespace-nowrap">{TOAST_COPY.newClip}</span>}
            </button>
          )}
        </div>
      )}

      {reply && (
        <div
          key={reply.id}
          role="status"
          aria-live="polite"
          data-testid="clip-reply"
          data-tappable={reply.tappable ? "true" : "false"}
          className={`pointer-events-none flex items-center gap-2 py-1.5 pl-4 pr-1.5 ${DARK_TOAST}`}
          style={{ maxWidth: plan.replyMaxWidth }}
        >
          <p className="min-w-0 flex-1 py-1 text-base font-semibold leading-snug">{reply.text}</p>
          {reply.tappable && (
            <div
              className="pointer-events-auto shrink-0"
              onPointerDownCapture={() => ui.store.holdReply(reply.id)}
              {...STOP_HANDLERS}
              onClick={stopHere}
            >
              <ReadAloudButton text={reply.text} variant="icon" className="text-slate-900" />
            </div>
          )}
        </div>
      )}

      {showTip && (
        <div
          ref={tipRef}
          data-testid="clip-hold-tip"
          data-tip={holdTip}
          className={`pointer-events-auto flex items-center gap-2 py-1.5 pl-4 pr-1.5 ${DARK_TOAST}`}
          style={{ maxWidth: plan.replyMaxWidth }}
          {...STOP_HANDLERS}
          onClick={stopHere}
        >
          <p className="min-w-0 flex-1 py-1 text-base font-semibold leading-snug">{TOAST_COPY.holdTip}</p>
          <ReadAloudButton text={TOAST_COPY.holdTip} variant="icon" className="shrink-0 text-slate-900" />
          <button
            type="button"
            onClick={() => ui.store.dismissHoldTip()}
            className="btn h-11 min-h-11 min-w-11 shrink-0 bg-white px-3 text-base text-slate-900"
          >
            {TOAST_COPY.holdTipDone}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
