/**
 * The Asteroids route with clips on: at game over the result chip shows the
 * run's clip buttons (decision D1: "Watch the whole run (m:ss)" for a run of
 * 30 s or less; "Watch the end" and "Make the whole run a video (m:ss)" for
 * a longer one) through the one mount (GameShell's ClipShellScope and
 * ResultChip), with no clip code in the game. The real AsteroidsGameShell,
 * GameShell, ClipProvider, ClipUiMount and clip UI; the service is the UI
 * tests' contract fake, and the game's runPhase calls set the run's span.
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

const flag = vi.hoisted(() => ({ verdict: { mode: "on", capture: true } }));
vi.mock("@/shared/clips/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/clips/config")>();
  return { ...actual, loadClipsVerdict: vi.fn(async () => flag.verdict) };
});
const service = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/shared/clips/service/ClipService", () => ({ startClipService: () => service.current }));

import { createFakeClipService } from "@/shared/clips/ui/__tests__/fakeClipService";
import { RESULT_ACTION_COPY, SHARING_COPY, watchRunLabel, wholeRunLabel } from "@/shared/clips/ui/copy";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { AsteroidsGameShell } from "../AsteroidsGameShell";
import { useAsteroidsStore } from "../lib/store";

let clock = 1_000_000;

beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: vi.fn() });
  localStorage.clear();
  act(() => {
    useAsteroidsStore.setState({ status: "ready", score: 0, wave: 1 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // @ts-expect-error - remove the stub again
  delete HTMLElement.prototype.animate;
});

/** The clip labels of the result chip on screen. */
function chipClipLabels(chip: HTMLElement): Array<string | undefined> {
  const actions = within(chip).getByTestId("result-chip-clip-actions");
  return Array.from(actions.querySelectorAll("[data-action]")).map((el) => el.textContent?.trim());
}

describe("Asteroids with clips on (plan 11.4, decision D1)", () => {
  it("offers the run's own clips at game over: a long run gets Watch the end and the whole run", async () => {
    const fake = createFakeClipService({ snapshot: { appId: "asteroids", bufferedSec: 60 } });
    // ClipProvider also calls refreshGame (a ClipService extra).
    service.current = { ...fake.service, refreshGame: vi.fn() };
    render(<AsteroidsGameShell />);
    // The clip UI loads with a real dynamic import.
    await screen.findByTestId("clip-button", {}, { timeout: 30_000 });

    act(() => useAsteroidsStore.getState().startGame());
    fake.advanceCapture(42); // the run plays on the capture timeline
    act(() => useAsteroidsStore.setState({ score: 700 }));
    act(() => useAsteroidsStore.getState().gameOver());

    const chip = await screen.findByTestId("result-chip");
    expect(chipClipLabels(chip)).toEqual([SHARING_COPY.putItOnTheLeaderboard, RESULT_ACTION_COPY.watchEnd, wholeRunLabel("0:42")]);
    // Shown once: the game adds no clip buttons of its own.
    expect(document.querySelectorAll('[data-testid="result-chip-clip-actions"]')).toHaveLength(1);

    // Play again ends the chip and starts a new run.
    clock += DEFAULT_RESTART_GRACE_MS;
    act(() => within(chip).getByRole("button", { name: /play again/i }).click());
    expect(useAsteroidsStore.getState().status).toBe("playing");
    expect(screen.queryByTestId("result-chip")).toBeNull();
  });

  it("a restarted short run: Watch the whole run starts at or after the new run's start, never in the run before", async () => {
    const fake = createFakeClipService({ snapshot: { appId: "asteroids", bufferedSec: 60 } });
    service.current = { ...fake.service, refreshGame: vi.fn() };
    render(<AsteroidsGameShell />);
    await screen.findByTestId("clip-button", {}, { timeout: 30_000 });

    // The first run: 40 s, then game over and Play again.
    act(() => useAsteroidsStore.getState().startGame());
    fake.advanceCapture(40);
    act(() => useAsteroidsStore.getState().gameOver());
    const first = await screen.findByTestId("result-chip");
    fake.advanceCapture(3); // the post-roll on the result card
    clock += DEFAULT_RESTART_GRACE_MS;
    act(() => within(first).getByRole("button", { name: /play again/i }).click());
    const secondStartUs = fake.captureUs();

    // The new run: 16 s.
    fake.advanceCapture(16);
    act(() => useAsteroidsStore.getState().gameOver());
    const endUs = fake.captureUs();
    const chip = await screen.findByTestId("result-chip");
    expect(chipClipLabels(chip)).toEqual([SHARING_COPY.putItOnTheLeaderboard, watchRunLabel("0:16")]);

    clock += DEFAULT_RESTART_GRACE_MS;
    const watch = within(chip).getByRole("button", { name: watchRunLabel("0:16") });
    act(() => watch.click());
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(fake.clipRequests).toEqual([{ seconds: 16, endAtUs: endUs, frozen: true, notBeforeUs: secondStartUs }]);
    expect(endUs - fake.clipRequests[0].seconds * 1e6).toBeGreaterThanOrEqual(secondStartUs);
  });
});
