/**
 * Auto-discovery for the MediaRecorder engine (tiers M and V, plan 6.1).
 *
 * The same rules as sources/autoDiscover.ts (which registers a VideoFrame
 * canvas source; tier V browsers can have no VideoFrame, so this engine
 * starts a canvas feed instead):
 * - watch the page realm of the root and each same-origin iframe in the root,
 *   with the canvas activity tracker;
 * - pick the largest canvas that the GAME drew on in at least startFrames
 *   frames (findLargestCanvas: never an ignored canvas, never one with no
 *   pixels, never one that is not shown);
 * - check at an interval, which also finds new iframes and sees canvases and
 *   realms that went away; release a realm whose document went away at once.
 * It never calls getContext.
 */

import { installCanvasActivity, type ActivityRealm, type CanvasActivity } from "../../sources/canvasActivity";
import { findLargestCanvas } from "../../sources/autoDiscover";
import type { CanvasFeed } from "./canvasFeed";

export interface FeedDiscoveryOptions {
  root: Element;
  /** Starts a feed on the picked canvas. Throws when the canvas cannot be used. */
  start(canvas: HTMLCanvasElement): CanvasFeed;
  /** A picked canvas could not be used (it is not tried again). */
  onError?(error: unknown): void;
  /** Called each time a canvas gets a feed. */
  onStarted?(feed: CanvasFeed): void;
  /** Frames with game draws on a canvas before it can be picked. Default 3. */
  startFrames?: number;
  /** Interval of the checks, in ms. Default 500. */
  checkMs?: number;
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(handle: unknown): void;
}

export interface FeedDiscovery {
  readonly feed: CanvasFeed | null;
  readonly canvas: HTMLCanvasElement | null;
  check(): void;
  stop(): void;
}

function liveDocs(root: Element): Document[] {
  const docs: Document[] = [];
  const page = root.ownerDocument;
  if (page && page.defaultView) docs.push(page);
  for (const frame of Array.from(root.querySelectorAll("iframe"))) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.defaultView) docs.push(doc);
    } catch {
      // A cross-origin iframe: its canvases cannot be read.
    }
  }
  return docs;
}

export function discoverFeed(options: FeedDiscoveryOptions): FeedDiscovery {
  const { root } = options;
  const gate = Math.max(1, options.startFrames ?? 3);
  const setTick = options.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearTick = options.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const realms = new Map<Document, CanvasActivity>();
  const failed = new WeakSet<HTMLCanvasElement>();
  let feed: CanvasFeed | null = null;
  let stopped = false;

  const watch = () => {
    const live = new Set(liveDocs(root));
    for (const [doc, activity] of Array.from(realms)) {
      if (!live.has(doc) || doc.defaultView === null) {
        realms.delete(doc);
        activity.uninstall();
      }
    }
    for (const doc of live) {
      if (!realms.has(doc) && doc.defaultView) realms.set(doc, installCanvasActivity(doc.defaultView as unknown as ActivityRealm));
    }
  };

  const drawnEnough = (c: HTMLCanvasElement): boolean => {
    if (failed.has(c)) return false;
    const record = realms.get(c.ownerDocument)?.record(c);
    return record !== undefined && record.drawFrames >= gate;
  };

  const isGone = (c: HTMLCanvasElement): boolean => {
    if (!c.isConnected) return true;
    const doc = c.ownerDocument;
    if (!doc || doc.defaultView === null || !realms.has(doc)) return true;
    return doc === root.ownerDocument && !root.contains(c);
  };

  const release = () => {
    feed?.stop();
    feed = null;
  };

  function check(): void {
    if (stopped) return;
    watch();
    if (feed?.stopped) {
      // The feed could not read its canvas (a tainted canvas): look for another one.
      failed.add(feed.canvas);
      feed = null;
    }
    if (feed && isGone(feed.canvas)) release();
    if (feed) return;
    const pick = findLargestCanvas(root, drawnEnough);
    if (!pick) return;
    try {
      feed = options.start(pick);
      options.onStarted?.(feed);
    } catch (error) {
      failed.add(pick);
      feed = null;
      options.onError?.(error);
    }
  }

  watch();
  const timer = setTick(check, options.checkMs ?? 500);

  return {
    get feed() {
      return feed;
    },
    get canvas() {
      return feed?.canvas ?? null;
    },
    check,
    stop() {
      if (stopped) return;
      stopped = true;
      clearTick(timer);
      release();
      for (const activity of realms.values()) activity.uninstall();
      realms.clear();
    },
  };
}
