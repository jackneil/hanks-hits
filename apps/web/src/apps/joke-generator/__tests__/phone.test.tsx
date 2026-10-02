/**
 * The joke generator on a phone (PR-G8). Sideways the joke card gets the
 * whole left side, and the big button, Funny / Meh and the actions stand in
 * a column on the right (Funny / Meh under the card pushed the punchline
 * off the screen). When the punchline opens, it scrolls into view.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn(), ready: true }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

import { JokeGenerator } from "../JokeGenerator";
import { useJokeStore } from "../lib/store";
import type { Joke } from "../lib/constants";

const JOKE: Joke = { id: "test-1", setup: "Why did the truck nap?", punchline: "It was two tired!", category: "animals" };

function mockShort(short: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: /max-height/.test(query) ? short : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  useJokeStore.setState({ currentJoke: JOKE, showPunchline: false, isLoading: false, showFavorites: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Joke generator on a phone", () => {
  it("sideways keeps Funny / Meh beside the joke card, never under it", () => {
    mockShort(true);
    render(<JokeGenerator />);
    fireEvent.click(screen.getByRole("button", { name: /Show Punchline/ }));
    const sideways = screen.getByTestId("joke-sideways");
    const card = screen.getByTestId("joke-text");
    const funny = within(sideways).getByRole("button", { name: /Funny/ });
    const tell = within(sideways).getByRole("button", { name: /TELL ME A JOKE/ });
    // Funny / Meh stand with the big button, in the column beside the card.
    expect(funny.closest("div.w-56")).toBe(tell.closest("div.w-56"));
    expect(funny.closest("div.w-56")!.contains(card)).toBe(false);
  });

  it("scrolls the punchline into view when its opening is done", () => {
    mockShort(true);
    // jsdom has no scrollIntoView: give it one for this test only.
    const scroll = vi.fn();
    const had = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = had;
    });
    render(<JokeGenerator />);
    fireEvent.click(screen.getByRole("button", { name: /Show Punchline/ }));
    expect(scroll).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(screen.getByTestId("joke-punchline"));
  });

  it("upright keeps the old order: card, Funny / Meh, then the big button", () => {
    mockShort(false);
    render(<JokeGenerator />);
    expect(screen.queryByTestId("joke-sideways")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show Punchline/ }));
    const funny = screen.getByRole("button", { name: /Funny/ });
    const tell = screen.getByRole("button", { name: /TELL ME A JOKE/ });
    expect(funny.compareDocumentPosition(tell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("gives the favorites buttons a 44 px target and a name", () => {
    mockShort(false);
    useJokeStore.setState({ favorites: [{ ...JOKE, savedAt: 1 }], showFavorites: true });
    render(<JokeGenerator />);
    const close = screen.getByRole("button", { name: "Close favorites" });
    expect(close.className).toContain("btn-md");
    const remove = screen.getAllByRole("button", { name: "Remove from favorites" }).at(-1)!;
    expect(remove.className).toContain("h-11");
  });
});
