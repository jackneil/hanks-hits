"use client";

import { useEffect, useId, useRef } from "react";

import { useShellOverlay } from "../lib/shellOverlays";
import { SECONDARY_ACTION } from "./buttonStyles";
import { ReadAloudButton } from "./ReadAloudButton";

/**
 * The safe choice of the restart question, the same words as the
 * orientation tip and the leaderboard: the big blue button keeps the run.
 * Before this the destructive Restart was the primary button next to a
 * ghost Cancel, one tap from the header's Pause on a phone, so a mis-tap
 * on the way to Pause and a reflex tap on the big button lost the run.
 */
export const RESTART_KEEP_PLAYING = "Keep playing";

interface RestartConfirmationDialogProps {
  isOpen: boolean;
  gameName: string;
  message?: string;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RestartConfirmationDialog({
  isOpen,
  gameName,
  message,
  triggerRef,
  onConfirm,
  onCancel,
}: RestartConfirmationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  // A shell overlay: GameShell holds the game while the question is up
  // (Hill Climb kept driving under it).
  useShellOverlay(isOpen);

  useEffect(() => {
    if (!isOpen) {
      if (wasOpenRef.current) {
        triggerRef?.current?.focus();
      }
      wasOpenRef.current = false;
      return;
    }

    wasOpenRef.current = true;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      // Cycle every focusable button inside the dialog, so the read-aloud
      // button joins the trap instead of letting focus escape to the page.
      // Order is Keep playing first and Restart last (the two decisions
      // bracket the cycle); anything between them keeps its DOM order.
      const inDom = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled])"
        ) ?? []
      );
      const cancel = cancelRef.current;
      const confirm = confirmRef.current;
      const middle = inDom.filter((node) => node !== cancel && node !== confirm);
      const focusables = [cancel, ...middle, confirm].filter(
        (node): node is HTMLButtonElement => node !== null
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const index = active ? focusables.indexOf(active as HTMLButtonElement) : -1;

      event.preventDefault();
      if (index === -1) {
        (event.shiftKey ? last : first).focus();
        return;
      }
      const step = event.shiftKey ? -1 : 1;
      const next = (index + step + focusables.length) % focusables.length;
      focusables[next].focus();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onCancel, triggerRef]);

  const readAloudText = [
    "Restart game?",
    message ?? `Start ${gameName} again from the beginning?`,
    RESTART_KEEP_PLAYING,
    "Restart",
  ].join(". ");

  if (!isOpen) return null;

  return (
    // m-auto on the card (not items-center here) centers it when it fits
    // and lets it scroll from its top on a short screen (a phone sideways).
    <div className="fixed inset-0 z-[3000] flex overflow-y-auto bg-black/70 px-4 py-4 short:py-2">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="m-auto w-full max-w-sm rounded-2xl bg-base-100 p-6 text-base-content shadow-2xl short:p-4"
      >
        <h2 id={titleId} className="text-2xl font-bold">
          Restart game?
        </h2>
        <p className="mt-3 text-base-content/75">
          {message ?? `Start ${gameName} again from the beginning?`}
        </p>
        <ReadAloudButton text={readAloudText} className="mt-4 short:mt-2 short:min-h-[44px]" />

        {/* The safe choice is the big blue button and gets the focus; the
            restart is a plain bordered button with a red word. */}
        <div className="mt-6 flex justify-end gap-3 short:mt-3">
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`btn ${SECONDARY_ACTION} min-h-[44px] text-error`}
            aria-label="Confirm restart"
          >
            Restart
          </button>
          <button ref={cancelRef} type="button" onClick={onCancel} className="btn btn-primary min-h-[44px]">
            <span aria-hidden="true">▶</span> {RESTART_KEEP_PLAYING}
          </button>
        </div>
      </div>
    </div>
  );
}
