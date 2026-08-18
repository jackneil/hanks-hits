"use client";

interface RestartConfirmationDialogProps {
  isOpen: boolean;
  gameName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RestartConfirmationDialog({
  isOpen,
  gameName,
  onConfirm,
  onCancel,
}: RestartConfirmationDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restart-dialog-title"
        className="w-full max-w-sm rounded-2xl bg-base-100 p-6 text-base-content shadow-2xl"
      >
        <h2 id="restart-dialog-title" className="text-2xl font-bold">
          Restart game?
        </h2>
        <p className="mt-3 text-base-content/75">
          Start {gameName} again from the beginning?
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="btn btn-ghost min-h-[44px]">
            Cancel
          </button>
          <button
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
