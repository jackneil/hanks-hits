import { describe, expect, it } from "vitest";

import { recentGamesToShow, type CatalogNamesBySystem } from "../lib/recentGames";
import type { RecentGame } from "../lib/store";

const catalogNames: CatalogNamesBySystem = {
  snes: new Set(["Super Mario World"]),
  atari2600: new Set(["Pitfall!"]),
};

function recent(name: string, system: RecentGame["system"]): RecentGame {
  return { gameId: `${system}-${name}`, name, system, lastPlayed: 1 };
}

describe("recentGamesToShow", () => {
  it("keeps catalog games and drops titles that no catalog lists", () => {
    const list = [
      recent("Mortal Kombat 1", "snes"),
      recent("Super Mario World", "snes"),
      recent("Custer's Revenge", "atari2600"),
      recent("Pitfall!", "atari2600"),
    ];

    expect(recentGamesToShow(list, catalogNames, []).map((game) => game.name)).toEqual([
      "Super Mario World",
      "Pitfall!",
    ]);
  });

  it("keeps a ROM that the player uploaded on a console with a catalog", () => {
    const list = [recent("my-hack.smc", "snes"), recent("gone.smc", "snes")];

    expect(
      recentGamesToShow(list, catalogNames, [{ name: "my-hack.smc", system: "snes" }]).map(
        (game) => game.name
      )
    ).toEqual(["my-hack.smc"]);
  });

  it("matches an uploaded ROM on its own console only", () => {
    const list = [recent("same-name.bin", "atari2600")];

    expect(recentGamesToShow(list, catalogNames, [{ name: "same-name.bin", system: "snes" }])).toEqual([]);
  });

  it("keeps every entry of a console with no catalog", () => {
    const list = [recent("my-game.nes", "nes"), recent("other.gba", "gba")];

    expect(recentGamesToShow(list, catalogNames, [])).toEqual(list);
  });

  it("does not change the saved list", () => {
    const list = [recent("Mortal Kombat 1", "snes")];

    recentGamesToShow(list, catalogNames, []);

    expect(list).toHaveLength(1);
  });
});
