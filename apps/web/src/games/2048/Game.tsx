"use client";

import { useSemanticClips } from "@/shared/clips/replay/useSemanticClips";
import { paint2048 } from "./lib/clipRenderer";
import { useShellHold } from "@/shared/hooks/useShellHold";


import { useCallback, useEffect, useRef, useState } from "react";

import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { RESULT_CHIP_BUTTON } from "@/shared/components/buttonStyles";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useTouchInput } from "@/shared/hooks/useTouchInput";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";

import { getTileColors, GRID_SIZE, TIMINGS, type Direction } from "./lib/constants";
import { boardLayout, EDGE, GAP, SCORE_ROW, SIDE_COLUMN } from "./lib/layout";
import { use2048Store } from "./lib/store";

/** A swipe turns into a move once the finger has gone this far (a kid's short flick counts). */
export const SWIPE_PX = 24;
/** The board's padding and the gap between cells, in CSS px. */
const BOARD_PAD = 8;
const CELL_GAP = 8;

/** The result chip's words, read out loud first. */
export function resultText({ won, score, best }: { won: boolean; score: number; best: number }): string {
  if (won) return `You made 2048! Your score is ${score}. Keep going for more, or play again.`;
  return `No more moves! Your score is ${score}. Your best is ${best}.`;
}

// Tile component with animations. Only transform and opacity animate (the
// real iPhone SE dropped frames to 56 ms during swipes with transition-all).
function Tile({ value, isNew, isMerged, cell }: { value: number; isNew: boolean; isMerged: boolean; cell: number }) {
  const colors = getTileColors(value);
  const digits = String(value).length;
  const fontSize = Math.round(cell * (digits >= 4 ? 0.3 : digits === 3 ? 0.36 : 0.45));
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center rounded-lg font-bold will-change-transform ${isNew ? "animate-spawn" : ""} ${
        isMerged ? "animate-pop" : ""
      }`}
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {value > 0 && <span style={{ fontSize }}>{value}</span>}
    </div>
  );
}

// Grid component
function Grid({ size }: { size: number }) {
  const grid = use2048Store((s) => s.grid);
  const newTilePosition = use2048Store((s) => s.newTilePosition);
  const mergedPositions = use2048Store((s) => s.mergedPositions);
  const clearAnimationState = use2048Store((s) => s.clearAnimationState);

  // Clear animation state after animations complete
  useEffect(() => {
    if (newTilePosition || mergedPositions.length > 0) {
      const timer = setTimeout(() => clearAnimationState(), TIMINGS.MERGE_POP);
      return () => clearTimeout(timer);
    }
  }, [newTilePosition, mergedPositions, clearAnimationState]);

  const isMerged = (row: number, col: number) => mergedPositions.some((p) => p.row === row && p.col === col);
  const isNew = (row: number, col: number) => newTilePosition?.row === row && newTilePosition?.col === col;
  const cell = (size - 2 * BOARD_PAD - (GRID_SIZE - 1) * CELL_GAP) / GRID_SIZE;

  return (
    <div
      data-testid="game-2048-board"
      className="relative shrink-0 rounded-lg bg-[#bbada0]"
      style={{ width: size, height: size, padding: BOARD_PAD }}
    >
      <div className="grid h-full w-full grid-cols-4" style={{ gap: CELL_GAP }}>
        {grid.map((row, rowIndex) =>
          row.map((value, colIndex) => (
            <div key={`${rowIndex}-${colIndex}`} className="relative rounded-lg bg-[rgba(238,228,218,0.35)]">
              <Tile value={value} isNew={isNew(rowIndex, colIndex)} isMerged={isMerged(rowIndex, colIndex)} cell={cell} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// The score, the best and Undo: a row over the board upright, a column beside it sideways.
function ScorePanel({ column }: { column: boolean }) {
  const score = use2048Store((s) => s.score);
  const highScore = use2048Store((s) => s.highScore);
  const undo = use2048Store((s) => s.undo);
  const canUndo = use2048Store((s) => s.canUndo);
  const box = "rounded-lg bg-[#655c52] px-3 py-1 text-center";
  return (
    <div
      data-testid="game-2048-score"
      className={`flex shrink-0 gap-2 ${column ? "flex-col items-stretch justify-center" : "items-center justify-center"}`}
      style={column ? { width: SIDE_COLUMN } : { height: SCORE_ROW }}
    >
      <div className={box}>
        <div className="text-xs font-bold uppercase text-[#eee4da]">Score</div>
        <div className="text-xl font-bold text-white">{score}</div>
      </div>
      <div className={box}>
        <div className="text-xs font-bold uppercase text-[#eee4da]">Best</div>
        <div className="text-xl font-bold text-white">{highScore}</div>
      </div>
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        className="min-h-11 rounded-lg bg-[#8f7a66] px-4 font-bold text-white shadow-md active:scale-95 disabled:opacity-40 touch-manipulation"
      >
        ↶ Undo
      </button>
    </div>
  );
}

// Main Game component
export function Game2048() {
  const rootRef = useRef<HTMLDivElement>(null);
  const store = use2048Store();
  const { status, keepPlaying } = store;
  const move = use2048Store((s) => s.move);
  const undo = use2048Store((s) => s.undo);
  const newGame = use2048Store((s) => s.newGame);
  const continueAfterWin = use2048Store((s) => s.continueAfterWin);

  // The board is live from mount, so a local gate gives the player a real
  // start moment. The header restart keeps its own behavior and does not
  // bring the start card back.
  const [hasStarted, setHasStarted] = useState(false);

  const box = usePlayBox({ fit: true });
  const layout = boardLayout(box);

  const over = status === "game-over";
  const wonCard = status === "won" && !keepPlaying;
  const clipHeld = useShellHold();
  useSemanticClips(store, paint2048, { phase: !hasStarted || over || wonCard ? "idle" : clipHeld ? "hold" : "playing", runId: store.clipRunId, score: store.score, best: store.highScore });

  // Sync with auth system
  const { forceSync } = useAuthSync({
    appId: "2048",
    localStorageKey: "2048-game-state",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on game end (won or game-over)
  useEffect(() => {
    if (status === "won" || status === "game-over") forceSync();
  }, [status, forceSync]);

  // Keys: arrows or WASD slide, Z undoes, N is a new game at a result (the
  // header's restart asks first in the middle of a game).
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      if (!hasStarted || e.metaKey || e.altKey) return;
      const state = use2048Store.getState();
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.key === "n" || e.key === "N") && (state.status === "game-over" || (state.status === "won" && !state.keepPlaying))) {
        e.preventDefault();
        newGame();
        return;
      }
      const direction: Direction | null =
        e.key === "ArrowUp" || e.key === "w" || e.key === "W"
          ? "up"
          : e.key === "ArrowDown" || e.key === "s" || e.key === "S"
            ? "down"
            : e.key === "ArrowLeft" || e.key === "a" || e.key === "A"
              ? "left"
              : e.key === "ArrowRight" || e.key === "d" || e.key === "D"
                ? "right"
                : null;
      if (direction) {
        e.preventDefault();
        move(direction);
      }
    },
    [hasStarted, move, undo, newGame]
  );
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // A swipe anywhere in the play box slides the tiles, once the finger has
  // gone SWIPE_PX (on the move, not on the lift, so it feels instant). The
  // listener is native and not passive, so the page never scrolls under a
  // swipe (a swipe from the scoreboard scrolled 74 to 129 px). Buttons keep
  // their own taps.
  useTouchInput<"used">(
    rootRef,
    {
      onMove: (touch) => {
        if (!hasStarted || touch.tag === "used") return;
        const dx = touch.x - touch.startX;
        const dy = touch.y - touch.startY;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
        touch.tag = "used";
        move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
      },
    },
    { ignore: "button" }
  );

  return (
    <div
      ref={rootRef}
      data-testid="game-2048-root"
      data-layout={layout.sideways ? "sideways" : "upright"}
      className={`relative flex h-full w-full items-center justify-center bg-[#faf8ef] touch-none select-none ${
        layout.sideways ? "flex-row" : "flex-col"
      }`}
      style={{ padding: EDGE, gap: GAP }}
    >
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Inline styles for animations (transform and opacity only) */}
      <style>{`
        @keyframes spawn {
          0% { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
        .animate-spawn { animation: spawn ${TIMINGS.SPAWN}ms ease-out forwards; }
        .animate-pop { animation: pop ${TIMINGS.MERGE_POP}ms ease-out forwards; }
      `}</style>

      <ScorePanel column={layout.sideways} />
      <Grid size={layout.board} />

      {/* Shared DOM start screen (renders the title once) */}
      {!hasStarted && (
        <GameStartOverlay
          title="2048"
          emoji="🔢"
          subtitle="Slide the tiles and add them up!"
          touchHints={["👈👉 Swipe to slide the tiles", "✨ Two of the same number join up"]}
          keyboardHints={["⬅️➡️ Arrow keys slide the tiles", "✨ Two of the same number join up"]}
          onStart={() => setHasStarted(true)}
        >
          <div className="text-base font-medium opacity-90">🏆 Best: {store.progress.highScore}</div>
        </GameStartOverlay>
      )}

      {over && (
        <ResultCard testId="game-2048-result-card" title="No more moves!">
          <ResultLine big>Score {store.score}</ResultLine>
          <ResultLine>Best {store.highScore}</ResultLine>
        </ResultCard>
      )}
      {wonCard && (
        <ResultCard testId="game-2048-result-card" title="🎉 You made 2048!">
          <ResultLine big>Score {store.score}</ResultLine>
        </ResultCard>
      )}

      {/* The result chip: read it to me, Play again (a new board at once:
          the game is over), the leaderboard; after 2048, Keep going first. */}
      {(over || wonCard) && (
        <ResultChip
          resultText={resultText({ won: wonCard, score: store.score, best: store.highScore })}
          appId="2048"
          onRestart={newGame}
          keyboardHint="N"
        >
          {wonCard && (
            <button
              type="button"
              data-testid="game-2048-keep-going"
              onClick={continueAfterWin}
              className={`btn btn-primary gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} active:scale-[0.97] touch-manipulation`}
            >
              <span aria-hidden="true">▶</span>
              Keep going
            </button>
          )}
        </ResultChip>
      )}
    </div>
  );
}

export default Game2048;
