"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useQuoridorStore } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay, GameStartOverlayButton } from "@/shared/components/GameStartOverlay";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import {
  type Difficulty,
  type GameMode,
  type Player,
  type Position,
  type Wall,
  BOARD_SIZE,
  COLORS,
  PLAYER1_GOAL_ROW,
  PLAYER2_GOAL_ROW,
  wallsEqual,
} from "./lib/constants";
import { getValidMoves, isValidWallPlacement, wallsOverlap } from "./lib/quoridorLogic";
import {
  type BoardGeometry,
  type Crossing,
  CONTROL_ROW,
  EDGE,
  GAP,
  HUD_ROW,
  SIDE_COLUMN,
  crossingOf,
  nearestCrossing,
  nearestMove,
  quoridorLayout,
  squareCentre,
  squareOrigin,
  stepCrossing,
  wallAt,
  wallRect,
} from "./lib/layout";

/** How long the computer waits before it moves, so a kid sees each move. */
export const AI_DELAY_MS = 700;

/** The smallest tap target (a green dot's hit box). */
const MIN_TARGET = 44;

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

/** Words for the players: "You" and "Computer" against the computer, colours on one phone. */
export function playerName(player: Player, mode: GameMode): string {
  if (mode === "ai") return player === 1 ? "You" : "Computer";
  return player === 1 ? "Blue" : "Orange";
}

/** Why a wall cannot go where it is, in kid words. */
export function wallProblem(walls: Wall[], wall: Wall): string {
  return walls.some((w) => wallsOverlap(w, wall)) ? "Walls can't cross" : "Leave a way through!";
}

/** The result, read out loud first by the result chip. */
export function resultText({
  winner,
  mode,
  moves,
  streak,
}: {
  winner: Player;
  mode: GameMode;
  moves: number;
  streak: number;
}): string {
  if (mode === "local") return `${playerName(winner, mode)} wins! ${playerName(winner, mode)} got to the other side first.`;
  if (winner === 2) return "The computer won. Good try!";
  const moveWords = moves === 1 ? "1 move" : `${moves} moves`;
  const streakWords = streak > 1 ? ` That is ${streak} wins in a row.` : "";
  return `You won! You got there in ${moveWords}.${streakWords}`;
}

/** "Move up", "Jump left", "Move up and left": the words of a green dot. */
function moveLabel(from: Position, to: Position): string {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const vertical = dr > 0 ? "up" : dr < 0 ? "down" : "";
  const horizontal = dc > 0 ? "right" : dc < 0 ? "left" : "";
  const jump = Math.abs(dr) === 2 || Math.abs(dc) === 2;
  const where = [vertical, horizontal].filter(Boolean).join(" and ");
  return `${jump ? "Jump" : "Move"} ${where}`;
}

/** Wall mode, with a first wall already on the board to drag. */
function startWallMode(): void {
  const state = useQuoridorStore.getState();
  state.enterWallMode(firstWall(state));
}

/**
 * The wall shown when the player taps Wall: in front of the other pawn,
 * across its way to its goal (the wall a kid usually wants), else the
 * nearest valid wall to the middle of the board.
 */
function firstWall(state: ReturnType<typeof useQuoridorStore.getState>): Wall | null {
  const logic = state.getLogicState();
  const player = state.currentPlayer;
  const other = state.positions[player === 1 ? 2 : 1];
  // Player 2 walks down (to row 0), Player 1 up (to row 8).
  const row = player === 1 ? other.row : other.row + 1;
  const candidates: Wall[] = [
    { row, col: Math.min(other.col, BOARD_SIZE - 2), orientation: "horizontal" },
    { row, col: Math.max(other.col - 1, 0), orientation: "horizontal" },
  ];
  for (const wall of candidates) {
    if (isValidWallPlacement(logic, wall, player)) return wall;
  }
  let best: Wall | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < BOARD_SIZE - 1; i++) {
    for (let j = 0; j < BOARD_SIZE - 1; j++) {
      const wall = wallAt({ i, j }, state.wallOrientation);
      const d = Math.hypot(i - 3.5, j - 3.5);
      if (d < bestDistance && isValidWallPlacement(logic, wall, player)) {
        best = wall;
        bestDistance = d;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- the board

function Board({
  geometry,
  size,
  interactive,
  onWallPoint,
  onWallHover,
  onMoveTap,
}: {
  geometry: BoardGeometry;
  size: number;
  interactive: boolean;
  /** A finger or a click at (x, y) in wall mode. `commit` is true for a mouse click. */
  onWallPoint: (x: number, y: number, commit: boolean) => void;
  onWallHover: (x: number, y: number) => void;
  onMoveTap: (x: number, y: number, fallback?: Position) => void;
}) {
  const positions = useQuoridorStore((s) => s.positions);
  const walls = useQuoridorStore((s) => s.walls);
  const wallMode = useQuoridorStore((s) => s.wallMode);
  const wallPreview = useQuoridorStore((s) => s.wallPreview);
  const wallsRemaining = useQuoridorStore((s) => s.wallsRemaining);
  const currentPlayer = useQuoridorStore((s) => s.currentPlayer);
  const lastMove = useQuoridorStore((s) => s.lastMove);
  const showDots = interactive && !wallMode;
  const moves = useMemo(
    () => (showDots ? getValidMoves({ positions, walls, wallsRemaining }, currentPlayer) : NO_MOVES),
    [showDots, positions, walls, wallsRemaining, currentPlayer]
  );
  const boardRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  // A press that began in wall mode: its click is not a move, even when the
  // press placed the wall (a mouse click) and the mode is over by then.
  const wallPress = useRef(false);

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = boardRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !wallMode) return;
    wallPress.current = true;
    const { x, y } = local(event);
    if (event.pointerType === "mouse") {
      onWallPoint(x, y, true);
      return;
    }
    // A finger drags the wall: it follows until the finger lifts, and
    // stays there until Place (a wall is never placed by the touch itself).
    dragging.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onWallPoint(x, y, false);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !wallMode) return;
    const { x, y } = local(event);
    if (event.pointerType === "mouse" && event.buttons === 0) onWallHover(x, y);
    else if (dragging.current === event.pointerId) onWallPoint(x, y, false);
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current === event.pointerId) dragging.current = null;
  };
  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (wallPress.current) {
      wallPress.current = false;
      return;
    }
    if (!interactive || wallMode) return;
    const { x, y } = local(event);
    onMoveTap(x, y);
  };

  const previewValid = wallPreview
    ? isValidWallPlacement({ positions, walls, wallsRemaining }, wallPreview, currentPlayer)
    : false;
  const target = Math.max(MIN_TARGET, geometry.square);
  const place = (v: number) => Math.min(size - target, Math.max(0, v - target / 2));

  const squares: React.ReactNode[] = [];
  for (let row = BOARD_SIZE - 1; row >= 0; row--) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const o = squareOrigin({ row, col }, geometry);
      const goal = row === PLAYER1_GOAL_ROW ? COLORS.GOAL_P1 : row === PLAYER2_GOAL_ROW ? COLORS.GOAL_P2 : COLORS.BOARD_LIGHT;
      squares.push(
        <div
          key={`sq-${row}-${col}`}
          className="absolute rounded-[3px]"
          style={{
            left: o.x,
            top: o.y,
            width: geometry.square,
            height: geometry.square,
            backgroundColor: goal,
            boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.12)",
          }}
        />
      );
    }
  }

  const pawn = (player: Player) => {
    const c = squareCentre(positions[player], geometry);
    const d = Math.round(geometry.square * 0.72);
    const light = player === 1 ? COLORS.PLAYER1_LIGHT : COLORS.PLAYER2_LIGHT;
    const dark = player === 1 ? COLORS.PLAYER1 : COLORS.PLAYER2;
    return (
      <div
        key={`pawn-${player}`}
        data-testid={`quoridor-pawn-${player}`}
        className="pointer-events-none absolute rounded-full transition-[left,top] duration-200 ease-out"
        style={{
          left: c.x - d / 2,
          top: c.y - d / 2,
          width: d,
          height: d,
          background: `radial-gradient(circle at 32% 30%, ${light}, ${dark})`,
          boxShadow: "0 2px 4px rgba(0,0,0,0.45)",
          outline: currentPlayer === player && interactive ? "3px solid #fde68a" : undefined,
          outlineOffset: 1,
        }}
      />
    );
  };

  const wallBar = (wall: Wall, key: string, style: React.CSSProperties, testId?: string) => {
    const r = wallRect(wall, geometry);
    return (
      <div
        key={key}
        data-testid={testId}
        className="pointer-events-none absolute rounded-[3px]"
        style={{ left: r.x, top: r.y, width: r.width, height: r.height, ...style }}
      />
    );
  };

  const lastWall = lastMove?.kind === "wall" ? lastMove.wall : null;

  return (
    <div
      ref={boardRef}
      data-testid="quoridor-board"
      data-mode={wallMode ? "wall" : "move"}
      aria-label="Quoridor board"
      role="group"
      className="relative shrink-0 touch-none select-none rounded-md"
      style={{
        width: size,
        height: size,
        backgroundColor: COLORS.GROOVE,
        outline: "4px solid #5b3a24",
        cursor: interactive && wallMode ? "crosshair" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={onClick}
    >
      {squares}

      {/* Where the last pawn move came from: a faint ring, so a kid sees what the computer did. */}
      {lastMove?.kind === "move" && (() => {
        const c = squareCentre(lastMove.from, geometry);
        const d = Math.round(geometry.square * 0.6);
        return (
          <div
            data-testid="quoridor-last-from"
            className="pointer-events-none absolute rounded-full border-2 border-dashed"
            style={{
              left: c.x - d / 2,
              top: c.y - d / 2,
              width: d,
              height: d,
              borderColor: lastMove.player === 1 ? COLORS.PLAYER1 : COLORS.PLAYER2,
              opacity: 0.7,
            }}
          />
        );
      })()}

      {walls.map((wall) =>
        wallBar(wall, `wall-${wall.orientation}-${wall.row}-${wall.col}`, {
          backgroundColor: COLORS.WALL,
          boxShadow:
            lastWall && wallsEqual(lastWall, wall)
              ? "0 0 0 2px #fde68a, 0 1px 3px rgba(0,0,0,0.5)"
              : "0 1px 3px rgba(0,0,0,0.5)",
          zIndex: 2,
        })
      )}

      {wallMode &&
        wallPreview &&
        wallBar(
          wallPreview,
          "preview",
          previewValid
            ? { backgroundColor: COLORS.WALL_PREVIEW, outline: "2px solid #fff", zIndex: 3 }
            : { backgroundColor: COLORS.WALL_INVALID, outline: "2px dashed #fecaca", zIndex: 3 },
          "quoridor-wall-preview"
        )}

      {pawn(1)}
      {pawn(2)}

      {/* The green dots: a real button each (Tab and a screen reader reach
          them), 44 px or more even when a square is smaller. A tap goes to
          the NEAREST dot, so two hit boxes that overlap never pick the wrong one. */}
      {moves.map((move) => {
        const c = squareCentre(move, geometry);
        const dot = Math.max(10, Math.round(geometry.square * 0.42));
        return (
          <button
            key={`move-${move.row}-${move.col}`}
            type="button"
            data-testid={`quoridor-move-${move.row}-${move.col}`}
            aria-label={moveLabel(positions[currentPlayer], move)}
            className="absolute z-[4] flex items-center justify-center rounded-full"
            style={{ left: place(c.x), top: place(c.y), width: target, height: target }}
            onClick={(event) => {
              event.stopPropagation();
              if (event.detail === 0) onMoveTap(c.x, c.y, move);
              else {
                const { x, y } = local(event);
                onMoveTap(x, y, move);
              }
            }}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none animate-pulse rounded-full"
              style={{
                width: dot,
                height: dot,
                backgroundColor: COLORS.VALID_MOVE,
                boxShadow: "0 0 0 2px rgba(255,255,255,0.8)",
                // Centre the dot on the square even when the hit box is clamped at an edge.
                transform: `translate(${c.x - (place(c.x) + target / 2)}px, ${c.y - (place(c.y) + target / 2)}px)`,
              }}
            />
          </button>
        );
      })}

    </div>
  );
}

const NO_MOVES: Position[] = [];

// ---------------------------------------------------------------- the turn strip

function WallCount({ player, column }: { player: Player; column: boolean }) {
  const count = useQuoridorStore((s) => s.wallsRemaining[player]);
  const active = useQuoridorStore((s) => s.currentPlayer === player && s.status === "playing");
  const mode = useQuoridorStore((s) => s.gameMode);
  const name = playerName(player, mode);
  const words = `${count} ${count === 1 ? "wall" : "walls"}`;
  return (
    <div
      data-testid={`quoridor-walls-${player}`}
      aria-label={`${name}: ${words} left`}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold ${
        active ? "bg-amber-50 text-amber-950" : "bg-black/30 text-amber-100"
      }`}
    >
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 rounded-full"
        style={{ backgroundColor: player === 1 ? COLORS.PLAYER1 : COLORS.PLAYER2 }}
      />
      {column && <span>{name} ·</span>}
      <span aria-hidden="true">🧱 {words}</span>
    </div>
  );
}

function statusWords({
  touch,
}: {
  touch: boolean;
}): (s: ReturnType<typeof useQuoridorStore.getState>) => string {
  return (s) => {
    if (s.status !== "playing") return "Game over";
    if (s.isComputerTurn()) return "🤖 Thinking…";
    if (s.wallMode) {
      if (s.wallPreview && !isValidWallPlacement(s.getLogicState(), s.wallPreview, s.currentPlayer)) {
        return `🚫 ${wallProblem(s.walls, s.wallPreview)}`;
      }
      return touch ? "Drag the wall, then tap Place" : "Click a gap to put a wall";
    }
    return s.gameMode === "ai" ? "Your turn!" : `${playerName(s.currentPlayer, s.gameMode)}'s turn`;
  };
}

function TurnStrip({ column, width }: { column: boolean; width?: number }) {
  const touch = useCoarsePointer();
  const words = useQuoridorStore(statusWords({ touch }));
  const text = (
    <p
      data-testid="quoridor-status"
      aria-live="polite"
      className="min-w-0 flex-1 text-center text-base font-bold leading-tight text-amber-50"
    >
      {words}
    </p>
  );
  if (column) {
    // The computer's pawn starts at the top, so its count is on top.
    return (
      <div data-testid="quoridor-turn" className="flex flex-col items-stretch gap-2">
        <WallCount player={2} column />
        {text}
        <WallCount player={1} column />
      </div>
    );
  }
  return (
    <div data-testid="quoridor-turn" className="flex shrink-0 items-center gap-2" style={{ width, height: HUD_ROW }}>
      <WallCount player={1} column={false} />
      {text}
      <WallCount player={2} column={false} />
    </div>
  );
}

// ---------------------------------------------------------------- the controls

const CONTROL = "btn min-h-11 h-11 flex-1 gap-1.5 border-0 px-2 text-base font-bold normal-case shadow-md";

function Controls({
  column,
  width,
  enabled,
  onWall,
}: {
  column: boolean;
  width?: number;
  enabled: boolean;
  onWall: () => void;
}) {
  const wallMode = useQuoridorStore((s) => s.wallMode);
  const exitWallMode = useQuoridorStore((s) => s.exitWallMode);
  const toggleWallOrientation = useQuoridorStore((s) => s.toggleWallOrientation);
  const placeWall = useQuoridorStore((s) => s.placeWall);
  const orientation = useQuoridorStore((s) => s.wallOrientation);
  const wallsLeft = useQuoridorStore((s) => s.wallsRemaining[s.currentPlayer]);
  const canPlace = useQuoridorStore(
    (s) => !!s.wallPreview && isValidWallPlacement(s.getLogicState(), s.wallPreview, s.currentPlayer)
  );
  const segment = (on: boolean) => (on ? "bg-amber-300 text-amber-950" : "bg-amber-800 text-amber-50");

  return (
    <div
      data-testid="quoridor-controls"
      className={column ? "grid grid-cols-2 gap-2" : "flex shrink-0 items-center gap-2"}
      style={column ? undefined : { width, height: CONTROL_ROW }}
    >
      <button
        type="button"
        aria-pressed={!wallMode}
        disabled={!enabled}
        onClick={exitWallMode}
        className={`${CONTROL} ${segment(!wallMode)}`}
      >
        <span aria-hidden="true">🚶</span> Move
      </button>
      <button
        type="button"
        aria-pressed={wallMode}
        disabled={!enabled || wallsLeft <= 0}
        onClick={() => (wallMode ? undefined : onWall())}
        className={`${CONTROL} ${segment(wallMode)}`}
      >
        <span aria-hidden="true">🧱</span> Wall
      </button>
      {wallMode && (
        <>
          <button
            type="button"
            disabled={!enabled}
            onClick={toggleWallOrientation}
            aria-label={orientation === "horizontal" ? "Turn the wall up and down" : "Turn the wall side to side"}
            className={`${CONTROL} bg-amber-700 text-amber-50`}
          >
            <span aria-hidden="true">🔄</span> Turn
          </button>
          <button
            type="button"
            data-testid="quoridor-place"
            disabled={!enabled || !canPlace}
            onClick={() => placeWall()}
            className={`${CONTROL} bg-green-600 text-white disabled:bg-green-900 disabled:text-green-200`}
          >
            <span aria-hidden="true">✅</span> Place
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the game

export function QuoridorGame() {
  const store = useQuoridorStore();
  // Quoridor plays from mount, so there is no store-level "before" state. This
  // per-mount gate gives the player a real start moment: the shared overlay
  // covers the board until Play is pressed, and the pickers (who to play,
  // how hard) are on it.
  const [hasStarted, setHasStarted] = useState(false);
  const held = useShellHold();
  const box = usePlayBox({ fit: true });
  const layout = quoridorLayout(box);
  const geometry: BoardGeometry = { square: layout.square, groove: layout.groove };

  // The first-run "How to Play" modal is gone, but players who saw it still
  // carry its flag. Clear the orphan so no stale key is left behind.
  // localStorage throws in private browsing, and a leftover key is not worth
  // breaking the game over.
  useEffect(() => {
    try {
      localStorage.removeItem("quoridor-onboarding-seen");
    } catch {
      // Storage is unavailable; nothing to clean up.
    }
  }, []);

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "quoridor",
    localStorageKey: "quoridor-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  const over = store.status !== "playing";
  // Force save immediately on game end
  useEffect(() => {
    if (over) forceSync();
  }, [over, forceSync]);

  // The computer's turn: it moves after a short wait, and never while the
  // pause menu, a shell overlay or the start card is up. The timer belongs
  // to this turn only, so a restart or a new game cancels it.
  const computerTurn = store.isComputerTurn();
  useEffect(() => {
    if (!hasStarted || !computerTurn || store.paused || held) return;
    const timer = setTimeout(() => useQuoridorStore.getState().aiMove(), AI_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasStarted, computerTurn, store.paused, held, store.positions, store.walls]);

  const interactive = hasStarted && !over && !computerTurn && !store.paused && !held;

  // ---- input

  const wallFor = (x: number, y: number): Wall =>
    wallAt(nearestCrossing(x, y, geometry), useQuoridorStore.getState().wallOrientation);

  const onWallPoint = (x: number, y: number, commit: boolean) => {
    const state = useQuoridorStore.getState();
    const wall = wallFor(x, y);
    state.setWallPreview(wall);
    if (commit) state.placeWall(wall);
  };
  const onWallHover = (x: number, y: number) => useQuoridorStore.getState().setWallPreview(wallFor(x, y));

  const onMoveTap = (x: number, y: number, fallback?: Position) => {
    const state = useQuoridorStore.getState();
    const target = nearestMove(x, y, state.humanMoves(), geometry) ?? fallback;
    if (target) state.movePawn(target);
  };

  const playAgain = () => useQuoridorStore.getState().newGame();

  // Keys (a mouse and keyboard player): the arrows walk the pawn or the
  // wall, R or Space turns the wall, Enter places it, Escape goes back to
  // moving, and N plays again once the game is over.
  useEffect(() => {
    if (!hasStarted) return;
    const onKey = (event: KeyboardEvent) => {
      if (keyBelongsToTarget(event)) return;
      const state = useQuoridorStore.getState();
      if (state.status !== "playing") {
        if (event.key === "n" || event.key === "N") {
          event.preventDefault();
          state.newGame();
        }
        return;
      }
      if (state.isComputerTurn() || state.paused) return;
      const arrows: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const step = arrows[event.key];
      if (state.wallMode) {
        if (step) {
          event.preventDefault();
          const from: Crossing = state.wallPreview ? crossingOf(state.wallPreview) : { i: 3, j: 3 };
          state.setWallPreview(wallAt(stepCrossing(from, step[0], step[1]), state.wallOrientation));
        } else if (event.key === "r" || event.key === "R" || event.key === " ") {
          event.preventDefault();
          state.toggleWallOrientation();
        } else if (event.key === "Enter") {
          event.preventDefault();
          state.placeWall();
        } else if (event.key === "Escape") {
          state.exitWallMode();
        }
        return;
      }
      if (step) {
        event.preventDefault();
        // Screen up is a higher row.
        const [dx, dy] = step;
        const here = state.positions[state.currentPlayer];
        const move = state
          .humanMoves()
          .filter((m) => Math.sign(m.col - here.col) === dx && Math.sign(m.row - here.row) === -dy)
          .sort((a, b) => Math.abs(a.row - here.row) + Math.abs(a.col - here.col) - (Math.abs(b.row - here.row) + Math.abs(b.col - here.col)))[0];
        if (move) state.movePawn(move);
      } else if (event.key === "w" || event.key === "W") {
        startWallMode();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasStarted]);

  // ---- result

  const winner: Player | null = store.status === "player1-wins" ? 1 : store.status === "player2-wins" ? 2 : null;
  const resultTitle =
    winner === null
      ? ""
      : store.gameMode === "local"
        ? `${winner === 1 ? "🔵" : "🟠"} ${playerName(winner, "local")} wins!`
        : winner === 1
          ? "🎉 You won!"
          : "🤖 The computer won";

  const board = (
    <Board
      geometry={geometry}
      size={layout.board}
      interactive={interactive}
      onWallPoint={onWallPoint}
      onWallHover={onWallHover}
      onMoveTap={onMoveTap}
    />
  );

  return (
    <div
      data-testid="quoridor-root"
      data-layout={layout.sideways ? "sideways" : "upright"}
      className={`relative flex h-full w-full select-none items-center justify-center bg-amber-950 ${
        layout.sideways ? "flex-row" : "flex-col"
      }`}
      style={{ padding: EDGE, gap: GAP }}
    >
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Shared start screen. It covers the page (it portals to
          document.body): who to play and how hard are picked here, so the
          play screen is the board and its two controls. */}
      {!hasStarted && (
        <GameStartOverlay
          title="Quoridor"
          emoji="🧱"
          subtitle="Race to the other side!"
          touchHints={[
            "👆 Tap a green dot to move",
            "🧱 Tap Wall, drag the wall, then tap Place",
            "🏁 Get to the far side first to win",
          ]}
          keyboardHints={[
            "🖱️ Click a green dot to move",
            "🧱 Click Wall, then click a gap to put a wall",
            "🏁 Get to the far side first to win",
          ]}
          spokenChoices="Pick who you play: the computer, or 2 players on one phone. Then pick how hard: easy, medium or hard."
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
              <TurnStrip column />
              {!over && <Controls column enabled={interactive} onWall={startWallMode} />}
            </div>
          </>
        ) : (
          <>
            <TurnStrip column={false} width={layout.board} />
            {board}
            {over ? (
              <div className="shrink-0" style={{ height: CONTROL_ROW }} />
            ) : (
              <Controls column={false} width={layout.board} enabled={interactive} onWall={startWallMode} />
            )}
          </>
        )}
      </div>

      {winner !== null && (
        <ResultCard testId="quoridor-result-card" title={resultTitle}>
          {store.gameMode === "ai" && winner === 1 && (
            <ResultLine big>
              {store.movesThisGame} {store.movesThisGame === 1 ? "move" : "moves"}
              {store.progress.currentWinStreak > 1 ? ` · 🔥 ${store.progress.currentWinStreak} in a row` : ""}
            </ResultLine>
          )}
          {store.gameMode === "ai" && winner === 2 && <ResultLine>Good try! Want another go?</ResultLine>}
          {store.gameMode === "local" && <ResultLine>First to the other side</ResultLine>}
        </ResultCard>
      )}

      {/* The result chip: read it to me, Play again (a new game at once, no
          question: the game is over), the leaderboard. */}
      {winner !== null && (
        <ResultChip
          resultText={resultText({
            winner,
            mode: store.gameMode,
            moves: store.movesThisGame,
            streak: store.progress.currentWinStreak,
          })}
          appId="quoridor"
          onRestart={playAgain}
          keyboardHint="N"
        />
      )}

      {/* Sync status indicator */}
      {isAuthenticated && (
        <div className="pointer-events-none fixed bottom-2 right-2 text-xs text-amber-300/60">
          {syncStatus === "syncing" ? "Saving..." : syncStatus === "synced" ? "Saved" : ""}
        </div>
      )}
    </div>
  );
}

export default QuoridorGame;
