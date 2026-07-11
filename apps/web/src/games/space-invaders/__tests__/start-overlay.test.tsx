import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Space Invaders builds an AudioContext at module load. jsdom has none, so
// stub it BEFORE the Game module is imported (vi.hoisted runs above imports).
vi.hoisted(() => {
  class MockAudioContext {}
  Object.defineProperty(globalThis, "AudioContext", {
    writable: true,
    configurable: true,
    value: MockAudioContext,
  });
});

// useAuthSync calls next-auth's useSession, which requires a SessionProvider.
// Stub it to guest/unauthenticated so the Game can render standalone.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import SpaceInvadersGame from "../Game";
import { DIFFICULTY_SETTINGS, type Difficulty } from "../lib/constants";
import { useSpaceInvadersStore } from "../lib/store";

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

afterEach(() => {
  mockPointer(false);
  // The one-tap test starts the game; put the module-global store back on
  // the ready screen so later tests see the overlay.
  useSpaceInvadersStore.setState({ gameState: "ready" });
});

describe("Space Invaders start overlay", () => {
  it("renders the game title exactly once, as the single heading", () => {
    render(<SpaceInvadersGame />);

    const headings = screen.getAllByRole("heading", { name: "Space Invaders" });
    expect(headings).toHaveLength(1);
    expect(screen.getAllByText("Space Invaders")).toHaveLength(1);
  });

  it("renders every age option as a real DOM button", () => {
    render(<SpaceInvadersGame />);

    for (const name of [
      "👶 4 years old",
      "🧒 8 years old",
      "👦 12 years old",
      "🧑 24 years old",
      "👴 99 years old",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("starts the game at the tapped age's difficulty (one-tap model)", () => {
    // Design review C1: a separate Start button sat below the overlay's
    // scroll clip while the look-alike age buttons only selected — so the
    // age buttons now start the game directly, like blitz-bomber/platformer.
    render(<SpaceInvadersGame />);

    const nameFor = (d: Difficulty) =>
      `${DIFFICULTY_SETTINGS[d].emoji} ${DIFFICULTY_SETTINGS[d].label}`;

    fireEvent.click(screen.getByRole("button", { name: nameFor("12yo") }));

    const state = useSpaceInvadersStore.getState();
    expect(state.progress.settings.difficulty).toBe("12yo");
    expect(state.gameState).toBe("playing");

    // No separate CTA exists to strand below the fold anymore.
    expect(
      screen.queryByRole("button", { name: /start/i })
    ).not.toBeInTheDocument();
  });

  it("shows touch hints (not keyboard copy) on coarse-pointer viewports", () => {
    mockPointer(true);
    render(<SpaceInvadersGame />);

    expect(screen.getByText("Tap ◀ ▶ to move")).toBeInTheDocument();
    expect(screen.getByText("Tap FIRE to shoot")).toBeInTheDocument();
    expect(
      screen.queryByText("A/D or Arrows to move")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine-pointer viewports", () => {
    mockPointer(false);
    render(<SpaceInvadersGame />);

    expect(screen.getByText("A/D or Arrows to move")).toBeInTheDocument();
    expect(
      screen.getByText("SPACE or W to shoot (hold to auto-fire)")
    ).toBeInTheDocument();
    expect(screen.queryByText("Tap ◀ ▶ to move")).not.toBeInTheDocument();
  });
});
