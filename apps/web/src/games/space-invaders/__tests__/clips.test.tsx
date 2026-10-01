/**
 * Space Invaders has gameplay clips (plan 2.6, the Asteroids pattern). These
 * tests drive useSpaceInvadersClips with a fake attached game (the clip
 * service's contract) and check what the game tells the service:
 * - the canvas is registered once, and capture pauses on every break;
 * - a run starts at a round start, a new wave is the same run, "end" comes
 *   before the break at game over, and a restart to the start card ends it;
 * - the new-best moment comes once per run, only when a real record falls.
 */
import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { AttachedGameContext, clipsEnabledFor, type AttachedGame } from "@/shared/clips";

import { metadata } from "../metadata";
import type { GameState } from "../lib/constants";
import { useSpaceInvadersStore } from "../lib/store";
import { NEW_BEST_MOMENT, useSpaceInvadersClips, type SpaceInvadersClipState } from "../lib/useSpaceInvadersClips";

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

function Harness(props: SpaceInvadersClipState) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useSpaceInvadersClips(canvasRef, props);
  return <canvas ref={canvasRef} width={10} height={10} />;
}

function mount(game: AttachedGame | null, first: SpaceInvadersClipState) {
  const view = render(
    <AttachedGameContext.Provider value={game}>
      <Harness {...first} />
    </AttachedGameContext.Provider>,
  );
  return (next: SpaceInvadersClipState) =>
    view.rerender(
      <AttachedGameContext.Provider value={game}>
        <Harness {...next} />
      </AttachedGameContext.Provider>,
    );
}

const at = (gameState: GameState, score = 0, highScore = 0, runId = 0): SpaceInvadersClipState => ({ gameState, score, highScore, runId });

describe("Space Invaders clips", () => {
  it("turns clips on with the metadata literal, and the generated lookup has it", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("space-invaders")).toBe(true);
  });

  it("registers the canvas once, and capture plays only while a round plays", () => {
    const { game, calls } = fakeGame();
    const update = mount(game, at("ready"));
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
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
    update(at("playing", 0, 0, 1));
    update(at("waveComplete", 500, 0, 1));
    update(at("playing", 500, 0, 1));
    update(at("paused", 600, 0, 1));
    update(at("playing", 600, 0, 1));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"]]);
    calls.length = 0;
    update(at("gameOver", 900, 0, 1));
    expect(calls.filter((c) => c !== "play")).toEqual(["run:end", "break"]);
    // Play again from game over: a new run.
    update(at("playing", 0, 900, 2));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"], ["end"], ["start"]]);
  });

  it("a restart from the header (back to the start card) ends the run, and the next age choice starts a new one", () => {
    const { game } = fakeGame();
    const update = mount(game, at("ready"));
    update(at("playing", 0, 0, 1));
    update(at("playing", 200, 0, 1));
    update(at("ready", 0, 0, 1));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"], ["end"]]);
    update(at("playing", 0, 0, 2));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"], ["end"], ["start"]]);
  });

  it("a restart during a run (a new runId while playing) ends that run first", () => {
    const { game } = fakeGame();
    const update = mount(game, at("playing", 0, 0, 1));
    update(at("playing", 300, 0, 1));
    update(at("playing", 0, 0, 2));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"], ["end"], ["start"]]);
  });

  it("marks the new best once per run, when the score passes the best from before the run", () => {
    const { game } = fakeGame();
    const update = mount(game, at("ready", 0, 1000));
    update(at("playing", 0, 1000, 1));
    update(at("playing", 900, 1000, 1));
    update(at("playing", 1000, 1000, 1));
    expect(game.markMoment).not.toHaveBeenCalled();
    update(at("playing", 1020, 1000, 1));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    expect(game.markMoment).toHaveBeenCalledWith(NEW_BEST_MOMENT);
    update(at("playing", 1500, 1000, 1));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    // The next run starts from the new saved best: 1500 must be beaten again.
    update(at("gameOver", 1500, 1000, 1));
    update(at("playing", 0, 1500, 2));
    update(at("playing", 1400, 1500, 2));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    update(at("playing", 1600, 1500, 2));
    expect(game.markMoment).toHaveBeenCalledTimes(2);
  });

  it("with clips off (no attached game) nothing is called", () => {
    const update = mount(null, at("ready"));
    expect(() => {
      update(at("playing", 0, 0, 1));
      update(at("playing", 500, 0, 1));
      update(at("gameOver", 500, 0, 1));
    }).not.toThrow();
  });

  it("the store counts runs and keeps the best from before the run, which the store raises during play", () => {
    localStorage.clear();
    useSpaceInvadersStore.setState({
      gameState: "ready",
      runId: 0,
      progress: { ...useSpaceInvadersStore.getState().progress, highScore: 700 },
    });
    useSpaceInvadersStore.getState().startGame();
    expect(useSpaceInvadersStore.getState().runId).toBe(1);
    expect(useSpaceInvadersStore.getState().runStartBest).toBe(700);
    // The store raises the saved best as the score climbs; the run's best to beat stays 700.
    useSpaceInvadersStore.setState({ progress: { ...useSpaceInvadersStore.getState().progress, highScore: 900 } });
    expect(useSpaceInvadersStore.getState().runStartBest).toBe(700);
    useSpaceInvadersStore.getState().startGame();
    expect(useSpaceInvadersStore.getState().runId).toBe(2);
    expect(useSpaceInvadersStore.getState().runStartBest).toBe(900);
    useSpaceInvadersStore.setState({ gameState: "ready" });
  });
});
