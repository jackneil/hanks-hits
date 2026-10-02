import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameBrowser, type CatalogGame } from "../GameBrowser";
import { SNES_CATALOG } from "../../lib/snes-catalog";
import { ATARI_2600_CATALOG } from "../../lib/atari-2600-catalog";
import { findOpenNoticeRule } from "../../lib/contentNotice";

const catalog: CatalogGame[] = [
  {
    id: "snes-alpha",
    displayName: "Alpha Mission",
    filename: "alpha.smc",
    genre: "action",
    favorite: false,
  },
  {
    id: "snes-bravo",
    displayName: "Bravo Quest",
    filename: "bravo.smc",
    genre: "rpg",
    favorite: false,
  },
];

function renderBrowser(
  favoriteIds: string[] = [],
  onToggleFavorite = vi.fn()
) {
  return {
    onToggleFavorite,
    onGameSelect: vi.fn(),
    ...render(
      <GameBrowser
        catalog={catalog}
        getRomUrl={(game) => `/roms/${game.filename}`}
        systemName="SNES"
        onGameSelect={vi.fn()}
        onUploadClick={vi.fn()}
        favoriteIds={favoriteIds}
        onToggleFavorite={onToggleFavorite}
      />
    ),
  };
}

describe("GameBrowser favorites", () => {
  it("exposes favorite buttons without launching the game", () => {
    const onToggleFavorite = vi.fn();
    const onGameSelect = vi.fn();

    render(
      <GameBrowser
        catalog={catalog}
        getRomUrl={(game) => `/roms/${game.filename}`}
        systemName="SNES"
        onGameSelect={onGameSelect}
        onUploadClick={vi.fn()}
        favoriteIds={[]}
        onToggleFavorite={onToggleFavorite}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Alpha Mission to favorites",
      })
    );

    expect(onToggleFavorite).toHaveBeenCalledWith("snes-alpha");
    expect(onGameSelect).not.toHaveBeenCalled();
  });

  it("makes each favorite star a 44 px touch target (h-11 w-11), like every kid control", () => {
    renderBrowser();
    for (const name of ["Add Alpha Mission to favorites", "Add Bravo Quest to favorites"]) {
      const star = screen.getByRole("button", { name });
      expect(star.className, name).toMatch(/(^|\s)h-11(\s|$)/);
      expect(star.className, name).toMatch(/(^|\s)w-11(\s|$)/);
    }
  });

  it("filters to persisted favorite games", () => {
    renderBrowser(["snes-bravo"]);

    fireEvent.click(screen.getByRole("button", { name: "Favorites (1)" }));

    expect(screen.getByText("Bravo Quest")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Mission")).not.toBeInTheDocument();
  });

  it("counts only the favorites that this catalog lists", () => {
    // A saved id that this catalog does not list ("snes-mortal-kombat-2" is
    // not in this test catalog) and a favorite from the other console stay
    // in the saved list. The tab must count only the games it can show.
    renderBrowser(["snes-bravo", "snes-mortal-kombat-2", "atari2600-pitfall"]);

    fireEvent.click(screen.getByRole("button", { name: "Favorites (1)" }));

    expect(screen.getByText("Bravo Quest")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 games")).toBeInTheDocument();
  });
});

describe("GameBrowser and the violent classics (Jack, 2026-10-02)", () => {
  // No label, badge, icon, color, sort change or filter: a classic that gets
  // the heads-up card looks in every list exactly like any other game.
  const all = [...SNES_CATALOG, ...ATARI_2600_CATALOG] as CatalogGame[];
  const classics = all.filter((game) => findOpenNoticeRule(game));
  const plainName = /^[A-Za-z0-9 .,]+$/;

  /** A normal game with the same genre and featured flag, and a plain name. */
  function twinOf(game: CatalogGame): CatalogGame {
    const twin = all.find(
      (other) =>
        !findOpenNoticeRule(other) &&
        other.genre === game.genre &&
        other.favorite === game.favorite &&
        plainName.test(other.displayName)
    );
    if (!twin) throw new Error(`no normal game like ${game.displayName}`);
    return twin;
  }

  function cardOf(game: CatalogGame): HTMLElement {
    const card = screen
      .getAllByTestId("catalog-game")
      .find((element) => element.querySelector("h3")?.textContent === game.displayName);
    if (!card) throw new Error(`no card for ${game.displayName}`);
    return card;
  }

  function markup(game: CatalogGame): string {
    return cardOf(game).outerHTML.split(game.displayName).join("NAME");
  }

  function renderPair(game: CatalogGame, twin: CatalogGame, favoriteIds: string[] = []) {
    return render(
      <GameBrowser
        catalog={[game, twin]}
        getRomUrl={(entry) => `/api/roms/${entry.filename}`}
        systemName="SNES"
        onGameSelect={vi.fn()}
        onUploadClick={vi.fn()}
        favoriteIds={favoriteIds}
        onToggleFavorite={vi.fn()}
      />
    );
  }

  it("finds the 16 classics in the catalogs, each with a plain name", () => {
    expect(classics).toHaveLength(16);
    for (const game of classics) expect(game.displayName, game.id).toMatch(/^[A-Za-z0-9 .,_]+$/);
  });

  it("draws each classic's card with the same markup as a normal game", () => {
    for (const game of classics) {
      const twin = twinOf(game);
      const view = renderPair(game, twin);
      expect(markup(game), game.displayName).toBe(markup(twin));
      view.unmount();
    }
  });

  it("draws a favorite classic in the Favorites tab like a normal favorite", () => {
    for (const game of classics) {
      const twin = twinOf(game);
      const view = renderPair(game, twin, [game.id, twin.id]);
      fireEvent.click(screen.getByRole("button", { name: "Favorites (2)" }));
      expect(markup(game), game.displayName).toBe(markup(twin));
      view.unmount();
    }
  });

  it("finds a classic by search like any other game", () => {
    const game = classics.find((entry) => entry.id === "snes-mortal-kombat-1")!;
    const twin = twinOf(game);
    renderPair(game, twin);
    fireEvent.change(screen.getByPlaceholderText("Search SNES games..."), { target: { value: "mortal" } });
    expect(screen.getAllByTestId("catalog-game")).toHaveLength(1);
    expect(cardOf(game)).toBeInTheDocument();
  });

  it("sorts the classics with every other game (featured first, then by name)", () => {
    render(
      <GameBrowser
        catalog={SNES_CATALOG as CatalogGame[]}
        getRomUrl={(entry) => `/api/roms/snes/${entry.filename}`}
        systemName="SNES"
        onGameSelect={vi.fn()}
        onUploadClick={vi.fn()}
        favoriteIds={[]}
        onToggleFavorite={vi.fn()}
      />
    );
    const byName = (a: CatalogGame, b: CatalogGame) => a.displayName.localeCompare(b.displayName);
    const catalog = SNES_CATALOG as CatalogGame[];
    const expected = [
      ...catalog.filter((game) => game.favorite).sort(byName),
      ...catalog.filter((game) => !game.favorite).sort(byName),
    ].map((game) => game.displayName);
    const shown = screen.getAllByTestId("catalog-game").map((card) => card.querySelector("h3")?.textContent);
    expect(shown).toEqual(expected);
  });

  it("puts no card words or badge in the list", () => {
    const game = classics[0];
    renderPair(game, twinOf(game));
    expect(screen.queryByText(/heads up/i)).toBeNull();
    expect(screen.queryByText(/teens and grown-ups|fighting and blood|grown-up/i)).toBeNull();
  });

  it("puts the card in the list back as it was after a select (the player can pick another game)", () => {
    vi.useFakeTimers();
    try {
      const game = classics.find((entry) => entry.id === "snes-mortal-kombat-1")!;
      const onGameSelect = vi.fn();
      render(
        <GameBrowser
          catalog={[game]}
          getRomUrl={(entry) => `/api/roms/snes/${entry.filename}`}
          systemName="SNES"
          onGameSelect={onGameSelect}
          onUploadClick={vi.fn()}
          favoriteIds={[]}
          onToggleFavorite={vi.fn()}
        />
      );
      const before = cardOf(game).outerHTML;
      const open = [...cardOf(game).querySelectorAll("button")].find((button) => !button.getAttribute("aria-label"))!;
      fireEvent.click(open);
      expect(cardOf(game).outerHTML).not.toBe(before); // the spinner
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(onGameSelect).toHaveBeenCalledWith(game, "/api/roms/snes/mortal_kombat_1.smc");
      expect(cardOf(game).outerHTML).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
