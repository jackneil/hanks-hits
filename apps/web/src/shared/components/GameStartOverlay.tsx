"use client";

import { useCallback, useRef } from "react";
import { useCoarsePointer } from "../hooks/useCoarsePointer";

/**
 * Shared start screen for every game: a DOM overlay (never in-canvas),
 * so start controls are real buttons that work on touch, scale with the
 * viewport, and stay readable. Renders the game title exactly once —
 * games using it must not paint their own menu/title into the canvas.
 *
 * Position contract: renders absolute inset-0, so the game mounts it
 * inside its relative, canvas-sized container. Stacking: z-40 — above
 * the play area, below OrientationWarning and the GameShell header/pause
 * layers.
 */

interface GameStartOverlayButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  /** Visual emphasis: "primary" for the main start action, "choice" for picker options */
  variant?: "primary" | "choice";
  /** Toggle-state semantics for picker buttons (screen readers hear the selection) */
  "aria-pressed"?: boolean;
}

/**
 * The one start-button style. Also used by difficulty/level pickers so
 * every start-screen target shares the same look and >=44px hit area.
 */
export function GameStartOverlayButton({
  onClick,
  children,
  className = "",
  variant = "choice",
  "aria-pressed": ariaPressed,
}: GameStartOverlayButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ariaPressed}
      className={`btn ${
        // "choice" stays on the default (base-200/base-content) button: white
        // text on btn-secondary green is ~3.1:1 and fails the 4.5:1 contract
        variant === "primary" ? "btn-primary btn-lg text-xl" : ""
      } min-h-[44px] min-w-[44px] w-full shadow-lg hover:scale-105 active:scale-95 transition-transform ${className}`}
    >
      {children}
    </button>
  );
}

export interface GameStartOverlayProps {
  /** Game name — rendered exactly once, as the overlay heading */
  title: string;
  /** Big friendly icon above the title */
  emoji?: string;
  /** One-line flavor text under the title */
  subtitle?: string;
  /** Instruction lines for touch (coarse-pointer) viewports */
  touchHints?: string[];
  /** Instruction lines for keyboard/mouse viewports */
  keyboardHints?: string[];
  /** Label for the built-in start button */
  startLabel?: string;
  /** Called exactly once, no matter how fast the button is mashed */
  onStart: () => void;
  /** Hide the built-in start button when the picker slot starts the game */
  showStartButton?: boolean;
  /** Picker slot (difficulty / level / age) rendered between hints and start */
  children?: React.ReactNode;
}

export function GameStartOverlay({
  title,
  emoji,
  subtitle,
  touchHints = [],
  keyboardHints = [],
  startLabel = "▶ Play!",
  onStart,
  showStartButton = true,
  children,
}: GameStartOverlayProps) {
  const isCoarse = useCoarsePointer();
  const startedRef = useRef(false);

  const handleStart = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    onStart();
  }, [onStart]);

  const hints = isCoarse ? touchHints : keyboardHints;

  return (
    <div
      data-testid="game-start-overlay"
      className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-3xl bg-base-100/95 p-6 text-center shadow-2xl">
        {emoji && (
          <div className="mb-2 text-6xl" aria-hidden="true">
            {emoji}
          </div>
        )}

        <h1 className="mb-1 text-3xl font-bold md:text-4xl">{title}</h1>

        {subtitle && <p className="mb-3 text-base opacity-80">{subtitle}</p>}

        {hints.length > 0 && (
          <ul className="mb-4 space-y-1 text-base font-medium opacity-90">
            {hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        )}

        {children && (
          <div className="mb-4 flex flex-col items-stretch gap-3">{children}</div>
        )}

        {showStartButton && (
          <GameStartOverlayButton variant="primary" onClick={handleStart}>
            {startLabel}
          </GameStartOverlayButton>
        )}
      </div>
    </div>
  );
}
