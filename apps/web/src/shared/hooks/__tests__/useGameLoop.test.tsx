import { act, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";
import { useGameLoop, type GameLoopOptions } from "../useGameLoop";

const REFRESH_RATES = [60, 90, 120, 144] as const;
const STEP_MS = 1000 / 60;

type Log = { updates: number[]; alphas: number[]; afterRenders: number[] };

function newLog(): Log {
  return { updates: [], alphas: [], afterRenders: [] };
}

function Harness({ log, ...options }: GameLoopOptions & { log: Log }) {
  useGameLoop(
    {
      update: (stepMs) => log.updates.push(stepMs),
      render: (alpha) => log.alphas.push(alpha),
      afterRender: () => log.afterRenders.push(1),
    },
    options
  );
  return null;
}

let raf: RafMock;

beforeEach(() => {
  raf = installRafMock();
});

afterEach(() => {
  uninstallRafMock();
});

/** Run the first frame, which only starts the clock. */
function prime(hz: number) {
  act(() => {
    raf.nextFrame(hz);
  });
}

/** Run frames for `ms`, letting React render between frames like a browser. */
function runFor(ms: number, hz: number) {
  raf.runFor(ms, hz, (runFrame) => act(runFrame));
}

describe("useGameLoop fixed step", () => {
  for (const hz of REFRESH_RATES) {
    for (const timeScale of [1, 0.5]) {
      it(`runs exactly ${60 * timeScale} updates each second at ${hz} Hz (timeScale ${timeScale})`, () => {
        const log = newLog();
        render(<Harness log={log} running timeScale={timeScale} />);
        prime(hz);
        expect(log.updates).toHaveLength(0);

        for (let second = 1; second <= 3; second += 1) {
          runFor(1000, hz);
          expect(log.updates).toHaveLength(60 * timeScale * second);
        }
        // Every update gets the same fixed step of game time.
        expect(new Set(log.updates)).toEqual(new Set([STEP_MS]));
      });
    }

    it(`keeps render alpha in [0, 1) and renders once each frame at ${hz} Hz`, () => {
      const log = newLog();
      render(<Harness log={log} running timeScale={0.5} />);
      prime(hz);
      runFor(2000, hz);

      expect(log.alphas).toHaveLength(1 + 2 * hz);
      expect(log.afterRenders).toHaveLength(log.alphas.length);
      for (const alpha of log.alphas) {
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThan(1);
      }
      // Alpha really interpolates: between steps it takes values above 0.
      expect(Math.max(...log.alphas)).toBeGreaterThan(0.4);
    });
  }

  it("uses stepsPerSecond for both the count and the step size", () => {
    const log = newLog();
    render(<Harness log={log} running stepsPerSecond={30} />);
    prime(120);
    runFor(1000, 120);
    expect(log.updates).toHaveLength(30);
    expect(log.updates[0]).toBeCloseTo(1000 / 30, 9);
  });

  it("falls back to safe defaults for bad option values", () => {
    const log = newLog();
    render(
      <Harness
        log={log}
        running
        stepsPerSecond={0}
        maxDtMs={Number.NaN}
        timeScale={-2}
      />
    );
    prime(60);
    runFor(1000, 60);
    expect(log.updates).toHaveLength(60);
  });
});

describe("useGameLoop stalls and pauses", () => {
  it("clamps a 500 ms stall to one 50 ms frame: no burst of updates", () => {
    const log = newLog();
    render(<Harness log={log} running />);
    prime(60);
    runFor(1000, 60);
    const before = log.updates.length;

    act(() => {
      raf.stall(500);
      raf.nextFrame(60);
    });
    const burst = log.updates.length - before;
    // 50 ms of game time is 3 steps. The lost 500 ms never comes back.
    expect(burst).toBeLessThanOrEqual(Math.ceil(50 / STEP_MS));

    const afterStall = log.updates.length;
    runFor(1000, 60);
    expect(log.updates.length - afterStall).toBe(60);
  });

  it("respects a custom maxDtMs clamp", () => {
    const log = newLog();
    render(<Harness log={log} running maxDtMs={20} />);
    prime(60);
    act(() => {
      raf.stall(500);
      raf.nextFrame(60);
    });
    expect(log.updates).toHaveLength(1);
  });

  it("stops updates while paused, keeps drawing a still picture, and resumes with no catch-up", () => {
    const log = newLog();
    const { rerender } = render(<Harness log={log} running timeScale={0.5} />);
    prime(120);
    runFor(1000, 120);
    // One more frame leaves part of a step in the accumulator (alpha > 0).
    act(() => {
      raf.nextFrame(120);
    });
    const updatesAtPause = log.updates.length;

    rerender(<Harness log={log} running paused timeScale={0.5} />);
    const alphasBefore = log.alphas.length;
    runFor(5000, 120);
    expect(log.updates).toHaveLength(updatesAtPause);
    const pausedAlphas = log.alphas.slice(alphasBefore);
    expect(pausedAlphas).toHaveLength(600);
    expect(new Set(pausedAlphas).size).toBe(1);
    expect(pausedAlphas[0]).toBeCloseTo(0.25, 9);

    rerender(<Harness log={log} running timeScale={0.5} />);
    // The first frame after resume only restarts the clock.
    act(() => {
      raf.nextFrame(120);
    });
    expect(log.updates).toHaveLength(updatesAtPause);
    // The next second is a normal second, not 5 seconds of catch-up.
    runFor(1000, 120);
    expect(log.updates.length - updatesAtPause).toBe(30);
  });

  it("restarts the clock when a hidden tab comes back", () => {
    const log = newLog();
    render(<Harness log={log} running />);
    prime(60);
    runFor(1000, 60);
    const before = log.updates.length;

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      raf.stall(30_000);
      raf.nextFrame(60);
    });
    expect(log.updates.length).toBe(before);
  });
});

describe("useGameLoop frame chain", () => {
  it("keeps ONE frame chain while the game re-renders on every step", () => {
    const log = newLog();
    const seen: number[] = [];

    function ReRendering() {
      const [ticks, setTicks] = useState(0);
      // New callback objects on every render, like a game that closes
      // over fresh state each frame.
      useGameLoop(
        {
          update: () => {
            seen.push(ticks);
            setTicks((t) => t + 1);
          },
          render: (alpha) => log.alphas.push(alpha),
        },
        { running: true }
      );
      return <div data-testid="ticks">{ticks}</div>;
    }

    render(<ReRendering />);
    prime(120);
    runFor(1000, 120);

    expect(seen).toHaveLength(60);
    // The newest callbacks run: each update saw the state of the last render.
    expect(seen.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    // One request per frame plus the first one; never cancelled or rebuilt.
    expect(raf.cancelCount()).toBe(0);
    expect(raf.requestCount()).toBe(1 + 1 + 120);
    expect(raf.pending()).toBe(1);
  });

  it("changing timeScale mid-run does not rebuild the chain", () => {
    const log = newLog();
    const { rerender } = render(<Harness log={log} running timeScale={1} />);
    prime(60);
    runFor(1000, 60);
    rerender(<Harness log={log} running timeScale={0.5} />);
    runFor(1000, 60);
    expect(log.updates).toHaveLength(90);
    expect(raf.cancelCount()).toBe(0);
  });

  it("starts and stops with the running flag", () => {
    const log = newLog();
    const { rerender, unmount } = render(<Harness log={log} running={false} />);
    runFor(1000, 60);
    expect(raf.pending()).toBe(0);
    expect(log.alphas).toHaveLength(0);

    rerender(<Harness log={log} running />);
    expect(raf.pending()).toBe(1);
    prime(60);
    runFor(1000, 60);
    expect(log.updates).toHaveLength(60);

    rerender(<Harness log={log} running={false} />);
    expect(raf.pending()).toBe(0);
    const frozen = log.alphas.length;
    runFor(1000, 60);
    expect(log.alphas).toHaveLength(frozen);

    rerender(<Harness log={log} running />);
    unmount();
    expect(raf.pending()).toBe(0);
  });
});
