import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DinoRunnerGame } from "../Game";
import { useDinoRunnerStore } from "../lib/store";

// useAuthSync pulls in next-auth's useSession, which needs a provider we don't
// mount in unit tests. Stub it with the shape the game destructures.
vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: vi.fn(),
  }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

/**
 * The global setup installs a matchMedia stub that always returns
 * matches: false. This swaps in one where "(pointer: coarse)" resolves to the
 * requested value so we can simulate touch vs keyboard/mouse viewports.
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
  localStorage.clear();
  useDinoRunnerStore.setState({ gameState: "idle" });
});

afterEach(() => {
  mockPointer(false);
});

describe("DinoRunnerGame start overlay", () => {
  it("shows the title exactly once, as a single heading, with a start button", () => {
    render(<DinoRunnerGame />);

    expect(
      screen.getAllByRole("heading", { name: "Dino Runner" })
    ).toHaveLength(1);
    expect(screen.getAllByText("Dino Runner")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
  });

  it("shows touch jump/duck hints (not keyboard copy) on coarse pointers", () => {
    mockPointer(true);
    render(<DinoRunnerGame />);

    expect(screen.getByText("Tap to jump (hold = higher)")).toBeInTheDocument();
    expect(
      screen.getByText("Swipe down or tap DUCK to duck")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("SPACE or ↑ to jump (hold = higher)")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<DinoRunnerGame />);

    expect(
      screen.getByText("SPACE or ↑ to jump (hold = higher)")
    ).toBeInTheDocument();
    expect(screen.getByText("↓ to duck")).toBeInTheDocument();
    expect(
      screen.queryByText("Tap to jump (hold = higher)")
    ).not.toBeInTheDocument();
  });
});
