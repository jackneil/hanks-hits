import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { AttachedGameContext, type AttachedGame } from "@/shared/clips";

import type { GameState } from "../lib/constants";
import { usePlatformerClips } from "../lib/usePlatformerClips";

function fakeGame() {
  const calls: string[] = [];
  const game: AttachedGame = {
    registerCanvas: vi.fn(() => () => undefined),
    autoDiscover: vi.fn(() => () => undefined),
    runPhase: vi.fn((phase) => calls.push(`run:${phase}`)),
    markMoment: vi.fn((mark) => calls.push(`moment:${mark.kind}`)),
    setAtBreak: vi.fn(),
    detach: vi.fn(),
  };
  return { game, calls };
}

function Harness({ gameState }: { gameState: GameState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  usePlatformerClips(canvasRef, { gameState, score: 0 });
  return <canvas ref={canvasRef} />;
}

describe("Hank's Hopper clips", () => {
  it("runs one attempt per level, keeps it through a pause, and marks the clear before the run ends", () => {
    const { game, calls } = fakeGame();
    const view = render(
      <AttachedGameContext.Provider value={game}>
        <Harness gameState="ready" />
      </AttachedGameContext.Provider>,
    );
    const show = (gameState: GameState) =>
      view.rerender(
        <AttachedGameContext.Provider value={game}>
          <Harness gameState={gameState} />
        </AttachedGameContext.Provider>,
      );
    show("playing");
    show("paused");
    show("playing");
    show("levelComplete");
    show("playing"); // the next level
    show("gameOver"); // a fall: no moment
    expect(calls).toEqual(["run:start", "moment:level-clear", "run:end", "run:start", "run:end"]);
  });
});
