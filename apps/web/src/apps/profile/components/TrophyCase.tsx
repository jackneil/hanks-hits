"use client";

import {
  catalogFor,
  useAchievementsStore,
  type AchievementInfo,
} from "@/shared/lib/achievements";
import { getGameMetadata } from "@/shared/lib/gameMetadata.generated";

interface TrophyGroup {
  appId: string | null; // null = cross-game group
  title: string;
  icon: string;
  achievements: { info: AchievementInfo; unlockedAt: number | null }[];
}

/**
 * The Trophy Case: every achievement the kid has earned, grouped per game,
 * with the still-locked ones dimmed as a tease of what's next. Games only
 * appear once they've been played (first-play unlocked) — plus the
 * cross-game group, which always shows.
 */
export function TrophyCase() {
  const unlocked = useAchievementsStore((s) => s.progress.unlocked);

  const playedAppIds = [
    ...new Set(
      Object.keys(unlocked)
        .filter((id) => id.startsWith("first-play:"))
        .map((id) => id.slice("first-play:".length))
    ),
  ].sort();

  const groups: TrophyGroup[] = playedAppIds.map((appId) => {
    const meta = getGameMetadata(appId);
    return {
      appId,
      title: meta.name,
      icon: meta.icon,
      achievements: catalogFor([appId])
        .filter((info) => info.appId === appId)
        .map((info) => ({ info, unlockedAt: unlocked[info.id] ?? null })),
    };
  });

  // Cross-game achievements (explorer, record-breaker) always show.
  groups.push({
    appId: null,
    title: "All Games",
    icon: "🌈",
    achievements: catalogFor([]).map((info) => ({
      info,
      unlockedAt: unlocked[info.id] ?? null,
    })),
  });

  const totalUnlocked = Object.keys(unlocked).length;

  return (
    <section id="trophies" className="mx-4 mb-6" data-testid="trophy-case">
      <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <span>🏆</span> Trophy Case
        {totalUnlocked > 0 && (
          <span className="ml-1 text-sm font-bold bg-yellow-400 text-yellow-950 rounded-full px-3 py-1">
            {totalUnlocked}
          </span>
        )}
      </h2>

      {totalUnlocked === 0 ? (
        <div className="bg-white/10 rounded-3xl p-8 text-center border-2 border-dashed border-white/20">
          <div className="text-6xl mb-4">🏆</div>
          <p className="text-white/80 text-lg">
            No trophies yet — play any game to earn your first one!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div
              key={group.appId ?? "global"}
              className="bg-white/10 rounded-3xl p-4"
            >
              <h3 className="font-bold text-white mb-3 flex items-center gap-2">
                <span>{group.icon}</span> {group.title}
              </h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.achievements.map(({ info, unlockedAt }) => (
                  <li
                    key={info.id}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                      unlockedAt !== null
                        ? "bg-yellow-400/20"
                        : "bg-white/5 opacity-60"
                    }`}
                  >
                    <span className="text-2xl" aria-hidden="true">
                      {unlockedAt !== null ? info.emoji : "🔒"}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-white text-sm truncate">
                        {info.name}
                      </div>
                      <div className="text-white/70 text-xs truncate">
                        {info.description}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
