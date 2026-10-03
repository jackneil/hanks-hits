"use client";

import { useSemanticClips } from "@/shared/clips/replay/useSemanticClips";
import { paintMemory } from "./lib/clipRenderer";


import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from "react";
import { useMemoryMatchStore } from "./lib/store";
import { CARD_GAP, EDGE, GAP, STATS_COLUMN, STATS_ROW, memoryLayout } from "./lib/layout";
import { MEMORY_MATCH_AUDIO_ID, releaseSounds } from "./lib/sounds";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { RESULT_CHIP_BUTTON, SECONDARY_ACTION } from "@/shared/components/buttonStyles";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { setGameSpeakerEnabled, wantGameAudio } from "@/shared/lib/audio";
import {
  type Difficulty,
  type ThemeId,
  DIFFICULTIES,
  THEMES,
  formatTime,
  calculateStars,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import {
  GameStartOverlay,
  GameStartOverlayButton,
} from "@/shared/components/GameStartOverlay";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";

// Card component with flip animation
function Card({
  imageId,
  isFlipped,
  isMatched,
  onClick,
  disabled,
  size,
}: {
  imageId: string;
  isFlipped: boolean;
  isMatched: boolean;
  onClick: () => void;
  disabled: boolean;
  size: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isFlipped || isMatched}
      className={`
        relative shrink-0 touch-manipulation
        perspective-1000 cursor-pointer
        transition-transform duration-200
        ${!disabled && !isFlipped && !isMatched ? "hover:scale-105 active:scale-95" : ""}
        ${isMatched ? "opacity-80" : ""}
        disabled:cursor-default
      `}
      style={{ perspective: "1000px", width: size, height: size }}
      aria-label={isFlipped || isMatched ? imageId : "Hidden card"}
    >
      <div
        className={`
          relative w-full h-full transition-transform duration-400 ease-in-out
          ${isFlipped || isMatched ? "rotate-y-180" : ""}
        `}
        style={{
          transformStyle: "preserve-3d",
          transform: isFlipped || isMatched ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 0.4s ease-in-out",
        }}
      >
        {/* Card Back */}
        <div
          className={`
            absolute inset-0 rounded-xl
            bg-gradient-to-br from-blue-500 to-blue-700
            border-4 border-blue-400
            flex items-center justify-center
            shadow-lg
            ${!isFlipped && !isMatched ? "animate-pulse-subtle" : ""}
          `}
          style={{ backfaceVisibility: "hidden" }}
        >
          <span className="opacity-30" style={{ fontSize: Math.round(size * 0.4) }}>?</span>
        </div>

        {/* Card Front */}
        <div
          className={`
            absolute inset-0 rounded-xl
            bg-gradient-to-br from-white to-gray-100
            border-4 ${isMatched ? "border-green-400 shadow-green-400/50" : "border-amber-400"}
            flex items-center justify-center
            shadow-lg
            ${isMatched ? "shadow-xl" : ""}
          `}
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <span className="select-none" style={{ fontSize: Math.round(size * 0.5) }}>{imageId}</span>
          {isMatched && (
            <div className="absolute top-1 right-1 text-green-500 text-xl">
              &#10003;
            </div>
          )}
        </div>
      </div>

      {/* Match celebration effect */}
      {isMatched && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 rounded-xl bg-green-400/20 animate-ping" />
        </div>
      )}
    </button>
  );
}

// Stats: moves, time and pairs. A row over the cards upright, a column
// beside them sideways.
function StatsBar({
  moves,
  time,
  matchedPairs,
  totalPairs,
  column,
}: {
  moves: number;
  time: number;
  matchedPairs: number;
  totalPairs: number;
  column: boolean;
}) {
  const pill = "flex items-center gap-2 rounded-full bg-black/30 px-3 py-1.5";
  return (
    <div
      data-testid="memory-stats"
      className={`flex shrink-0 justify-center gap-2 text-base font-bold text-white ${column ? "flex-col items-stretch" : "items-center"}`}
      style={column ? { width: STATS_COLUMN } : { height: STATS_ROW }}
    >
      <div className={pill}>
        <span className="text-amber-400">&#128064;</span>
        <span>{movesText(moves)}</span>
      </div>
      <div className={pill}>
        <span className="text-blue-400">&#9203;</span>
        <span>{formatTime(time)}</span>
      </div>
      <div className={pill}>
        <span className="text-green-400">&#10003;</span>
        <span>
          {matchedPairs}/{totalPairs}
        </span>
      </div>
    </div>
  );
}

/** The card pictures a kid can pick, with how to unlock the locked ones (in words, not a tooltip). */
function ThemePicker({
  current,
  onChange,
  unlockedThemes,
  totalWins,
}: {
  current: ThemeId;
  onChange: (t: ThemeId) => void;
  unlockedThemes: ThemeId[];
  totalWins: number;
}) {
  const themes: ThemeId[] = ["animals", "vehicles", "emojis", "dinosaurs"];
  return (
    <div data-testid="theme-picker" className="grid grid-cols-2 gap-2">
      {themes.map((t) => {
        const theme = THEMES[t];
        const isUnlocked = unlockedThemes.includes(t);
        const winsNeeded = Math.max(0, theme.unlockCondition - totalWins);
        return (
          <GameStartOverlayButton
            key={t}
            onClick={() => isUnlocked && onChange(t)}
            disabled={!isUnlocked}
            aria-pressed={current === t}
            className={current === t ? "btn-primary" : ""}
          >
            <span className="flex flex-col items-center leading-tight">
              <span>
                {theme.emoji} {theme.name}
              </span>
              {!isUnlocked && (
                <span className="text-xs font-normal">
                  &#128274; Win {winsNeeded} more
                </span>
              )}
            </span>
          </GameStartOverlayButton>
        );
      })}
    </div>
  );
}

/** The result chip's words, read out loud first. */
/** "1 move", "2 moves": the counter said "1 moves" after the first turn. */
export function movesText(moves: number): string {
  return moves === 1 ? "1 move" : `${moves} moves`;
}

export function winText({ moves, time, stars, newBest }: { moves: number; time: number; stars: number; newBest: boolean }): string {
  const starWords = stars === 1 ? "1 star" : `${stars} stars`;
  return `You won! ${movesText(moves)} in ${formatTime(time)}. You got ${starWords}.${newBest ? " That is a new best time!" : ""}`;
}

// Main game component
export function MemoryMatchGame() {
  const store = useMemoryMatchStore();
  // The board is live from mount, so a local gate holds the cards still until
  // the player presses Play on the shared start overlay.
  const [hasStarted, setHasStarted] = useState(false);
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Auth sync
  const { forceSync } = useAuthSync({
    appId: "memory-match",
    localStorageKey: "memory-match-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on win
  useEffect(() => {
    if (store.isWon) forceSync();
  }, [store.isWon, forceSync]);

  // Start a new game on first load to ensure cards are shuffled
  useEffect(() => {
    store.newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer tick: one interval for the life of the game. It reads the store's
  // action on each tick, because `store` (the whole state) is a new object
  // after every set, and depending on it cleared and re-made the interval
  // on every tick and every flip.
  useEffect(() => {
    if (!isClient) return;
    const interval = setInterval(() => useMemoryMatchStore.getState().tick(), 100);
    return () => clearInterval(interval);
  }, [isClient]);

  // The shell holds the game under an overlay (the leaderboard, a clip
  // sheet, the install steps, the orientation tip) and in a hidden tab: the
  // round's clock stops there, like under the pause menu. Only a stop the
  // hold made is undone when it ends (the pause menu owns its own).
  const held = useShellHold();
  useSemanticClips(store, paintMemory, { phase: !hasStarted || store.isWon ? "idle" : held || store.pausedAt !== null ? "hold" : "playing", runId: store.clipRunId, score: store.matchedPairs, best: 0 });
  const pausedByHold = useRef(false);
  useEffect(() => {
    const state = useMemoryMatchStore.getState();
    if (held && state.isPlaying && !state.isWon && state.pausedAt === null) {
      state.pauseTimer();
      pausedByHold.current = true;
    } else if (!held && pausedByHold.current) {
      pausedByHold.current = false;
      state.resumeTimer();
    }
  }, [held]);

  // Sound: the first tap starts the shared game-audio bus, the sound switch
  // is this game's speaker, and the channel leaves the bus on unmount.
  useEffect(() => wantGameAudio(), []);
  const soundEnabled = store.progress.soundEnabled;
  useEffect(() => {
    setGameSpeakerEnabled(MEMORY_MATCH_AUDIO_ID, soundEnabled);
  }, [soundEnabled]);
  useEffect(() => () => releaseSounds(), []);

  // A new deal at once: Play again on the result chip, or N on a keyboard
  // (the header's restart asks first in the middle of a round).
  const playAgain = useCallback(() => useMemoryMatchStore.getState().newGame(), []);
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      if ((e.key === "n" || e.key === "N") && useMemoryMatchStore.getState().isWon) {
        e.preventDefault();
        playAgain();
      }
    },
    [playAgain]
  );
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const config = DIFFICULTIES[store.difficulty];
  const box = usePlayBox({ fit: true });
  const layout = memoryLayout(box, { rows: config.rows, cols: config.cols });

  if (!isClient) {
    return (
      <div className="min-h-full bg-gradient-to-b from-blue-800 to-purple-900 flex items-center justify-center">
        <div className="text-white text-2xl">Loading...</div>
      </div>
    );
  }

  const totalPairs = config.pairs;
  const previousBestTime = store.progress.bestTimes[store.difficulty];
  const isNewBest =
    store.isWon && store.currentTime > 0 && (previousBestTime === null || store.currentTime <= previousBestTime);
  const stars = calculateStars(store.moves, totalPairs);

  return (
    <div
      data-testid="memory-root"
      data-layout={layout.sideways ? "sideways" : "upright"}
      className={`relative flex h-full w-full items-center justify-center bg-gradient-to-b from-blue-800 to-purple-900 ${
        layout.sideways ? "flex-row" : "flex-col"
      }`}
      style={{ padding: EDGE, gap: GAP }}
    >
      {/* Shared start screen. It covers the page (it portals to
          document.body): the number of cards and the pictures are picked
          here, so the play screen is all cards. */}
      {!hasStarted && (
        <GameStartOverlay
          title="Memory Match"
          emoji="🃏"
          subtitle="Find the two cards that match!"
          touchHints={["👆 Tap a card to flip it", "🎯 Find two cards that look the same", "⏱️ Match them all as fast as you can"]}
          keyboardHints={["🖱️ Click a card to flip it", "🎯 Find two cards that look the same", "⏱️ Match them all as fast as you can"]}
          spokenChoices={`Pick how many cards: ${(Object.keys(DIFFICULTIES) as Difficulty[])
            .map((level) => DIFFICULTIES[level].name)
            .join(", ")}. Then pick the pictures.`}
          onStart={() => setHasStarted(true)}
        >
          {previousBestTime !== null && (
            <div className="text-base font-medium opacity-90">🏆 Best Time: {formatTime(previousBestTime)}</div>
          )}
          <div className="text-sm font-bold opacity-80">How many cards?</div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(DIFFICULTIES) as Difficulty[]).map((level) => (
              <GameStartOverlayButton
                key={level}
                onClick={() => store.setDifficulty(level)}
                aria-pressed={store.difficulty === level}
                className={store.difficulty === level ? "btn-primary" : ""}
              >
                {DIFFICULTIES[level].name}
              </GameStartOverlayButton>
            ))}
          </div>
          <div className="text-sm font-bold opacity-80">Which pictures?</div>
          <ThemePicker
            current={store.theme}
            onChange={(t) => store.setTheme(t)}
            unlockedThemes={store.progress.unlockedThemes}
            totalWins={store.progress.gamesWon}
          />
        </GameStartOverlay>
      )}

      {/* iOS install prompt */}
      <IOSInstallPrompt />

      <StatsBar
        moves={store.moves}
        time={store.currentTime}
        matchedPairs={store.matchedPairs}
        totalPairs={totalPairs}
        column={layout.sideways}
      />

      {/* The cards, sized from the play box (memoryLayout). */}
      <div
        data-testid="memory-board"
        className="shrink-0"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${config.cols}, ${layout.card}px)`,
          gap: CARD_GAP,
        }}
      >
        {store.cards.map((card, index) => (
          <Card
            key={card.id}
            imageId={card.imageId}
            isFlipped={card.isFlipped}
            isMatched={card.isMatched}
            onClick={() => hasStarted && store.flipCard(index)}
            disabled={store.isProcessing || !hasStarted}
            size={layout.card}
          />
        ))}
      </div>

      {store.isWon && (
        <ResultCard testId="memory-result-card" title="🎉 You won!">
          <ResultLine big>
            {movesText(store.moves)} · {formatTime(store.currentTime)}
          </ResultLine>
          <ResultLine>
            {"⭐".repeat(stars)}
            {isNewBest ? " New best time!" : previousBestTime !== null ? ` Best ${formatTime(previousBestTime)}` : ""}
          </ResultLine>
        </ResultCard>
      )}

      {/* The result chip: read it to me, Play again (a new deal at once, no
          question: the round is over), the leaderboard, the sound switch. */}
      {store.isWon && (
        <ResultChip
          resultText={winText({ moves: store.moves, time: store.currentTime, stars, newBest: isNewBest })}
          appId="memory-match"
          onRestart={playAgain}
          keyboardHint="N"
        >
          <button
            type="button"
            data-testid="result-chip-sound"
            onClick={() => store.toggleSound()}
            onMouseDown={(event) => event.preventDefault()}
            className={`btn ${SECONDARY_ACTION} gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} normal-case active:scale-[0.97] touch-manipulation`}
          >
            <span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
            {soundEnabled ? "Sound on" : "Sound off"}
          </button>
        </ResultChip>
      )}
    </div>
  );
}

export default MemoryMatchGame;
