import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRealm, FakeVideoFrame, installCanvasContexts, type FakeContext2D, type InstalledContexts } from "@/__tests__/canvas-mock";
import type { HudState } from "../../protocol";
import { FramePump } from "../../runtime/framePump";
import { hasRafDispatcher } from "../../runtime/rafDispatcher";
import { autoDiscover, candidateCanvases, findLargestCanvas, IGNORE_ATTRIBUTE, type AutoDiscoverOptions } from "../autoDiscover";
import { RecordingSink } from "./fakes";

const HUD: HudState = { gameName: "Kid Game", emoji: "⭐" };
const V = 1000 / 60;

type RafWindow = { requestAnimationFrame: unknown; cancelAnimationFrame: unknown };

/** A jsdom window with a fake rAF that the test drives and fake canvas contexts. */
function setupRealm(win: Window): { realm: FakeRealm; contexts: InstalledContexts; restore: () => void } {
  const w = win as unknown as RafWindow;
  const saved = { raf: w.requestAnimationFrame, caf: w.cancelAnimationFrame };
  const realm = new FakeRealm();
  w.requestAnimationFrame = realm.requestAnimationFrame;
  w.cancelAnimationFrame = realm.cancelAnimationFrame;
  const contexts = installCanvasContexts(win);
  return {
    realm,
    contexts,
    restore: () => {
      contexts.restore();
      w.requestAnimationFrame = saved.raf;
      w.cancelAnimationFrame = saved.caf;
    },
  };
}

function makeCanvas(doc: Document, w: number, h: number, opts: { shown?: boolean } = {}): HTMLCanvasElement {
  const c = doc.createElement("canvas");
  c.width = w;
  c.height = h;
  const shown = opts.shown ?? true;
  c.getBoundingClientRect = () =>
    ({ width: shown ? w / 2 : 0, height: shown ? h / 2 : 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0 }) as DOMRect;
  return c;
}

function calls(canvas: HTMLCanvasElement): string[] {
  return (canvas as unknown as { getContextCalls?: string[] }).getContextCalls ?? [];
}

/** A game that makes its context (now or at its first frame) and draws a picture every frame. */
function game(win: Window, canvas: HTMLCanvasElement, kind: "2d" | "webgl2" = "2d", opts: { contextNow?: boolean } = {}) {
  const w = win as unknown as { requestAnimationFrame(cb: FrameRequestCallback): number; cancelAnimationFrame(id: number): void };
  let n = 0;
  let id = 0;
  let ctx: unknown = opts.contextNow === false ? null : canvas.getContext(kind);
  const loop = () => {
    ctx ??= canvas.getContext(kind);
    n++;
    const c = ctx as FakeContext2D & { drawFrame?: (n: number) => void };
    if (c.drawFrame) c.drawFrame(n);
    else c.drawPicture(n);
    id = w.requestAnimationFrame(loop);
  };
  id = w.requestAnimationFrame(loop);
  return {
    stop: () => w.cancelAnimationFrame(id),
    get context() {
      return ctx;
    },
  };
}

/** A rAF user that is not a game: it never touches a canvas. */
function uiLoop(win: Window) {
  const w = win as unknown as { requestAnimationFrame(cb: FrameRequestCallback): number };
  const loop = () => {
    w.requestAnimationFrame(loop);
  };
  w.requestAnimationFrame(loop);
}

let root: HTMLDivElement;
let page: ReturnType<typeof setupRealm>;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  FakeVideoFrame.made = [];
  vi.stubGlobal("VideoFrame", FakeVideoFrame);
  root = document.createElement("div");
  document.body.appendChild(root);
  page = setupRealm(window);
});
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  root.remove();
  page.restore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function newPump() {
  const sink = new RecordingSink();
  return { sink, pump: new FramePump({ sink, displayHz: 60, targetFps: 30 }) };
}

function discover(extra: Partial<AutoDiscoverOptions> = {}) {
  const { pump, sink } = newPump();
  const found = autoDiscover({ root, hud: () => HUD, targetFps: 30, pump, warmupMs: 0, ...extra });
  cleanups.push(() => found.stop());
  return { found, pump, sink };
}

function frames(realm: FakeRealm, from: number, count: number, each?: () => void): number {
  let t = from;
  for (let i = 0; i < count; i++) {
    each?.();
    t = from + i * V;
    realm.frame(t);
  }
  return t;
}

describe("findLargestCanvas", () => {
  it("picks the largest shown, accepted canvas and skips ignored, hidden, empty and refused ones", () => {
    const small = makeCanvas(document, 200, 100);
    const big = makeCanvas(document, 800, 600);
    const hidden = makeCanvas(document, 2000, 2000, { shown: false });
    const ignored = makeCanvas(document, 1500, 1500);
    ignored.setAttribute(IGNORE_ATTRIBUTE, "");
    const empty = makeCanvas(document, 0, 0);
    const refused = makeCanvas(document, 1200, 1200);
    root.append(small, big, hidden, ignored, empty, refused);
    const accept = (c: HTMLCanvasElement) => c !== refused;
    expect(candidateCanvases(root, accept)).toEqual([small, big]);
    expect(findLargestCanvas(root, accept)).toBe(big);
  });

  it("looks inside same-origin iframes", () => {
    const outer = makeCanvas(document, 300, 300);
    const frame = document.createElement("iframe");
    root.append(outer, frame);
    const inner = makeCanvas(frame.contentDocument!, 900, 600);
    frame.contentDocument!.body.appendChild(inner);
    expect(findLargestCanvas(root, () => true)).toBe(inner);
  });

  it("returns null when there is no canvas", () => {
    expect(findLargestCanvas(root, () => true)).toBeNull();
  });
});

describe("autoDiscover", () => {
  it("registers the largest canvas once the game drew on it in 3 frames", () => {
    const small = makeCanvas(document, 200, 100);
    const big = makeCanvas(document, 800, 600);
    root.append(small, big);
    const onRegistered = vi.fn();
    const { found, pump, sink } = discover({ onRegistered });
    game(window, small);
    game(window, big);
    frames(page.realm, 0, 2);
    expect(found.source).toBeNull();
    frames(page.realm, 2 * V, 1);
    // Registered at the end of the frame in which the canvases passed the gate.
    expect(found.canvas).toBe(big);
    expect(found.source?.path).toBe("P");
    expect(onRegistered).toHaveBeenCalledWith(found.source, big);
    frames(page.realm, 3 * V, 17, () => sink.consumeAll(pump));
    expect(sink.frames().length).toBeGreaterThan(3);
  });

  it("never touches a canvas that the game has not set up, whatever else runs rAF", () => {
    const canvas = makeCanvas(document, 800, 600);
    root.append(canvas);
    const { found } = discover({ checkMs: 100 });
    // A UI animation and the display-rate probe run rAF: not game frames for this canvas.
    uiLoop(window);
    frames(page.realm, 0, 30);
    vi.advanceTimersByTime(3000);
    expect(found.source).toBeNull();
    expect(calls(canvas)).toEqual([]);
    // The game sets up its WebGL2 canvas now: it gets its context.
    const g = game(window, canvas, "webgl2", { contextNow: false });
    frames(page.realm, 30 * V, 4, () => page.contexts.composite());
    expect(g.context).not.toBeNull();
    expect(calls(canvas)).toEqual(["webgl2"]);
    expect(found.canvas).toBe(canvas);
    expect(found.source?.path).toBe("E");
  });

  it("does not pick a canvas drawn in fewer than startFrames frames", () => {
    const canvas = makeCanvas(document, 800, 600);
    root.append(canvas);
    const { found } = discover({ startFrames: 5 });
    const g = game(window, canvas);
    frames(page.realm, 0, 4);
    g.stop();
    frames(page.realm, 4 * V, 10);
    vi.advanceTimersByTime(2000);
    expect(found.source).toBeNull();
  });

  it("finds a canvas that appears later, once the game draws on it", () => {
    const { found } = discover({ checkMs: 250 });
    uiLoop(window);
    frames(page.realm, 0, 5);
    const late = makeCanvas(document, 640, 480);
    root.append(late);
    vi.advanceTimersByTime(250);
    // In the page, but not drawn yet: not picked.
    expect(found.canvas).toBeNull();
    game(window, late);
    frames(page.realm, 5 * V, 3);
    expect(found.canvas).toBe(late);
  });

  it("re-registers when the canvas leaves the page, after the new canvas passes the gate", () => {
    const first = makeCanvas(document, 800, 600);
    root.append(first);
    const { found } = discover();
    const g1 = game(window, first);
    frames(page.realm, 0, 4);
    expect(found.canvas).toBe(first);
    g1.stop();
    first.remove();
    const second = makeCanvas(document, 400, 300);
    root.append(second);
    found.check();
    expect(found.canvas).toBeNull();
    game(window, second);
    frames(page.realm, 4 * V, 3);
    expect(found.canvas).toBe(second);
    found.stop();
    expect(found.source).toBeNull();
  });

  it("reports a registration error once and keeps checking", () => {
    vi.stubGlobal("VideoFrame", undefined);
    const canvas = makeCanvas(document, 800, 600);
    root.append(canvas);
    const onError = vi.fn();
    const { found } = discover({ onError, checkMs: 100 });
    game(window, canvas);
    frames(page.realm, 0, 20);
    vi.advanceTimersByTime(2000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(found.source).toBeNull();
  });

  it("stop restores the page rAF and canvas classes, and ignores later checks", () => {
    const canvas = makeCanvas(document, 800, 600);
    root.append(canvas);
    const proto = (window as unknown as { CanvasRenderingContext2D: { prototype: object } }).CanvasRenderingContext2D.prototype;
    const before = Object.getOwnPropertyNames(proto);
    const { found } = discover();
    expect((window as unknown as RafWindow).requestAnimationFrame).not.toBe(page.realm.nativeRaf);
    expect(Object.getOwnPropertyNames(proto).length).toBeGreaterThan(before.length);
    found.stop();
    expect((window as unknown as RafWindow).requestAnimationFrame).toBe(page.realm.nativeRaf);
    expect(Object.getOwnPropertyNames(proto)).toEqual(before);
    expect(hasRafDispatcher(window as unknown as FakeRealm)).toBe(false);
    found.check();
    expect(found.source).toBeNull();
    found.stop();
  });
});

describe("autoDiscover in iframes", () => {
  function addFrame(): { frame: HTMLIFrameElement; realm: ReturnType<typeof setupRealm> } {
    const frame = document.createElement("iframe");
    root.append(frame);
    const realm = setupRealm(frame.contentWindow!);
    cleanups.push(realm.restore);
    return { frame, realm };
  }

  it("registers a canvas inside a same-origin iframe in the iframe's realm", () => {
    const { frame, realm } = addFrame();
    const canvas = makeCanvas(frame.contentDocument!, 900, 600);
    frame.contentDocument!.body.appendChild(canvas);
    const { found, pump, sink } = discover();
    game(frame.contentWindow!, canvas);
    frames(realm.realm, 0, 12, () => sink.consumeAll(pump));
    expect(found.canvas).toBe(canvas);
    expect(found.watched).toEqual([document, frame.contentDocument]);
    expect(sink.frames().length).toBeGreaterThan(0);
  });

  it("releases a removed iframe's realm and registers the canvas of the new iframe", () => {
    const first = addFrame();
    const oldDoc = first.frame.contentDocument!;
    const oldCanvas = makeCanvas(oldDoc, 900, 600);
    oldDoc.body.appendChild(oldCanvas);
    const { found } = discover({ checkMs: 100 });
    game(first.frame.contentWindow!, oldCanvas);
    frames(first.realm.realm, 0, 4);
    expect(found.canvas).toBe(oldCanvas);
    // The game restarts: its iframe is removed and a new one mounts
    // (key={restartNonce}). As in Chrome, the old canvas still says it is
    // connected; only its document loses its window.
    first.frame.remove();
    Object.defineProperty(oldCanvas, "isConnected", { configurable: true, get: () => true });
    Object.defineProperty(oldDoc, "defaultView", { configurable: true, get: () => null });
    const second = addFrame();
    const newCanvas = makeCanvas(second.frame.contentDocument!, 900, 600);
    second.frame.contentDocument!.body.appendChild(newCanvas);
    vi.advanceTimersByTime(100);
    expect(found.source).toBeNull();
    expect(found.watched).toEqual([document, second.frame.contentDocument]);
    game(second.frame.contentWindow!, newCanvas);
    frames(second.realm.realm, 0, 3);
    expect(found.canvas).toBe(newCanvas);
  });

  it("follows an iframe that loads a new document in the same element", () => {
    const { frame, realm } = addFrame();
    const oldDoc = frame.contentDocument!;
    const oldCanvas = makeCanvas(oldDoc, 900, 600);
    oldDoc.body.appendChild(oldCanvas);
    const { found } = discover({ checkMs: 100 });
    game(frame.contentWindow!, oldCanvas);
    frames(realm.realm, 0, 4);
    expect(found.canvas).toBe(oldCanvas);
    // A reload: the same iframe element shows a new document. (jsdom does
    // not navigate srcdoc, so a second, detached iframe lends the new document.)
    const donor = document.createElement("iframe");
    document.body.appendChild(donor);
    cleanups.push(() => donor.remove());
    const next = setupRealm(donor.contentWindow!);
    cleanups.push(next.restore);
    const newDoc = donor.contentDocument!;
    Object.defineProperty(frame, "contentDocument", { configurable: true, get: () => newDoc });
    Object.defineProperty(oldDoc, "defaultView", { configurable: true, get: () => null });
    Object.defineProperty(oldCanvas, "isConnected", { configurable: true, get: () => true });
    const newCanvas = makeCanvas(newDoc, 900, 600);
    newDoc.body.appendChild(newCanvas);
    vi.advanceTimersByTime(100);
    expect(found.source).toBeNull();
    expect(found.watched).toEqual([document, newDoc]);
    game(donor.contentWindow!, newCanvas);
    frames(next.realm, 0, 3);
    expect(found.canvas).toBe(newCanvas);
  });
});
