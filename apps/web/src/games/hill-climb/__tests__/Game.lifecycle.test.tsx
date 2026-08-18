import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useAuthSync -> useSession needs a SessionProvider; stub to guest.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

// PauseMenu uses next/navigation's useRouter (app router isn't mounted in jsdom)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

import { HillClimbGame } from "../Game";
import HillClimbGameShell from "../GameShell";
import { useHillClimbStore } from "../lib/store";

/**
 * Run-lifecycle pinning tests for the latest-ref / effect-deps surgery
 * (2026-07-11). The two bugs these must catch if they ever return:
 *  - restart double-init (handleRestart calling initGame() on top of the
 *    isPlaying-transition effect),
 *  - pause -> Garage -> Play leaving a blank canvas because the effect never
 *    re-initialized for the freshly remounted canvas (isPlaying never
 *    transitions on that path; only showGarage does).
 *
 * The render loop itself never runs here: requestAnimationFrame is stubbed to
 * capture callbacks without executing them, so we assert SCHEDULING (a new
 * loop chain was started) rather than painted pixels.
 */

let rafCalls = 0;
let cancelCalls = 0;

beforeEach(() => {
  rafCalls = 0;
  cancelCalls = 0;
  let nextId = 1;
  vi.stubGlobal("requestAnimationFrame", () => {
    rafCalls++;
    return nextId++;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    cancelCalls++;
  });
  // jsdom has no 2d context; the loop only needs a truthy handle because the
  // stubbed rAF never executes the render callback.
  // `as never` sidesteps getContext's overload union (2d/webgl/webgpu) - the
  // stub only needs to be truthy because the stubbed rAF never runs the loop.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as never
  );
  localStorage.clear();
  useHillClimbStore.setState({
    isPlaying: false,
    isPaused: false,
    isGameOver: false,
    pauseScreen: "menu",
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => {
    useHillClimbStore.setState({ isPlaying: false, isPaused: false });
  });
});

describe("hill-climb run lifecycle", () => {
  it("starts exactly one render-loop chain on Play Now", () => {
    render(<HillClimbGame />);
    expect(rafCalls).toBe(0); // start screen: no loop yet

    fireEvent.click(screen.getByRole("button", { name: /Play Now/ }));

    expect(useHillClimbStore.getState().isPlaying).toBe(true);
    expect(rafCalls).toBeGreaterThan(0);
    // A double-init would tear down the first chain: startRenderLoop's
    // defensive cancel (and the effect cleanup) would fire. A single clean
    // first init never cancels anything.
    expect(cancelCalls).toBe(0);
  });

  it("mounts a restart as one active fresh run, not the start screen", () => {
    render(<HillClimbGame startActive />);

    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
    expect(useHillClimbStore.getState().isPlaying).toBe(true);
    expect(rafCalls).toBeGreaterThan(0);
    expect(cancelCalls).toBe(0);
  });

  it("preserves settings and progression when starting a fresh run", () => {
    act(() => {
      useHillClimbStore.setState({
        soundEnabled: false,
        bestDistance: 1234,
        totalCoinsEarned: 77,
      });
    });

    render(<HillClimbGame startActive />);
    const state = useHillClimbStore.getState();

    expect(state.isPlaying).toBe(true);
    expect(state.soundEnabled).toBe(false);
    expect(state.bestDistance).toBe(1234);
    expect(state.totalCoinsEarned).toBe(77);
  });

  it("header restart remounts directly into one active fresh run", () => {
    render(<HillClimbGameShell />);

    const beforeRestart = rafCalls;
    expect(useHillClimbStore.getState().isPlaying).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Restart game" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm restart" }));

    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
    expect(useHillClimbStore.getState().isPlaying).toBe(true);
    expect(rafCalls).toBeGreaterThan(beforeRestart);
    // Remount cleanup cancels the old chain before the single new chain starts.
    expect(cancelCalls).toBeGreaterThan(0);
  });

  it("pause -> Garage -> Play re-initializes the loop for the remounted canvas", () => {
    render(<HillClimbGame />);
    fireEvent.click(screen.getByRole("button", { name: /Play Now/ }));
    const afterStart = rafCalls;

    // pause mid-run, then leave for the Garage via the pause menu
    act(() => {
      useHillClimbStore.getState().pauseGame();
    });
    fireEvent.click(screen.getByRole("button", { name: /Garage/ }));

    // the canvas is gone and the old run was torn down
    expect(document.querySelector("canvas")).toBeNull();
    expect(cancelCalls).toBeGreaterThan(0);

    // start again from the Garage: a NEW loop chain must be scheduled for the
    // NEW canvas (isPlaying never transitioned on this path - only showGarage)
    fireEvent.click(screen.getByRole("button", { name: /Play Now/ }));

    expect(document.querySelector("canvas")).not.toBeNull();
    expect(rafCalls).toBeGreaterThan(afterStart);
    expect(useHillClimbStore.getState().isPaused).toBe(false);
  });

  it("game over -> Try Again runs exactly ONE fresh init via the isPlaying transition", () => {
    render(<HillClimbGame />);
    fireEvent.click(screen.getByRole("button", { name: /Play Now/ }));
    // rAF never executes here, so every init schedules the same fixed number
    // of frames (render loop + Matter.Runner). One clean init = afterStart
    // schedules; a regressed double-init on restart would add 2x that.
    const afterStart = rafCalls;

    act(() => {
      useHillClimbStore.getState().endRun("head");
    });
    fireEvent.click(screen.getByRole("button", { name: /Try Again/ }));

    const s = useHillClimbStore.getState();
    expect(s.isPlaying).toBe(true);
    expect(s.isGameOver).toBe(false);
    expect(rafCalls).toBe(afterStart * 2); // exactly one more init's worth
  });
});
