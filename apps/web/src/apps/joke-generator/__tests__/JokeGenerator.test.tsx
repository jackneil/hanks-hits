import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JokeGenerator } from "../JokeGenerator";
import { useJokeStore } from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: vi.fn(),
  }),
}));

vi.mock("@/shared/components/FullscreenButton", () => ({
  FullscreenButton: () => null,
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

describe("JokeGenerator", () => {
  beforeEach(() => {
    localStorage.clear();
    useJokeStore.setState({
      favorites: [],
      ratings: [],
      seenJokeIds: [],
      lastCategory: "all",
      jokesViewed: 0,
      jokesCopied: 0,
      jokesShared: 0,
      lastModified: Date.now(),
      currentJoke: null,
      showPunchline: false,
      isLoading: false,
      showFavorites: false,
      copiedId: null,
    });
  });

  it("defers home + title to the app shell (no in-app title or home link)", () => {
    render(<JokeGenerator />);

    // The shared GameShell owns the home button and centered app name now.
    expect(
      screen.queryByRole("heading", { name: /joke generator/i })
    ).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/"]')).toBeNull();
  });

  it("keeps the core actions on-screen without a scrolling title bar", () => {
    render(<JokeGenerator />);

    // Category action and the always-visible new-joke CTA survived the restructure.
    expect(
      screen.getByRole("button", { name: /tell me a joke/i })
    ).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();

    // The "view favorites" control was relocated into the slim toolbar, not dropped.
    expect(
      screen.getByRole("button", { name: /view favorites/i })
    ).toBeInTheDocument();
  });
});
