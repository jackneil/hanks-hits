"use client";

import { useEffect, useId, useRef } from "react";

import { ReadAloudButton } from "./ReadAloudButton";

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
      // Order is Cancel first and Restart last (the two decisions bracket
      // the cycle); anything between them keeps its DOM order.
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
    "Cancel",
    "Restart",
  ].join(". ");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-2xl bg-base-100 p-6 text-base-content shadow-2xl"
      >
        <h2 id={titleId} className="text-2xl font-bold">
          Restart game?
        </h2>
        <p className="mt-3 text-base-content/75">
          {message ?? `Start ${gameName} again from the beginning?`}
        </p>
        <ReadAloudButton text={readAloudText} className="mt-4" />

        <div className="mt-6 flex justify-end gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} className="btn btn-ghost min-h-[44px]">
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="btn btn-primary min-h-[44px]"
            aria-label="Confirm restart"
          >
            Restart
          </button>
        </div>
      </div>
    </div>
  );
}
