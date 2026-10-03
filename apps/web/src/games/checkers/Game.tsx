"use client";

import { useSemanticClips } from "@/shared/clips/replay/useSemanticClips";
import { paintCheckers } from "./lib/clipRenderer";


import { useEffect, useState } from "react";
import { Board } from "./components/Board";
import { TurnStrip } from "./components/TurnStrip";
import { useCheckersStore } from "./lib/store";
import { AI_CONFIG, RULE_SETS, type Difficulty, type GameMode, type GameStatus, type GameVariant } from "./lib/constants";
import { EDGE, GAP, SIDE_COLUMN, TOP_ROW, checkersLayout } from "./lib/layout";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay, GameStartOverlayButton } from "@/shared/components/GameStartOverlay";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const VARIANTS = Object.keys(RULE_SETS) as GameVariant[];

/** The result, from the kid's side. */
export type CheckersOutcome = "won" | "lost" | "red-won" | "black-won";

export function checkersOutcome(status: GameStatus, mode: GameMode): CheckersOutcome | null {
  if (status !== "red-wins" && status !== "black-wins") return null;
  if (mode === "vs-friend") return status === "red-wins" ? "red-won" : "black-won";
  return status === "red-wins" ? "won" : "lost";
}

const OUTCOME_TITLES: Record<CheckersOutcome, string> = {
  won: "🎉 You won!",
  lost: "🤖 The computer won",
  "red-won": "🔴 Red wins!",
  "black-won": "⚫ Black wins!",
};

/** The result, read out loud first by the result chip. */
export function resultText(outcome: CheckersOutcome, giveaway: boolean, streak: number): string {
  const how = giveaway ? " Every piece is gone!" : "";
  switch (outcome) {
    case "won":
      return `You won!${how}${streak > 1 ? ` That is ${streak} wins in a row.` : ""}`;
    case "lost":
      return `The computer won.${how} Good try!`;
    case "red-won":
      return `Red wins!${how}`;
    case "black-won":
      return `Black wins!${how}`;
  }
}

export function CheckersGame() {
  const store = useCheckersStore();
  const { status, progress } = store;
  const held = useShellHold();
  const box = usePlayBox({ fit: true });
  const layout = checkersLayout(box);

  // Checkers plays from mount, so there is no store-level "before" state. This
  // per-mount gate gives the player a real start moment: the shared overlay
  // covers the board until Play is pressed, and the choices are on it.
  const [hasStarted, setHasStarted] = useState(false);

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "checkers",
    localStorageKey: "checkers-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  const over = status !== "playing";
  useSemanticClips(store, paintCheckers, { phase: !hasStarted || over ? "idle" : held || store.paused ? "hold" : "playing", runId: store.clipRunId, score: progress.currentWinStreak, best: progress.bestWinStreak });
  // Force save immediately on game end
  useEffect(() => {
    if (over) forceSync();
  }, [over, forceSync]);

  // The computer's turn: it moves after a short wait, never while the start
  // card, the pause menu or a shell overlay is up. The timer belongs to this
  // board, so a new game cancels it.
  const computerTurn = store.isComputerTurn();
  useEffect(() => {
    if (!hasStarted || !computerTurn || store.paused || held) return;
    const timer = setTimeout(() => useCheckersStore.getState().aiMove(), AI_CONFIG.MOVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasStarted, computerTurn, store.paused, held, store.board]);

  const canAct = hasStarted && !over && !computerTurn && !store.paused && !held;

  // N plays again once the game is over (a mouse and keyboard player).
  useEffect(() => {
    if (!hasStarted) return;
    const onKey = (event: KeyboardEvent) => {
      if (keyBelongsToTarget(event)) return;
      if ((event.key === "n" || event.key === "N") && useCheckersStore.getState().status !== "playing") {
        event.preventDefault();
        useCheckersStore.getState().newGame();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasStarted]);

  const outcome = checkersOutcome(status, store.gameMode);
  const giveaway = store.rules.invertedWinCondition;
  const board = <Board size={layout.board} canAct={canAct} />;

  return (
    <div
      data-testid="checkers-root"
      data-layout={layout.sideways ? "sideways" : "upright"}
      className={`relative flex h-full w-full select-none items-center justify-center bg-amber-950 ${
        layout.sideways ? "flex-row" : "flex-col"
      }`}
      style={{ padding: EDGE, gap: GAP }}
    >
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Everything under the start card. `inert` while the card is up so Tab
          cannot reach the board before Play, and a stray tap through the
          overlay cannot move a piece. `contents` keeps the flex layout. */}
      <div className="contents" inert={!hasStarted || undefined}>
        {layout.sideways ? (
          <>
            {board}
            <div className="flex shrink-0 flex-col justify-center" style={{ width: SIDE_COLUMN }}>
              <TurnStrip column />
            </div>
          </>
        ) : (
          <>
            <TurnStrip column={false} width={layout.board} height={TOP_ROW} />
            {board}
          </>
        )}
      </div>

      {/* Shared start screen. It covers the page (it portals to
          document.body): who to play, the rules and how hard are picked
          here, so the play screen is the board. */}
      {!hasStarted && (
        <GameStartOverlay
          title="Checkers"
          emoji="🔴"
          subtitle="Jump the other pieces and win!"
          touchHints={[
            "👆 Tap a piece, then tap where it goes",
            "⭐ Jump over a piece to take it",
            "👑 Reach the far row to get a crown",
          ]}
          keyboardHints={[
            "🖱️ Click a piece, then click where it goes",
            "⭐ Jump over a piece to take it",
            "👑 Reach the far row to get a crown",
          ]}
          spokenChoices={`Pick who you play: the computer, or 2 players on one phone. Then pick the rules: ${VARIANTS.map(
            (v) => RULE_SETS[v].displayName
          ).join(", ")}. Against the computer, pick how hard.`}
          onStart={() => setHasStarted(true)}
        >
          {progress.gamesWon > 0 && (
            <div className="text-base font-medium opacity-90">
              🏆 Wins: {progress.gamesWon} · 🔥 Best streak: {progress.bestWinStreak}
            </div>
          )}
          <div className="text-sm font-bold opacity-80">Who do you play?</div>
          <div data-testid="mode-picker" className="grid grid-cols-2 gap-2">
            <GameStartOverlayButton
              onClick={() => store.setGameMode("vs-ai")}
              aria-pressed={store.gameMode === "vs-ai"}
              className={store.gameMode === "vs-ai" ? "btn-primary" : ""}
            >
              🤖 Computer
            </GameStartOverlayButton>
            <GameStartOverlayButton
              onClick={() => store.setGameMode("vs-friend")}
              aria-pressed={store.gameMode === "vs-friend"}
              className={store.gameMode === "vs-friend" ? "btn-primary" : ""}
            >
              👫 2 players
            </GameStartOverlayButton>
          </div>
          <div className="text-sm font-bold opacity-80">Rules</div>
          <div data-testid="rules-picker" className="grid grid-cols-2 gap-2">
            {VARIANTS.map((v) => (
              <GameStartOverlayButton
                key={v}
                onClick={() => store.setVariant(v)}
                aria-pressed={store.rules.variant === v}
                className={store.rules.variant === v ? "btn-primary" : ""}
              >
                {RULE_SETS[v].displayName}
              </GameStartOverlayButton>
            ))}
          </div>
          <div data-testid="rules-words" className="text-sm opacity-90">
            {store.rules.description}
          </div>
          {store.gameMode === "vs-ai" && (
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

      {outcome && (
        <ResultCard testId="checkers-result-card" title={OUTCOME_TITLES[outcome]}>
          {giveaway && <ResultLine>Every piece is gone!</ResultLine>}
          {outcome === "won" && progress.currentWinStreak > 1 && (
            <ResultLine big>🔥 {progress.currentWinStreak} wins in a row</ResultLine>
          )}
          {outcome === "lost" && <ResultLine>Good try! Want another go?</ResultLine>}
        </ResultCard>
      )}

      {/* The result chip: read it to me, Play again (a new game at once, same
          choices), the leaderboard. */}
      {outcome && (
        <ResultChip
          resultText={resultText(outcome, giveaway, progress.currentWinStreak)}
          appId="checkers"
          onRestart={() => useCheckersStore.getState().newGame()}
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

export default CheckersGame;
