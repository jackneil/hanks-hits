import { render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useAuthSync -> useSession needs a SessionProvider we don't mount in tests.
// Stub it to guest mode so the game renders without a provider or network.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import PlatformerGame from "../Game";
import { usePlatformerStore } from "../lib/store";
import { LEVELS } from "../lib/constants";

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
  act(() => {
    usePlatformerStore.setState({ gameState: "ready", currentLevelIndex: 0 });
  });
});

afterEach(() => {
  mockPointer(false);
});

describe("Platformer start overlay", () => {
  it("renders the shared DOM start overlay with the title exactly once", () => {
    render(<PlatformerGame />);
    // The canvas ready-screen title and the duplicate module <h1> are gone;
    // only the overlay heading remains.
    expect(
      screen.getAllByRole("heading", { name: "Hank's Hopper" })
    ).toHaveLength(1);
  });

  it("shows one DOM level button per level, each a >=44px touch target", () => {
    render(<PlatformerGame />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(LEVELS.length);
    for (const button of buttons) {
      expect(button.className).toMatch(/min-h-\[44px\]/);
    }

    LEVELS.forEach((_level, index) => {
      expect(
        screen.getByRole("button", { name: new RegExp(`Level ${index + 1}`) })
      ).toBeInTheDocument();
    });
  });

  it("starts the picked level (leaves 'ready') when its button is clicked", () => {
    render(<PlatformerGame />);
    expect(usePlatformerStore.getState().gameState).toBe("ready");

    fireEvent.click(screen.getByRole("button", { name: /Level 2/ }));

    expect(usePlatformerStore.getState().gameState).toBe("playing");
    expect(usePlatformerStore.getState().currentLevelIndex).toBe(1);
  });
});
