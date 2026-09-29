import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatSaveSize, SavedGames } from "../SavedGames";
import { SaveStateError, type SavedGame, type SaveStateStore } from "../../lib/saveStates";

const TETRIS: SavedGame = {
  gameId: "gb-tetris.gb",
  name: "tetris.gb",
  system: "gb",
  bytes: 405_680,
  savedAt: 2,
  slots: ["auto", "manual"],
};
const MARIO: SavedGame = {
  gameId: "snes-Super Mario World",
  name: "Super Mario World",
  system: "snes",
  bytes: 3 * 1024 * 1024,
  savedAt: 3,
  slots: ["manual"],
};

function storeWith(games: SavedGame[]) {
  let current = [...games];
  const store: SaveStateStore = {
    put: vi.fn(),
    get: vi.fn(),
    list: vi.fn(async () => [...current]),
    remove: vi.fn(async (_owner: string, gameId: string) => {
      current = current.filter((game) => game.gameId !== gameId);
    }),
    close: vi.fn(),
  };
  return store;
}

describe("SavedGames", () => {
  it("lists the saves of the owner with their console and size", async () => {
    const store = storeWith([MARIO, TETRIS]);
    render(<SavedGames owner="u_0123456789abcdef0123" store={store} />);

    expect(await screen.findByText("Your Game Saves")).toBeInTheDocument();
    expect(store.list).toHaveBeenCalledWith("u_0123456789abcdef0123");
    expect(screen.getByText("Super Mario World")).toBeInTheDocument();
    expect(screen.getByText("SNES · 3.0 MB")).toBeInTheDocument();
    expect(screen.getByText("Game Boy · 396 KB")).toBeInTheDocument();
  });

  it("shows nothing while the owner is unknown or when there are no saves", async () => {
    const store = storeWith([]);
    const { container, rerender } = render(<SavedGames owner={null} store={store} />);
    expect(store.list).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    rerender(<SavedGames owner="guest" store={store} />);
    await waitFor(() => expect(store.list).toHaveBeenCalledWith("guest"));
    expect(container).toBeEmptyDOMElement();
  });

  it("deletes a save only after the kid says yes", async () => {
    const store = storeWith([MARIO, TETRIS]);
    render(<SavedGames owner="guest" store={store} />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete the save for tetris.gb" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(store.remove).not.toHaveBeenCalled();
    expect(screen.getByText("tetris.gb")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete the save for tetris.gb" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(store.remove).toHaveBeenCalledWith("guest", "gb-tetris.gb"));
    await waitFor(() => expect(screen.queryByText("tetris.gb")).not.toBeInTheDocument());
    expect(screen.getByText("Super Mario World")).toBeInTheDocument();
  });

  it("says so when a delete fails", async () => {
    const store = storeWith([TETRIS]);
    vi.mocked(store.remove).mockRejectedValue(new SaveStateError("write"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<SavedGames owner="guest" store={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete the save for tetris.gb" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not delete that save. Try again.");
    warn.mockRestore();
  });

  it("shows nothing when the browser has no IndexedDB", async () => {
    const store = storeWith([]);
    vi.mocked(store.list).mockRejectedValue(new SaveStateError("unavailable"));
    const { container } = render(<SavedGames owner="guest" store={store} />);
    await waitFor(() => expect(store.list).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [1, "1 KB"],
    [202_840, "198 KB"],
    [16 * 1024 * 1024, "16.0 MB"],
  ])("formats %d bytes as %s", (bytes, text) => {
    expect(formatSaveSize(bytes)).toBe(text);
  });
});
