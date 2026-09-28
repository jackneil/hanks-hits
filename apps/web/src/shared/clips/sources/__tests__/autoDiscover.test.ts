import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HudState } from "../../protocol";
import { FramePump } from "../../runtime/framePump";
import { FakeRealm } from "../../runtime/__tests__/fakeRealm";
import { autoDiscover, candidateCanvases, findLargestCanvas, IGNORE_ATTRIBUTE } from "../autoDiscover";
import { FakeVideoFrame, RecordingSink } from "./fakes";

const HUD: HudState = { gameName: "Kid Game", emoji: "⭐" };

type RafWindow = { requestAnimationFrame: unknown; cancelAnimationFrame: unknown };

/** Point a jsdom window's rAF at a fake realm that the test drives. */
function useFakeRaf(win: Window): { realm: FakeRealm; restore: () => void } {
  const w = win as unknown as RafWindow;
  const saved = { raf: w.requestAnimationFrame, caf: w.cancelAnimationFrame };
  const realm = new FakeRealm();
  w.requestAnimationFrame = realm.requestAnimationFrame;
  w.cancelAnimationFrame = realm.cancelAnimationFrame;
  return {
    realm,
    restore: () => {
      w.requestAnimationFrame = saved.raf;
      w.cancelAnimationFrame = saved.caf;
    },
  };
}

function makeCanvas(doc: Document, w: number, h: number, opts: { shown?: boolean; kind?: string } = {}): HTMLCanvasElement {
  const c = doc.createElement("canvas");
  c.width = w;
  c.height = h;
  const shown = opts.shown ?? true;
  c.getBoundingClientRect = () =>
    ({ width: shown ? w / 2 : 0, height: shown ? h / 2 : 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0 }) as DOMRect;
  const kind = opts.kind ?? "2d";
  (c as unknown as { getContext: (t: string) => unknown }).getContext = (t: string) => (t === kind ? {} : null);
  return c;
}

function gameLoop(win: Window) {
  const w = win as unknown as { requestAnimationFrame(cb: FrameRequestCallback): number };
  const loop = () => {
    w.requestAnimationFrame(loop);
  };
  w.requestAnimationFrame(loop);
}

let root: HTMLDivElement;
let raf: ReturnType<typeof useFakeRaf>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("VideoFrame", FakeVideoFrame);
  root = document.createElement("div");
  document.body.appendChild(root);
  raf = useFakeRaf(window);
});
afterEach(() => {
  root.remove();
  raf.restore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function newPump() {
  const sink = new RecordingSink();
  return { sink, pump: new FramePump({ sink, displayHz: 60, targetFps: 30 }) };
}

describe("findLargestCanvas", () => {
  it("picks the largest shown canvas and skips ignored, hidden and empty ones", () => {
    const small = makeCanvas(document, 200, 100);
    const big = makeCanvas(document, 800, 600);
    const hidden = makeCanvas(document, 2000, 2000, { shown: false });
    const ignored = makeCanvas(document, 1500, 1500);
    ignored.setAttribute(IGNORE_ATTRIBUTE, "");
    const empty = makeCanvas(document, 0, 0);
    root.append(small, big, hidden, ignored, empty);
    expect(candidateCanvases(root)).toEqual([small, big]);
    expect(findLargestCanvas(root)).toBe(big);
  });

  it("looks inside same-origin iframes", () => {
    const outer = makeCanvas(document, 300, 300);
    const frame = document.createElement("iframe");
    root.append(outer, frame);
    const inner = makeCanvas(frame.contentDocument!, 900, 600);
    frame.contentDocument!.body.appendChild(inner);
    expect(findLargestCanvas(root)).toBe(inner);
  });

  it("returns null when there is no canvas", () => {
    expect(findLargestCanvas(root)).toBeNull();
  });
});

describe("autoDiscover", () => {
  it("waits for game frames, then registers the largest canvas", () => {
    const small = makeCanvas(document, 200, 100);
    const big = makeCanvas(document, 800, 600);
    root.append(small, big);
    const { pump, sink } = newPump();
    const onRegistered = vi.fn();
    const found = autoDiscover({ root, hud: () => HUD, targetFps: 30, pump, onRegistered });
    gameLoop(window);
    raf.realm.frame(0);
    raf.realm.frame(16.7);
    expect(found.source).toBeNull();
    raf.realm.frame(33.3);
    expect(found.canvas).toBe(big);
    expect(found.source?.path).toBe("P");
    expect(onRegistered).toHaveBeenCalledWith(found.source, big);
    for (let i = 3; i < 20; i++) {
      sink.consumeAll(pump);
      raf.realm.frame(i * 16.7);
    }
    expect(sink.frames().length).toBeGreaterThan(3);
    found.stop();
  });

  it("does not register before the game runs (no context yet)", () => {
    root.append(makeCanvas(document, 800, 600));
    const { pump } = newPump();
    const found = autoDiscover({ root, hud: () => HUD, targetFps: 30, pump });
    vi.advanceTimersByTime(5000);
    expect(found.source).toBeNull();
    found.stop();
  });

  it("finds a canvas that appears later, at the next check", () => {
    const { pump } = newPump();
    const found = autoDiscover({ root, hud: () => HUD, targetFps: 30, pump, checkMs: 250 });
    gameLoop(window);
    for (let i = 0; i < 5; i++) raf.realm.frame(i * 16.7);
    expect(found.source).toBeNull();
    const late = makeCanvas(document, 640, 480);
    root.append(late);
    vi.advanceTimersByTime(250);
    expect(found.canvas).toBe(late);
    found.stop();
  });

  it("re-registers when the canvas leaves the page", () => {
    const first = makeCanvas(document, 800, 600);
    root.append(first);
    const { pump } = newPump();
    const found = autoDiscover({ root, hud: () => HUD, targetFps: 30, pump });
    gameLoop(window);
    for (let i = 0; i < 4; i++) raf.realm.frame(i * 16.7);
    expect(found.canvas).toBe(first);
    first.remove();
    const second = makeCanvas(document, 400, 300);
    root.append(second);
    found.check();
    expect(found.canvas).toBe(second);
    found.stop();
    expect(found.source).toBeNull();
  });

  it("reports a registration error and keeps checking", () => {
    vi.stubGlobal("VideoFrame", undefined);
    root.append(makeCanvas(document, 800, 600));
    const { pump } = newPump();
    const onError = vi.fn();
    const found = autoDiscover({ root, hud: () => HUD, targetFps: 30, pump, onError });
    gameLoop(window);
    for (let i = 0; i < 4; i++) raf.realm.frame(i * 16.7);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(found.source).toBeNull();
    found.stop();
  });

  it("stop restores the page rAF and ignores later checks", () => {
    root.append(makeCanvas(document, 800, 600));
    const { pump } = newPump();
    const found = autoDiscover({ root, hud: () => HUD, targetFps: 30, pump });
    expect((window as unknown as RafWindow).requestAnimationFrame).not.toBe(raf.realm.nativeRaf);
    found.stop();
    expect((window as unknown as RafWindow).requestAnimationFrame).toBe(raf.realm.nativeRaf);
    found.check();
    expect(found.source).toBeNull();
    found.stop();
  });

  it("registers a canvas inside a same-origin iframe in the iframe's realm", () => {
    const frame = document.createElement("iframe");
    root.append(frame);
    const inner = frame.contentWindow!;
    const innerRaf = useFakeRaf(inner);
    try {
      const canvas = makeCanvas(frame.contentDocument!, 900, 600);
      frame.contentDocument!.body.appendChild(canvas);
      const { pump, sink } = newPump();
      const found = autoDiscover({ root, hud: () => HUD, targetFps: 30, pump });
      gameLoop(inner);
      for (let i = 0; i < 12; i++) {
        sink.consumeAll(pump);
        innerRaf.realm.frame(i * 16.7);
      }
      expect(found.canvas).toBe(canvas);
      expect(sink.frames().length).toBeGreaterThan(0);
      found.stop();
    } finally {
      innerRaf.restore();
    }
  });
});
