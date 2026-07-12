"use client";

import { useEffect } from "react";

import { useAuthSync } from "@/shared/hooks/useAuthSync";
import {
  getAchievementInfo,
  useAchievementsStore,
  type AchievementInfo,
  type AchievementsProgress,
} from "@/shared/lib/achievements";

const SHOW_MS = 4000;

// Deterministic confetti burst — CSS keyframes only, no dependencies.
const CONFETTI = [
  { left: "12%", delay: "0s", emoji: "🎉" },
  { left: "28%", delay: "0.15s", emoji: "⭐" },
  { left: "44%", delay: "0.05s", emoji: "🎊" },
  { left: "58%", delay: "0.2s", emoji: "✨" },
  { left: "72%", delay: "0.1s", emoji: "⭐" },
  { left: "86%", delay: "0.25s", emoji: "🎉" },
] as const;

/**
 * Global celebration layer for the Trophy Case: mounts once in the root
 * layout, syncs the achievements blob to the cloud for signed-in kids, and
 * pops a confetti toast for each unlock in the session queue.
 *
 * The layer and the toast are pointer-events-none so a celebration can never
 * eat a mid-game tap (the cookie-clicker toast lesson); the single
 * interactive element is the >=44px "Yay!" dismiss button.
 */
export function AchievementCelebrations() {
  const dequeueCelebration = useAchievementsStore((s) => s.dequeueCelebration);
  // The queue head IS the current celebration — no mirrored local state.
  const currentId = useAchievementsStore((s) => s.celebrationQueue[0] ?? null);

  // Cloud sync for the achievements blob itself (guests stay local-only).
  useAuthSync<AchievementsProgress>({
    appId: "achievements",
    localStorageKey: "achievements-progress",
    getState: () => useAchievementsStore.getState().getProgress(),
    setState: (data) => useAchievementsStore.getState().setProgress(data),
  });

  // Auto-advance: each unlock gets its show window, then the queue shifts.
  useEffect(() => {
    if (currentId === null) return;
    const timer = setTimeout(() => dequeueCelebration(), SHOW_MS);
    return () => clearTimeout(timer);
  }, [currentId, dequeueCelebration]);

  if (currentId === null) return null;
  const current: AchievementInfo = getAchievementInfo(currentId);

  return (
    <div
      className="fixed inset-x-0 top-14 z-[1100] flex justify-center pointer-events-none"
      role="status"
      aria-live="polite"
      data-testid="achievement-celebration"
    >
      <div className="relative mx-4 max-w-sm w-full">
        {/* Confetti */}
        {CONFETTI.map((piece, i) => (
          <span
            key={i}
            className="confetti-piece"
            style={{ left: piece.left, animationDelay: piece.delay }}
            aria-hidden="true"
          >
            {piece.emoji}
          </span>
        ))}

        {/* Toast card */}
        <div className="achievement-pop rounded-2xl bg-gradient-to-r from-yellow-400 to-orange-400 shadow-2xl px-4 py-3 flex items-center gap-3">
          <span className="text-4xl" aria-hidden="true">
            {current.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-lg text-yellow-950 truncate">
              🏆 {current.name}
            </div>
            <div className="text-sm text-yellow-900 truncate">
              {current.description}
            </div>
          </div>
          <button
            onClick={() => dequeueCelebration()}
            className="pointer-events-auto shrink-0 min-w-[44px] min-h-[44px] rounded-xl bg-white/40 hover:bg-white/60 active:scale-95 font-bold text-yellow-950 px-3 transition-all"
            aria-label="Dismiss celebration"
          >
            Yay!
          </button>
        </div>
      </div>
    </div>
  );
}
