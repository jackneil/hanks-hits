"use client";

import { useSemanticClips } from "@/shared/clips/replay/useSemanticClips";
import { paintChess } from "./lib/clipRenderer";


import { useCallback, useEffect, useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { Square } from "chess.js";
import { useChessStore } from "./lib/store";
import { AI_CONFIG, COLORS, PIECE_UNICODE, type Difficulty, type GameMode, type GameStatus } from "./lib/constants";
import { BOTTOM_ROW, EDGE, GAP, SIDE_COLUMN, TOP_ROW, chessLayout } from "./lib/layout";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay, GameStartOverlayButton } from "@/shared/components/GameStartOverlay";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";

type Side = "white" | "black";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

/** How long Give up waits for the second tap. */
export const GIVE_UP_CONFIRM_MS = 3000;

/** The order a captured-pieces tray lists the pieces in, most valuable first. */
const TRAY_ORDER = ["q", "r", "b", "n", "p"];

/** The result of a game, from the kid's side. */
export type ChessOutcome = "won" | "lost" | "draw" | "gave-up" | "white-won" | "black-won";

export function chessOutcome(status: GameStatus, turn: "w" | "b", mode: GameMode, playerColor: Side): ChessOutcome | null {
  if (status === "playing") return null;
  if (status === "stalemate" || status === "draw") return "draw";
  if (status === "resigned") return "gave-up";
  // Checkmate: the side to move is the side that lost.
  const winner: Side = turn === "w" ? "black" : "white";
  if (mode === "local") return winner === "white" ? "white-won" : "black-won";
  return winner === playerColor ? "won" : "lost";
}

const OUTCOME_TITLES: Record<ChessOutcome, string> = {
  won: "🎉 Checkmate! You won!",
  lost: "🤖 Checkmate. The computer won",
  draw: "🤝 It's a draw!",
  "gave-up": "🏳️ You gave up",
  "white-won": "⚪ White wins!",
  "black-won": "⚫ Black wins!",
};

/** The result, read out loud first by the result chip. */
export function resultText(outcome: ChessOutcome, streak: number): string {
  switch (outcome) {
    case "won":
      return `Checkmate! You won!${streak > 1 ? ` That is ${streak} wins in a row.` : ""}`;
    case "lost":
      return "Checkmate. The computer won. Good try!";
    case "draw":
      return "It is a draw. Nobody can win from here.";
    case "gave-up":
      return "You gave up. Want to play again?";
    case "white-won":
      return "Checkmate! White wins!";
    case "black-won":
      return "Checkmate! Black wins!";
  }
}

/** The pieces one side took, grouped: "♛ ♞ ♟×3". Nothing when there are none. */
function CapturedTray({ pieces, color, testId }: { pieces: string[]; color: "w" | "b"; testId: string }) {
  if (pieces.length === 0) return null;
  const counts = TRAY_ORDER.map((type) => ({ type, n: pieces.filter((p) => p === type).length })).filter((c) => c.n > 0);
  const names: Record<string, string> = { q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
  const label = counts.map((c) => `${c.n} ${names[c.type]}${c.n > 1 ? "s" : ""}`).join(", ");
  return (
    <div
      data-testid={testId}
      aria-label={`Took ${label}`}
      className="flex min-w-0 items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-0.5 text-xl leading-none text-white"
    >
      {counts.map((c) => (
        <span key={c.type} aria-hidden="true" className="whitespace-nowrap">
          {PIECE_UNICODE[`${color}${c.type.toUpperCase()}`]}
          {c.n > 1 && <span className="text-sm font-bold">×{c.n}</span>}
        </span>
      ))}
    </div>
  );
}

const ACTION = "btn h-11 min-h-11 gap-1.5 border-0 px-3 text-base font-bold normal-case shadow-md";

export function ChessGame() {
  const store = useChessStore();
  const touch = useCoarsePointer();
  const held = useShellHold();
  const box = usePlayBox({ fit: true });
  const layout = chessLayout(box);

  // Chess plays from mount, so there is no store-level "before" state. This
  // per-mount gate gives the player a real start moment: the shared overlay
  // covers the board until Play is pressed, and the pickers are on it.
  const [hasStarted, setHasStarted] = useState(false);
  // Give up asks for a second tap, so a stray finger never ends a game.
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "chess",
    localStorageKey: "hank-chess-state",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  const over = store.status !== "playing";
  useSemanticClips(store, paintChess, { phase: !hasStarted || over ? "idle" : held || store.paused ? "hold" : "playing", runId: store.clipRunId, score: store.progress.currentWinStreak, best: store.progress.bestWinStreak });
  // Force save immediately on game end
  useEffect(() => {
    if (over) forceSync();
  }, [over, forceSync]);

  // The computer's turn: it moves after a short wait, never while the start
  // card, the pause menu, a shell overlay or a promotion choice is up. The
  // timer belongs to this position, so a new game or an undo cancels it.
  const computerTurn = store.isComputerTurn();
  useEffect(() => {
    if (!hasStarted || !computerTurn || store.paused || held) return;
    const timer = setTimeout(() => useChessStore.getState().aiMove(), AI_CONFIG.MOVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasStarted, computerTurn, store.paused, held, store.fen]);

  useEffect(() => {
    if (!confirmGiveUp) return;
    const timer = setTimeout(() => setConfirmGiveUp(false), GIVE_UP_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmGiveUp]);

  const canAct = hasStarted && !over && !computerTurn && !store.paused && !held;

  // N plays again once the game is over (a mouse and keyboard player).
  useEffect(() => {
    if (!hasStarted) return;
    const onKey = (event: KeyboardEvent) => {
      if (keyBelongsToTarget(event)) return;
      if ((event.key === "n" || event.key === "N") && useChessStore.getState().status !== "playing") {
        event.preventDefault();
        useChessStore.getState().newGame();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasStarted]);

  // Highlights: the picked piece, where it can go, the last move, a king in check.
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (store.lastMove) {
      styles[store.lastMove.from] = { backgroundColor: COLORS.LAST_MOVE };
      styles[store.lastMove.to] = { backgroundColor: COLORS.LAST_MOVE };
    }
    if (store.selectedSquare) styles[store.selectedSquare] = { backgroundColor: COLORS.SELECTED };
    // Where the picked piece can go: a dot on an empty square, a ring
    // around a piece it can take (a dot hid under that piece).
    for (const square of store.legalMoves) {
      const takes = !!store.game.get(square);
      styles[square] = {
        ...styles[square],
        background: takes
          ? `radial-gradient(circle closest-side, transparent 80%, ${COLORS.VALID_MOVE} 82%, ${COLORS.VALID_MOVE} 96%, transparent 98%)`
          : `radial-gradient(circle closest-side, ${COLORS.VALID_MOVE} 36%, transparent 38%)`,
      };
    }
    if (store.kingInCheck) styles[store.kingInCheck] = { ...styles[store.kingInCheck], backgroundColor: COLORS.CHECK };
    return styles;
  }, [store.selectedSquare, store.legalMoves, store.lastMove, store.kingInCheck, store.game]);

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }): boolean => {
      if (!targetSquare) return false;
      return useChessStore.getState().makeMove(sourceSquare as Square, targetSquare as Square);
    },
    []
  );
  const onSquareClick = useCallback(({ square }: { square: string }) => {
    useChessStore.getState().selectSquare(square as Square);
  }, []);

  const boardOrientation: Side = store.gameMode === "ai" ? store.playerColor : "white";
  const chessboardOptions = useMemo(
    () => ({
      id: "hank-chess",
      position: store.fen,
      boardOrientation,
      squareStyles,
      boardStyle: { borderRadius: "6px", boxShadow: "0 4px 12px rgba(0,0,0,0.45)" },
      darkSquareStyle: { backgroundColor: COLORS.DARK_SQUARE },
      lightSquareStyle: { backgroundColor: COLORS.LIGHT_SQUARE },
      // A finger taps a piece, then its square. Dragging is for a mouse:
      // on a phone a drag that began on a piece moved it when the kid only
      // meant to scroll (phone UX audit 2026-09-29).
      allowDragging: !touch && canAct,
      onPieceDrop,
      onSquareClick,
    }),
    [store.fen, boardOrientation, squareStyles, touch, canAct, onPieceDrop, onSquareClick]
  );

  // ---- the words around the board

  const turn = store.game.turn();
  const check = store.game.isCheck();
  const statusWords = over
    ? "Game over"
    : computerTurn
      ? "🤖 Thinking…"
      : store.gameMode === "ai"
        ? check
          ? "Check! Save your king"
          : "Your turn"
        : `${turn === "w" ? "⚪ White" : "⚫ Black"}'s turn${check ? ": check!" : ""}`;

  // The top of the board is the other side. The pieces a side took are the
  // other side's colour: `capturedPieces.white` are black pieces.
  const topSide: Side = boardOrientation === "white" ? "black" : "white";
  const bottomSide: Side = boardOrientation;
  const tray = (side: Side, testId: string) => (
    <CapturedTray pieces={store.capturedPieces[side]} color={side === "white" ? "b" : "w"} testId={testId} />
  );

  const status = (
    <p data-testid="chess-status" aria-live="polite" className="min-w-0 flex-1 truncate text-base font-bold text-white">
      {statusWords}
    </p>
  );

  const historyLength = store.game.history().length;
  const canUndo = canAct && (store.gameMode === "ai" ? historyLength >= 2 : historyLength >= 1);
  const actions = (
    <>
      <button
        type="button"
        onClick={() => store.undoMove()}
        disabled={!canUndo}
        className={`${ACTION} bg-amber-500 text-amber-950 disabled:bg-emerald-900 disabled:text-emerald-300`}
      >
        <span aria-hidden="true">↩️</span> Undo
      </button>
      <button
        type="button"
        data-testid="chess-give-up"
        onClick={() => {
          if (confirmGiveUp) {
            setConfirmGiveUp(false);
            store.resign();
          } else setConfirmGiveUp(true);
        }}
        disabled={!canAct}
        className={`${ACTION} ${confirmGiveUp ? "bg-red-600 text-white" : "bg-emerald-950 text-emerald-100"} disabled:bg-emerald-900 disabled:text-emerald-300`}
      >
        <span aria-hidden="true">🏳️</span> {confirmGiveUp ? "Sure? Tap again" : "Give up"}
      </button>
    </>
  );

  const outcome = chessOutcome(store.status, turn, store.gameMode, store.playerColor);

  const board = (
    <div
      data-testid="chess-board"
      data-game-board=""
      className="shrink-0 touch-manipulation select-none"
      style={{ width: layout.board, height: layout.board }}
    >
      <Chessboard options={chessboardOptions} />
    </div>
  );

  return (
    <div
      data-testid="chess-root"
      data-layout={layout.sideways ? "sideways" : "upright"}
      className={`relative flex h-full w-full select-none items-center justify-center bg-emerald-900 ${
        layout.sideways ? "flex-row" : "flex-col"
      }`}
      style={{ padding: EDGE, gap: GAP }}
    >
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Shared start screen. It covers the page (it portals to
          document.body): who to play, how hard and which side are picked
          here, so the play screen is the board and two buttons. */}
      {!hasStarted && (
        <GameStartOverlay
          title="Chess"
          emoji="♟️"
          subtitle="Catch the other king!"
          touchHints={["👆 Tap a piece, then tap where it goes", "🟢 The dots show where it can go", "👑 Trap the king to win"]}
          keyboardHints={[
            "🖱️ Click a piece, then click where it goes",
            "✋ Or drag a piece to its new square",
            "👑 Trap the king to win",
          ]}
          spokenChoices="Pick who you play: the computer, or 2 players on one phone. Against the computer, pick how hard, and pick white or black."
          onStart={() => setHasStarted(true)}
        >
          {store.progress.gamesWon > 0 && (
            <div className="text-base font-medium opacity-90">
              🏆 Wins: {store.progress.gamesWon} · 🔥 Best streak: {store.progress.bestWinStreak}
            </div>
          )}
          <div className="text-sm font-bold opacity-80">Who do you play?</div>
          <div data-testid="mode-picker" className="grid grid-cols-2 gap-2">
            <GameStartOverlayButton
              onClick={() => store.setGameMode("ai")}
              aria-pressed={store.gameMode === "ai"}
              className={store.gameMode === "ai" ? "btn-primary" : ""}
            >
              🤖 Computer
            </GameStartOverlayButton>
            <GameStartOverlayButton
              onClick={() => store.setGameMode("local")}
              aria-pressed={store.gameMode === "local"}
              className={store.gameMode === "local" ? "btn-primary" : ""}
            >
              👫 2 players
            </GameStartOverlayButton>
          </div>
          {store.gameMode === "ai" && (
            <>
              <div className="text-sm font-bold opacity-80">How hard?</div>
              <div data-testid="difficulty-picker" className="grid grid-cols-3 gap-2">
                {DIFFICULTIES.map((d) => (
                  <GameStartOverlayButton
                    key={d}
                    onClick={() => store.setDifficulty(d)}
                    aria-pressed={store.difficulty === d}
                    className={store.difficulty === d ? "btn-primary" : ""}
                  >
                    {DIFFICULTY_LABELS[d]}
                  </GameStartOverlayButton>
                ))}
              </div>
              <div className="text-sm font-bold opacity-80">Your pieces</div>
              <div data-testid="side-picker" className="grid grid-cols-2 gap-2">
                {(["white", "black"] as Side[]).map((side) => (
                  <GameStartOverlayButton
                    key={side}
                    onClick={() => store.setPlayerColor(side)}
                    aria-pressed={store.playerColor === side}
                    className={store.playerColor === side ? "btn-primary" : ""}
                  >
                    {side === "white" ? "⚪ White" : "⚫ Black"}
                  </GameStartOverlayButton>
                ))}
              </div>
            </>
          )}
        </GameStartOverlay>
      )}

      {/* Everything under the start card. `inert` while the card is up so Tab
          cannot reach the game's own controls before Play, and a stray tap
          through the overlay cannot move a piece. `contents` keeps the flex
          layout exactly as it is. */}
      <div className="contents" inert={!hasStarted || undefined}>
        {layout.sideways ? (
          <>
            {board}
            <div className="flex shrink-0 flex-col justify-center gap-3" style={{ width: SIDE_COLUMN }}>
              <div className="flex min-h-7">{tray(topSide, "chess-captured-top")}</div>
              <div className="flex">{status}</div>
              <div className="flex min-h-7">{tray(bottomSide, "chess-captured-bottom")}</div>
              {!over && (
                <div data-testid="chess-actions" className="grid grid-cols-1 gap-2">
                  {actions}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2" style={{ width: layout.board, height: TOP_ROW }}>
              {status}
              {tray(topSide, "chess-captured-top")}
            </div>
            {board}
            <div className="flex shrink-0 items-center gap-2" style={{ width: layout.board, height: BOTTOM_ROW }}>
              <div className="flex min-w-0 flex-1">{tray(bottomSide, "chess-captured-bottom")}</div>
              {!over && (
                <div data-testid="chess-actions" className="flex shrink-0 gap-2">
                  {actions}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Promotion: which piece the pawn becomes. */}
      {store.showPromotion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div role="dialog" aria-label="Choose a piece" className="rounded-xl bg-gray-800 p-4">
            <h3 className="mb-3 text-center text-xl font-bold text-white">Your pawn becomes…</h3>
            <div className="flex gap-3">
              {["q", "r", "b", "n"].map((piece) => (
                <button
                  key={piece}
                  type="button"
                  onClick={() => store.handlePromotion(piece)}
                  aria-label={{ q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }[piece]}
                  className="flex h-16 w-16 items-center justify-center rounded-lg bg-white text-4xl text-gray-900"
                >
                  {PIECE_UNICODE[`${store.game.turn()}${piece.toUpperCase()}`]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => store.cancelPromotion()}
              className="btn mt-3 h-11 min-h-11 w-full border-0 bg-gray-600 text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {outcome && (
        <ResultCard testId="chess-result-card" title={OUTCOME_TITLES[outcome]}>
          {outcome === "won" && store.progress.currentWinStreak > 1 && (
            <ResultLine big>🔥 {store.progress.currentWinStreak} wins in a row</ResultLine>
          )}
          {outcome === "lost" && <ResultLine>Good try! Want another go?</ResultLine>}
          {outcome === "draw" && <ResultLine>Nobody can win from here</ResultLine>}
        </ResultCard>
      )}

      {/* The result chip: read it to me, Play again (a new game at once, same
          choices), the leaderboard. */}
      {outcome && (
        <ResultChip
          resultText={resultText(outcome, store.progress.currentWinStreak)}
          appId="chess"
          onRestart={() => useChessStore.getState().newGame()}
          keyboardHint="N"
        />
      )}

      {/* Sync status indicator */}
      {isAuthenticated && (
        <div className="pointer-events-none fixed bottom-2 right-2 text-xs text-emerald-300/60">
          {syncStatus === "syncing" ? "Saving..." : syncStatus === "synced" ? "Saved" : ""}
        </div>
      )}
    </div>
  );
}

export default ChessGame;
