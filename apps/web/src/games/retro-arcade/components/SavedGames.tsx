"use client";

import { useCallback, useEffect, useState } from "react";

import { SYSTEMS, type SystemType } from "../lib/constants";
import {
  saveStateStore,
  SaveStateError,
  type SavedGame,
  type SaveStateStore,
} from "../lib/saveStates";

/** 200 KB, 1.4 MB: the size of a save in words a kid can read. */
export function formatSaveSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function consoleName(system: string): string {
  return SYSTEMS[system as SystemType]?.name ?? system;
}

/**
 * The save states that this player keeps on this device, with a Delete
 * button for each game. When a save does not fit, the message tells the kid
 * to delete an old game save. This list is where they do that.
 */
export function SavedGames({
  owner,
  store = saveStateStore,
}: {
  owner: string | null;
  store?: SaveStateStore;
}) {
  // The list belongs to the owner it was read for. A different owner (a
  // sign-in or sign-out) never sees it, even before the new list arrives.
  const [listing, setListing] = useState<{ owner: string; games: SavedGame[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(
    async (forOwner: string, isCurrent: () => boolean = () => true) => {
      try {
        const games = await store.list(forOwner);
        if (isCurrent()) setListing({ owner: forOwner, games });
      } catch (error) {
        // No IndexedDB in this browser: there are no saves to show.
        if (error instanceof SaveStateError && error.kind === "unavailable") return;
        console.warn("Retro Arcade could not list the saves", error);
        if (isCurrent()) setProblem("We could not open your saves.");
      }
    },
    [store]
  );

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    void load(owner, () => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [owner, load]);

  const games = owner && listing?.owner === owner ? listing.games : [];

  const handleDelete = async (game: SavedGame) => {
    if (!owner) return;
    setDeleting(game.gameId);
    setProblem(null);
    try {
      await store.remove(owner, game.gameId);
      setConfirming(null);
      await load(owner);
    } catch (error) {
      console.warn("Retro Arcade could not delete a save", error);
      setProblem("We could not delete that save. Try again.");
    } finally {
      setDeleting(null);
    }
  };

  if (!owner || (games.length === 0 && !problem)) return null;

  return (
    <section className="mt-8 max-w-4xl mx-auto w-full" aria-labelledby="retro-saved-games">
      <h2 id="retro-saved-games" className="text-xl font-bold text-white mb-1">
        Your Game Saves
      </h2>
      <p className="text-white/60 text-sm mb-4">Saves stay on this device.</p>
      {problem && (
        <p role="alert" className="mb-3 rounded-lg bg-red-700 p-3 font-bold text-white">
          {problem}
        </p>
      )}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {games.map((game) => {
          const isConfirming = confirming === game.gameId;
          const isDeleting = deleting === game.gameId;
          return (
            <li
              key={game.gameId}
              className="p-3 bg-white/10 rounded-lg text-white flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold">{game.name}</div>
                <div className="text-white/50 text-sm">
                  {consoleName(game.system)} · {formatSaveSize(game.bytes)}
                </div>
              </div>
              {isConfirming ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDelete(game)}
                    disabled={isDeleting}
                    className="min-h-[44px] rounded-lg bg-red-600 px-3 font-bold hover:bg-red-500 active:scale-95 disabled:opacity-60"
                  >
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    disabled={isDeleting}
                    className="min-h-[44px] rounded-lg bg-white/20 px-3 font-bold hover:bg-white/30 active:scale-95"
                  >
                    Keep it
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(game.gameId)}
                  aria-label={`Delete the save for ${game.name}`}
                  className="min-h-[44px] shrink-0 rounded-lg bg-white/20 px-4 font-bold hover:bg-white/30 active:scale-95"
                >
                  Delete
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
