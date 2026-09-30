"use client";

import { useEffect, useCallback, useRef } from "react";
import { useSnakeStore, type SnakeProgress } from "./lib/store";
import {
  type Direction,
  CELL_SIZE,
  COLORS,
  FOOD_EMOJI,
  getTickInterval,
} from "./lib/constants";
import { layoutSnake, BOARD_PX, type ControlKind } from "./lib/layout";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import {
  GameStartOverlay,
  GameStartOverlayButton,
} from "@/shared/components/GameStartOverlay";
import { ResultChip } from "@/shared/components/ResultChip";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { useGameLoop } from "@/shared/hooks/useGameLoop";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useTouchInput } from "@/shared/hooks/useTouchInput";
import { usePointerTap, useRestartGrace } from "@/shared/lib/input";

/** A swipe turns the snake once its finger has moved this far (CSS px). */
export const SWIPE_TURN_PX = 24;

/** The result in kid words, read aloud by the result chip. */
export function gameOverText(input: {
  score: number;
  length: number;
  best: number;
  newBest: boolean;
}): string {
  const points = input.score === 1 ? "1 point" : `${input.score} points`;
  const record = input.newBest ? "That is a new best!" : `Your best is ${input.best}.`;
  return `Game over! You got ${points}. Your snake was ${input.length} long. ${record}`;
}

// ============================================
// GAME BOARD COMPONENT
// ============================================
function GameBoard({ size }: { size: number }) {
  const { snake, food, foodType, status } = useSnakeStore();
  const scale = size / BOARD_PX;

  return (
    <div
      data-testid="snake-board"
      className="shrink-0"
      style={{ width: size, height: size }}
    >
      <div
        className="relative border-4 border-green-700 rounded-lg shadow-xl overflow-hidden"
        style={{
          width: BOARD_PX,
          height: BOARD_PX,
          backgroundColor: COLORS.GRID_BG,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {/* Grid lines */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, ${COLORS.GRID_LINE} 1px, transparent 1px),
              linear-gradient(to bottom, ${COLORS.GRID_LINE} 1px, transparent 1px)
            `,
            backgroundSize: `${CELL_SIZE}px ${CELL_SIZE}px`,
          }}
        />

        {/* Food */}
        <div
          className="absolute flex items-center justify-center transition-all duration-100"
          style={{
            left: food.x * CELL_SIZE,
            top: food.y * CELL_SIZE,
            width: CELL_SIZE,
            height: CELL_SIZE,
            fontSize: CELL_SIZE * 0.8,
          }}
        >
          <span className="animate-bounce">{FOOD_EMOJI[foodType]}</span>
        </div>

        {/* Snake */}
        {snake.map((segment, index) => {
          const isHead = index === 0;
          const isTail = index === snake.length - 1;

          return (
            <div
              key={`${segment.x}-${segment.y}-${index}`}
              className="absolute rounded-md transition-all duration-75"
              style={{
                left: segment.x * CELL_SIZE + 1,
                top: segment.y * CELL_SIZE + 1,
                width: CELL_SIZE - 2,
                height: CELL_SIZE - 2,
                backgroundColor: isHead
                  ? COLORS.SNAKE_HEAD
                  : index % 2 === 0
                  ? COLORS.SNAKE_BODY
                  : COLORS.SNAKE_BODY_ALT,
                borderRadius: isHead ? "6px" : isTail ? "4px" : "3px",
                boxShadow: isHead ? "0 2px 4px rgba(0,0,0,0.3)" : "none",
              }}
            >
              {/* Snake face on head */}
              {isHead && (
                <div className="w-full h-full flex items-center justify-center text-xs">
                  <span role="img" aria-label="snake face">
                    {status === "game-over" ? "😵" : "😊"}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {/* Game over: the picture under the result chip. The chip has the
            words and the buttons; this is the board's own mark. */}
        {status === "game-over" && (
          <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center">
            <div className="text-4xl font-bold text-white drop-shadow-lg">
              GAME OVER!
            </div>
          </div>
        )}

        {/* Paused Overlay */}
        {status === "paused" && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-4xl font-bold text-white drop-shadow-lg">
              PAUSED
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// D-PAD (touch, buttons mode)
// ============================================
const ARROWS: { dir: Direction; label: string; path: string }[] = [
  { dir: "up", label: "Move up", path: "M12 4l-8 8h5v8h6v-8h5z" },
  { dir: "left", label: "Move left", path: "M4 12l8-8v5h8v6h-8v5z" },
  { dir: "down", label: "Move down", path: "M12 20l8-8h-5V4H9v8H4z" },
  { dir: "right", label: "Move right", path: "M20 12l-8-8v5H4v6h8v5z" },
];

function PadKey({
  arrow,
  size,
  onTurn,
}: {
  arrow: (typeof ARROWS)[number];
  size: number;
  onTurn: (dir: Direction) => void;
}) {
  // One tap = one turn, on pointerdown (the fastest signal), never twice.
  const tap = usePointerTap<HTMLButtonElement>(() => onTurn(arrow.dir));
  return (
    <button
      type="button"
      {...tap}
      aria-label={arrow.label}
      className="bg-green-600 active:bg-green-700 text-white rounded-xl shadow-lg active:scale-95 flex items-center justify-center touch-manipulation select-none [-webkit-touch-callout:none]"
      style={{ width: size, height: size, gridArea: arrow.dir }}
    >
      <svg className="w-1/2 h-1/2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={arrow.path} />
      </svg>
    </button>
  );
}

/** The inverted T: up on top, then left, down, right. Three keys wide. */
function DirectionPad({ keySize, onTurn }: { keySize: number; onTurn: (dir: Direction) => void }) {
  return (
    <div
      data-testid="snake-dpad"
      className="grid shrink-0 gap-2"
      style={{
        gridTemplateAreas: '". up ." "left down right"',
        gridTemplateColumns: `repeat(3, ${keySize}px)`,
        gridTemplateRows: `repeat(2, ${keySize}px)`,
      }}
    >
      {ARROWS.map((arrow) => (
        <PadKey key={arrow.dir} arrow={arrow} size={keySize} onTurn={onTurn} />
      ))}
    </div>
  );
}

// ============================================
// HUD
// ============================================
function Hud({ column, syncNote }: { column: boolean; syncNote: string }) {
  const { score, snake, progress } = useSnakeStore();
  const pill = "rounded-lg px-3 py-2 text-base font-bold text-white whitespace-nowrap";
  return (
    <div
      data-testid="snake-hud"
      className={`flex shrink-0 gap-2 ${column ? "flex-col items-stretch" : "flex-row items-center justify-center flex-wrap"}`}
    >
      <div className={`${pill} bg-green-800`}>Score: {score}</div>
      <div className={`${pill} bg-green-800`}>Length: {snake.length}</div>
      <div className={`${pill} bg-amber-600`}>Best: {progress.highScore}</div>
      {syncNote && <div className="text-xs text-green-200/70 text-center">{syncNote}</div>}
    </div>
  );
}

// ============================================
// MAIN GAME COMPONENT
// ============================================
export function SnakeGame() {
  const store = useSnakeStore();
  const { status, progress, tick, setDirection } = store;
  const rootRef = useRef<HTMLDivElement>(null);
  const isCoarse = useCoarsePointer();

  // The board fits the play box on both axes, with room for the controls.
  const box = usePlayBox({ fit: true });
  const controls: ControlKind = !isCoarse
    ? "keyboard"
    : progress.controlMode === "swipe"
      ? "swipe"
      : "pad";
  const layout = layoutSnake(box, controls);
  const boardSize = layout.fit.width;

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "snake",
    localStorageKey: "snake-game-state",
    getState: () => store.getProgress(),
    setState: (data: SnakeProgress) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on game over
  useEffect(() => {
    if (status === "game-over") {
      forceSync();
    }
  }, [status, forceSync]);

  // A restart from the keyboard waits out the result grace, so a kid who
  // is still pressing keys at the crash sees the result first.
  const grace = useRestartGrace(undefined, status);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // The start card owns the ready state: keys must not act or block the
      // browser's own Space/Enter handling while it is up.
      if (status === "idle") return;
      // Prevent default for arrow keys to avoid scrolling
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault();
      }

      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          setDirection("up");
          break;
        case "ArrowDown":
        case "s":
        case "S":
          setDirection("down");
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          setDirection("left");
          break;
        case "ArrowRight":
        case "d":
        case "D":
          setDirection("right");
          break;
        case " ":
        case "r":
        case "R":
          // Pause is owned by the GameShell (ESC + pause button). Space and R
          // restart from the game-over screen only, after the result grace.
          if (status === "game-over" && grace.accept(e)) {
            store.startGame();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setDirection, status, store, grace]);

  // The game loop: one shared fixed-step loop, one step per snake move. It
  // is pause-aware and re-seeds its clock after a hidden tab, so no moves
  // pile up while the kid is away. The interval shortens as the snake grows.
  const stepMs = getTickInterval(progress.speed, store.snake.length);
  useGameLoop(
    { update: () => tick() },
    { running: status === "playing", fixedStepMs: stepMs }
  );

  const turn = useCallback(
    (dir: Direction) => {
      if (useSnakeStore.getState().status === "playing") setDirection(dir);
    },
    [setDirection]
  );

  // Swipes: on the whole game (the board and the room around it), in both
  // control modes, while a run plays. The turn happens on touchmove, as
  // soon as the finger has travelled SWIPE_TURN_PX, once per gesture. The
  // buttons over the surface keep their own taps (ignore). The play box is
  // fitted, so the swipe never scrolls the page.
  useTouchInput<"turned">(
    rootRef,
    {
      onMove: (touch) => {
        if (touch.tag === "turned") return;
        const dx = touch.x - touch.startX;
        const dy = touch.y - touch.startY;
        if (Math.abs(dx) < SWIPE_TURN_PX && Math.abs(dy) < SWIPE_TURN_PX) return;
        touch.tag = "turned";
        if (Math.abs(dx) > Math.abs(dy)) {
          turn(dx > 0 ? "right" : "left");
        } else {
          turn(dy > 0 ? "down" : "up");
        }
      },
    },
    { enabled: isCoarse && status === "playing", ignore: "button" }
  );

  const syncNote = isAuthenticated
    ? syncStatus === "syncing"
      ? "Saving..."
      : syncStatus === "synced"
        ? "Saved"
        : ""
    : "";

  // A finger gets the d-pad or the swipe hint; a keyboard gets its own line.
  const controlsNode = isCoarse ? (
    controls === "pad" ? (
      <DirectionPad keySize={layout.padKey} onTurn={turn} />
    ) : (
      <div
        data-testid="snake-swipe-hint"
        className="text-center text-green-200 text-base font-bold whitespace-nowrap"
      >
        👆 Swipe to turn
      </div>
    )
  ) : (
    <div className="text-green-300 text-sm text-center">
      Use WASD or Arrow Keys to move | ESC to pause | R to restart
    </div>
  );

  return (
    <div
      ref={rootRef}
      data-testid="snake-game"
      className={`relative h-full w-full bg-green-900 p-2 select-none [-webkit-touch-callout:none] flex items-center justify-center gap-2 ${
        layout.sideways ? "flex-row" : "flex-col"
      }`}
    >
      {/* Shared start screen. It covers the page (it portals to
          document.body), so the card and its pickers never clip against
          the board box. */}
      {status === "idle" && (
        <GameStartOverlay
          title="Snake"
          emoji="🐍"
          subtitle="Eat the snacks and grow long!"
          touchHints={[
            // The hint must match the mode the kid picked below.
            progress.controlMode === "swipe"
              ? "👆 Swipe on the board to turn"
              : "🔼 Tap the arrows, or swipe, to turn",
            "🍎 Eat the food to grow",
            "🚫 Do not bump into yourself",
          ]}
          keyboardHints={[
            "⌨️ Arrow keys or WASD to turn",
            "🍎 Eat the food to grow",
            "🚫 Do not bump into yourself",
          ]}
          spokenChoices={
            isCoarse
              ? "Pick how fast: Slow, Medium, or Fast. Then pick how to turn: Arrows, or Swipe."
              : "Pick how fast: Slow, Medium, or Fast."
          }
          onStart={() => store.startGame()}
        >
          <div className="text-base font-medium opacity-90">
            🏆 Best Score: {progress.highScore.toLocaleString()}
          </div>
          <div className="text-sm font-bold opacity-80">How fast?</div>
          {/* grid, not flex: the buttons are w-full and daisyUI .btn does not
              shrink, so a flex row fitted only "Slow" and pushed the rest off
              the card. */}
          <div data-testid="snake-speed-picker" className="grid grid-cols-3 gap-2">
            {(["slow", "medium", "fast"] as const).map((speed) => (
              <GameStartOverlayButton
                key={speed}
                onClick={() => store.setSpeed(speed)}
                aria-pressed={progress.speed === speed}
                className={`capitalize ${
                  progress.speed === speed ? "btn-primary" : ""
                }`}
              >
                {speed}
              </GameStartOverlayButton>
            ))}
          </div>
          {/* The control mode, on a touch screen only: a keyboard has no
              swipe. Swiping works in both modes; "Arrows" also shows the
              d-pad, "Swipe" gives the board the room. */}
          {isCoarse && (
            <>
              <div className="text-sm font-bold opacity-80">How do you turn?</div>
              <div data-testid="snake-controls-picker" className="grid grid-cols-2 gap-2">
                {(
                  [
                    { mode: "buttons", label: "🔼 Arrows" },
                    { mode: "swipe", label: "👆 Swipe" },
                  ] as const
                ).map((choice) => (
                  <GameStartOverlayButton
                    key={choice.mode}
                    onClick={() => store.setControlMode(choice.mode)}
                    aria-pressed={progress.controlMode === choice.mode}
                    className={progress.controlMode === choice.mode ? "btn-primary" : ""}
                  >
                    {choice.label}
                  </GameStartOverlayButton>
                ))}
              </div>
            </>
          )}
        </GameStartOverlay>
      )}

      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Sideways: score column, board, controls column (the gutters).
          Upright: score row, board, controls row. */}
      <Hud column={layout.sideways} syncNote={syncNote} />
      {boardSize > 0 && <GameBoard size={boardSize} />}
      <div
        data-testid="snake-controls"
        className={`flex shrink-0 items-center justify-center ${layout.sideways ? "flex-col" : "flex-row"}`}
      >
        {controlsNode}
      </div>

      {/* The result chip: read it to me, Play again (a new run at once),
          the leaderboard. Mounted only at game over, so its grace starts
          then. */}
      {status === "game-over" && (
        <ResultChip
          resultText={gameOverText({
            score: store.score,
            length: store.snake.length,
            best: progress.highScore,
            newBest: store.lastRunNewBest,
          })}
          appId="snake"
          onRestart={store.startGame}
          keyboardHint="Space"
        />
      )}
    </div>
  );
}

export default SnakeGame;
