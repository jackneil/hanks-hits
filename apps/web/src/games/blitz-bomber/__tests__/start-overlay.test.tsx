import { render, screen, within, act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useAuthSync calls next-auth's useSession, which requires a SessionProvider.
// Stub it to guest/unauthenticated so the Game can render standalone.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import BlitzBomberGame from "../Game";
import { useBlitzBomberStore } from "../lib/store";

/**
 * The global setup installs a matchMedia stub that always returns
 * matches: false. This helper swaps in a stub where "(pointer: coarse)"
 * resolves to the requested value so we can simulate touch vs keyboard/mouse.
 */
function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  // Keep the rAF game loop from ticking during assertions.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useBlitzBomberStore.setState({ gameState: "ready" });
    useBlitzBomberStore.getState().setDifficulty("normal");
  });
});

afterEach(() => {
  mockPointer(false);
  vi.unstubAllGlobals();
  act(() => {
    useBlitzBomberStore.setState({ gameState: "ready" });
  });
});

describe("Blitz Bomber start overlay", () => {
  it("renders the game title exactly once, as the single heading", () => {
    render(<BlitzBomberGame />);

    const headings = screen.getAllByRole("heading", { name: "Blitz Bomber" });
    expect(headings).toHaveLength(1);
    expect(screen.getAllByText("Blitz Bomber")).toHaveLength(1);
  });

  it("renders the three difficulty choices as real DOM buttons", () => {
    render(<BlitzBomberGame />);

    expect(screen.getByRole("button", { name: /Easy/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Normal/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hard/ })).toBeInTheDocument();
  });

  it("picking a difficulty sets it and starts the game", () => {
    render(<BlitzBomberGame />);

    expect(useBlitzBomberStore.getState().gameState).toBe("ready");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Hard/ }));
    });

    const state = useBlitzBomberStore.getState();
    expect(state.progress.settings.difficulty).toBe("hard");
    expect(state.gameState).toBe("playing");
  });

  // The below-canvas play hints (kept as-is) also contain touch copy, so scope
  // these assertions to the overlay card to test only what the overlay renders.
  it("shows touch hints (not keyboard copy) on coarse-pointer viewports", () => {
    mockPointer(true);
    render(<BlitzBomberGame />);

    const card = screen
      .getByRole("heading", { name: "Blitz Bomber" })
      .closest("div") as HTMLElement;

    expect(
      within(card).getByText("Tap anywhere to drop bombs")
    ).toBeInTheDocument();
    expect(
      within(card).queryByText("SPACE or any key drops bombs")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine-pointer viewports", () => {
    mockPointer(false);
    render(<BlitzBomberGame />);

    const card = screen
      .getByRole("heading", { name: "Blitz Bomber" })
      .closest("div") as HTMLElement;

    expect(
      within(card).getByText("SPACE or any key drops bombs")
    ).toBeInTheDocument();
    expect(
      within(card).getByText("R restarts from level 1")
    ).toBeInTheDocument();
    expect(
      within(card).queryByText("Tap anywhere to drop bombs")
    ).not.toBeInTheDocument();
  });
});
