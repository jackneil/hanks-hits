"use client";

import { type PieceType, COLORS, getPlayerFromPiece, isDarkSquare, isKing } from "../lib/constants";

type SquareProps = {
  row: number;
  col: number;
  size: number;
  piece: PieceType;
  isSelected: boolean;
  isValidMove: boolean;
  isLastMove: boolean;
  isSelectable: boolean;
  onClick: () => void;
  children?: React.ReactNode;
};

/** The words a screen reader says for a square: what is on it, and what a tap does. */
function squareLabel(piece: PieceType, isValidMove: boolean, isSelectable: boolean): string {
  if (isValidMove) return "Move here";
  if (!piece) return "Empty square";
  const who = getPlayerFromPiece(piece) === "red" ? "Red" : "Black";
  const what = `${who} ${isKing(piece) ? "king" : "piece"}`;
  return isSelectable ? `${what}, can move` : what;
}

export function Square({
  row,
  col,
  size,
  piece,
  isSelected,
  isValidMove,
  isLastMove,
  isSelectable,
  onClick,
  children,
}: SquareProps) {
  const style = { width: size, height: size };
  // Only the dark squares are played on. A light square is never a target.
  if (!isDarkSquare(row, col)) {
    return <div aria-hidden="true" style={{ ...style, backgroundColor: COLORS.LIGHT_SQUARE }} />;
  }

  const bgColor = isSelected ? COLORS.SELECTED : isLastMove ? COLORS.LAST_MOVE : COLORS.DARK_SQUARE;
  return (
    <button
      type="button"
      data-square={`${row}-${col}`}
      aria-label={squareLabel(piece, isValidMove, isSelectable)}
      aria-pressed={isSelectable || isSelected ? isSelected : undefined}
      className={`relative flex items-center justify-center p-0 ${isSelectable || isValidMove ? "cursor-pointer" : "cursor-default"} ${
        isValidMove ? "ring-4 ring-inset ring-green-400" : ""
      }`}
      style={{ ...style, backgroundColor: bgColor }}
      onClick={onClick}
    >
      {isValidMove && !children && (
        <span aria-hidden="true" className="h-2/5 w-2/5 animate-pulse rounded-full bg-green-500 opacity-80" />
      )}
      {children}
    </button>
  );
}
