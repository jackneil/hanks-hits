/**
 * useRunClips: the run logic every canvas game shares with the clip
 * service. The games' own clip tests (Asteroids first) cover their status
 * mapping; this covers the rules once.
 */
import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { AttachedGameContext, NEW_BEST_MOMENT, useRunClips, type AttachedGame, type RunClipState } from "@/shared/clips";

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

function Harness(props: RunClipState) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useRunClips(canvasRef, props);
  return <canvas ref={canvasRef} width={10} height={10} />;
}

function mount(game: AttachedGame | null, first: RunClipState) {
  const view = render(
    <AttachedGameContext.Provider value={game}>
      <Harness {...first} />
    </AttachedGameContext.Provider>,
  );
  return {
    update: (next: RunClipState) =>
      view.rerender(
        <AttachedGameContext.Provider value={game}>
          <Harness {...next} />
        </AttachedGameContext.Provider>,
      ),
    swap: (nextGame: AttachedGame | null, next: RunClipState) =>
      view.rerender(
        <AttachedGameContext.Provider value={nextGame}>
          <Harness {...next} />
        </AttachedGameContext.Provider>,
      ),
    unmount: () => view.unmount(),
  };
}

const at = (phase: RunClipState["phase"], score = 0, best = 0, runId = 0): RunClipState => ({ phase, score, best, runId });
const runs = (calls: string[]) => calls.filter((c) => c.startsWith("run:") || c.startsWith("moment:"));

describe("useRunClips", () => {
  it("captures only while playing; hold and idle are breaks", () => {
    const { game, calls } = fakeGame();
    const { update } = mount(game, at("idle"));
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)).toBe("break");
    update(at("playing"));
    expect(calls.at(-1)).toBe("play");
    update(at("hold"));
    expect(calls.at(-1)).toBe("break");
    update(at("playing"));
    expect(calls.at(-1)).toBe("play");
    update(at("idle"));
    expect(calls.at(-1)).toBe("break");
  });

  it("starts a run after idle, keeps it through a hold, and ends it at idle before the break", () => {
    const { game, calls } = fakeGame();
    const { update } = mount(game, at("idle"));
    update(at("playing"));
    update(at("hold"));
    update(at("playing"));
    update(at("idle"));
    expect(runs(calls)).toEqual(["run:start", "run:end"]);
    // "end" comes before the break, so the result stays in the ring.
    expect(calls.slice(-2)).toEqual(["run:end", "break"]);
  });

  it("treats a new runId while playing as a restart: the old run ends first", () => {
    const { game, calls } = fakeGame();
    const { update } = mount(game, at("idle", 0, 0, 1));
    update(at("playing", 0, 0, 1));
    update(at("playing", 5, 0, 2));
    // A restart from the pause (hold) with a new id is a new run too.
    update(at("hold", 5, 0, 2));
    update(at("playing", 0, 0, 3));
    expect(runs(calls)).toEqual(["run:start", "run:end", "run:start", "run:end", "run:start"]);
  });

  it("starts a run when the service arrives while the game already plays", () => {
    const { game, calls } = fakeGame();
    const { swap } = mount(null, at("playing"));
    swap(game, at("playing"));
    expect(runs(calls)).toEqual(["run:start"]);
  });

  it("ends an open run when the game unmounts (a remounting restart)", () => {
    const { game, calls } = fakeGame();
    const { update, unmount } = mount(game, at("idle"));
    update(at("playing"));
    unmount();
    expect(runs(calls)).toEqual(["run:start", "run:end"]);
  });

  it("marks the new best once per run, only when a real record falls", () => {
    const { game, calls } = fakeGame();
    const { update } = mount(game, at("idle", 0, 10));
    update(at("playing", 0, 10));
    update(at("playing", 10, 10)); // a tie is no record
    expect(runs(calls)).toEqual(["run:start"]);
    update(at("playing", 11, 10));
    update(at("playing", 20, 10));
    expect(runs(calls)).toEqual(["run:start", "moment:new-best"]);
    expect(game.markMoment).toHaveBeenCalledWith({ ...NEW_BEST_MOMENT });

    // A first-ever score breaks no record.
    const first = fakeGame();
    const second = mount(first.game, at("idle", 0, 0));
    second.update(at("playing", 0, 0));
    second.update(at("playing", 50, 0));
    expect(runs(first.calls)).toEqual(["run:start"]);
  });

  it("keeps its snapshot when the store raises the best during the run, and follows a better cloud best", () => {
    const { game, calls } = fakeGame();
    const { update } = mount(game, at("idle", 0, 10));
    update(at("playing", 0, 10));
    // A cloud sync brings 30 from another device: 25 is no record now.
    update(at("playing", 25, 30));
    expect(runs(calls)).toEqual(["run:start"]);
    update(at("playing", 31, 30));
    expect(runs(calls)).toEqual(["run:start", "moment:new-best"]);
  });

  it("compares the other way for a lower-is-better score (a race time)", () => {
    const { game, calls } = fakeGame();
    const { update } = mount(game, { phase: "idle", score: 0, best: 60, lowerIsBetter: true });
    update({ phase: "playing", score: 70, best: 60, lowerIsBetter: true });
    expect(runs(calls)).toEqual(["run:start"]);
    update({ phase: "playing", score: 55, best: 60, lowerIsBetter: true });
    expect(runs(calls)).toEqual(["run:start", "moment:new-best"]);
  });

  it("does nothing with clips off", () => {
    const { update, unmount } = mount(null, at("idle"));
    update(at("playing", 99, 1));
    update(at("idle"));
    unmount();
  });
});
