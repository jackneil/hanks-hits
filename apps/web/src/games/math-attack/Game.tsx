"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useMathAttackStore, type MathAttackProgress } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import {
  DIFFICULTY_SETTINGS,
  getDifficultySettings,
  POINTS,
  GAME,
  type Difficulty,
  type Operation,
} from "./lib/constants";
import { generateProblem, findMatchingProblem, type Problem } from "./lib/problems";

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
    startGame,
    addScore,
    recordAnswerAttempt,
    incrementCombo,
    resetCombo,
    loseLife,
    reset,
    setDifficulty,
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
    if (gameState === "gameOver") {
      forceSync();
    }
  }, [gameState, forceSync]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const problemsRef = useRef<Problem[]>([]);
  const lastSpawnRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const explosionsRef = useRef<{ x: number; y: number; id: string; time: number }[]>([]);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const gameStateRef = useRef(gameState); // Track gameState in ref for animation loop

  const diffSettings = getDifficultySettings(settings.difficulty);

  // Start game
  const handleStartGame = () => {
    // Debug logging to help diagnose difficulty issues
    console.log("[Math Attack] Starting game with difficulty:", settings.difficulty);
    console.log("[Math Attack] Operations:", diffSettings.operations);
    console.log("[Math Attack] Number range:", diffSettings.numberRange);

    problemsRef.current = [];
    lastSpawnRef.current = 0;
    setInputValue("");
    startGame(diffSettings.lives);
    inputRef.current?.focus();
  };

  // Handle answer submission
  const handleSubmit = useCallback(() => {
    if (gameState !== "playing") return;

    const answer = parseInt(inputValue, 10);
    if (isNaN(answer)) {
      setInputValue("");
      return;
    }

    const match = findMatchingProblem(problemsRef.current, answer);

    if (match) {
      // Correct answer!
      const speedBonus = Math.floor((GAME.height - match.y) * POINTS.speedBonus / GAME.height);
      const comboBonus = combo * POINTS.comboBonus;
      const points = POINTS.correct + speedBonus + comboBonus;

      // Use operation stored on problem
      addScore(points, match.operation as Operation);
      incrementCombo();

      // Remove problem
      problemsRef.current = problemsRef.current.filter((p) => p.id !== match.id);

      // Add explosion effect (using ref to avoid re-triggering game loop)
      explosionsRef.current.push({ x: match.x, y: match.y, id: match.id, time: Date.now() });
    } else {
      // Wrong answer
      recordAnswerAttempt();
      resetCombo();
    }

    setInputValue("");
  }, [gameState, inputValue, combo, addScore, recordAnswerAttempt, incrementCombo, resetCombo]);

  // Keyboard input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // Keep gameStateRef in sync
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Game loop
  useEffect(() => {
    if (gameState !== "playing") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastTime = 0;
    let isRunning = true;

    const gameLoop = (time: number) => {
      if (!isRunning) return;

      const delta = lastTime ? (time - lastTime) / 16.67 : 1; // Normalize to ~60fps
      lastTime = time;

      // Check if game is still playing (use ref for fresh value)
      if (gameStateRef.current !== "playing") {
        return;
      }

      // Spawn new problems
      if (time - lastSpawnRef.current >= diffSettings.spawnRateMs) {
        const problem = generateProblem(
          diffSettings.operations,
          diffSettings.numberRange,
          diffSettings.fallSpeed,
          diffSettings.bubbleSize
        );
        problemsRef.current.push(problem);
        lastSpawnRef.current = time;
      }

      // Update problem positions and check for bottom
      const newProblems: Problem[] = [];
      for (const problem of problemsRef.current) {
        problem.y += problem.speed * delta;

        // Check if reached bottom (only lose life once per problem)
        if (problem.y >= GAME.height - GAME.bottomZone) {
          if (!problem.reachedBottom) {
            problem.reachedBottom = true;
            recordAnswerAttempt();
            loseLife();
          }
          // Remove problem after it's processed
        } else {
          newProblems.push(problem);
        }
      }
      problemsRef.current = newProblems;

      // Clean up old explosions (500ms lifetime)
      const now = Date.now();
      explosionsRef.current = explosionsRef.current.filter(e => now - e.time < 500);

      // Clear canvas
      ctx.fillStyle = "#1e1b4b"; // Dark indigo
      ctx.fillRect(0, 0, GAME.width, GAME.height);

      // Draw danger zone
      ctx.fillStyle = "rgba(239, 68, 68, 0.2)";
      ctx.fillRect(0, GAME.height - GAME.bottomZone, GAME.width, GAME.bottomZone);

      // Draw problems as bubbles
      for (const problem of problemsRef.current) {
        const baseSize = diffSettings.bubbleSize;
        const textLen = problem.text.length;
        // Scale bubble up for longer text (e.g., "99 + 99 = 198")
        const size = textLen > 11 ? baseSize * 1.4 : textLen > 7 ? baseSize * 1.2 : baseSize;

        // Bubble
        ctx.beginPath();
        ctx.arc(problem.x, problem.y, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = problem.color;
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 3;
        ctx.stroke();

        // Text - scale font to fit inside bubble
        const maxFontSize = size / 3;
        const scaledFontSize = Math.min(maxFontSize, (size * 0.8) / (textLen * 0.5));
        ctx.fillStyle = "white";
        ctx.font = `bold ${Math.max(12, scaledFontSize)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(problem.text, problem.x, problem.y);
      }

      // Draw explosions from ref
      for (const exp of explosionsRef.current) {
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

      if (isRunning && gameStateRef.current === "playing") {
        animationFrameRef.current = requestAnimationFrame(gameLoop);
      }
    };

    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      isRunning = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gameState, diffSettings, loseLife]);

  // Focus input when game starts
  useEffect(() => {
    if (gameState === "playing") {
      inputRef.current?.focus();
    }
  }, [gameState]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-950 via-purple-950 to-indigo-950 text-white">
      <IOSInstallPrompt />
      <FullscreenButton />

      <div className="container mx-auto px-4 py-6 max-w-lg flex flex-col items-center">
        {/* Ready Screen */}
        {gameState === "ready" && (
          <div className="text-center space-y-8 w-full">
            <h1 className="text-5xl font-bold mb-4">🔢 Math Attack</h1>
            <p className="text-xl text-purple-200">Solve problems before they hit the ground!</p>

            {/* Stats */}
            {gamesPlayed > 0 && (
              <div className="bg-white/10 rounded-2xl p-4 space-y-2">
                <div className="text-lg">🏆 High Score: {highScore}</div>
                <div className="text-sm text-purple-200">
                  {totalCorrect} problems solved
                </div>
                <div className="text-sm text-purple-200">
                  🔥 Best Combo: {longestCombo}
                </div>
              </div>
            )}

            {/* Age Selector */}
            <div className="space-y-4">
              <div className="text-xl font-bold">How old are you?</div>
              <div className="flex flex-wrap gap-2 justify-center">
                {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((diff) => {
                  const s = DIFFICULTY_SETTINGS[diff];
                  const isSelected = settings.difficulty === diff;
                  return (
                    <button
                      key={diff}
                      onClick={() => setDifficulty(diff)}
                      className={`px-4 py-3 rounded-xl font-bold text-base transition-all flex flex-col items-center min-w-[70px] ${
                        isSelected
                          ? `${s.color} text-white scale-110 ring-2 ring-white shadow-lg`
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      <span className="text-2xl">{s.emoji}</span>
                      <span>{diff}</span>
                    </button>
                  );
                })}
              </div>
              <div className="text-purple-300 text-sm">
                Operations: {diffSettings.operations.join(", ")} | Lives: {diffSettings.lives}
              </div>
              {settings.difficulty === "99yo" && (
                <div className="text-purple-300 text-sm">
                  Grandpa mode: Big numbers, slow falling, extra lives!
                </div>
              )}
            </div>

            {/* Start Button */}
            <button
              onClick={handleStartGame}
              className="btn btn-primary btn-lg text-xl px-12 py-4 rounded-full shadow-lg hover:scale-105 transition-transform"
            >
              🎮 Start Game!
            </button>
          </div>
        )}

        {/* Playing Screen */}
        {gameState === "playing" && (
          <div className="w-full space-y-4">
            {/* HUD */}
            <div className="flex justify-between items-center text-lg">
              <div>❤️ {lives}</div>
              <div className="font-bold">Score: {score}</div>
              {combo > 1 && (
                <div className="text-yellow-400 animate-pulse">
                  🔥 x{combo}
                </div>
              )}
            </div>

            {/* Game Canvas */}
            <canvas
              ref={canvasRef}
              width={GAME.width}
              height={GAME.height}
              className="border-4 border-purple-500 rounded-xl mx-auto block"
              style={{ maxWidth: "100%", height: "auto" }}
            />

            {/* Input */}
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type answer..."
                className="flex-1 input input-bordered input-lg text-center text-2xl bg-white/10 border-purple-500"
                autoFocus
              />
              <button
                onClick={handleSubmit}
                className="btn btn-primary btn-lg text-xl"
              >
                ⚡
              </button>
            </div>
          </div>
        )}

        {/* Game Over Screen */}
        {gameState === "gameOver" && (
          <div className="text-center space-y-8 w-full">
            <h1 className="text-5xl font-bold text-red-400">💥 Game Over!</h1>

            <div className="bg-white/10 rounded-2xl p-6 space-y-4">
              <div className="text-4xl font-bold text-yellow-400">
                {score} points
              </div>
              {score >= highScore && score > 0 && (
                <div className="text-green-400 font-bold animate-bounce">
                  🏆 NEW HIGH SCORE!
                </div>
              )}
              <div className="text-lg">
                Best combo: {Math.max(longestCombo, combo)}x
              </div>
            </div>

            <button
              onClick={() => {
                reset();
                handleStartGame();
              }}
              className="btn btn-primary btn-lg text-xl px-8 rounded-full"
            >
              🔄 Play Again
            </button>

            <button
              onClick={reset}
              className="btn btn-ghost text-purple-300"
            >
              Change Difficulty
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default MathAttackGame;
