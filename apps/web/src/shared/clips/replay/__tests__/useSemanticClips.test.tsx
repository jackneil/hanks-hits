import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachedGameContext } from "../../service/context";
import type { AttachedGame } from "../../service/contract";
import type { RunClipState } from "../../useRunClips";
import { useSemanticClips } from "../useSemanticClips";

afterEach(() => vi.restoreAllMocks());
function fakeGame(log: string[]): AttachedGame {
  return {
    registerCanvas: vi.fn(() => { log.push("register"); return () => log.push("unregister"); }),
    autoDiscover: vi.fn(() => () => undefined),
    runPhase: vi.fn(phase => log.push(`run:${phase}`)),
    markMoment: vi.fn(), setAtBreak: vi.fn(), detach: vi.fn(),
  };
}
function Harness({ value, paint, run, native }: { value: number; paint: (c: CanvasRenderingContext2D, n: number) => void; run: RunClipState; native?: HTMLCanvasElement }) {
  useSemanticClips(value, paint, run, native);
  return <div>Visible game</div>;
}
const playing: RunClipState = { phase: "playing", score: 0, best: 0, runId: 1 };

describe("semantic capture source lifecycle", () => {
  it("supplies a frame clock for a motionless board and stops it while paused", () => {
    const queued = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { queued.set(++next, callback); return next; });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { queued.delete(id); });
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({})) as unknown as HTMLCanvasElement["getContext"]);
    const game = fakeGame([]);
    const paint = vi.fn();
    const view = render(<AttachedGameContext.Provider value={game}><Harness value={1} paint={paint} run={playing} /></AttachedGameContext.Provider>);
    const first = [...queued.entries()][0];
    queued.delete(first[0]);
    act(() => first[1](16));
    expect(context).toHaveBeenCalledTimes(2); // layout paint and post-registration announcement
    const second = [...queued.entries()][0];
    queued.delete(second[0]);
    act(() => second[1](32));
    expect(context).toHaveBeenCalledTimes(3); // a tracker installed late still sees the context
    expect(paint).toHaveBeenCalledTimes(1); // no needless board repaint per frame
    expect(queued.size).toBe(1);
    view.rerender(<AttachedGameContext.Provider value={game}><Harness value={1} paint={paint} run={{ ...playing, phase: "hold" }} /></AttachedGameContext.Provider>);
    expect(cancel).toHaveBeenCalled();
    expect(queued.size).toBe(0);
  });

  it("does no canvas allocation or drawing when capture is off", () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const paint = vi.fn();
    render(<Harness value={1} paint={paint} run={playing} />);
    expect(context).not.toHaveBeenCalled();
    expect(paint).not.toHaveBeenCalled();
  });
  it("paints before registration, redraws real state and final result, and frees registration", () => {
    const log: string[] = [];
    const game = fakeGame(log);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({})) as unknown as HTMLCanvasElement["getContext"]);
    const paint = vi.fn((_, value: number) => log.push(`paint:${value}`));
    const view = render(<AttachedGameContext.Provider value={game}><Harness value={1} paint={paint} run={playing} /></AttachedGameContext.Provider>);
    expect(log.indexOf("paint:1")).toBeLessThan(log.indexOf("register"));
    const source = vi.mocked(game.registerCanvas).mock.calls[0][0];
    expect([source.width, source.height]).toEqual([640, 720]);
    // The pixel source is detached; it never enters the page's controls or text.
    expect(source.isConnected).toBe(false);
    view.rerender(<AttachedGameContext.Provider value={game}><Harness value={2} paint={paint} run={{ ...playing, phase: "idle" }} /></AttachedGameContext.Provider>);
    expect(log.indexOf("paint:2")).toBeLessThan(log.indexOf("run:end"));
    expect(game.registerCanvas).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(log.filter(x => x === "unregister")).toHaveLength(1);
  });
  it("registers when capture arrives late and swaps a native minigame source within one run", () => {
    const log: string[] = [];
    const game = fakeGame(log);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({})) as unknown as HTMLCanvasElement["getContext"]);
    const paint = vi.fn();
    const view = render(<AttachedGameContext.Provider value={null}><Harness value={1} paint={paint} run={playing} /></AttachedGameContext.Provider>);
    view.rerender(<AttachedGameContext.Provider value={game}><Harness value={1} paint={paint} run={playing} /></AttachedGameContext.Provider>);
    const native = document.createElement("canvas");
    view.rerender(<AttachedGameContext.Provider value={game}><Harness value={2} paint={paint} run={playing} native={native} /></AttachedGameContext.Provider>);
    expect(game.registerCanvas).toHaveBeenLastCalledWith(native, undefined);
    view.rerender(<AttachedGameContext.Provider value={game}><Harness value={3} paint={paint} run={playing} /></AttachedGameContext.Provider>);
    expect(game.registerCanvas).toHaveBeenCalledTimes(3);
    expect(log.filter(x => x.startsWith("run:"))).toEqual(["run:start"]);
  });
});
