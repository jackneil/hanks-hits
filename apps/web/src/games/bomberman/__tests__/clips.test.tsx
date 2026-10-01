/**
 * Bomberman gameplay clips (plan Phase 2, like Asteroids). These tests drive
 * useBombermanClips with a fake attached game (the clip service's contract)
 * and check what the game tells the service:
 * - the canvas is registered once, and capture pauses on every break;
 * - a run starts at a game start, a cleared level and the next level are the
 *   same run, "end" comes before the break at game over, and going back to
 *   the menu ends the run;
 * - the new-best moment comes once per run, only when a real record falls;
 *   a cleared level marks a level moment.
 */
import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { AttachedGameContext, clipsEnabledFor, type AttachedGame } from "@/shared/clips";

import { metadata } from "../metadata";
import {
  levelClearMoment,
  NEW_BEST_MOMENT,
  useBombermanClips,
  type BombermanClipState,
  type BombermanClipStatus,
} from "../lib/useBombermanClips";

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

function Harness(props: BombermanClipState) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useBombermanClips(canvasRef, props);
  return <canvas ref={canvasRef} width={10} height={10} />;
}

function mount(game: AttachedGame | null, first: BombermanClipState) {
  const view = render(
    <AttachedGameContext.Provider value={game}>
      <Harness {...first} />
    </AttachedGameContext.Provider>,
  );
  return (next: BombermanClipState) =>
    view.rerender(
      <AttachedGameContext.Provider value={game}>
        <Harness {...next} />
      </AttachedGameContext.Provider>,
    );
}

const at = (gameState: BombermanClipStatus, score = 0, highScore = 0, runId = 0, level = 1): BombermanClipState => ({
  gameState,
  score,
  level,
  highScore,
  runId,
});

describe("Bomberman clips", () => {
  it("turns clips on with the metadata literal, and the generated lookup has it", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("bomberman")).toBe(true);
  });

  it("registers the canvas once, and capture plays only while a level plays", () => {
    const { game, calls } = fakeGame();
    const update = mount(game, at("menu"));
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)).toBe("break");
    update(at("playing", 0, 0, 1));
    expect(calls.at(-1)).toBe("play");
    update(at("paused", 0, 0, 1));
    expect(calls.at(-1)).toBe("break");
    update(at("playing", 0, 0, 1));
    update(at("won", 100, 0, 1));
    expect(calls.at(-1)).toBe("break");
    update(at("playing", 100, 0, 1, 2));
    expect(calls.at(-1)).toBe("play");
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
  });

  it("a run starts at a game start, the next level is the same run, and 'end' comes before the break at game over", () => {
    const { game, calls } = fakeGame();
    const update = mount(game, at("menu"));
    update(at("playing", 0, 0, 1));
    update(at("won", 100, 100, 1));
    update(at("playing", 100, 100, 1, 2));
    update(at("paused", 150, 100, 1, 2));
    update(at("playing", 150, 100, 1, 2));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"]]);
    calls.length = 0;
    update(at("lost", 150, 150, 1, 2));
    expect(calls.filter((c) => c !== "play")).toEqual(["run:end", "break"]);
    // Play again from game over: a new run.
    update(at("playing", 0, 150, 2));
    expect((game.runPhase as ReturnType<typeof vi.fn>).mock.calls).toEqual([["start"], ["end"], ["start"]]);
  });

  it("going back to the menu during a run ends it, and a restart in play is a new run", () => {
    const { game, calls } = fakeGame();
    const update = mount(game, at("menu"));
    update(at("playing", 0, 0, 1));
    calls.length = 0;
    update(at("menu", 0, 0, 1));
    expect(calls.filter((c) => c.startsWith("run:"))).toEqual(["run:end"]);
    update(at("playing", 0, 0, 2));
    calls.length = 0;
    update(at("playing", 0, 0, 3));
    expect(calls.filter((c) => c.startsWith("run:"))).toEqual(["run:end", "run:start"]);
  });

  it("marks the new best once per run, when the score passes the best from before the run, and a level moment at each win", () => {
    const { game } = fakeGame();
    const update = mount(game, at("menu", 0, 1000));
    update(at("playing", 0, 1000, 1));
    update(at("playing", 900, 1000, 1));
    update(at("playing", 1000, 1000, 1));
    expect(game.markMoment).not.toHaveBeenCalled();
    update(at("playing", 1020, 1000, 1));
    expect(game.markMoment).toHaveBeenCalledTimes(1);
    expect(game.markMoment).toHaveBeenCalledWith(NEW_BEST_MOMENT);
    // A cleared level: the store banks the best (1020) and says "won".
    update(at("won", 1020, 1020, 1, 1));
    expect(game.markMoment).toHaveBeenCalledTimes(2);
    expect(game.markMoment).toHaveBeenLastCalledWith(levelClearMoment(1));
    // The next level, in the same run: the raised best is not a new record to mark again.
    update(at("playing", 1020, 1020, 1, 2));
    update(at("playing", 1500, 1020, 1, 2));
    expect(game.markMoment).toHaveBeenCalledTimes(2);
    // The next run starts from the new saved best.
    update(at("lost", 1500, 1500, 1, 2));
    update(at("playing", 0, 1500, 2));
    update(at("playing", 1400, 1500, 2));
    expect(game.markMoment).toHaveBeenCalledTimes(2);
    update(at("playing", 1600, 1500, 2));
    expect(game.markMoment).toHaveBeenCalledTimes(3);
  });

  it("does nothing with clips off (no attached game)", () => {
    const update = mount(null, at("menu"));
    expect(() => {
      update(at("playing", 0, 0, 1));
      update(at("lost", 10, 10, 1));
    }).not.toThrow();
  });
});
