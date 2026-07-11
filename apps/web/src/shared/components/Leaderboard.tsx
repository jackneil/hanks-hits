"use client";

import { useState, useEffect, useCallback } from "react";
import { plural } from "@/shared/lib/pluralize";

export interface LeaderboardEntry {
  rank: number;
  handle: string;
  score: number;
  additionalStats?: Record<string, string | number> | null;
  achievedAt?: string | null;
}

export interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  myEntry: { rank: number; handle: string; score: number } | null;
  totalPlayers: number;
  period: "all" | "week" | "month";
  scoreType?: ScoreType;
}

interface LeaderboardProps {
  appId: string;
  gameName: string;
  icon?: string;
  className?: string;
  showPeriodSelector?: boolean;
  /** Hide the icon + game-name header when the surrounding page already names the game */
  showTitle?: boolean;
  initialPeriod?: "all" | "week" | "month";
  limit?: number;
  compact?: boolean;
}

type ScoreType = "high_score" | "wins" | "fastest_time";

const PERIOD_LABELS = {
  all: "All Time",
  week: "This Week",
  month: "This Month",
};

function formatScore(score: number, scoreType?: ScoreType): string {
  if (scoreType === "fastest_time") {
    // Handle seconds, minutes, and hours
    if (score < 60) return `${score.toFixed(1)}s`;
    if (score < 3600) {
      const mins = Math.floor(score / 60);
      const secs = Math.floor(score % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    }
    // Hours:minutes:seconds for very long times
    const hours = Math.floor(score / 3600);
    const mins = Math.floor((score % 3600) / 60);
    const secs = Math.floor(score % 60);
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  if (scoreType === "wins") {
    return `${score.toLocaleString()} wins`;
  }
  return score.toLocaleString();
}

function getRankBadge(rank: number): { emoji: string; label: string } | null {
  switch (rank) {
    case 1:
      return { emoji: "🥇", label: "First Place" };
    case 2:
      return { emoji: "🥈", label: "Second Place" };
    case 3:
      return { emoji: "🥉", label: "Third Place" };
    default:
      return null;
  }
}

function LeaderboardSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Loading leaderboard">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 bg-slate-700/30 rounded-lg"
        >
          <div className="w-8 h-6 bg-slate-600 rounded" />
          <div className="flex-1 h-5 bg-slate-600 rounded" />
          <div className="w-16 h-5 bg-slate-600 rounded" />
        </div>
      ))}
    </div>
  );
}

export function Leaderboard({
  appId,
  gameName,
  icon = "🏆",
  className = "",
  showPeriodSelector = true,
  showTitle = true,
  initialPeriod = "all",
  limit = 100,
  compact = false,
}: LeaderboardProps) {
  const [period, setPeriod] = useState<"all" | "week" | "month">(initialPeriod);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scoreType, setScoreType] = useState<ScoreType>("high_score");

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        period,
        limit: String(limit),
        includeMe: "true",
      });

      const res = await fetch(`/api/leaderboards/${appId}?${params}`);

      if (!res.ok) {
        // Handle non-JSON error responses (502, HTML error pages, etc.)
        const contentType = res.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          const err = await res.json();
          throw new Error(err.error || "Failed to fetch leaderboard");
        } else {
          throw new Error(`Server error (${res.status})`);
        }
      }

      const result = await res.json();
      setData(result);

      // Use scoreType from API response for proper formatting
      if (result.scoreType) {
        setScoreType(result.scoreType);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [appId, period, limit]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const handleRetry = () => {
    fetchLeaderboard();
  };

  // Period selector buttons
  const PeriodSelector = () => (
    <div className="flex gap-1 bg-slate-800 p-1 rounded-lg" role="tablist" aria-label="Time period">
      {(["week", "month", "all"] as const).map((p) => (
        <button
          key={p}
          role="tab"
          aria-selected={period === p}
          onClick={() => setPeriod(p)}
          className={`
            px-3 py-2 rounded-md text-sm font-medium transition-colors
            min-w-[44px] min-h-[44px]
            ${period === p
              ? "bg-primary text-primary-content"
              : "text-slate-400 hover:text-white hover:bg-slate-700"
            }
          `}
        >
          {PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );

  // Current user's rank sticky footer
  const MyRankFooter = () => {
    if (!data?.myEntry) return null;

    const badge = getRankBadge(data.myEntry.rank);

    return (
      <div
        className="sticky bottom-0 left-0 right-0 p-3 bg-primary/90 backdrop-blur-sm rounded-b-lg border-t border-primary-focus"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg">#{data.myEntry.rank}</span>
            {badge && <span aria-label={badge.label}>{badge.emoji}</span>}
            <span className="font-medium">{data.myEntry.handle}</span>
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded">YOU</span>
          </div>
          <span className="font-bold text-lg">{formatScore(data.myEntry.score, scoreType)}</span>
        </div>
        <div className="text-xs opacity-80 mt-1">
          Your rank: {data.myEntry.rank.toLocaleString()} of {data.totalPlayers.toLocaleString()} {plural(data.totalPlayers, "player")}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex flex-col text-white ${className}`}>
      {/* Header. showTitle=false when the surrounding page already names the
          game (the leaderboards page banner) — the title must render once. */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {showTitle && (
            <>
              <span className="text-2xl" aria-hidden="true">{icon}</span>
              <h2 className="text-xl font-bold">{gameName}</h2>
            </>
          )}
          {data && (
            <span className="text-sm text-slate-400">
              ({data.totalPlayers.toLocaleString()} {plural(data.totalPlayers, "player")})
            </span>
          )}
        </div>
        {showPeriodSelector && <PeriodSelector />}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden rounded-lg bg-slate-800/50 border border-slate-700">
        {loading && <div className="p-4"><LeaderboardSkeleton rows={compact ? 5 : 10} /></div>}

        {error && (
          <div className="p-8 text-center">
            <div className="text-4xl mb-4">😢</div>
            <p className="text-slate-400 mb-4">{error}</p>
            <button
              onClick={handleRetry}
              className="btn btn-primary min-w-[44px] min-h-[44px]"
            >
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && data && data.leaderboard.length === 0 && (
          <div className="p-8 text-center">
            <div className="text-4xl mb-4">🎮</div>
            <p className="text-slate-400">
              {period === "all"
                ? "Be the first to play! Your score will appear here."
                : `No scores ${period === "week" ? "this week" : "this month"} yet. Play now!`}
            </p>
          </div>
        )}

        {!loading && !error && data && data.leaderboard.length > 0 && (
          <div className="relative">
            {/* Scrollable entries */}
            <div
              className={`overflow-y-auto ${compact ? "max-h-[300px]" : "max-h-[500px]"}`}
              role="table"
              aria-label={`${gameName} leaderboard, ${PERIOD_LABELS[period]}`}
            >
              <div role="rowgroup">
                {/* Header row */}
                <div
                  role="row"
                  className="sticky top-0 flex items-center gap-3 p-3 bg-slate-800 text-slate-400 text-sm font-medium border-b border-slate-700"
                >
                  <div role="columnheader" className="w-12">Rank</div>
                  <div role="columnheader" className="flex-1">Player</div>
                  <div role="columnheader" className="w-24 text-right">Score</div>
                </div>

                {/* Entries */}
                {data.leaderboard.map((entry, index) => {
                  const badge = getRankBadge(entry.rank);
                  const isCurrentUser = data.myEntry?.handle === entry.handle;

                  return (
                    <div
                      key={`${entry.handle}-${entry.rank}`}
                      role="row"
                      className={`
                        flex items-center gap-3 p-3 border-b border-slate-700/50
                        transition-colors hover:bg-slate-700/30
                        ${isCurrentUser ? "bg-primary/20 border-l-4 border-l-primary" : ""}
                        ${index % 2 === 0 ? "bg-slate-800/30" : ""}
                      `}
                    >
                      {/* Rank */}
                      <div role="cell" className="w-12 flex items-center gap-1">
                        {badge ? (
                          <span
                            className="text-xl"
                            aria-label={badge.label}
                          >
                            {badge.emoji}
                          </span>
                        ) : (
                          <span className="font-mono text-slate-400">
                            #{entry.rank}
                          </span>
                        )}
                      </div>

                      {/* Handle */}
                      <div role="cell" className="flex-1 flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">
                          {entry.handle}
                        </span>
                        {isCurrentUser && (
                          <span className="text-xs bg-primary/30 text-primary px-2 py-0.5 rounded shrink-0">
                            YOU
                          </span>
                        )}
                      </div>

                      {/* Score */}
                      <div role="cell" className="w-24 text-right font-bold tabular-nums">
                        {formatScore(entry.score, scoreType)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* My rank footer */}
            {data.myEntry && data.myEntry.rank > limit && <MyRankFooter />}
          </div>
        )}
      </div>

      {/* Screen reader announcement */}
      {data && (
        <div className="sr-only" role="status" aria-live="polite">
          {data.myEntry
            ? `Leaderboard showing ${data.leaderboard.length} of ${data.totalPlayers} ${plural(data.totalPlayers, "player")}. Your rank is ${data.myEntry.rank}.`
            : `Leaderboard showing ${data.leaderboard.length} of ${data.totalPlayers} ${plural(data.totalPlayers, "player")}.`}
        </div>
      )}
    </div>
  );
}
