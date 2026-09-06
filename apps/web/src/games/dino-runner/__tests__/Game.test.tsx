import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DinoRunnerGame } from "../Game";
import { useDinoRunnerStore } from "../lib/store";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

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

beforeEach(() => {
  localStorage.clear();
  useDinoRunnerStore.setState({ gameState: "idle" });
});

afterEach(() => {
  resetPointerMock();
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
