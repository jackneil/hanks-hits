"use client";

import { BOARD_SIZE, type Position, positionsEqual } from "../lib/constants";
import { getSelectablePieces } from "../lib/gameLogic";
import { useCheckersStore } from "../lib/store";
import { Square } from "./Square";
import { Piece } from "./Piece";

/** The board, `size` px square. `canAct` is false on the computer's turn, in a pause and before Play. */
export function Board({ size, canAct }: { size: number; canAct: boolean }) {
  const board = useCheckersStore((s) => s.board);
  const currentPlayer = useCheckersStore((s) => s.currentPlayer);
  const selectedPiece = useCheckersStore((s) => s.selectedPiece);
  const validMoves = useCheckersStore((s) => s.validMoves);
  const lastMove = useCheckersStore((s) => s.lastMove);
  const rules = useCheckersStore((s) => s.rules);
  const selectPiece = useCheckersStore((s) => s.selectPiece);
  const makeMove = useCheckersStore((s) => s.makeMove);

  // The pieces the player to move may pick (a forced jump limits them).
  const selectablePieces = canAct ? getSelectablePieces(board, currentPlayer, rules) : [];

  const handleSquareClick = (row: number, col: number) => {
    if (!canAct) return;
    const pos: Position = { row, col };
    if (validMoves.some((m) => positionsEqual(m.to, pos))) {
      makeMove(pos);
      return;
    }
    const piece = board[row][col];
    if (piece && piece.startsWith(currentPlayer)) selectPiece(pos);
  };

  const isLastMoveSquare = (row: number, col: number): boolean =>
    !!lastMove && (positionsEqual(lastMove.from, { row, col }) || positionsEqual(lastMove.to, { row, col }));

  const cell = size / BOARD_SIZE;
  return (
    <div
      data-testid="checkers-board"
      data-game-board=""
      role="group"
      aria-label="Checkers board"
      className="grid shrink-0 select-none overflow-hidden rounded-md touch-manipulation"
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(${BOARD_SIZE}, ${cell}px)`,
        outline: "4px solid #5b3a24",
        boxShadow: "0 4px 12px rgba(0,0,0,0.45)",
      }}
    >
      {Array.from({ length: BOARD_SIZE }).map((_, row) =>
        Array.from({ length: BOARD_SIZE }).map((_, col) => {
          const piece = board[row][col];
          const pos: Position = { row, col };
          const isSelected = selectedPiece ? positionsEqual(selectedPiece, pos) : false;
          const isValidMove = validMoves.some((m) => positionsEqual(m.to, pos));
          const isSelectable = selectablePieces.some((p) => positionsEqual(p, pos));
          return (
            <Square
              key={`${row}-${col}`}
              row={row}
              col={col}
              size={cell}
              piece={piece}
              isSelected={isSelected}
              isValidMove={isValidMove}
              isLastMove={isLastMoveSquare(row, col)}
              isSelectable={isSelectable}
              onClick={() => handleSquareClick(row, col)}
            >
              {piece && <Piece piece={piece} isSelected={isSelected} isSelectable={isSelectable} />}
            </Square>
          );
        })
      )}
    </div>
  );
}
