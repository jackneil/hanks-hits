"use client";

import { useEffect, useId, useRef } from "react";

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

      const first = cancelRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onCancel, triggerRef]);

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
