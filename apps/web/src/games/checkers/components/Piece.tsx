"use client";

import { type PieceType, COLORS, isKing, getPlayerFromPiece } from "../lib/constants";

type PieceProps = {
  piece: PieceType;
  isSelected: boolean;
  isSelectable: boolean;
};

export function Piece({ piece, isSelected, isSelectable }: PieceProps) {
  if (!piece) return null;

  const player = getPlayerFromPiece(piece);
  const pieceIsKing = isKing(piece);

  const mainColor = player === "red" ? COLORS.RED_PIECE : COLORS.BLACK_PIECE;
  const darkColor = player === "red" ? COLORS.RED_PIECE_DARK : COLORS.BLACK_PIECE_DARK;

  // The picked piece lifts and stays lifted (it bounced forever before,
  // which read as "something is wrong" more than "this one is picked").
  const selectedStyle = isSelected ? "scale-110 ring-4 ring-yellow-300" : "";
  const selectableStyle = isSelectable && !isSelected ? "hover:scale-105" : "";

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none relative w-4/5 h-4/5 rounded-full transition-transform duration-150 ${selectedStyle} ${selectableStyle}`}
      style={{
        background: `radial-gradient(circle at 30% 30%, ${mainColor}, ${darkColor})`,
        boxShadow: "0 4px 8px rgba(0,0,0,0.3), inset 0 -2px 4px rgba(0,0,0,0.2)",
      }}
    >
      {/* Inner ring for 3D effect */}
      <div
        className="absolute inset-2 rounded-full"
        style={{
          background: `radial-gradient(circle at 40% 40%, transparent 30%, ${darkColor}40)`,
        }}
      />
      
      {/* Crown for kings */}
      {pieceIsKing && (
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            className="w-1/2 h-1/2"
            fill="gold"
            stroke="goldenrod"
            strokeWidth="1"
          >
            <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z" />
            <path d="M5 19h14v2H5z" />
          </svg>
        </div>
      )}
    </div>
  );
}
