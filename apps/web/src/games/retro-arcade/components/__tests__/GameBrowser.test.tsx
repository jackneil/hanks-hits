import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameBrowser, type CatalogGame } from "../GameBrowser";

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

  it("filters to persisted favorite games", () => {
    renderBrowser(["snes-bravo"]);

    fireEvent.click(screen.getByRole("button", { name: "Favorites (1)" }));

    expect(screen.getByText("Bravo Quest")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Mission")).not.toBeInTheDocument();
  });
});
