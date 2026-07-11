import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useAuthSync -> useSession needs a SessionProvider we don't mount in tests.
// Stub it to guest mode so the game renders without a provider or network.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import BombermanGame from "../Game";
import { useBombermanStore } from "../lib/store";

// The global setup stubs matchMedia to always return matches:false. Swap in a
// stub where "(pointer: coarse)" resolves to the requested value so we can
// simulate touch vs keyboard/mouse viewports (mirrors GameStartOverlay tests).
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
  mockPointer(false);
  // Keep the animation loop from ticking during assertions (it would run the
  // sim and re-render outside act); DOM state is set at render time regardless.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useBombermanStore.getState().resetGame();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockPointer(false);
});

describe("Bomberman start overlay", () => {
  it("shows the shared DOM start overlay title exactly once in the menu", () => {
    render(<BombermanGame />);
    expect(
      screen.getAllByRole("heading", { name: "Bomberman" })
    ).toHaveLength(1);
  });

  it("names the on-screen controls in the touch hints on coarse pointers", () => {
    mockPointer(true);
    render(<BombermanGame />);

    expect(screen.getByText("Tap the arrows to move")).toBeInTheDocument();
    expect(screen.getByText("Tap 💣 to drop bombs")).toBeInTheDocument();
    // Keyboard copy must not show to touch users.
    expect(
      screen.queryByText("WASD or Arrows to move")
    ).not.toBeInTheDocument();
  });

  it("hides the D-pad on fine (desktop) pointers while playing", () => {
    mockPointer(false);
    act(() => {
      useBombermanStore.getState().startGame();
    });
    render(<BombermanGame />);

    expect(useBombermanStore.getState().gameState).toBe("playing");
    // ▲ is unique to the D-pad up button.
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
  });

  it("shows the D-pad on coarse (touch) pointers while playing", () => {
    mockPointer(true);
    act(() => {
      useBombermanStore.getState().startGame();
    });
    render(<BombermanGame />);

    expect(useBombermanStore.getState().gameState).toBe("playing");
    expect(screen.getByText("▲")).toBeInTheDocument();
  });
});
