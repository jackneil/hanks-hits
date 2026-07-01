"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { signOutAndClear } from "@/lib/auth-client";
import { GameProgressCard } from "./GameProgressCard";
import { extractGameStats, type GameDisplayInfo } from "../lib/gameStatExtractor";
import Link from "next/link";
import { Header } from "@/shared/components/Header";
import { getPlayableHref } from "@/shared/lib/app-routing";

interface ProfileData {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  createdAt: string | null;
  emailVerified: boolean;
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

  // Name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

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
        setNewName(profileData.name || "");

        // Extract game stats from progress
        const gameInfos: GameDisplayInfo[] = (progressData.progress || [])
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

  // Handle name save
  const handleSaveName = async () => {
    if (!newName.trim()) {
      setNameError("Name can't be empty!");
      return;
    }

    try {
      setNameSaving(true);
      setNameError(null);

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save name");
      }

      setProfile((prev) => prev ? { ...prev, name: data.name } : null);
      setIsEditingName(false);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Couldn't save name");
    } finally {
      setNameSaving(false);
    }
  };

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

  // Get initials for avatar fallback
  const getInitials = (name: string | null, email: string | null): string => {
    const displayName = name || email || "Player";
    return displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // Loading state
  if (loading || status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-600 to-purple-700 flex items-center justify-center">
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
      <div className="min-h-screen bg-gradient-to-b from-red-600 to-orange-700 flex items-center justify-center p-4">
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

  const displayName = profile?.name || profile?.email || "Player";

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-600 to-purple-700 pb-8">
      <Header title="My Profile" titleIcon="👤" />

      {/* Profile Card */}
      <section className="mx-4 mb-6">
        <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-6 border-2 border-white/20">
          {/* Avatar and Name */}
          <div className="flex flex-col items-center mb-6">
            {/* Large Avatar */}
            <div className="w-24 h-24 rounded-full ring-4 ring-white/30 mb-4 overflow-hidden bg-blue-500 flex items-center justify-center">
              {profile?.image ? (
                <img
                  src={profile.image}
                  alt={displayName}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <span className="text-3xl font-bold text-white">
                  {getInitials(profile?.name ?? null, profile?.email ?? null)}
                </span>
              )}
            </div>

            {/* Name with edit */}
            {isEditingName ? (
              <div className="w-full max-w-xs">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={50}
                  className="w-full px-4 py-3 text-center text-xl font-bold rounded-xl bg-white/20 text-white placeholder-white/50 border-2 border-white/30 focus:border-white/60 outline-none"
                  placeholder="Your name"
                  autoFocus
                />
                {nameError && (
                  <p className="text-red-300 text-sm text-center mt-2">{nameError}</p>
                )}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => {
                      setIsEditingName(false);
                      setNewName(profile?.name || "");
                      setNameError(null);
                    }}
                    className="flex-1 px-4 py-2 bg-white/10 text-white rounded-xl font-bold"
                    disabled={nameSaving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveName}
                    disabled={nameSaving}
                    className="flex-1 px-4 py-2 bg-green-500 text-white rounded-xl font-bold disabled:opacity-50"
                  >
                    {nameSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsEditingName(true)}
                className="group flex items-center gap-2"
              >
                <h2 className="text-2xl font-bold text-white">{displayName}</h2>
                <span className="text-white/50 group-hover:text-white/80 transition-colors">
                  ✏️
                </span>
              </button>
            )}

            {/* Email */}
            {profile?.email && (
              <p className="text-white/60 mt-1">{profile.email}</p>
            )}

            {/* Member since */}
            <p className="text-white/40 text-sm mt-2">
              Member since {formatMemberSince(profile?.createdAt ?? null)}
            </p>
          </div>
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

          {/* Gaming handle display */}
          {rankings.handle && (
            <div className="bg-yellow-500/20 rounded-xl p-3 mb-4 border border-yellow-400/30 flex items-center justify-between">
              <div>
                <span className="text-white/60 text-sm">Your Gamer Handle:</span>
                <span className="ml-2 font-bold text-white">{rankings.handle}</span>
              </div>
              <span className="text-2xl">🎮</span>
            </div>
          )}

          {/* Rankings grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rankings.ranks.slice(0, 6).map((rank) => (
              <Link
                key={rank.appId}
                href={getPlayableHref(rank.appId)}
                className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20 hover:bg-white/20 transition-colors"
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

      {/* Games Section */}
      <section id="games" className="mx-4 mb-6">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <span>🎮</span> My Games
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
    </div>
  );
}

export default ProfilePage;
