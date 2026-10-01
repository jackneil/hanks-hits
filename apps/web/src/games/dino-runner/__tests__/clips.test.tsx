/**
 * Dino Runner with gameplay clips (the Asteroids pattern, plan 11.5). These
 * tests drive useDinoClips with a fake attached game (the clip service's
 * contract) and check what the game tells the service:
 * - the canvas is registered once, and capture pauses on every break;
 * - a run starts at a start from the start card, from game over (Play
 *   again) and from a restart during a run, and "end" comes before the
 *   break at game over;
 * - the new-best moment comes once per run, only when a real record falls.
 */
import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { AttachedGameContext, clipsEnabledFor, type AttachedGame } from "@/shared/clips";

import { metadata } from "../metadata";
import type { GameState } from "../lib/constants";
import { NEW_BEST_MOMENT, useDinoClips, type DinoClipState } from "../lib/useDinoClips";

function fakeGame() {
  const calls: string[] = [];
  const game: AttachedGame = {
    registerCanvas: vi.fn(() => {
      calls.push("register");
      return () => calls.push("unregister");
    }),
    autoDiscover: vi.fn(() => () => undefined),
    runPhase: vi.fn((phase) => calls.push(`run:${phase}`)),
    markMoment: vi.fn((mark) => calls.push(`moment:${mark.kind}`)),
    setAtBreak: vi.fn((atBreak) => calls.push(atBreak ? "break" : "play")),
    detach: vi.fn(),
  };
  return { game, calls };
}

function Harness(props: DinoClipState) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useDinoClips(canvasRef, props);
  return <canvas ref={canvasRef} width={10} height={10} />;
}

function mount(game: AttachedGame | null, first: DinoClipState) {
  const view = render(
    <AttachedGameContext.Provider value={game}>
      <Harness {...first} />
    </AttachedGameContext.Provider>
  );
  return (next: DinoClipState) =>
    view.rerender(
      <AttachedGameContext.Provider value={game}>
        <Harness {...next} />
      </AttachedGameContext.Provider>
    );
}

const at = (gameState: GameState, score = 0, highScore = 0, runId = 0): DinoClipState => ({ gameState, score, highScore, runId });

describe("Dino Runner clips", () => {
  it("turns clips on with the metadata literal, and the generated lookup has it", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("dino-runner")).toBe(true);
  });

  it("registers the canvas once, and capture plays only while a run plays", () => {
    const { game, calls } = fakeGame();
    const update = mount(game, at("idle"));
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)).toBe("break");
    update(at("playing", 0, 0, 1));
    expect(calls.at(-1)).toBe("play");
    update(at("game-over", 50, 50, 1));
    expect(calls.at(-1)).toBe("break");
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
  });

  it("a run starts at each start, and 'end' comes before the break at game over", () => {
    const { game, calls } = fakeGame();
    const update = mount(game, at("idle"));
    update(at("playing", 0, 0, 1));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"]]);
    calls.length = 0;
    update(at("game-over", 90, 90, 1));
    expect(calls.filter((c) => c !== "play")).toEqual(["run:end", "break"]);
    // Play again from game over: a new run.
    update(at("playing", 0, 90, 2));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"], ["end"], ["start"]]);
    // The header's Restart during play: a new runId while playing ends the run and starts another.
    calls.length = 0;
    update(at("playing", 0, 90, 3));
    expect(calls.filter((c) => c.startsWith("run:"))).toEqual(["run:end", "run:start"]);
  });

  it("marks the new best once per run, when the score passes the best from before the run", () => {
    const { game } = fakeGame();
    const update = mount(game, at("idle", 0, 100));
    update(at("playing", 0, 100, 1));
    update(at("playing", 90, 100, 1));
    update(at("playing", 100, 100, 1));
    expect(game.markMoment).not.toHaveBeenCalled();
    update(at("playing", 101, 100, 1));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    expect(game.markMoment).toHaveBeenCalledWith(NEW_BEST_MOMENT);
    update(at("playing", 150, 100, 1));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    // The next run starts from the new saved best.
    update(at("game-over", 150, 150, 1));
    update(at("playing", 0, 150, 2));
    update(at("playing", 140, 150, 2));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    update(at("playing", 160, 150, 2));
    expect(game.markMoment).toHaveBeenCalledTimes(2);
  });

  it("a first-ever score breaks no record: no moment", () => {
    const { game } = fakeGame();
    const update = mount(game, at("idle"));
    update(at("playing", 0, 0, 1));
    update(at("playing", 500, 0, 1));
    expect(game.markMoment).not.toHaveBeenCalled();
  });

  it("a clip service that arrives during a run starts the run then", () => {
    const { game } = fakeGame();
    const view = render(
      <AttachedGameContext.Provider value={null}>
        <Harness {...at("playing", 10, 5, 1)} />
      </AttachedGameContext.Provider>
    );
    view.rerender(
      <AttachedGameContext.Provider value={game}>
        <Harness {...at("playing", 10, 5, 1)} />
      </AttachedGameContext.Provider>
    );
    expect(game.runPhase).toHaveBeenCalledWith("start");
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
  });
});
