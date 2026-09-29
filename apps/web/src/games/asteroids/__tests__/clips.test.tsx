/**
 * Asteroids is the first game with gameplay clips (plan 11.5). These tests
 * drive useAsteroidsClips with a fake attached game (the clip service's
 * contract) and check what the game tells the service:
 * - the canvas is registered once, and capture pauses on every break;
 * - a run starts at a round start from the start card or from game over, a
 *   new wave is the same run, and "end" comes before the break at game over
 *   (so the result card stays in the ring);
 * - the new-best moment comes once per run, only when a real record falls.
 */
import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { AttachedGameContext, clipsEnabledFor, type AttachedGame } from "@/shared/clips";

import { metadata } from "../metadata";
import type { GameStatus } from "../lib/constants";
import { NEW_BEST_MOMENT, useAsteroidsClips, type AsteroidsClipState } from "../lib/useAsteroidsClips";

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

function Harness(props: AsteroidsClipState) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useAsteroidsClips(canvasRef, props);
  return <canvas ref={canvasRef} width={10} height={10} />;
}

function mount(game: AttachedGame | null, first: AsteroidsClipState) {
  const view = render(
    <AttachedGameContext.Provider value={game}>
      <Harness {...first} />
    </AttachedGameContext.Provider>,
  );
  return (next: AsteroidsClipState) =>
    view.rerender(
      <AttachedGameContext.Provider value={game}>
        <Harness {...next} />
      </AttachedGameContext.Provider>,
    );
}

const at = (status: GameStatus, score = 0, highScore = 0, runId = 0): AsteroidsClipState => ({ status, score, highScore, runId });

describe("Asteroids clips", () => {
  it("turns clips on with the metadata literal, and the generated lookup has it", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("asteroids")).toBe(true);
  });

  it("registers the canvas once, and capture plays only while a round plays", () => {
    const { game, calls } = fakeGame();
    const update = mount(game, at("ready"));
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
    expect((game.registerCanvas as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(HTMLCanvasElement);
    expect(calls.at(-1)).toBe("break");
    update(at("playing"));
    expect(calls.at(-1)).toBe("play");
    update(at("paused"));
    expect(calls.at(-1)).toBe("break");
    update(at("playing"));
    update(at("waveComplete"));
    expect(calls.at(-1)).toBe("break");
    update(at("playing"));
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
  });

  it("a run starts at a round start, a new wave is the same run, and 'end' comes before the break at game over", () => {
    const { game, calls } = fakeGame();
    const update = mount(game, at("ready"));
    update(at("playing"));
    update(at("waveComplete", 500));
    update(at("playing", 500));
    update(at("paused", 600));
    update(at("playing", 600));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"]]);
    calls.length = 0;
    update(at("gameOver", 900, 900));
    // "end" first, then the break: the service keeps capturing the result card for its post-roll.
    expect(calls.filter((c) => c !== "play")).toEqual(["run:end", "break"]);
    expect(calls.at(-1)).toBe("break");
    // Play again from game over: a new run.
    update(at("playing", 0, 900));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"], ["end"], ["start"]]);
  });

  it("marks the new best once per run, when the score passes the best from before the run", () => {
    const { game } = fakeGame();
    const update = mount(game, at("ready", 0, 1000));
    update(at("playing", 0, 1000));
    update(at("playing", 900, 1000));
    // A tie is not a new best.
    update(at("playing", 1000, 1000));
    expect(game.markMoment).not.toHaveBeenCalled();
    update(at("playing", 1020, 1000));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    expect(game.markMoment).toHaveBeenCalledWith(NEW_BEST_MOMENT);
    update(at("playing", 1500, 1000));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    // The next run starts from the new saved best: 1500 must be beaten again.
    update(at("gameOver", 1500, 1500));
    update(at("playing", 0, 1500));
    update(at("playing", 1400, 1500));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    update(at("playing", 1600, 1500));
    expect(game.markMoment).toHaveBeenCalledTimes(2);
  });

  it("a restart during a run (header or pause-menu Restart) is a new run that can mark a new best again", () => {
    const { game, calls } = fakeGame();
    const update = mount(game, at("ready", 0, 1000, 0));
    update(at("playing", 0, 1000, 1));
    update(at("playing", 1020, 1000, 1));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    calls.length = 0;

    // The header Restart during play: startGame gives a new runId, the status stays "playing".
    update(at("playing", 0, 1000, 2));
    expect(calls.filter((c) => c.startsWith("run:"))).toEqual(["run:end", "run:start"]);
    update(at("playing", 1030, 1000, 2));
    expect(game.markMoment).toHaveBeenCalledTimes(2);

    // The pause menu's Restart: paused, then playing with a new runId.
    calls.length = 0;
    update(at("paused", 1030, 1000, 2));
    update(at("playing", 0, 1000, 3));
    expect(calls.filter((c) => c.startsWith("run:"))).toEqual(["run:end", "run:start"]);
    update(at("playing", 1040, 1000, 3));
    expect(game.markMoment).toHaveBeenCalledTimes(3);

    // A resume and a new wave keep the run.
    calls.length = 0;
    update(at("paused", 1040, 1000, 3));
    update(at("playing", 1040, 1000, 3));
    update(at("waveComplete", 1040, 1000, 3));
    update(at("playing", 1040, 1000, 3));
    expect(calls.filter((c) => c.startsWith("run:"))).toEqual([]);
  });

  it("the store counts every start as a new run, and never saves the count", async () => {
    const { useAsteroidsStore } = await import("../lib/store");
    const first = useAsteroidsStore.getState().runId;
    useAsteroidsStore.getState().startGame();
    expect(useAsteroidsStore.getState().runId).toBe(first + 1);
    // A restart during play is a start too.
    useAsteroidsStore.getState().startGame();
    expect(useAsteroidsStore.getState()).toMatchObject({ status: "playing", runId: first + 2 });
    const saved = JSON.parse(window.localStorage.getItem("asteroids-game-state") ?? "{}");
    expect(saved.state).not.toHaveProperty("runId");
  });

  it("a first-ever score breaks no record: no moment", () => {
    const { game } = fakeGame();
    const update = mount(game, at("ready"));
    update(at("playing"));
    update(at("playing", 5000));
    expect(game.markMoment).not.toHaveBeenCalled();
  });

  it("a clip service that arrives during a round starts the run then", () => {
    const { game } = fakeGame();
    const view = render(
      <AttachedGameContext.Provider value={null}>
        <Harness {...at("playing", 100, 50)} />
      </AttachedGameContext.Provider>,
    );
    view.rerender(
      <AttachedGameContext.Provider value={game}>
        <Harness {...at("playing", 100, 50)} />
      </AttachedGameContext.Provider>,
    );
    expect(game.runPhase).toHaveBeenCalledWith("start");
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
  });

});
