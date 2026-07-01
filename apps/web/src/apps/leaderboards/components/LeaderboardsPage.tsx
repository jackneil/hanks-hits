"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Leaderboard } from "@/shared/components/Leaderboard";
import { Header } from "@/shared/components/Header";
import {
  getGameMetadata,
} from "@/shared/lib/gameMetadata.generated";
import { getPlayableHref } from "@/shared/lib/app-routing";
import { LEADERBOARD_ENABLED_GAMES } from "@/lib/leaderboard-extractors";

interface MyRank {
  appId: string;
  gameName: string;
  icon: string;
  rank: number;
  score: number;
  scoreType: string;
  totalPlayers: number;
}

interface MyRanksData {
  handle: string | null;
  ranks: MyRank[];
}

// Floating background elements
const FLOATING_ICONS = ["🏆", "⭐", "🎮", "👑", "💎", "🔥", "⚡", "🎯", "🥇", "🌟"];

// Get leaderboard games with their metadata
const LEADERBOARD_GAMES = LEADERBOARD_ENABLED_GAMES.map((appId) => {
  const meta = getGameMetadata(appId);
  return {
    appId,
    name: meta.name,
    icon: meta.icon,
  };
});

function getRankBadge(rank: number): { emoji: string; color: string; glow: string } {
  switch (rank) {
    case 1:
      return { emoji: "🥇", color: "from-yellow-300 to-amber-500", glow: "shadow-yellow-500/50" };
    case 2:
      return { emoji: "🥈", color: "from-slate-300 to-slate-400", glow: "shadow-slate-400/50" };
    case 3:
      return { emoji: "🥉", color: "from-orange-400 to-orange-600", glow: "shadow-orange-500/50" };
    default:
      return { emoji: "🎮", color: "from-purple-400 to-pink-500", glow: "shadow-purple-500/30" };
  }
}

export function LeaderboardsPage() {
  const { data: session, status } = useSession();
  const [selectedGame, setSelectedGame] = useState<string>(
    LEADERBOARD_GAMES[0]?.appId || "2048"
  );
  const [myRanks, setMyRanks] = useState<MyRanksData | null>(null);
  const [myRanksLoading, setMyRanksLoading] = useState(false);

  // Game selector scroll state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // Update scroll button visibility
  const updateScrollButtons = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  // Scroll handlers
  const scrollLeft = () => {
    scrollContainerRef.current?.scrollBy({ left: -200, behavior: 'smooth' });
  };
  const scrollRight = () => {
    scrollContainerRef.current?.scrollBy({ left: 200, behavior: 'smooth' });
  };

  // Update scroll buttons on mount and resize
  useEffect(() => {
    updateScrollButtons();
    window.addEventListener('resize', updateScrollButtons);
    return () => window.removeEventListener('resize', updateScrollButtons);
  }, [updateScrollButtons]);

  // Fetch user's ranks
  useEffect(() => {
    if (status !== "authenticated") {
      setMyRanks(null);
      return;
    }

    const fetchMyRanks = async () => {
      setMyRanksLoading(true);
      try {
        const res = await fetch("/api/leaderboards/my-ranks");
        if (res.ok) {
          const data = await res.json();
          setMyRanks(data);
        }
      } catch (err) {
        console.error("Failed to fetch my ranks:", err);
      } finally {
        setMyRanksLoading(false);
      }
    };

    fetchMyRanks();
  }, [status]);

  const selectedGameMeta = getGameMetadata(selectedGame);

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-hidden relative">
      {/* Animated gradient background */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900/30 via-slate-950 to-cyan-900/30 pointer-events-none" />

      {/* Scanline overlay for retro feel */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 4px)',
        }}
      />

      {/* Floating background icons */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {FLOATING_ICONS.map((icon, i) => (
          <span
            key={i}
            className="absolute text-3xl md:text-5xl opacity-[0.07] animate-float-slow"
            style={{
              left: `${5 + (i * 10) % 90}%`,
              top: `${10 + (i * 13) % 80}%`,
              animationDelay: `${i * 0.7}s`,
              animationDuration: `${6 + (i % 4)}s`,
            }}
          >
            {icon}
          </span>
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10">
        <Header title="Hall of Fame" titleIcon="🏆" />

        {/* Hero Section */}
        <section className="relative py-8 md:py-12 overflow-hidden">
          {/* Glowing orbs background */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-radial from-yellow-500/20 via-transparent to-transparent blur-3xl pointer-events-none" />
          <div className="absolute top-1/4 left-1/4 w-[300px] h-[300px] bg-gradient-radial from-pink-500/10 via-transparent to-transparent blur-3xl pointer-events-none" />
          <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-gradient-radial from-cyan-500/10 via-transparent to-transparent blur-3xl pointer-events-none" />

          <div className="max-w-4xl mx-auto px-4 text-center">
            {/* Giant Trophy */}
            <div className="relative inline-block mb-4">
              <span className="text-8xl md:text-[10rem] drop-shadow-[0_0_40px_rgba(250,204,21,0.4)] animate-pulse-glow">
                🏆
              </span>
              {/* Sparkle effects */}
              <span className="absolute top-4 right-0 text-2xl animate-sparkle">✨</span>
              <span className="absolute top-8 left-0 text-xl animate-sparkle-delayed">⭐</span>
              <span className="absolute bottom-8 right-4 text-lg animate-sparkle">💫</span>
            </div>

            <p className="text-white/60 text-lg md:text-xl font-medium">
              Can you make it to the top?
            </p>
          </div>
        </section>

        {/* My Rankings Summary (Authenticated Only) */}
        {status === "authenticated" && (
          <section className="max-w-4xl mx-auto px-4 mb-8">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 backdrop-blur-sm">
              {/* Animated border glow */}
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-yellow-500/20 via-pink-500/20 to-cyan-500/20 blur-xl opacity-50" />

              <div className="relative p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-3">
                  <span className="text-2xl">👑</span>
                  <span className="bg-gradient-to-r from-yellow-300 to-pink-400 bg-clip-text text-transparent">
                    Your Rankings
                  </span>
                </h2>

                {myRanksLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="relative">
                      <div className="animate-spin text-4xl">🎮</div>
                      <div className="absolute inset-0 animate-ping text-4xl opacity-30">🎮</div>
                    </div>
                  </div>
                ) : myRanks && myRanks.ranks.length > 0 ? (
                  <div className="grid gap-3">
                    {myRanks.ranks.slice(0, 3).map((rank, index) => {
                      const badge = getRankBadge(rank.rank);
                      return (
                        <button
                          key={rank.appId}
                          onClick={() => setSelectedGame(rank.appId)}
                          className={`
                            group relative w-full flex items-center gap-4 p-4 rounded-2xl transition-all duration-300
                            ${selectedGame === rank.appId
                              ? "bg-gradient-to-r from-yellow-500/20 to-pink-500/20 ring-2 ring-yellow-400/50 scale-[1.02]"
                              : "bg-white/5 hover:bg-white/10 hover:scale-[1.01]"
                            }
                          `}
                          style={{ animationDelay: `${index * 0.1}s` }}
                        >
                          {/* Rank Badge */}
                          <div className={`
                            relative w-14 h-14 rounded-xl bg-gradient-to-br ${badge.color}
                            flex items-center justify-center shadow-lg ${badge.glow}
                            group-hover:scale-110 transition-transform
                          `}>
                            <span className="text-2xl">{badge.emoji}</span>
                            <span className="absolute -bottom-1 -right-1 text-xs font-black bg-slate-900 text-white px-1.5 py-0.5 rounded-md">
                              #{rank.rank}
                            </span>
                          </div>

                          {/* Game Info */}
                          <div className="flex-1 text-left">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">{rank.icon}</span>
                              <span className="font-bold text-white text-lg">{rank.gameName}</span>
                            </div>
                            <div className="text-sm text-white/50 mt-0.5">
                              Top {rank.totalPlayers > 0 ? Math.round((rank.rank / rank.totalPlayers) * 100) : 0}% of {rank.totalPlayers.toLocaleString()} players
                            </div>
                          </div>

                          {/* Score */}
                          <div className="text-right">
                            <div className="font-black text-2xl tabular-nums bg-gradient-to-r from-yellow-300 to-pink-400 bg-clip-text text-transparent">
                              {rank.score.toLocaleString()}
                            </div>
                            <div className="text-xs text-white/40 uppercase tracking-wider">
                              {rank.scoreType === "high_score" ? "points" : rank.scoreType === "wins" ? "wins" : "time"}
                            </div>
                          </div>

                          {/* Hover glow */}
                          <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-yellow-500/0 via-yellow-500/5 to-pink-500/0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                        </button>
                      );
                    })}

                    {myRanks.ranks.length > 3 && (
                      <Link
                        href="/profile"
                        className="flex items-center justify-center gap-2 py-3 text-white/50 hover:text-white/80 transition-colors group"
                      >
                        <span>View all {myRanks.ranks.length} rankings</span>
                        <span className="group-hover:translate-x-1 transition-transform">→</span>
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="text-6xl mb-4 animate-bounce-slow">🎮</div>
                    <p className="text-white/60 text-lg mb-2">No rankings yet!</p>
                    <p className="text-white/40 text-sm">Play some games to climb the leaderboards</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Game Selector */}
        <section className="mb-6">
          <h3 className="max-w-4xl mx-auto px-4 text-sm font-bold text-white/40 uppercase tracking-wider mb-3">
            Select Game
          </h3>
          {/* Outer wrapper constrains width */}
          <div className="max-w-4xl mx-auto px-4">
            <div className="relative">
              {/* Left arrow button */}
              {canScrollLeft && (
                <button
                  onClick={scrollLeft}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-11 h-11 flex items-center justify-center bg-slate-900/90 hover:bg-slate-800 border border-white/20 rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
                  aria-label="Scroll left"
                >
                  <span className="text-xl text-white">←</span>
                </button>
              )}

              {/* Right arrow button */}
              {canScrollRight && (
                <button
                  onClick={scrollRight}
                  className="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-11 h-11 flex items-center justify-center bg-slate-900/90 hover:bg-slate-800 border border-white/20 rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
                  aria-label="Scroll right"
                >
                  <span className="text-xl text-white">→</span>
                </button>
              )}

              {/* Fade edges to indicate scrollability */}
              <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-slate-950 to-transparent z-10 pointer-events-none" />
              <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-slate-950 to-transparent z-10 pointer-events-none" />

              {/* Scroll container */}
              <div
                ref={scrollContainerRef}
                onScroll={updateScrollButtons}
                className="overflow-x-auto pb-2 px-6 scrollbar-hide"
                style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
              >
                <div className="flex flex-nowrap gap-2">
                  {LEADERBOARD_GAMES.map((game, index) => (
                    <button
                      key={game.appId}
                      onClick={() => setSelectedGame(game.appId)}
                      className={`
                        group relative flex items-center gap-2 px-5 py-3 rounded-2xl font-bold
                        min-w-[44px] min-h-[44px] transition-all duration-300 whitespace-nowrap flex-shrink-0
                        ${selectedGame === game.appId
                          ? "bg-gradient-to-r from-yellow-400 to-pink-500 text-slate-900 shadow-lg shadow-pink-500/30 scale-105"
                          : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/10 hover:border-white/20"
                        }
                      `}
                      style={{ animationDelay: `${index * 0.05}s` }}
                    >
                      <span className={`text-xl transition-transform ${selectedGame === game.appId ? "scale-110" : "group-hover:scale-110"}`}>
                        {game.icon}
                      </span>
                      <span>{game.name}</span>

                      {/* Active indicator dot */}
                      {selectedGame === game.appId && (
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-300 rounded-full animate-pulse" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Selected Game Leaderboard */}
        <section className="max-w-4xl mx-auto px-4 mb-8">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900/90 to-slate-800/90 border border-white/10 shadow-2xl shadow-black/50">
            {/* Decorative corner accents */}
            <div className="absolute top-0 left-0 w-20 h-20 bg-gradient-to-br from-yellow-500/20 to-transparent" />
            <div className="absolute bottom-0 right-0 w-20 h-20 bg-gradient-to-tl from-pink-500/20 to-transparent" />

            {/* Top banner with game info */}
            <div className="relative bg-gradient-to-r from-slate-800/50 via-slate-900/50 to-slate-800/50 border-b border-white/10 p-4">
              <div className="flex items-center justify-center gap-3">
                <span className="text-4xl animate-bounce-slow">{selectedGameMeta.icon}</span>
                <h2 className="text-2xl md:text-3xl font-black bg-gradient-to-r from-white via-white to-white/80 bg-clip-text text-transparent">
                  {selectedGameMeta.name}
                </h2>
                <span className="text-4xl animate-bounce-slow" style={{ animationDelay: '0.5s' }}>{selectedGameMeta.icon}</span>
              </div>
            </div>

            {/* Leaderboard content */}
            <div className="p-4 md:p-6">
              <Leaderboard
                appId={selectedGame}
                gameName={selectedGameMeta.name}
                icon={selectedGameMeta.icon}
                showPeriodSelector={true}
                compact={false}
              />
            </div>
          </div>
        </section>

        {/* Play Button */}
        <section className="max-w-4xl mx-auto px-4 mb-8">
          <Link
            href={getPlayableHref(selectedGame)}
            className="group relative block w-full py-5 overflow-hidden rounded-2xl font-black text-xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
          >
            {/* Animated gradient background */}
            <div className="absolute inset-0 bg-gradient-to-r from-green-500 via-emerald-500 to-green-500 bg-[length:200%_100%] animate-gradient-x" />

            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-400 blur-xl opacity-50 group-hover:opacity-75 transition-opacity" />

            {/* Content */}
            <div className="relative flex items-center justify-center gap-3 text-white">
              <span className="text-3xl group-hover:scale-125 group-hover:rotate-12 transition-transform">
                {selectedGameMeta.icon}
              </span>
              <span>Play {selectedGameMeta.name}!</span>
              <span className="text-2xl group-hover:translate-x-2 transition-transform">→</span>
            </div>
          </Link>
        </section>

        {/* Login prompt for guests */}
        {status === "unauthenticated" && (
          <section className="max-w-4xl mx-auto px-4 mb-8">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-400/20 p-6 text-center">
              {/* Animated background */}
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-blue-500/5 animate-pulse" />

              <div className="relative">
                <div className="text-5xl mb-4">🌟</div>
                <p className="text-white/80 text-lg mb-4">
                  Sign in to track your rankings and compete for the top spots!
                </p>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-400 hover:to-purple-400 text-white font-bold rounded-2xl transition-all duration-300 hover:scale-105 shadow-lg shadow-blue-500/30"
                >
                  <span>Sign In</span>
                  <span className="text-xl">→</span>
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Footer spacer */}
        <div className="h-8" />
      </div>

      {/* Custom animations */}
      <style>{`
        @keyframes float-slow {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-30px) rotate(10deg);
          }
        }
        .animate-float-slow {
          animation: float-slow 8s ease-in-out infinite;
        }
        @keyframes bounce-slow {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
        .animate-bounce-slow {
          animation: bounce-slow 2s ease-in-out infinite;
        }
        @keyframes pulse-glow {
          0%, 100% {
            filter: drop-shadow(0 0 20px rgba(250, 204, 21, 0.4));
          }
          50% {
            filter: drop-shadow(0 0 40px rgba(250, 204, 21, 0.6));
          }
        }
        .animate-pulse-glow {
          animation: pulse-glow 2s ease-in-out infinite;
        }
        @keyframes sparkle {
          0%, 100% {
            opacity: 0;
            transform: scale(0) rotate(0deg);
          }
          50% {
            opacity: 1;
            transform: scale(1) rotate(180deg);
          }
        }
        .animate-sparkle {
          animation: sparkle 2s ease-in-out infinite;
        }
        .animate-sparkle-delayed {
          animation: sparkle 2s ease-in-out infinite;
          animation-delay: 0.5s;
        }
        @keyframes gradient-x {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
        .animate-gradient-x {
          animation: gradient-x 3s ease infinite;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .bg-gradient-radial {
          background: radial-gradient(circle, var(--tw-gradient-stops));
        }
      `}</style>
    </div>
  );
}

export default LeaderboardsPage;
