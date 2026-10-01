import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Matter from "matter-js";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

import { HillClimbGame } from "../Game";
import { useHillClimbStore } from "../lib/store";
import { ShellHoldContext } from "@/shared/hooks/useShellHold";

// Regression (phone UX audit 2026-09-29, S8; review of phone/foundation):
// Hill Climb's physics never stopped under a shell overlay. The truck drove
// 213 m to 890 m under "Restart game?", and the install sheet opened over a
// live run. The shell's hold now stops the physics runner exactly like the
// game's own pause, and starts it again when the hold ends.

beforeEach(() => {
  let nextId = 1;
  vi.stubGlobal("requestAnimationFrame", () => nextId++);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  // jsdom has no 2d context; the loop only needs a truthy handle because
  // the stubbed rAF never runs the render callback.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
  localStorage.clear();
  useHillClimbStore.setState({ isPlaying: false, isPaused: false, isGameOver: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => {
    useHillClimbStore.setState({ isPlaying: false, isPaused: false });
  });
});

function Game({ held }: { held: boolean }) {
  return (
    <ShellHoldContext.Provider value={held}>
      <HillClimbGame startActive />
    </ShellHoldContext.Provider>
  );
}

describe("Hill Climb under the shell's hold", () => {
  it("stops the physics runner while the shell holds the game, and runs it again when the hold ends", () => {
    const stop = vi.spyOn(Matter.Runner, "stop");
    const run = vi.spyOn(Matter.Runner, "run");
    act(() => {
      useHillClimbStore.getState().restartRun();
    });
    const { rerender } = render(<Game held={false} />);
    expect(run).toHaveBeenCalledTimes(1);
    const runner = run.mock.calls[0][0];
    expect(stop).not.toHaveBeenCalled();

    rerender(<Game held />);
    expect(stop).toHaveBeenCalledWith(runner);
    // The hold is not the game's own pause: no pause menu opens.
    expect(useHillClimbStore.getState().isPaused).toBe(false);

    rerender(<Game held={false} />);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toBe(runner);
  });

  it("a run that starts under a hold waits for the hold to end", () => {
    const stop = vi.spyOn(Matter.Runner, "stop");
    const run = vi.spyOn(Matter.Runner, "run");
    act(() => {
      useHillClimbStore.getState().restartRun();
    });
    const { rerender } = render(<Game held />);
    expect(run).toHaveBeenCalledTimes(1);
    const runner = run.mock.calls[0][0];
    expect(stop).toHaveBeenLastCalledWith(runner);

    rerender(<Game held={false} />);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
