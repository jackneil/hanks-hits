"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTriviaStore, type TriviaProgress } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { ResultChip } from "@/shared/components/ResultChip";
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
      // Names the real button (it says "Start Quiz!", not "Play").
      setError("😕 The questions did not load. Tap Start Quiz! to try again.");
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

  // The shell holds the quiz under a shell overlay (the restart question,
  // the install steps) and in a hidden tab: the clock does not run there.
  const held = useShellHold();

  // Timer countdown. The updater only counts — side effects in a state
  // updater are illegal (calling handleAnswer inside it fired React's
  // "setState while rendering" warning every time the clock ran out).
  useEffect(() => {
    if (gameState !== "playing" || showResult || held) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameState, questionIndex, showResult, held]);

  // Time's up - counts as a wrong answer (use ref for fresh closure)
  useEffect(() => {
    if (gameState !== "playing" || showResult) return;
    if (timeLeft === 0 && questions.length > 0) {
      handleAnswerRef.current(null);
    }
  }, [timeLeft, gameState, showResult, questions.length]);

  // Play again from the result: a new quiz at once, at the same age.
  const playAgainNow = () => {
    handlePlayAgain();
    handleStartGame();
  };

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
    <div className="relative min-h-full bg-gradient-to-b from-indigo-900 via-purple-900 to-pink-900 text-white">
      <IOSInstallPrompt />

      <div className="container mx-auto max-w-2xl px-4 py-3 short:max-w-none short:px-3 short:py-2">
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
                  {DIFFICULTY_SETTINGS[diff].emoji} {DIFFICULTY_SETTINGS[diff].label}
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

        {/* Playing Screen: one header line and a thin clock, then the
            question and its answers. Sideways the question sits beside the
            answers, so all four are on the screen when the clock starts
            (the first answer was at y=392 of 311). */}
        {gameState === "playing" && currentQuestion && (
          <div data-testid="trivia-playing" className="space-y-3 short:space-y-2">
            <div className="flex items-center justify-between gap-2 text-base">
              <div>
                Question {questionIndex + 1}/{questions.length}
              </div>
              <div
                aria-label={`${timeLeft} seconds left`}
                className={`rounded-full px-3 py-0.5 font-bold ${timeLeft <= 5 ? "bg-red-500" : "bg-white/15"}`}
              >
                ⏱ {timeLeft}s
              </div>
              <div className="font-bold">⭐ {currentScore}</div>
            </div>

            {/* Timer */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
              <div
                className={`h-full transition-all duration-1000 ${
                  timeLeft <= 5 ? "bg-red-500" : timeLeft <= 10 ? "bg-yellow-500" : "bg-green-500"
                }`}
                style={{ width: `${(timeLeft / diffSettings.timerSec) * 100}%` }}
              />
            </div>

            <div className="space-y-3 short:grid short:grid-cols-2 short:items-start short:gap-3 short:space-y-0">
              {/* Question */}
              <div className="space-y-2 rounded-2xl bg-white/10 p-4 short:p-3">
                <div className="text-sm text-purple-200">{currentQuestion.category}</div>
                <div className={`font-bold ${diffSettings.fontSize} short:text-lg`}>{currentQuestion.question}</div>
                {/* Streak */}
                {currentStreak > 0 && (
                  <div className="font-bold text-yellow-300">
                    🔥 {currentStreak} streak! (+{currentStreak * POINTS.streakBonus} bonus)
                  </div>
                )}
              </div>

              {/* Answers */}
              <div data-testid="trivia-answers" className="grid grid-cols-1 gap-2">
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
                      type="button"
                      onClick={() => handleAnswer(answer)}
                      disabled={showResult}
                      className={`min-h-11 w-full rounded-xl px-3 font-bold transition-all ${diffSettings.buttonSize} short:py-2 short:text-base ${buttonClass}`}
                    >
                      {answer}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Finished Screen: the score here, and the shared result chip for
            Read it to me, Play again (a new quiz at once) and the
            leaderboard. */}
        {gameState === "finished" && (
          <div data-testid="trivia-finished" className="space-y-3 text-center short:space-y-2">
            <h1 className="text-4xl font-bold short:text-2xl">🎉 Quiz Complete!</h1>
            <div className="space-y-2 rounded-2xl bg-white/10 p-4 short:p-3">
              <div className="text-4xl font-bold text-yellow-300 short:text-3xl">{currentScore} points</div>
              {currentScore >= highScore && currentScore > 0 && (
                <div className="font-bold text-green-300">🏆 NEW HIGH SCORE!</div>
              )}
              <div className="text-lg">
                {questions.filter((_, i) => i < questionIndex + 1).length} questions answered
              </div>
              <div className="text-purple-100">Best streak this game: {bestStreakThisGame}</div>
            </div>
            <ResultChip
              resultText={quizResultText({
                score: currentScore,
                answered: questions.filter((_, i) => i < questionIndex + 1).length,
                newBest: currentScore >= highScore && currentScore > 0,
              })}
              appId="trivia"
              onRestart={playAgainNow}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default Trivia;

/** The result, read out loud first by the result chip. */
export function quizResultText({ score, answered, newBest }: { score: number; answered: number; newBest: boolean }): string {
  const questions = answered === 1 ? "1 question" : `${answered} questions`;
  return `Quiz complete! You got ${score} points in ${questions}.${newBest ? " That is a new high score!" : ""}`;
}
