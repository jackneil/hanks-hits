"use client";

import { useEffect, useRef, useState } from "react";
import { ReadAloudButton } from "./ReadAloudButton";
import { RestartConfirmationDialog } from "./RestartConfirmationDialog";
import { RestartGameButton } from "./RestartGameButton";

interface PauseMenuProps {
  isOpen: boolean;
  onResume: () => void;
  onHome: () => void;
  gameName: string;
  onRestart?: () => void;
  restartConfirmation?: "always" | "never";
  restartConfirmationMessage?: string;
  children?: React.ReactNode;
  /** Labels of the extra buttons in the children slot, so the voice names every button the kid sees. */
  spokenExtras?: string[];
}

export function PauseMenu({
  isOpen,
  onResume,
  onHome,
  gameName,
  onRestart,
  restartConfirmation = "always",
  restartConfirmationMessage,
  children,
  spokenExtras = [],
}: PauseMenuProps) {
  const [isRestartConfirmationOpen, setIsRestartConfirmationOpen] = useState(false);
  const restartTriggerRef = useRef<HTMLButtonElement>(null);

  // Prevent body scroll when paused
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Same order as the buttons on screen: Resume, extras, Restart, Go Home.
  const readAloudText = [
    "Paused",
    gameName,
    "Resume",
    ...spokenExtras,
    onRestart ? "Restart" : null,
    "Go Home",
  ]
    .filter(Boolean)
    .join(". ");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center overflow-y-auto bg-black/85 py-4 backdrop-blur-sm short:justify-start">
      {/* Paused title */}
      <div className="text-4xl md:text-6xl font-bold text-white mb-8 animate-pulse short:mb-2 short:text-3xl">
        PAUSED
      </div>

      {/* Game name */}
      <div className="text-xl text-gray-400 mb-8 short:mb-2">{gameName}</div>

      {/* Read the menu out loud for players who cannot read yet */}
      <div className="w-64 mb-4 short:mb-2">
        <ReadAloudButton text={readAloudText} className="short:min-h-[44px]" />
      </div>

      {/* Menu buttons: on a phone held sideways the column scrolls
          instead of clipping below the viewport */}
      <div className="flex flex-col gap-4 w-64 short:gap-2">
        <button
          onClick={onResume}
          className="btn btn-primary btn-lg text-xl gap-3 shadow-lg hover:scale-105 transition-transform"
        >
          <span className="text-2xl">▶️</span>
          Resume
        </button>

        {children}

        {onRestart && (
          <RestartGameButton
            ref={restartTriggerRef}
            onClick={() => {
              if (restartConfirmation === "never") {
                onRestart();
              } else {
                setIsRestartConfirmationOpen(true);
              }
            }}
            className="btn btn-secondary btn-lg w-full text-xl gap-3 shadow-lg hover:scale-105 transition-transform"
          />
        )}

        <button
          onClick={onHome}
          className="btn btn-error btn-lg text-xl gap-3 shadow-lg hover:scale-105 transition-transform"
        >
          <span className="text-2xl">🏠</span>
          Go Home
        </button>
      </div>

      {/* Hint */}
      <div className="mt-8 text-gray-500 text-sm">
        Press ESC to resume
      </div>

      <RestartConfirmationDialog
        isOpen={isRestartConfirmationOpen}
        gameName={gameName}
        message={restartConfirmationMessage}
        triggerRef={restartTriggerRef}
        onCancel={() => setIsRestartConfirmationOpen(false)}
        onConfirm={() => {
          setIsRestartConfirmationOpen(false);
          onRestart?.();
          onResume();
        }}
      />
    </div>
  );
}
