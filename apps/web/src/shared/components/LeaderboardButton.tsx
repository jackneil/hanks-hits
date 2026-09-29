"use client";

import { useState } from "react";
import { LeaderboardModal } from "./LeaderboardModal";
import { getGameMetadata } from "../lib/gameMetadata.generated";

interface LeaderboardButtonProps {
  appId: string;
  className?: string;
  variant?: "icon" | "full";
}

/**
 * A button that opens the leaderboard modal for a specific game.
 * Can be added to any game's UI.
 *
 * Usage:
 * ```tsx
 * <LeaderboardButton appId="snake" />
 * ```
 *
 * Or with full label:
 * ```tsx
 * <LeaderboardButton appId="snake" variant="full" />
 * ```
 */
export function LeaderboardButton({
  appId,
  className = "",
  variant = "icon",
}: LeaderboardButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const metadata = getGameMetadata(appId);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`
          flex items-center justify-center gap-2 transition-all
          min-w-[44px] min-h-[44px]
          ${variant === "icon"
            ? "text-2xl hover:scale-110 active:scale-95"
            : "px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold rounded-xl shadow-lg hover:scale-105 active:scale-95"
          }
          ${className}
        `}
        title="View Leaderboard"
        aria-label={`View ${metadata.name} leaderboard`}
      >
        <span>🏆</span>
        {variant === "full" && <span>Leaderboard</span>}
      </button>

      <LeaderboardModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        appId={appId}
        gameName={metadata.name}
        icon={metadata.icon}
      />
    </>
  );
}
