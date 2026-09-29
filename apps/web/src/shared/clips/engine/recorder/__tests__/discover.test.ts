/**
 * Auto-discovery for tiers M and V (plan 6.1), in jsdom with the canvas-mock
 * contexts and a fake rAF the test drives: the same picks as the tier W
 * auto-discovery, with a canvas feed in place of a VideoFrame source.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRealm, installCanvasContexts, type FakeContext2D, type InstalledContexts } from "@/__tests__/canvas-mock";
import { IGNORE_ATTRIBUTE } from "../../../sources/autoDiscover";
import type { CanvasFeed } from "../canvasFeed";
import { discoverFeed, type FeedDiscovery } from "../discover";

const V = 1000 / 60;

type RafWindow = { requestAnimationFrame: unknown; cancelAnimationFrame: unknown };

let realm: FakeRealm;
let contexts: InstalledContexts;
let saved: { raf: unknown; caf: unknown };
let root: HTMLDivElement;
let t = 0;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  const w = window as unknown as RafWindow;
  saved = { raf: w.requestAnimationFrame, caf: w.cancelAnimationFrame };
  realm = new FakeRealm();
  w.requestAnimationFrame = realm.requestAnimationFrame;
  w.cancelAnimationFrame = realm.cancelAnimationFrame;
  contexts = installCanvasContexts(window);
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  root.remove();
  contexts.restore();
  const w = window as unknown as RafWindow;
  w.requestAnimationFrame = saved.raf;
  w.cancelAnimationFrame = saved.caf;
  vi.useRealTimers();
});

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getBoundingClientRect = () => ({ width: w, height: h, x: 0, y: 0, top: 0, left: 0, right: w, bottom: h }) as DOMRect;
  root.appendChild(c);
  return c;
}

/** A game that draws on `c` every frame (through the window's rAF, like a real game). */
function game(c: HTMLCanvasElement) {
  const w = window as unknown as { requestAnimationFrame(cb: FrameRequestCallback): number };
  const ctx = c.getContext("2d") as unknown as FakeContext2D;
  let n = 0;
  const loop = () => {
    ctx.drawPicture(++n);
    w.requestAnimationFrame(loop);
  };
  w.requestAnimationFrame(loop);
}

function frames(count: number) {
  for (let i = 0; i < count; i++) {
    t += V;
    realm.frame(t);
  }
}

function fakeFeed(c: HTMLCanvasElement): CanvasFeed & { stopCalls: number; stopItself(): void } {
  let stopped = false;
  let stopCalls = 0;
  return {
    canvas: c,
    contextType: "2d",
    frames: 0,
    get stopped() {
      return stopped;
    },
    get stopCalls() {
      return stopCalls;
    },
    snapshotPng: async () => null,
    requestTouch: () => undefined,
    stop() {
      stopCalls++;
      stopped = true;
    },
    stopItself() {
      stopped = true;
    },
  };
}

function discover(start: (c: HTMLCanvasElement) => CanvasFeed, onError?: (e: unknown) => void): FeedDiscovery {
  const found = discoverFeed({ root, start, onError, checkMs: 500 });
  cleanups.push(() => found.stop());
  return found;
}

describe("discoverFeed", () => {
  it("picks the largest canvas that the game drew on in 3 frames, never an ignored one", () => {
    const small = canvas(100, 100);
    const big = canvas(400, 300);
    const ignored = canvas(800, 600);
    ignored.setAttribute(IGNORE_ATTRIBUTE, "");
    canvas(1000, 1000); // Never drawn on.
    game(small);
    game(big);
    game(ignored);
    const started: HTMLCanvasElement[] = [];
    const found = discover((c) => {
      started.push(c);
      return fakeFeed(c);
    });
    frames(2);
    vi.advanceTimersByTime(500);
    expect(found.feed).toBeNull();
    frames(2);
    vi.advanceTimersByTime(500);
    expect(started).toEqual([big]);
    expect(found.canvas).toBe(big);
  });

  it("lets a removed canvas go and picks the next one", () => {
    const a = canvas(400, 300);
    const b = canvas(200, 200);
    game(a);
    game(b);
    const feeds: Array<ReturnType<typeof fakeFeed>> = [];
    const found = discover((c) => {
      const feed = fakeFeed(c);
      feeds.push(feed);
      return feed;
    });
    frames(4);
    vi.advanceTimersByTime(500);
    expect(found.canvas).toBe(a);
    a.remove();
    vi.advanceTimersByTime(500);
    expect(feeds[0].stopCalls).toBe(1);
    expect(found.canvas).toBe(b);
  });

  it("a canvas whose feed cannot start, or stops itself (a tainted canvas), is not tried again", () => {
    const a = canvas(400, 300);
    const b = canvas(200, 200);
    const c = canvas(100, 100);
    game(a);
    game(b);
    game(c);
    const errors: unknown[] = [];
    const feeds = new Map<HTMLCanvasElement, ReturnType<typeof fakeFeed>>();
    const found = discover((canvasEl) => {
      if (canvasEl === a) throw new Error("no feed");
      const feed = fakeFeed(canvasEl);
      feeds.set(canvasEl, feed);
      return feed;
    }, (e) => errors.push(e));
    frames(4);
    vi.advanceTimersByTime(500);
    expect(errors).toHaveLength(1);
    // The check after the failed pick takes the next one at the next interval.
    vi.advanceTimersByTime(500);
    expect(found.canvas).toBe(b);
    feeds.get(b)!.stopItself();
    vi.advanceTimersByTime(500);
    expect(found.canvas).toBe(c);
    vi.advanceTimersByTime(2000);
    expect(errors).toHaveLength(1);
  });

  it("stop() stops the feed and the checks", () => {
    const a = canvas(400, 300);
    game(a);
    const feeds: Array<ReturnType<typeof fakeFeed>> = [];
    const found = discover((c) => {
      const feed = fakeFeed(c);
      feeds.push(feed);
      return feed;
    });
    frames(4);
    vi.advanceTimersByTime(500);
    found.stop();
    expect(feeds[0].stopCalls).toBe(1);
    expect(found.feed).toBeNull();
    vi.advanceTimersByTime(2000);
    expect(feeds).toHaveLength(1);
  });
});
