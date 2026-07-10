"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTriviaStore, type TriviaProgress } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
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
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const handleAnswerRef = useRef<(answer: string | null) => void>(() => {});

  const diffSettings = getDifficultySettings(settings.difficulty);
  const currentQuestion = questions[questionIndex];

  // Build this round's questions from the bundled bank - returns them for checking
  const loadQuestions = useCallback((): PreparedQuestion[] => {
    setError(null);
    const diff = getDifficultySettings(settings.difficulty);
    const rawQuestions = getQuestions(diff.questionsPerRound, diff.difficulty);

    if (rawQuestions.length === 0) {
      setError("No questions available right now. Please try again!");
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
      // Error state will be shown
      return;
    }
    setBestStreakThisGame(0);
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
    setTimeout(() => {
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

  // Timer countdown
  useEffect(() => {
    if (gameState !== "playing" || showResult) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Time's up - wrong answer (use ref for fresh closure)
          handleAnswerRef.current(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameState, questionIndex, showResult]);

  // Reset game
  const handlePlayAgain = () => {
    reset();
    setQuestions([]);
    setSelectedAnswer(null);
    setShowResult(false);
    setTimeLeft(0);
    setError(null);
    setBestStreakThisGame(0);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-900 via-purple-900 to-pink-900 text-white">
      <IOSInstallPrompt />
      <FullscreenButton />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Ready Screen */}
        {gameState === "ready" && (
          <div className="text-center space-y-8">
            <h1 className="text-5xl font-bold mb-4">🧠 Trivia Quiz</h1>
            <p className="text-xl text-purple-200">Test your knowledge!</p>

            {/* Stats */}
            {gamesPlayed > 0 && (
              <div className="bg-white/10 rounded-2xl p-4 space-y-2">
                <div className="text-lg">🏆 High Score: {highScore}</div>
                <div className="text-sm text-purple-200">
                  {totalCorrect}/{totalAnswered} correct ({totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0}%)
                </div>
                <div className="text-sm text-purple-200">
                  🔥 Best Streak: {longestStreak}
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
              {settings.difficulty === "99yo" && (
                <div className="text-purple-300 text-sm">
                  Grandpa mode: Big text, more time, easy questions!
                </div>
              )}
            </div>

            {/* Error State */}
            {error && (
              <div className="bg-red-500/20 border border-red-500 rounded-xl p-4 text-red-200">
                {error}
              </div>
            )}

            {/* Start Button */}
            <button
              onClick={handleStartGame}
              className="btn btn-primary btn-lg text-xl px-12 py-4 rounded-full shadow-lg hover:scale-105 transition-transform"
            >
              🎮 Start Quiz!
            </button>
          </div>
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
