"use client";

import { COLORS, type Player } from "../lib/constants";
import { countPieces } from "../lib/gameLogic";
import { useCheckersStore } from "../lib/store";

/** A side's pieces left on the board: a dot of its colour and a count. */
function PieceCount({ player, column }: { player: Player; column: boolean }) {
  const count = useCheckersStore((s) => countPieces(s.board)[player]);
  const active = useCheckersStore((s) => s.currentPlayer === player && s.status === "playing");
  const mode = useCheckersStore((s) => s.gameMode);
  const name = mode === "vs-ai" ? (player === "red" ? "You" : "Computer") : player === "red" ? "Red" : "Black";
  return (
    <div
      data-testid={`checkers-count-${player}`}
      aria-label={`${name}: ${count} ${count === 1 ? "piece" : "pieces"} left`}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold ${
        active ? "bg-amber-50 text-amber-950" : "bg-black/30 text-amber-100"
      }`}
    >
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-white/60"
        style={{ backgroundColor: player === "red" ? COLORS.RED_PIECE : COLORS.BLACK_PIECE }}
      />
      {column && <span>{name} ·</span>}
      <span aria-hidden="true">{count}</span>
    </div>
  );
}

/** Whose turn it is, in words. */
export function turnWords(state: ReturnType<typeof useCheckersStore.getState>): string {
  if (state.status !== "playing") return "Game over";
  if (state.isComputerTurn()) return "🤖 Thinking…";
  if (state.gameMode === "vs-ai") return state.selectedPiece ? "Tap a green dot" : "Your turn!";
  return state.currentPlayer === "red" ? "🔴 Red's turn" : "⚫ Black's turn";
}

/** The turn and the piece counts: a row over the board upright, a column beside it sideways. */
export function TurnStrip({ column, width, height }: { column: boolean; width?: number; height?: number }) {
  const words = useCheckersStore(turnWords);
  const text = (
    <p
      data-testid="checkers-status"
      aria-live="polite"
      className="min-w-0 flex-1 text-center text-base font-bold leading-tight text-amber-50"
    >
      {words}
    </p>
  );
  if (column) {
    // The computer's pieces start at the top, so its count is on top.
    return (
      <div className="flex flex-col items-stretch gap-2">
        <PieceCount player="black" column />
        {text}
        <PieceCount player="red" column />
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2" style={{ width, height }}>
      <PieceCount player="red" column={false} />
      {text}
      <PieceCount player="black" column={false} />
    </div>
  );
}
