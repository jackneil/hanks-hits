import type { SystemType } from "./constants";
import type { CustomRom, RecentGame } from "./store";

/** The display names of each console's catalog. A console with no catalog has no entry. */
export type CatalogNamesBySystem = Partial<Record<SystemType, ReadonlySet<string>>>;

/**
 * Returns the recently played games that the arcade can still offer.
 *
 * The saved list (local and cloud) can keep the name of a game that a
 * catalog no longer lists, for example a title that the content blocklist
 * removed (issue #25). The Recently Played list must not show that name.
 *
 * - A console with no catalog plays only uploaded ROMs, so all of its
 *   entries stay.
 * - On a console with a catalog, an entry stays when its name is in the
 *   catalog or is the name of a ROM that the player uploaded.
 *
 * The saved list does not change. This function only selects what to show.
 */
export function recentGamesToShow(
  recent: readonly RecentGame[],
  catalogNames: CatalogNamesBySystem,
  customRoms: readonly Pick<CustomRom, "name" | "system">[]
): RecentGame[] {
  return recent.filter((game) => {
    const names = catalogNames[game.system];
    if (!names) return true;
    if (names.has(game.name)) return true;
    return customRoms.some((rom) => rom.system === game.system && rom.name === game.name);
  });
}
