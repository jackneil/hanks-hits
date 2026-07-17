"use client";

import { useState } from "react";
import Link from "next/link";
import type { GameDisplayInfo } from "@/shared/lib/gameStatExtractor";
import { GameDetailView } from "./game-details";
import { getGameGradient } from "@/shared/lib/gameMetadata.generated";

interface GameProgressCardProps {
  game: GameDisplayInfo;
}

/**
 * Kid-friendly game progress card for the profile page.
 * Big, colorful, with fun stats.
 * Expandable to show full game details for supported games.
 */
export function GameProgressCard({ game }: GameProgressCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Format relative time (e.g., "2 hours ago", "Yesterday")
  const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  // Determine game URL - apps live at /apps/, games at /games/
  const gameUrl = game.isApp ? `/apps/${game.appId}` : `/games/${game.appId}`;

  // Toggle expand without navigating
  const handleExpandClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExpanded((prev) => !prev);
  };

  // Get static gradient classes (Tailwind can't analyze dynamic classes)
  const gradientClasses = getGameGradient(game.appId);

  return (
    <div
      className={`
        block p-4 rounded-2xl shadow-lg
        bg-gradient-to-br ${gradientClasses}
        border-2 border-white/20
        transition-all duration-200
      `}
    >
      {/* Header with icon and name */}
      <Link href={gameUrl} className="block">
        <div className="flex items-center gap-3 mb-3 hover:scale-[1.01] active:scale-[0.99] transition-transform">
          <span className="text-4xl">{game.icon}</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-white truncate">
              {game.displayName}
            </h3>
            <p className="text-white/60 text-sm">
              {formatRelativeTime(game.lastPlayed)}
            </p>
          </div>
        </div>
      </Link>

      {/* Primary stat - big and bold */}
      {game.primaryStat && (
        <div className="bg-white/20 rounded-xl p-3 mb-3 text-center">
          <div className="text-2xl font-bold text-white">
            {game.primaryStat.value}
          </div>
          <div className="text-white/70 text-sm">
            {game.primaryStat.label}
          </div>
        </div>
      )}

      {/* Progress bar if applicable */}
      {game.progress !== undefined && (
        <div className="mb-3">
          <div className="flex justify-between text-white/70 text-xs mb-1">
            <span>Progress</span>
            <span>{game.progress}%</span>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/80 rounded-full transition-all duration-500"
              style={{ width: `${game.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Secondary stats - smaller row */}
      {game.secondaryStats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {game.secondaryStats.slice(0, 3).map((stat, i) => (
            <div
              key={i}
              className="bg-white/10 rounded-lg px-2 py-1 text-xs text-white/80"
            >
              <span className="font-semibold">{stat.value}</span>{" "}
              <span className="text-white/60">{stat.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Expandable Details */}
      {game.hasDetailView && (
        <>
          {/* Expand/Collapse Button */}
          <button
            onClick={handleExpandClick}
            className="mt-3 w-full py-2 rounded-lg bg-white/10 hover:bg-white/20
                       active:bg-white/30 transition-colors text-white/70 text-sm
                       flex items-center justify-center gap-2 min-h-[44px]"
            aria-expanded={isExpanded}
          >
            <span>{isExpanded ? "Hide Details" : "Show Details"}</span>
            <span
              className={`transition-transform duration-200 ${
                isExpanded ? "rotate-180" : ""
              }`}
            >
              ▼
            </span>
          </button>

          {/* Detail View with Animation */}
          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              isExpanded ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            <GameDetailView game={game} />
          </div>
        </>
      )}

      {/* Play button - only show if no detail view OR if collapsed */}
      {(!game.hasDetailView || !isExpanded) && (
        <Link
          href={gameUrl}
          className="mt-3 block text-center py-2 rounded-lg bg-white/10 hover:bg-white/20
                     active:bg-white/30 transition-colors text-white/70 text-sm min-h-[44px]
                     flex items-center justify-center"
        >
          Tap to play!
        </Link>
      )}

      {/* Play button when expanded */}
      {game.hasDetailView && isExpanded && (
        <Link
          href={gameUrl}
          className="mt-3 block text-center py-2 rounded-lg bg-white/20 hover:bg-white/30
                     active:bg-white/40 transition-colors text-white text-sm font-medium
                     min-h-[44px] flex items-center justify-center gap-2"
        >
          <span>▶</span> Play Now!
        </Link>
      )}
    </div>
  );
}

export default GameProgressCard;
