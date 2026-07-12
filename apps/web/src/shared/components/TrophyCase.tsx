"use client";

import {
  appCatalog,
  getAchievementInfo,
  globalCatalog,
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
 * with the still-locked ones shown as goal teasers. Games appear once
 * they've been played (first-play unlocked) — plus the cross-game group,
 * which always shows. Locked tiers are filtered by each app's observed
 * capability (watermarks), so the case never teases a trophy the app
 * cannot actually award; unlocked trophies always show regardless.
 */
export function TrophyCase() {
  const unlocked = useAchievementsStore((s) => s.progress.unlocked);
  const watermarks = useAchievementsStore((s) => s.watermarks);

  const playedAppIds = [
    ...new Set(
      Object.keys(unlocked)
        .filter((id) => id.startsWith("first-play:"))
        .map((id) => id.slice("first-play:".length))
    ),
  ].sort();

  const buildRows = (catalog: AchievementInfo[], appId: string | null) => {
    const rows = catalog.map((info) => ({
      info,
      unlockedAt: unlocked[info.id] ?? null,
    }));
    // Unlocked ids the capability filter would hide (e.g. earned on another
    // device whose blob carried richer fields) still belong in the case.
    const shown = new Set(catalog.map((i) => i.id));
    for (const id of Object.keys(unlocked)) {
      if (shown.has(id)) continue;
      const info = getAchievementInfo(id);
      if (info.appId === appId) {
        rows.push({ info, unlockedAt: unlocked[id] });
      }
    }
    return rows;
  };

  const groups: TrophyGroup[] = playedAppIds.map((appId) => {
    const meta = getGameMetadata(appId);
    const caps = watermarks.apps[appId];
    return {
      appId,
      title: meta.name,
      icon: meta.icon,
      achievements: buildRows(
        appCatalog(appId, { hasPlays: caps?.hasPlays, hasStreak: caps?.hasStreak }),
        appId
      ),
    };
  });

  // Cross-game achievements (explorer, record-breaker) always show.
  groups.push({
    appId: null,
    title: "All Games",
    icon: "🌈",
    achievements: buildRows(globalCatalog(), null),
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
            No trophies yet! Play any game to earn your first one!
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
                      unlockedAt !== null ? "bg-yellow-400/20" : "bg-white/5"
                    }`}
                  >
                    {/* Locked state lives in the dimmed lock + bg, never the
                        text — the goal line is exactly what a kid must READ */}
                    <span
                      className={`text-2xl ${unlockedAt === null ? "opacity-60" : ""}`}
                      aria-hidden="true"
                    >
                      {unlockedAt !== null ? info.emoji : "🔒"}
                    </span>
                    <div className="min-w-0">
                      <div
                        className={`font-bold text-sm truncate ${
                          unlockedAt !== null ? "text-white" : "text-white/85"
                        }`}
                      >
                        {info.name}
                      </div>
                      <div
                        className={`text-xs truncate ${
                          unlockedAt !== null ? "text-white/70" : "text-white/60"
                        }`}
                      >
                        {unlockedAt !== null
                          ? info.description
                          : info.lockedDescription}
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
