/**
 * Hill Climb's gameplay clips (PR-G1). The run rules are the shared
 * useRunClips (tested there); this checks Hill Climb's side: clips are on,
 * its phases map to the right run phases, and a real sequence of screens
 * gives the clip service the right runs and moments.
 */
import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { AttachedGameContext, clipsEnabledFor, type AttachedGame } from "@/shared/clips";

import { metadata } from "../metadata";
import {
  NEW_BEST_MOMENT,
  runClipPhase,
  useHillClimbClips,
  type HillClimbClipState,
} from "../lib/useHillClimbClips";

function fakeGame() {
  const calls: string[] = [];
  const game: AttachedGame = {
    registerCanvas: vi.fn(() => () => undefined),
    autoDiscover: vi.fn(() => () => undefined),
    runPhase: vi.fn((phase) => calls.push(`run:${phase}`)),
    markMoment: vi.fn((mark) => calls.push(`moment:${mark.kind}`)),
    setAtBreak: vi.fn((atBreak) => calls.push(atBreak ? "break" : "play")),
    detach: vi.fn(),
  };
  return { game, calls };
}

function Harness(props: HillClimbClipState) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useHillClimbClips(canvasRef, props);
  return <canvas ref={canvasRef} width={10} height={10} />;
}

const at = (phase: HillClimbClipState["phase"], distance = 0, bestDistance = 0): HillClimbClipState => ({
  phase,
  distance,
  bestDistance,
});

describe("Hill Climb clips", () => {
  it("turns clips on with the metadata literal, and the generated lookup has it", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("hill-climb")).toBe(true);
  });

  it("maps driving to play, the pause sheet to a hold, and every other screen to no run", () => {
    expect(runClipPhase("playing")).toBe("playing");
    expect(runClipPhase("paused")).toBe("hold");
    expect(runClipPhase("start")).toBe("idle");
    expect(runClipPhase("garage")).toBe("idle");
    expect(runClipPhase("gameOver")).toBe("idle");
  });

  it("runs from the start card to the crash, through a pause, then again from the Garage", () => {
    const { game, calls } = fakeGame();
    const view = render(
      <AttachedGameContext.Provider value={game}>
        <Harness {...at("start", 0, 500)} />
      </AttachedGameContext.Provider>,
    );
    const show = (state: HillClimbClipState) =>
      view.rerender(
        <AttachedGameContext.Provider value={game}>
          <Harness {...state} />
        </AttachedGameContext.Provider>,
      );
    show(at("playing", 0, 500));
    show(at("paused", 300, 500));
    show(at("playing", 300, 500));
    show(at("playing", 520, 500)); // past the old best: the moment, once
    show(at("playing", 700, 500));
    show(at("gameOver", 700, 700));
    show(at("garage", 0, 700));
    show(at("playing", 0, 700));
    expect(calls.filter((c) => !["play", "break"].includes(c))).toEqual([
      "run:start",
      "moment:new-best",
      "run:end",
      "run:start",
    ]);
    expect(game.markMoment).toHaveBeenCalledWith({ ...NEW_BEST_MOMENT });
  });
});
