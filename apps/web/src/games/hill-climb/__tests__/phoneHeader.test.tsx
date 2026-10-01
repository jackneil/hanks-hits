import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

import HillClimbGameShell from "../GameShell";
import { useHillClimbStore } from "../lib/store";

/**
 * Hill Climb pauses with its own sheet, not the shell pause menu. On a
 * phone during a run, Sign In and Leaderboard leave the header (the wide
 * Sign In label took the header sideways) and appear in that sheet
 * (live check at 667x311, 2026-09-30).
 */

const DEFAULT_WIDTH = window.innerWidth;
const DEFAULT_HEIGHT = window.innerHeight;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  let nextId = 1;
  vi.stubGlobal("requestAnimationFrame", () => nextId++);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
  localStorage.clear();
  useHillClimbStore.setState({ isPlaying: false, isPaused: false, isGameOver: false });
});

afterEach(() => {
  act(() => setViewport(DEFAULT_WIDTH, DEFAULT_HEIGHT));
  resetPointerMock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Hill Climb header on a phone", () => {
  it("moves Sign In and Leaderboard into the pause sheet during a run, and back after it", () => {
    mockPointer(true);
    setViewport(667, 311);
    render(<HillClimbGameShell />);
    const header = screen.getByTestId("game-shell-header");
    // Before the run (start card): both in the header.
    expect(within(header).getByRole("link", { name: /sign in/i })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Play Now/ })[0]);
    expect(useHillClimbStore.getState().isPlaying).toBe(true);
    expect(within(header).queryByRole("link", { name: /sign in/i })).toBeNull();
    expect(within(header).queryByRole("button", { name: /leaderboard/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    const moved = screen.getByTestId("hill-climb-pause-shell-actions");
    expect(within(moved).getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(within(moved).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();

    act(() => {
      useHillClimbStore.setState({ isPlaying: true, isPaused: false, isGameOver: true });
    });
    expect(within(header).getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });
});
