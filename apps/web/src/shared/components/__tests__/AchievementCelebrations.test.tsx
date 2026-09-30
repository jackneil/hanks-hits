import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  // No router in a test: the placement reads window.location instead.
  usePathname: () => null,
}));

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { AchievementCelebrations, SEEN_MS } from "../AchievementCelebrations";
import { GameShell } from "../GameShell";
import { ResultChip } from "../ResultChip";
import { useAchievementsStore } from "@/shared/lib/achievements";
import { useGameBreaks } from "@/shared/lib/gameBreaks";
import { useStartOverlayPresence } from "@/shared/lib/startOverlayPresence";

function resetAchievements(queue: string[] = []) {
  useAchievementsStore.setState({
    progress: { unlocked: {}, lastModified: 0 },
    watermarks: { apps: {}, playedApps: [], bestIncreases: 0 },
    celebrationQueue: queue,
  });
}

const queue = () => useAchievementsStore.getState().celebrationQueue;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetAchievements();
  useGameBreaks.setState({ shells: 0, slots: [] });
  useStartOverlayPresence.setState({ count: 0, enteredOn: null, leftOn: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  removeSpeechMock();
  window.history.pushState({}, "", "/");
});

describe("AchievementCelebrations on a page with no play (the strip)", () => {
  it("renders nothing while the queue is empty", () => {
    render(<AchievementCelebrations />);
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
  });

  it("is a thin strip at the bottom of the screen, never a toast over the top of the page", () => {
    // The toast under the header covered the top of the play area (the
    // asteroids HUD, breakout's brick row, the drawing toolbar, the joke
    // chips) for 4 s (phone UX audit, S9).
    resetAchievements(["first-play:snake"]);
    render(<AchievementCelebrations />);

    const layer = screen.getByTestId("achievement-celebration");
    expect(layer).toHaveAttribute("data-placement", "strip");
    expect(layer).toHaveClass("fixed", "bottom-0", "inset-x-0");
    expect(layer.className).not.toMatch(/\btop-\d/);
    expect(screen.getByText(/First Play!/)).toBeInTheDocument();
    // One row: the card is 44 px high, not a two-line card.
    expect(screen.getByTestId("achievement-card")).toHaveClass("min-h-11");
  });

  it("never eats taps outside the dismiss button", () => {
    resetAchievements(["first-play:snake"]);
    render(<AchievementCelebrations />);

    const layer = screen.getByTestId("achievement-celebration");
    // The layer (and everything except the dismiss button) must not
    // intercept gameplay taps.
    expect(layer.className).toContain("pointer-events-none");

    const dismiss = screen.getByRole("button", { name: "Dismiss celebration" });
    expect(dismiss.className).toContain("pointer-events-auto");
    expect(dismiss.className).toContain("min-w-[44px]");
    expect(dismiss.className).toContain("min-h-[44px]");
  });

  it("has its own layer: above the emulator view (1100), below modals, sheets and dialogs", () => {
    resetAchievements(["first-play:snake"]);
    render(<AchievementCelebrations />);

    const layer = screen.getByTestId("achievement-celebration");
    // It used to share z-[1100] with the Retro Arcade's full-screen
    // emulator view, so which one drew on top depended on page order.
    expect(layer).toHaveClass("fixed", "z-[1150]", "pointer-events-none");
    expect(layer.className.match(/\bz-\[\d+\]/g)).toEqual(["z-[1150]"]);
  });

  it("draws the strip on one solid surface, with no gradient or colored glow", () => {
    resetAchievements(["first-play:snake"]);
    render(<AchievementCelebrations />);

    const card = screen.getByTestId("achievement-card");
    expect(card).toHaveClass("bg-amber-300");
    expect(card.className).not.toMatch(/bg-gradient|from-|to-orange|shadow-2xl|backdrop-blur/);
    // The text stays dark on the gold card.
    expect(screen.getByText(/First Play!/)).toHaveClass("text-yellow-950");
  });

  it("goes away by itself after its window", () => {
    resetAchievements(["first-play:snake"]);
    render(<AchievementCelebrations />);
    expect(screen.getByTestId("achievement-celebration")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
    expect(queue()).toEqual([]);
  });

  it("collapses a deep queue into ONE summary instead of a parade", () => {
    // Retroactive burst: an existing player's first evaluation can award
    // first-play + several tiers at once. 4+ queued unlocks would stack
    // 16s+ of cards over the page.
    resetAchievements([
      "first-play:snake",
      "plays:snake:5",
      "plays:snake:25",
      "streak:snake:3",
      "explorer:3",
    ]);
    render(<AchievementCelebrations />);

    expect(screen.getByText("You earned 5 trophies!")).toBeInTheDocument();
    // The pointer must work for a GUEST too: the Trophy Case is the
    // guest-visible /trophies page, never a login-walled destination.
    expect(screen.getByText("See them all in your Trophy Case!")).toBeInTheDocument();

    // Dismissing the summary drains the whole batch at once.
    act(() => {
      screen.getByRole("button", { name: "Dismiss celebration" }).click();
    });
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
    expect(queue()).toEqual([]);
  });

  it("summarizes at exactly one past the threshold (queue of 4) and the summary's own timer drains everything", () => {
    resetAchievements(["first-play:snake", "plays:snake:5", "plays:snake:25", "explorer:3"]);
    render(<AchievementCelebrations />);

    // boundary: 4 > SUMMARY_THRESHOLD(3) -> summary, not individual cards
    expect(screen.getByText("You earned 4 trophies!")).toBeInTheDocument();

    // the AUTO-ADVANCE path (not the button) must clear the whole batch too
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
    expect(queue()).toEqual([]);
  });

  it("a stale auto-advance timer racing a tap cannot swallow the next card", () => {
    resetAchievements(["first-play:snake", "plays:snake:5"]);
    render(<AchievementCelebrations />);
    expect(screen.getByText(/First Play!/)).toBeInTheDocument();

    // Simulate the race: the timer's dequeue fires for an id that is no
    // longer the head (the tap already advanced it). It must no-op.
    act(() => {
      screen.getByRole("button", { name: "Dismiss celebration" }).click();
      // stale timer callback for the ALREADY-DISMISSED head
      useAchievementsStore.getState().dequeueCelebration("first-play:snake");
    });
    // The second card still gets its window instead of being skipped.
    expect(screen.getByText(/Regular!/)).toBeInTheDocument();
  });

  it("advances through a multi-unlock queue: dismiss, then auto-advance", () => {
    resetAchievements(["first-play:snake", "plays:snake:5", "explorer:3"]);
    render(<AchievementCelebrations />);

    expect(screen.getByText(/First Play!/)).toBeInTheDocument();

    // Tap Yay! -> next unlock appears.
    act(() => {
      screen.getByRole("button", { name: "Dismiss celebration" }).click();
    });
    expect(screen.getByText(/Regular!/)).toBeInTheDocument();

    // Auto-advance after the show window.
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.getByText(/Explorer!/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
    expect(queue()).toEqual([]);
  });

  it("shows the strip on an app page with no start card (the drawing app)", () => {
    window.history.pushState({}, "", "/apps/drawing-app");
    resetAchievements(["first-play:drawing-app"]);
    render(<AchievementCelebrations />);
    expect(screen.getByTestId("achievement-celebration")).toHaveAttribute("data-placement", "strip");
  });
});

describe("AchievementCelebrations during play", () => {
  it("shows nothing while a game shell is on screen with no break, and keeps the unlock for the next break", () => {
    // Live on a real iPhone SE: the bird of Flappy Bird died behind the
    // toast before the first tap. During play the celebration waits.
    useGameBreaks.setState({ shells: 1 });
    resetAchievements(["first-play:flappy-bird"]);
    render(<AchievementCelebrations />);

    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
    // No timer runs it out while it waits.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(queue()).toEqual(["first-play:flappy-bird"]);
  });

  it("waits on an app page whose start card has left (the quiz is running)", () => {
    window.history.pushState({}, "", "/apps/trivia");
    useStartOverlayPresence.setState({ count: 0, leftOn: "/apps/trivia" });
    resetAchievements(["first-play:trivia"]);
    const { rerender } = render(<AchievementCelebrations />);
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();

    // Back on the home page there is no play: the strip shows.
    window.history.pushState({}, "", "/");
    rerender(<AchievementCelebrations />);
    expect(screen.getByTestId("achievement-celebration")).toHaveAttribute("data-placement", "strip");
  });

  it("waits while a start card with no room for a note is up, so the strip never covers Play", () => {
    useStartOverlayPresence.setState({ count: 1 });
    resetAchievements(["first-play:snake"]);
    render(<AchievementCelebrations />);
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
  });
});

describe("AchievementCelebrations at a break", () => {
  /** A game on screen: the shell plus the global celebration layer. */
  function renderGame() {
    return render(
      <>
        <GameShell gameName="Snake" appId="snake">
          <div>game</div>
        </GameShell>
        <AchievementCelebrations />
      </>
    );
  }

  const pause = () => fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
  const resume = () =>
    fireEvent.click(within(screen.getByTestId("pause-menu")).getByRole("button", { name: /Resume/ }));

  it("is a card inside the pause menu, part of it, not a fixed layer over it", () => {
    resetAchievements(["first-play:snake"]);
    renderGame();
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();

    pause();

    const slot = screen.getByTestId("pause-menu-break-slot");
    const card = within(slot).getByTestId("achievement-celebration");
    expect(card).toHaveAttribute("data-placement", "break");
    expect(card.className).not.toMatch(/fixed|z-\[/);
    expect(within(card).getByText(/First Play!/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Dismiss celebration" })).toHaveClass(
      "min-w-[44px]",
      "min-h-[44px]"
    );
  });

  it("is read out loud with the pause menu, after the menu's own words", async () => {
    // findBy waits on real timers.
    vi.useRealTimers();
    const synth = installSpeechMock();
    resetAchievements(["first-play:snake"]);
    renderGame();
    pause();

    const menu = screen.getByTestId("pause-menu");
    fireEvent.click(await within(menu).findByTestId("read-aloud-button"));

    expect(synth.lastUtterance().text).toBe(
      "Paused. Snake. Resume. Leaderboard. Go Home. New trophy! First Play! You tried Snake! Tap Yay! to close it."
    );
  });

  it("stays for the whole break with no timer, and leaves the queue when the break ends after it was seen", () => {
    resetAchievements(["first-play:snake"]);
    renderGame();
    pause();
    expect(screen.getByTestId("achievement-celebration")).toBeInTheDocument();

    // Long after the strip's window, the card is still in the menu.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByTestId("achievement-celebration")).toBeInTheDocument();
    expect(queue()).toEqual(["first-play:snake"]);

    // The kid resumes: the card was on screen for 10 s, so it counts as
    // seen. It does not come back at the next break.
    resume();
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
    expect(queue()).toEqual([]);
    pause();
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
  });

  it("keeps a card the kid could not have seen: a break that ends before SEEN_MS", () => {
    // The start card removes its slot before paint when the note does not
    // fit, and a kid can tap Resume at once. Then the card waits for the
    // next break.
    resetAchievements(["first-play:snake"]);
    renderGame();
    pause();
    act(() => {
      vi.advanceTimersByTime(SEEN_MS - 100);
    });
    resume();
    expect(queue()).toEqual(["first-play:snake"]);

    pause();
    expect(
      within(screen.getByTestId("pause-menu-break-slot")).getByTestId("achievement-celebration")
    ).toBeInTheDocument();
  });

  it("Yay! closes the card and shows the next trophy in the same slot", () => {
    resetAchievements(["first-play:snake", "plays:snake:5"]);
    renderGame();
    pause();
    const slot = screen.getByTestId("pause-menu-break-slot");
    expect(within(slot).getByText(/First Play!/)).toBeInTheDocument();

    fireEvent.click(within(slot).getByRole("button", { name: "Dismiss celebration" }));
    expect(within(slot).getByText(/Regular!/)).toBeInTheDocument();
    expect(queue()).toEqual(["plays:snake:5"]);

    // The old card's leave must not dequeue the new head.
    act(() => {
      vi.advanceTimersByTime(SEEN_MS + 100);
    });
    expect(queue()).toEqual(["plays:snake:5"]);
  });

  it("a summary in a break surface clears the whole batch on Yay!", () => {
    resetAchievements(["first-play:snake", "plays:snake:5", "plays:snake:25", "explorer:3"]);
    renderGame();
    pause();
    const slot = screen.getByTestId("pause-menu-break-slot");
    expect(within(slot).getByText("You earned 4 trophies!")).toBeInTheDocument();
    fireEvent.click(within(slot).getByRole("button", { name: "Dismiss celebration" }));
    expect(queue()).toEqual([]);
  });

  it("is one truncated row on a short screen, so the start card's slot holds it under the install tip", () => {
    // Live at 667x311 the start card's slot stacked the two-line card
    // under the 150 px install tip, and the card ran to the bottom edge
    // of the screen.
    resetAchievements(["first-play:snake"]);
    renderGame();
    pause();
    const card = screen.getByTestId("achievement-card");
    expect(card).toHaveClass("short:py-1");
    const words = within(card).getByText(/First Play!/).parentElement!;
    expect(words).toHaveClass("short:truncate");
    expect(within(card).getByText(/First Play!/)).toHaveClass("block", "short:inline");
    expect(within(card).getByText(/You tried Snake!/)).toHaveClass("block", "short:inline");
  });

  describe("seen means in view (IntersectionObserver)", () => {
    class FakeIntersectionObserver {
      static instances: FakeIntersectionObserver[] = [];
      targets: Element[] = [];
      constructor(private readonly callback: IntersectionObserverCallback) {
        FakeIntersectionObserver.instances.push(this);
      }
      observe(el: Element) {
        this.targets.push(el);
      }
      unobserve() {}
      disconnect() {
        this.targets = [];
      }
      takeRecords() {
        return [];
      }
      /** The browser reports the card in view, or out of it. */
      report(isIntersecting: boolean) {
        act(() => {
          this.callback(
            this.targets.map((target) => ({ isIntersecting, target }) as IntersectionObserverEntry),
            this as unknown as IntersectionObserver
          );
        });
      }
    }
    const newest = () => FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];

    beforeEach(() => {
      FakeIntersectionObserver.instances = [];
      vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("a card under the fold of the pause menu is not seen: it comes back at the next break", () => {
      // Live at 667x311 the pause menu is a long column and the card sat
      // below Restart, off screen. Resume must not count it as seen.
      resetAchievements(["first-play:snake"]);
      renderGame();
      pause();
      expect(newest().targets).toEqual([screen.getByTestId("achievement-card")]);
      newest().report(false);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      resume();
      expect(queue()).toEqual(["first-play:snake"]);

      pause();
      expect(
        within(screen.getByTestId("pause-menu-break-slot")).getByTestId("achievement-celebration")
      ).toBeInTheDocument();
    });

    it("a card in view for SEEN_MS in total counts as seen, even if it scrolled out later", () => {
      resetAchievements(["first-play:snake"]);
      renderGame();
      pause();
      newest().report(true);
      act(() => {
        vi.advanceTimersByTime(SEEN_MS - 200);
      });
      newest().report(false);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      newest().report(true);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      resume();
      expect(queue()).toEqual([]);
    });

    it("a card that scrolled into view for less than SEEN_MS is kept", () => {
      resetAchievements(["first-play:snake"]);
      renderGame();
      pause();
      newest().report(false);
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      newest().report(true);
      act(() => {
        vi.advanceTimersByTime(SEEN_MS - 500);
      });
      resume();
      expect(queue()).toEqual(["first-play:snake"]);
    });
  });

  it("is a card inside the result chip at game over, read after the chip's buttons", async () => {
    // findBy waits on real timers.
    vi.useRealTimers();
    const synth = installSpeechMock();
    useGameBreaks.setState({ shells: 1 });
    resetAchievements(["first-play:snake"]);
    render(
      <>
        <ResultChip resultText="Game over! You got 12 points" onRestart={() => {}} />
        <AchievementCelebrations />
      </>
    );

    const slot = screen.getByTestId("result-chip-break-slot");
    expect(within(slot).getByTestId("achievement-celebration")).toBeInTheDocument();
    // The card sits above the buttons, inside the chip.
    const chip = screen.getByTestId("result-chip");
    expect(chip).toContainElement(slot);
    expect(
      slot.compareDocumentPosition(within(chip).getByRole("group")) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // The chip ignores every tap for its 600 ms restart grace.
    const mounted = performance.now();
    vi.spyOn(performance, "now").mockImplementation(() => mounted + 1000);
    fireEvent.click(await within(chip).findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe(
      "Game over! You got 12 points. Play again. New trophy! First Play! You tried Snake! Tap Yay! to close it."
    );
  });
});
