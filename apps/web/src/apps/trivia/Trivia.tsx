"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTriviaStore, type TriviaProgress } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import {
  GameStartOverlay,
  GameStartOverlayButton,
} from "@/shared/components/GameStartOverlay";
import {
  DIFFICULTY_SETTINGS,
  getDifficultySettings,
  POINTS,
  type Difficulty,
} from "./lib/constants";
import {
  getQuestions,
  prepareQuestion,
  type PreparedQuestion,
} from "./lib/api";

export function Trivia() {
  const store = useTriviaStore();
  const {
    gameState,
    currentScore,
    currentStreak,
    questionIndex,
    highScore,
    totalCorrect,
    totalAnswered,
    longestStreak,
    gamesPlayed,
    settings,
    startGame,
    answerQuestion,
    nextQuestion,
    endGame,
    reset,
    setDifficulty,
  } = store;

  // Auth sync
  const { forceSync } = useAuthSync({
    appId: "trivia",
    localStorageKey: "trivia-progress",
    getState: () => store.getProgress() as unknown as Record<string, unknown>,
    setState: (data) => store.setProgress(data as unknown as TriviaProgress),
    debounceMs: 2000,
  });

  // Force save immediately on game end
  useEffect(() => {
    if (gameState === "finished") {
      forceSync();
    }
  }, [gameState, forceSync]);

  // Game state
  const [questions, setQuestions] = useState<PreparedQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [bestStreakThisGame, setBestStreakThisGame] = useState(0);
  // Bumped on every FAILED start. It keys the start overlay, so a failed
  // attempt remounts it and clears the overlay's fire-once start guard --
  // otherwise the Play button would stay dead for the rest of this mount.
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const handleAnswerRef = useRef<(answer: string | null) => void>(() => {});
  // The 1.5s "show the answer" pause. Held in a ref so a restart can cancel
  // it: otherwise it fired endGame() over the fresh start card.
  const nextQuestionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const diffSettings = getDifficultySettings(settings.difficulty);
  const currentQuestion = questions[questionIndex];

  // Build this round's questions from the bundled bank - returns them for checking
  const loadQuestions = useCallback((): PreparedQuestion[] => {
    setError(null);
    const diff = getDifficultySettings(settings.difficulty);
    const rawQuestions = getQuestions(diff.questionsPerRound, diff.difficulty);

    if (rawQuestions.length === 0) {
      setError("😕 The questions did not load. Press Play to try again.");
      return [];
    }

    const prepared = rawQuestions.map(prepareQuestion);
    setQuestions(prepared);
    return prepared;
  }, [settings.difficulty]);

  // Start game
  const handleStartGame = () => {
    const loadedQuestions = loadQuestions();
    if (loadedQuestions.length === 0) {
      // loadQuestions() has set a visible error. Remount the overlay so its
      // per-mount start guard resets and Play works again.
      setAttempt((previous) => previous + 1);
      return;
    }
    setBestStreakThisGame(0);
    // A restart can leave the last answer highlighted; clear it before the
    // first question of the new game paints.
    setSelectedAnswer(null);
    setShowResult(false);
    startGame();
    setTimeLeft(diffSettings.timerSec);
  };

  // Handle answer selection
  const handleAnswer = useCallback((answer: string | null) => {
    if (showResult) return;
    if (timerRef.current) clearInterval(timerRef.current);

    setSelectedAnswer(answer);
    setShowResult(true);

    const isCorrect = answer === currentQuestion?.correctAnswer;
    const timeBonus = isCorrect ? timeLeft * POINTS.timeBonus : 0;
    const streakBonus = isCorrect ? currentStreak * POINTS.streakBonus : 0;
    const points = isCorrect ? POINTS.correct + timeBonus + streakBonus : 0;

    answerQuestion(isCorrect, points);

    // Track best streak this game
    if (isCorrect) {
      setBestStreakThisGame(prev => Math.max(prev, currentStreak + 1));
    }

    // Move to next question after delay
    if (nextQuestionTimeoutRef.current) clearTimeout(nextQuestionTimeoutRef.current);
    nextQuestionTimeoutRef.current = setTimeout(() => {
      nextQuestionTimeoutRef.current = null;
      setSelectedAnswer(null);
      setShowResult(false);

      if (questionIndex + 1 >= questions.length) {
        endGame();
      } else {
        nextQuestion();
        setTimeLeft(diffSettings.timerSec);
      }
    }, 1500);
  }, [showResult, currentQuestion, timeLeft, currentStreak, questionIndex, questions.length, answerQuestion, endGame, nextQuestion, diffSettings.timerSec]);

  // Keep ref updated with latest handleAnswer
  useEffect(() => {
    handleAnswerRef.current = handleAnswer;
  }, [handleAnswer]);

  // A restart (the header button) puts the store back to "ready" and shows the
  // start card. Cancel the pending answer pause: left running it called
  // endGame() over the fresh start card and counted a game nobody played.
  useEffect(() => {
    if (gameState !== "ready") return;
    if (nextQuestionTimeoutRef.current) {
      clearTimeout(nextQuestionTimeoutRef.current);
      nextQuestionTimeoutRef.current = null;
    }
  }, [gameState]);

  // Never leave the pause running after the app unmounts.
  useEffect(() => {
    return () => {
      if (nextQuestionTimeoutRef.current) clearTimeout(nextQuestionTimeoutRef.current);
    };
  }, []);

  // Timer countdown. The updater only counts — side effects in a state
  // updater are illegal (calling handleAnswer inside it fired React's
  // "setState while rendering" warning every time the clock ran out).
  useEffect(() => {
    if (gameState !== "playing" || showResult) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameState, questionIndex, showResult]);

  // Time's up - counts as a wrong answer (use ref for fresh closure)
  useEffect(() => {
    if (gameState !== "playing" || showResult) return;
    if (timeLeft === 0 && questions.length > 0) {
      handleAnswerRef.current(null);
    }
  }, [timeLeft, gameState, showResult, questions.length]);

  // Reset game
  const handlePlayAgain = () => {
    reset();
    setQuestions([]);
    setSelectedAnswer(null);
    setShowResult(false);
    setTimeLeft(0);
    setError(null);
    setBestStreakThisGame(0);
    setAttempt(0);
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-indigo-900 via-purple-900 to-pink-900 text-white">
      <IOSInstallPrompt />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Ready screen: the shared start overlay. It renders the title once
            and carries the read-aloud button; the age picker and this round's
            stats live in its children slot. */}
        {gameState === "ready" && (
          <GameStartOverlay
            key={attempt}
            title="Trivia Quiz"
            emoji="🧠"
            subtitle="Test your knowledge!"
            touchHints={[
              "👆 Tap the right answer",
              "⏱️ Answer fast to get more points",
              "🔥 Get them right in a row for a streak",
            ]}
            keyboardHints={[
              "🖱️ Click the right answer",
              "⏱️ Answer fast to get more points",
              "🔥 Get them right in a row for a streak",
            ]}
            startLabel="🎮 Start Quiz!"
            spokenChoices={`Pick how old you are: ${(
              Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]
            )
              .map((diff) => DIFFICULTY_SETTINGS[diff].label)
              .join(", ")}.`}
            onStart={handleStartGame}
          >
            {gamesPlayed > 0 && (
              <div className="text-base font-medium opacity-90">
                🏆 High Score: {highScore}
                <div className="text-sm opacity-80">
                  {totalCorrect}/{totalAnswered} correct (
                  {totalAnswered > 0
                    ? Math.round((totalCorrect / totalAnswered) * 100)
                    : 0}
                  %) · 🔥 Best Streak: {longestStreak}
                </div>
              </div>
            )}

            <div className="text-sm font-bold opacity-80">How old are you?</div>
            {/* Two columns with the odd last choice spanning both, the same
                pattern space-invaders uses: an odd count in a plain 2-up grid
                left a lone half-width cell dangling. */}
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((diff, index, all) => (
                <GameStartOverlayButton
                  key={diff}
                  onClick={() => setDifficulty(diff)}
                  aria-pressed={settings.difficulty === diff}
                  className={`${settings.difficulty === diff ? "btn-primary" : ""} ${
                    all.length % 2 === 1 && index === all.length - 1
                      ? "col-span-2"
                      : ""
                  }`}
                >
                  {DIFFICULTY_SETTINGS[diff].emoji} {diff}
                </GameStartOverlayButton>
              ))}
            </div>
            {settings.difficulty === "99yo" && (
              <div className="text-sm opacity-80">
                Grandpa mode: Big text, more time, easy questions!
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-xl bg-red-500/20 p-3 text-base font-bold text-red-200"
              >
                {error}
              </div>
            )}
          </GameStartOverlay>
        )}

        {/* Playing Screen */}
        {gameState === "playing" && currentQuestion && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
              <div className="text-lg">
                Question {questionIndex + 1}/{questions.length}
              </div>
              <div className="text-lg font-bold">Score: {currentScore}</div>
            </div>

            {/* Timer */}
            <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ${
                  timeLeft <= 5 ? "bg-red-500" : timeLeft <= 10 ? "bg-yellow-500" : "bg-green-500"
                }`}
                style={{ width: `${(timeLeft / diffSettings.timerSec) * 100}%` }}
              />
            </div>
            <div className="text-center text-2xl font-bold">
              {timeLeft}s
            </div>

            {/* Streak */}
            {currentStreak > 0 && (
              <div className="text-center text-yellow-400 font-bold animate-pulse">
                🔥 {currentStreak} streak! (+{currentStreak * POINTS.streakBonus} bonus)
              </div>
            )}

            {/* Question */}
            <div className="bg-white/10 rounded-2xl p-6 space-y-4">
              <div className="text-sm text-purple-300">{currentQuestion.category}</div>
              <div className={`font-bold ${diffSettings.fontSize}`}>
                {currentQuestion.question}
              </div>
            </div>

            {/* Answers */}
            <div className="grid grid-cols-1 gap-3">
              {currentQuestion.answers.map((answer, i) => {
                const isCorrect = answer === currentQuestion.correctAnswer;
                const isSelected = answer === selectedAnswer;
                let buttonClass = "bg-white/20 hover:bg-white/30";

                if (showResult) {
                  if (isCorrect) {
                    buttonClass = "bg-green-500 ring-4 ring-green-300";
                  } else if (isSelected && !isCorrect) {
                    buttonClass = "bg-red-500 ring-4 ring-red-300";
                  } else {
                    buttonClass = "bg-white/10 opacity-50";
                  }
                }

                return (
                  <button
                    key={i}
                    onClick={() => handleAnswer(answer)}
                    disabled={showResult}
                    className={`w-full rounded-xl font-bold transition-all ${diffSettings.buttonSize} ${buttonClass}`}
                  >
                    {answer}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Finished Screen */}
        {gameState === "finished" && (
          <div className="text-center space-y-8">
            <h1 className="text-5xl font-bold">🎉 Quiz Complete!</h1>

            <div className="bg-white/10 rounded-2xl p-6 space-y-4">
              <div className="text-4xl font-bold text-yellow-400">
                {currentScore} points
              </div>
              {currentScore >= highScore && currentScore > 0 && (
                <div className="text-green-400 font-bold animate-bounce">
                  🏆 NEW HIGH SCORE!
                </div>
              )}
              <div className="text-lg">
                {questions.filter((_, i) => i < questionIndex + 1).length} questions answered
              </div>
              <div className="text-purple-200">
                Best streak this game: {bestStreakThisGame}
              </div>
            </div>

            <div className="flex gap-4 justify-center">
              <button
                onClick={handlePlayAgain}
                className="btn btn-primary btn-lg text-xl px-8 rounded-full"
              >
                🔄 Play Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Trivia;
