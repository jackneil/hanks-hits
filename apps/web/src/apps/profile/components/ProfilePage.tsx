"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { signOutAndClear } from "@/lib/auth-client";
import { GameProgressCard } from "./GameProgressCard";
import { GamesIMade } from "./GamesIMade";
import { LeaderboardNameToggle } from "./LeaderboardNameToggle";
import { DeleteAccount } from "./DeleteAccount";
import { TrophyCase } from "@/shared/components/TrophyCase";
import { extractGameStats, type GameDisplayInfo } from "@/shared/lib/gameStatExtractor";
import Link from "next/link";
import { Header } from "@/shared/components/Header";
import { getPlayableHref } from "@/shared/lib/app-routing";

/**
 * GET /api/profile. An account keeps no name, email or photo (COPPA,
 * lib/auth-privacy.ts): the card shows the made-up gamer name.
 */
interface ProfileData {
  handle: string | null;
  createdAt: string | null;
}

interface ProgressItem {
  appId: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

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

/**
 * Main profile page component.
 * Shows user info, game progress, and account actions.
 */
export function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [games, setGames] = useState<GameDisplayInfo[]>([]);
  const [rankings, setRankings] = useState<MyRanksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Fetch profile and game progress
  useEffect(() => {
    if (status !== "authenticated") return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch profile, progress, and rankings in parallel
        const [profileRes, progressRes, rankingsRes] = await Promise.all([
          fetch("/api/profile"),
          fetch("/api/progress"),
          fetch("/api/leaderboards/my-ranks"),
        ]);

        if (!profileRes.ok || !progressRes.ok) {
          throw new Error("Failed to load profile data");
        }

        const profileData = await profileRes.json();
        const progressData = await progressRes.json();

        // Rankings are optional - don't fail if not available
        if (rankingsRes.ok) {
          const rankingsData = await rankingsRes.json();
          setRankings(rankingsData);
        }

        setProfile(profileData);

        // Extract game stats from progress. The "achievements" blob is
        // platform state, not a game — it feeds the Trophy Case section,
        // never a game card.
        const gameInfos: GameDisplayInfo[] = (progressData.progress || [])
          .filter((p: ProgressItem) => p.appId !== "achievements")
          .filter((p: ProgressItem) => p.data && Object.keys(p.data).length > 0)
          .map((p: ProgressItem) => extractGameStats(p.appId, p.data, p.updatedAt));

        setGames(gameInfos);
      } catch (err) {
        console.error("Profile fetch error:", err);
        setError("Oops! Couldn't load your profile. Try again?");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [status]);

  // Handle sign out
  const handleSignOut = async () => {
    await signOutAndClear("/");
  };

  // Format member since date
  const formatMemberSince = (dateStr: string | null): string => {
    if (!dateStr) return "A while ago";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  };

  // Loading state
  if (loading || status === "loading") {
    return (
      <div className="min-h-dvh bg-blue-800 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">👤</div>
          <p className="text-white text-xl">Loading your profile...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-dvh bg-red-700 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">😕</div>
          <p className="text-white text-xl mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-white text-red-600 font-bold rounded-xl text-lg"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // The made-up gamer name. "Player" only if creating it failed.
  const gamerName = profile?.handle || "Player";

  return (
    <div className="min-h-dvh bg-blue-800 pb-8">
      <Header title="My Profile" titleIcon="👤" />

      {/* Profile Card */}
      <section className="mx-4 mb-6">
        <div className="bg-white/10 rounded-3xl p-6 border-2 border-white/20">
          {/* Avatar and Name */}
          <div className="flex flex-col items-center mb-6">
            {/* Large avatar: the gamer name's first letter, never a photo */}
            <div
              data-testid="gamer-avatar"
              className="w-24 h-24 rounded-full ring-4 ring-white/30 mb-4 overflow-hidden bg-blue-500 flex items-center justify-center"
            >
              <span className="text-3xl font-bold text-white">
                {gamerName.charAt(0).toUpperCase()}
              </span>
            </div>

            <p className="text-white/75 text-sm">Your gamer name</p>
            <h2 className="text-2xl font-bold text-white">{gamerName}</h2>

            {/* Member since */}
            <p className="text-white/75 text-sm mt-2">
              Member since {formatMemberSince(profile?.createdAt ?? null)}
            </p>
          </div>

          {/* Leaderboard privacy: the only control for show_on_leaderboards */}
          <LeaderboardNameToggle />
        </div>
      </section>

      {/* My Rankings Section */}
      {rankings && rankings.ranks.length > 0 && (
        <section className="mx-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>🏆</span> My Rankings
            </h2>
            <Link
              href="/leaderboards"
              className="text-sm text-white/70 hover:text-white transition-colors"
            >
              View All →
            </Link>
          </div>

          {/* Rankings grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rankings.ranks.slice(0, 6).map((rank) => (
              <Link
                key={rank.appId}
                href={getPlayableHref(rank.appId)}
                className="bg-white/10 rounded-xl p-4 border border-white/20 hover:bg-white/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{rank.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-white truncate">{rank.gameName}</div>
                    <div className="text-sm text-white/60">
                      Rank #{rank.rank} of {rank.totalPlayers.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-yellow-400 tabular-nums">
                      {rank.score.toLocaleString()}
                    </div>
                    <div className="text-xs text-white/40">
                      {rank.scoreType === "wins" ? "wins" : rank.scoreType === "fastest_time" ? "time" : "score"}
                    </div>
                  </div>
                </div>
                {/* Rank badge for top 3 */}
                {rank.rank <= 3 && (
                  <div className="mt-2 flex justify-center">
                    <span className="text-2xl">
                      {rank.rank === 1 ? "🥇" : rank.rank === 2 ? "🥈" : "🥉"}
                    </span>
                  </div>
                )}
              </Link>
            ))}
          </div>

          {rankings.ranks.length > 6 && (
            <Link
              href="/leaderboards"
              className="block text-center mt-4 text-white/70 hover:text-white text-sm"
            >
              + {rankings.ranks.length - 6} more games
            </Link>
          )}
        </section>
      )}

      {/* Trophy Case */}
      <TrophyCase />

      {/* The kid's own creations */}
      <GamesIMade />

      {/* Played-games section. "Games I've Played", not "My Games" - the
          home page's My Games shelf means games the kid MADE, and one label
          must not mean two different things. */}
      <section id="games" className="mx-4 mb-6">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <span>🎮</span> Games I&apos;ve Played
        </h2>

        {games.length === 0 ? (
          // Empty state
          <div className="bg-white/10 rounded-3xl p-8 text-center border-2 border-dashed border-white/20">
            <div className="text-6xl mb-4">🎮</div>
            <p className="text-white/80 text-lg mb-4">
              No games played yet!
            </p>
            <Link
              href="/games/monster-truck"
              className="inline-block px-6 py-3 bg-red-500 hover:bg-red-400 text-white font-bold rounded-xl text-lg transition-colors"
            >
              Try Monster Truck! 🚛
            </Link>
          </div>
        ) : (
          // Game cards grid
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {games.map((game) => (
              <GameProgressCard key={game.appId} game={game} />
            ))}
          </div>
        )}
      </section>

      {/* Account Actions */}
      <section className="mx-4">
        <button
          onClick={handleSignOut}
          className="w-full px-6 py-4 bg-red-500/80 hover:bg-red-500 text-white font-bold rounded-2xl text-lg transition-colors flex items-center justify-center gap-2"
        >
          <span className="text-xl">👋</span>
          Sign Out
        </button>
      </section>

      {/* The parent's right to delete the account (COPPA 312.6) */}
      <DeleteAccount handle={profile?.handle ?? null} userId={session?.user?.id ?? null} />
    </div>
  );
}

export default ProfilePage;
