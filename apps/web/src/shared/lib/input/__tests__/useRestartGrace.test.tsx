import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RESTART_GRACE_MS,
  createRestartGrace,
  useRestartGrace,
  type RestartGrace,
} from "../useRestartGrace";

let clock = 50_000;

beforeEach(() => {
  clock = 50_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRestartGrace", () => {
  it("has no lockout before the first transition", () => {
    const grace = createRestartGrace();
    expect(grace.accept()).toBe(true);
    expect(grace.isLocked()).toBe(false);
  });

  it("ignores input for 600 ms after a transition, then accepts it", () => {
    expect(DEFAULT_RESTART_GRACE_MS).toBe(600);
    const grace = createRestartGrace();
    grace.markTransition();

    expect(grace.accept()).toBe(false);
    clock += 599;
    expect(grace.accept()).toBe(false);
    expect(grace.isLocked()).toBe(true);
    clock += 1;
    expect(grace.accept()).toBe(true);
    expect(grace.isLocked()).toBe(false);
  });

  it("never accepts a key auto-repeat, even long after the transition", () => {
    const grace = createRestartGrace();
    grace.markTransition();
    clock += 10_000;
    expect(grace.accept({ repeat: true })).toBe(false);
    expect(grace.accept({ repeat: false })).toBe(true);
    expect(grace.accept(null)).toBe(true);
  });

  it("reads repeat straight off a real KeyboardEvent", () => {
    const grace = createRestartGrace();
    const held = new KeyboardEvent("keydown", { key: " ", repeat: true });
    const fresh = new KeyboardEvent("keydown", { key: " ", repeat: false });
    expect(grace.accept(held)).toBe(false);
    expect(grace.accept(fresh)).toBe(true);
  });

  it("uses a custom window and falls back to 600 ms for a bad one", () => {
    const grace = createRestartGrace(200);
    grace.markTransition();
    clock += 200;
    expect(grace.accept()).toBe(true);

    grace.setWindowMs(Number.NaN);
    grace.markTransition();
    clock += 599;
    expect(grace.accept()).toBe(false);
  });

  it("a zero window only blocks key repeats", () => {
    const grace = createRestartGrace(0);
    grace.markTransition();
    expect(grace.accept()).toBe(true);
    expect(grace.accept({ repeat: true })).toBe(false);
  });
});

describe("useRestartGrace", () => {
  it("locks on mount, so a result card that appears is safe from a tap", () => {
    const restart = vi.fn();

    function ResultCard() {
      const grace = useRestartGrace();
      return (
        <button type="button" onClick={() => grace.accept() && restart()}>
          Play again
        </button>
      );
    }

    render(<ResultCard />);
    fireEvent.click(screen.getByRole("button"));
    expect(restart).not.toHaveBeenCalled();
    clock += 600;
    fireEvent.click(screen.getByRole("button"));
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("restarts the lockout on every phase change and keeps one object", () => {
    const graces: RestartGrace[] = [];
    const latest = () => graces[graces.length - 1];

    function Game({ phase }: { phase: string }) {
      graces.push(useRestartGrace(600, phase));
      return <div>{phase}</div>;
    }

    const { rerender } = render(<Game phase="playing" />);
    clock += 5000;
    expect(latest().accept()).toBe(true);

    rerender(<Game phase="gameOver" />);
    expect(latest().accept()).toBe(false);
    clock += 600;
    expect(latest().accept()).toBe(true);

    // A re-render with the SAME phase does not start a new lockout.
    rerender(<Game phase="gameOver" />);
    expect(latest().accept()).toBe(true);

    // Back to play, then game over again: a new lockout each time.
    rerender(<Game phase="playing" />);
    clock += 5000;
    rerender(<Game phase="gameOver" />);
    expect(latest().accept()).toBe(false);

    expect(new Set(graces).size).toBe(1);
  });

  it("marks the transition in the same commit as a state change", () => {
    const restart = vi.fn();

    function Game() {
      const [phase, setPhase] = useState("playing");
      const grace = useRestartGrace(600, phase);
      return (
        <>
          <button type="button" onClick={() => setPhase("gameOver")}>
            crash
          </button>
          <button
            type="button"
            onClick={() => phase === "gameOver" && grace.accept() && restart()}
          >
            restart
          </button>
        </>
      );
    }

    render(<Game />);
    clock += 5000;
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "crash" }));
    });
    // The very next tap, with no time passing, is inside the lockout.
    fireEvent.click(screen.getByRole("button", { name: "restart" }));
    expect(restart).not.toHaveBeenCalled();
    clock += 600;
    fireEvent.click(screen.getByRole("button", { name: "restart" }));
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("gates a window keydown restart: held Space never restarts", () => {
    const restart = vi.fn();

    function Game({ phase }: { phase: string }) {
      const grace = useRestartGrace(600, phase);
      return (
        <div
          data-testid="game"
          tabIndex={0}
          onKeyDown={(e) => {
            if (phase === "gameOver" && e.key === " " && grace.accept(e)) restart();
          }}
        />
      );
    }

    const { rerender } = render(<Game phase="playing" />);
    rerender(<Game phase="gameOver" />);
    const game = screen.getByTestId("game");

    // The key was already down when the run ended: repeats never restart.
    fireEvent.keyDown(game, { key: " ", repeat: true });
    clock += 2000;
    fireEvent.keyDown(game, { key: " ", repeat: true });
    expect(restart).not.toHaveBeenCalled();

    // A fresh press after the lockout does.
    fireEvent.keyDown(game, { key: " ", repeat: false });
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("follows a new ms value", () => {
    const graces: RestartGrace[] = [];
    function Card({ ms }: { ms: number }) {
      graces.push(useRestartGrace(ms));
      return null;
    }
    const { rerender } = render(<Card ms={600} />);
    rerender(<Card ms={100} />);
    clock += 100;
    expect(graces[graces.length - 1].accept()).toBe(true);
  });
});
