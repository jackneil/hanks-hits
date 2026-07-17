"use client";

import Link from "next/link";
import {
  GAME_METADATA,
  type GameMetadata,
} from "@/shared/lib/gameMetadata.generated";
import { hrefForCategory } from "@/shared/lib/app-routing";

interface GamesIMadeProps {
  /** Injectable for tests; defaults to the build-time generated lookup. */
  catalog?: Record<string, GameMetadata>;
}

/**
 * The kid's own creations (metadata madeByKid: true), straight from the
 * build-time lookup — no fetch, works the moment the profile mounts.
 * Renders nothing when the kid hasn't made a game yet: the home page's
 * My Games shelf owns the "make your first game" invite; the profile
 * stays a stats surface.
 */
export function GamesIMade({ catalog = GAME_METADATA }: GamesIMadeProps) {
  const creations = Object.entries(catalog).filter(
    ([, metadata]) => metadata.madeByKid
  );

  if (creations.length === 0) return null;

  return (
    <section data-testid="games-i-made" className="mx-4 mb-6">
      <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <span>🛠️</span> Games I Made
        <span className="ml-1 text-sm font-semibold text-white/60">
          ({creations.length})
        </span>
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {creations.map(([appId, metadata]) => (
          <Link
            key={appId}
            href={hrefForCategory(appId, metadata.category)}
            className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20 hover:bg-white/20 transition-colors flex items-center gap-3"
          >
            <span className="text-3xl">{metadata.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-white truncate">
                {metadata.name}
              </div>
              <div className="text-sm text-white/60">Made by me</div>
            </div>
            <span className="text-xl">▶️</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
