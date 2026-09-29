/**
 * The Asteroids route with clips on: at game over the result chip shows the
 * clip buttons (Watch, "Make the whole run a video", Record a video, Take a
 * picture) through the one mount (GameShell's ClipShellScope and
 * ResultChip), with no clip code in the game. The real AsteroidsGameShell,
 * GameShell, ClipProvider, ClipUiMount and clip UI; the service is the UI
 * tests' contract fake.
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
import { RESULT_ACTION_COPY, wholeRunLabel } from "@/shared/clips/ui/copy";
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

describe("Asteroids with clips on (plan 11.4)", () => {
  it("shows the clip buttons in the result chip at game over, with the whole run when the ring holds it", async () => {
    const fake = createFakeClipService({ snapshot: { appId: "asteroids", bufferedSec: 45 } });
    // ClipProvider also calls refreshGame (a ClipService extra).
    service.current = { ...fake.service, refreshGame: vi.fn() };
    render(<AsteroidsGameShell />);
    // The clip UI loads with a real dynamic import.
    await screen.findByTestId("clip-button", {}, { timeout: 30_000 });

    act(() => useAsteroidsStore.getState().startGame());
    clock += 20_000;
    act(() => useAsteroidsStore.setState({ score: 700 }));
    act(() => useAsteroidsStore.getState().gameOver());

    const chip = await screen.findByTestId("result-chip");
    const actions = within(chip).getByTestId("result-chip-clip-actions");
    const labels = Array.from(actions.querySelectorAll("[data-action]")).map((el) => el.textContent?.trim());
    expect(labels).toEqual([RESULT_ACTION_COPY.watch, wholeRunLabel("0:20"), RESULT_ACTION_COPY.record, RESULT_ACTION_COPY.picture]);
    // Shown once: the game adds no clip buttons of its own.
    expect(document.querySelectorAll('[data-testid="result-chip-clip-actions"]')).toHaveLength(1);

    // Play again ends the chip and starts a new run.
    clock += DEFAULT_RESTART_GRACE_MS;
    act(() => within(chip).getByRole("button", { name: /play again/i }).click());
    expect(useAsteroidsStore.getState().status).toBe("playing");
    expect(screen.queryByTestId("result-chip")).toBeNull();
  });
});
