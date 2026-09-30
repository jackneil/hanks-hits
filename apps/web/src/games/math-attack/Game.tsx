"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { GameStartOverlay, GameStartOverlayButton } from "@/shared/components/GameStartOverlay";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { RESULT_CHIP_BUTTON, SECONDARY_ACTION } from "@/shared/components/buttonStyles";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useGameLoop } from "@/shared/hooks/useGameLoop";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { setGameSpeakerEnabled, wantGameAudio } from "@/shared/lib/audio";
import { usePointerTap, useRestartGrace } from "@/shared/lib/input";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { PICKER_GRID, pickerCellClass } from "@/shared/lib/pickerGrid";

import { DIFFICULTY_SETTINGS, GAME, getDifficultySettings, POINTS, type Difficulty, type Operation } from "./lib/constants";
import { EDGE, GAP, HUD_ROW, KEY_GAP, mathAttackLayout } from "./lib/layout";
import { findMatchingProblem, generateProblem, type Problem } from "./lib/problems";
import { MATH_ATTACK_AUDIO_ID, playSound, releaseSounds } from "./lib/sounds";
import { useMathAttackStore, type MathAttackProgress } from "./lib/store";
import { useMathAttackClips } from "./lib/useMathAttackClips";

/** One step of the shared fixed-step loop is one 60 fps frame of the old speeds. */
const FRAME_MS = 1000 / 60;
/** The longest answer a kid can type (the biggest answer is 198). */
export const MAX_ANSWER_DIGITS = 4;
/** The sound switch: the words say what the kid hears now. */
export const SOUND_LABELS = { on: "Sound on", off: "Sound off" } as const;
/** The spoken names of the pad's action keys. */
export const PAD_LABELS = { delete: "Delete", send: "Send the answer" } as const;

/** The result chip's words, read out loud first. */
export function gameOverText({ score, best, newBest }: { score: number; best: number; newBest: boolean }): string {
  const points = score === 1 ? "1 point" : `${score} points`;
  return newBest ? `Game over! You got ${points}. That is a new best!` : `Game over! You got ${points}. Your best is ${best}.`;
}

function drawSky(ctx: CanvasRenderingContext2D, problems: Problem[], explosions: { x: number; y: number; time: number }[], bubbleSize: number) {
  ctx.fillStyle = "#1e1b4b"; // Dark indigo
  ctx.fillRect(0, 0, GAME.width, GAME.height);

  // The danger zone
  ctx.fillStyle = "rgba(239, 68, 68, 0.2)";
  ctx.fillRect(0, GAME.height - GAME.bottomZone, GAME.width, GAME.bottomZone);

  // The problems, as bubbles
  for (const problem of problems) {
    const textLen = problem.text.length;
    // Bigger bubbles for longer text (e.g., "99 + 99")
    const size = textLen > 11 ? bubbleSize * 1.4 : textLen > 7 ? bubbleSize * 1.2 : bubbleSize;
    ctx.beginPath();
    ctx.arc(problem.x, problem.y, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = problem.color;
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 3;
    ctx.stroke();
    const scaledFontSize = Math.min(size / 3, (size * 0.8) / (textLen * 0.5));
    ctx.fillStyle = "white";
    ctx.font = `bold ${Math.max(12, scaledFontSize)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(problem.text, problem.x, problem.y);
  }

  // The pops of right answers
  for (const exp of explosions) {
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, 40, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 215, 0, 0.6)";
    ctx.fill();
    ctx.font = "bold 30px sans-serif";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✓", exp.x, exp.y);
  }
}

export function MathAttackGame() {
  const store = useMathAttackStore();
  const {
    gameState,
    score,
    lives,
    combo,
    highScore,
    totalCorrect,
    longestCombo,
    gamesPlayed,
    settings,
    runId,
    lastRunNewBest,
    startGame,
    addScore,
    recordAnswerAttempt,
    incrementCombo,
    resetCombo,
    reset,
    setDifficulty,
    setSoundEnabled,
  } = store;

  // Auth sync
  const { forceSync } = useAuthSync({
    appId: "math-attack",
    localStorageKey: "math-attack-progress",
    getState: () => store.getProgress() as unknown as Record<string, unknown>,
    setState: (data) => store.setProgress(data as unknown as MathAttackProgress),
    debounceMs: 2000,
  });

  // Force save immediately when game ends
  useEffect(() => {
    if (gameState === "gameOver") forceSync();
  }, [gameState, forceSync]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const problemsRef = useRef<Problem[]>([]);
  /** Game time since the last problem, in ms (it counts only while the loop steps). */
  const spawnClockRef = useRef(0);
  const explosionsRef = useRef<{ x: number; y: number; time: number }[]>([]);
  const [answer, setAnswer] = useState("");
  // The shell holds the game under an overlay and in a hidden tab: no game
  // time passes, so no problem falls and no life is lost.
  const held = useShellHold();

  const diffSettings = getDifficultySettings(settings.difficulty);
  const playing = gameState === "playing";
  const over = gameState === "gameOver";

  // The play box, fitted: the sky, the HUD and the pad share it.
  const box = usePlayBox({ fit: true });
  const layout = mathAttackLayout(box);

  // Gameplay clips: the canvas, the run phases and the new-best moment.
  useMathAttackClips(canvasRef, { gameState, score, highScore, runId });

  // Sound: the first tap starts the shared game-audio bus, the sound switch
  // is this game's speaker, and the channel leaves the bus on unmount.
  useEffect(() => wantGameAudio(), []);
  const soundEnabled = settings.soundEnabled;
  useEffect(() => {
    setGameSpeakerEnabled(MATH_ATTACK_AUDIO_ID, soundEnabled);
  }, [soundEnabled]);
  useEffect(() => () => releaseSounds(), []);

  const beginRun = useCallback(() => {
    problemsRef.current = [];
    explosionsRef.current = [];
    // The first problem comes at once.
    spawnClockRef.current = Number.POSITIVE_INFINITY;
    setAnswer("");
    startGame(getDifficultySettings(useMathAttackStore.getState().settings.difficulty).lives);
  }, [startGame]);

  // Send the typed answer.
  const submit = useCallback(() => {
    if (useMathAttackStore.getState().gameState !== "playing") return;
    const value = parseInt(answer, 10);
    setAnswer("");
    if (Number.isNaN(value)) return;
    const match = findMatchingProblem(problemsRef.current, value);
    if (match) {
      const speedBonus = Math.floor(((GAME.height - match.y) * POINTS.speedBonus) / GAME.height);
      const points = POINTS.correct + speedBonus + useMathAttackStore.getState().combo * POINTS.comboBonus;
      addScore(points, match.operation as Operation);
      incrementCombo();
      problemsRef.current = problemsRef.current.filter((p) => p.id !== match.id);
      explosionsRef.current.push({ x: match.x, y: match.y, time: Date.now() });
      playSound("pop");
    } else {
      recordAnswerAttempt();
      resetCombo();
      playSound("wrong");
    }
  }, [answer, addScore, incrementCombo, recordAnswerAttempt, resetCombo]);

  const press = useCallback(
    (key: string) => {
      if (useMathAttackStore.getState().gameState !== "playing") return;
      if (key === "⌫") setAnswer((a) => a.slice(0, -1));
      else if (key === "⚡") submit();
      else setAnswer((a) => (a.length >= MAX_ANSWER_DIGITS ? a : a + key));
    },
    [submit]
  );

  // One step of game time: spawn, fall, lose a life at the ground.
  const update = useCallback(
    (stepMs: number) => {
      const state = useMathAttackStore.getState();
      if (state.gameState !== "playing") return;
      const settingsNow = getDifficultySettings(state.settings.difficulty);
      spawnClockRef.current += stepMs;
      if (spawnClockRef.current >= settingsNow.spawnRateMs) {
        problemsRef.current.push(
          generateProblem(settingsNow.operations, settingsNow.numberRange, settingsNow.fallSpeed, settingsNow.bubbleSize)
        );
        spawnClockRef.current = 0;
      }
      const frames = stepMs / FRAME_MS;
      const kept: Problem[] = [];
      for (const before of problemsRef.current) {
        const problem = { ...before, y: before.y + before.speed * frames };
        if (problem.y >= GAME.height - GAME.bottomZone) {
          if (!problem.reachedBottom) {
            state.recordAnswerAttempt();
            const livesBefore = useMathAttackStore.getState().lives;
            useMathAttackStore.getState().loseLife();
            playSound(livesBefore <= 1 ? "game-over" : "lose-life");
          }
        } else {
          kept.push(problem);
        }
      }
      problemsRef.current = kept;
      const now = Date.now();
      explosionsRef.current = explosionsRef.current.filter((e) => now - e.time < 500);
    },
    []
  );

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const difficulty = useMathAttackStore.getState().settings.difficulty;
    drawSky(ctx, problemsRef.current, explosionsRef.current, getDifficultySettings(difficulty).bubbleSize);
  }, []);

  // The shared loop: a fixed 60 Hz step of game time and the sky drawn every
  // frame; no game time between runs, under the pause or under a hold.
  useGameLoop({ update, render: draw }, { running: true, paused: !playing || held });

  // Play again waits out the chip's grace (an Enter that sent the last
  // answer must not skip the result), and a held key's repeats never count.
  const grace = useRestartGrace(undefined, gameState);

  // A physical keyboard types too (a computer).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (keyBelongsToTarget(e)) return;
      const state = useMathAttackStore.getState().gameState;
      if (state === "gameOver") {
        if ((e.key === "Enter" || e.key === " ") && grace.accept(e)) {
          e.preventDefault();
          reset();
          beginRun();
        }
        return;
      }
      if (state !== "playing") return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter") press("⚡");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [grace, press, reset, beginRun]);

  // The pad: one handler, on pointerdown, so two thumbs type fast (a second
  // finger's tap makes no click) and one tap is one digit.
  const padTap = usePointerTap<HTMLDivElement>((event) => {
    const key = (event.target as Element | null)?.closest?.("[data-key]")?.getAttribute("data-key");
    if (key) press(key);
  });

  const hud = (
    <div
      data-testid="math-attack-hud"
      className="flex shrink-0 items-center justify-between gap-2 px-1 text-lg font-bold"
      style={{ height: HUD_ROW, width: layout.sky.width }}
    >
      <span aria-label={`${lives} lives`}>❤️ {lives}</span>
      <span
        data-testid="math-attack-answer"
        aria-live="polite"
        className="min-w-[5ch] rounded-lg border-2 border-purple-400 bg-white/10 px-3 text-center text-2xl tabular-nums"
      >
        {answer || "?"}
      </span>
      <span>
        {score}
        {combo > 1 && <span className="ml-2 text-yellow-400">🔥x{combo}</span>}
      </span>
    </div>
  );

  const pad = (
    <div
      data-testid="math-attack-pad"
      {...padTap}
      {...(playing ? {} : ({ "aria-hidden": true, inert: true } as const))}
      className={`grid shrink-0 touch-none select-none [-webkit-touch-callout:none] ${playing ? "" : "invisible"}`}
      style={{
        gridTemplateColumns: `repeat(${layout.pad[0].length}, ${layout.key}px)`,
        gridAutoRows: `${layout.key}px`,
        gap: KEY_GAP,
      }}
    >
      {layout.pad.flat().map((key) => (
        <button
          key={key}
          type="button"
          data-key={key}
          aria-label={key === "⌫" ? PAD_LABELS.delete : key === "⚡" ? PAD_LABELS.send : key}
          className={`flex items-center justify-center rounded-xl text-2xl font-bold text-white shadow ${
            key === "⚡" ? "bg-yellow-500 text-slate-900" : key === "⌫" ? "bg-slate-600" : "bg-purple-600 active:bg-purple-800"
          }`}
        >
          <span aria-hidden="true">{key}</span>
        </button>
      ))}
    </div>
  );

  const sky = (
    <div data-testid="math-attack-sky" className="relative shrink-0 overflow-hidden rounded-xl border-4 border-purple-500">
      <canvas
        ref={canvasRef}
        width={GAME.width}
        height={GAME.height}
        className="block"
        style={{ width: layout.sky.width, height: layout.sky.height }}
      />
    </div>
  );

  return (
    <div
      data-testid="math-attack-root"
      data-layout={layout.sideways ? "sideways" : "upright"}
      className={`relative flex h-full w-full items-center justify-center bg-gradient-to-b from-indigo-950 via-purple-950 to-indigo-950 text-white ${
        layout.sideways ? "flex-row" : "flex-col"
      }`}
      style={{ padding: EDGE, gap: GAP }}
    >
      <IOSInstallPrompt />

      {/* One stable tree on every screen: the sky (with the HUD over it)
          first, the pad second (under it upright, beside it sideways), so
          a turn of the phone never remounts the canvas or the pad. */}
      <div className="flex shrink-0 flex-col items-center" style={{ gap: GAP }}>
        {hud}
        {sky}
      </div>
      {pad}

      {over && (
        <ResultCard testId="math-attack-result-card" title="💥 Game over!">
          <ResultLine big>{score} points</ResultLine>
          <ResultLine>{lastRunNewBest ? "🏆 New best!" : `Best ${highScore} · Best combo ${Math.max(longestCombo, combo)}x`}</ResultLine>
        </ResultCard>
      )}

      {gameState === "ready" && (
        <GameStartOverlay
          title="Math Attack"
          emoji="🔢"
          subtitle="Solve the problems before they hit the ground!"
          touchHints={["🔢 Tap the numbers of the answer", "⚡ Tap the yellow key to send it", "❤️ Do not let a problem land"]}
          keyboardHints={["⌨️ Type the answer with the number keys", "↩️ Press Enter to send it", "❤️ Do not let a problem land"]}
          startLabel="🎮 Start Game!"
          spokenChoices={`Pick how old you are: ${(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[])
            .map((diff) => DIFFICULTY_SETTINGS[diff].label)
            .join(", ")}.`}
          onStart={beginRun}
        >
          {gamesPlayed > 0 && (
            <div className="text-base font-medium opacity-90">
              🏆 High Score: {highScore} · 🔥 Best Combo: {longestCombo}
              <div className="text-sm opacity-80">{totalCorrect} problems solved</div>
            </div>
          )}
          <div className="text-sm font-bold opacity-80">How old are you?</div>
          {/* Three short choices to a row (shared/lib/pickerGrid.ts), so
              every age is on screen with the heading on a phone upright;
              two columns put 12yo and up under the fold. */}
          <div data-testid="age-picker" className={PICKER_GRID}>
            {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((diff, index, all) => (
              <GameStartOverlayButton
                key={diff}
                onClick={() => setDifficulty(diff)}
                aria-pressed={settings.difficulty === diff}
                className={`${settings.difficulty === diff ? "btn-primary" : ""} ${pickerCellClass(index, all.length)}`}
              >
                {DIFFICULTY_SETTINGS[diff].emoji} {diff}
              </GameStartOverlayButton>
            ))}
          </div>
          <div className="text-xs opacity-70">
            Operations: {diffSettings.operations.join(", ")} | Lives: {diffSettings.lives}
          </div>
        </GameStartOverlay>
      )}

      {/* The result chip: read it to me, Play again (the same age, no start
          card), the leaderboard, a way back to the ages, the sound switch,
          and with clips on the clip buttons. */}
      {over && (
        <ResultChip
          resultText={gameOverText({ score, best: highScore, newBest: lastRunNewBest })}
          appId="math-attack"
          onRestart={() => {
            reset();
            beginRun();
          }}
          keyboardHint="Enter"
        >
          <button
            type="button"
            data-testid="math-attack-change-age"
            onClick={reset}
            className={`btn ${SECONDARY_ACTION} gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} normal-case active:scale-[0.97] touch-manipulation`}
          >
            <span aria-hidden="true">🎂</span>
            Change age
          </button>
          <button
            type="button"
            data-testid="result-chip-sound"
            onClick={() => setSoundEnabled(!soundEnabled)}
            onMouseDown={(event) => event.preventDefault()}
            className={`btn ${SECONDARY_ACTION} gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} normal-case active:scale-[0.97] touch-manipulation`}
          >
            <span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
            {soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off}
          </button>
        </ResultChip>
      )}
    </div>
  );
}

export default MathAttackGame;
