/**
 * Auto-discovery for canvas games with no clip hook (plan 6.1).
 *
 * It installs the rAF dispatcher on the page realm of the root element (and
 * on each same-origin iframe inside it), waits until the game ran a few
 * frames, then registers the largest drawn canvas. Waiting for game frames
 * matters: registerCanvasSource reads the canvas's existing context type, and
 * the game creates its context before its first frame.
 *
 * While it runs, it checks again at an interval: when no canvas is found
 * yet, and when the registered canvas left the document (a route change or a
 * remounted game), it registers the new largest canvas.
 *
 * A canvas with the attribute data-clips-ignore is never picked (the clip UI
 * marks its own canvases with it).
 */
import type { RafDispatcher, RafRealm } from "../runtime/rafDispatcher";
import { installRafDispatcher } from "../runtime/rafDispatcher";
import { registerCanvasSource, type CanvasSource, type CanvasSourceOptions } from "./canvasSource";

export interface AutoDiscoverOptions extends Omit<CanvasSourceOptions, "canvas"> {
  /** The play area. Canvases outside it are never picked. */
  root: Element;
  /** Game frames to wait for before the first pick. Default 3. */
  startFrames?: number;
  /** Interval of the checks, in ms. Default 500. */
  checkMs?: number;
  /** Called each time a canvas is registered. */
  onRegistered?: (source: CanvasSource, canvas: HTMLCanvasElement) => void;
}

export interface AutoDiscovery {
  /** The registered source, or null while none is registered. */
  readonly source: CanvasSource | null;
  readonly canvas: HTMLCanvasElement | null;
  /** Check now instead of at the next interval. */
  check(): void;
  stop(): void;
}

export const IGNORE_ATTRIBUTE = "data-clips-ignore";

function sameOriginDocuments(root: Element): Document[] {
  const docs: Document[] = [];
  for (const frame of Array.from(root.querySelectorAll("iframe"))) {
    try {
      const doc = frame.contentDocument;
      if (doc) docs.push(doc);
    } catch {
      // A cross-origin iframe: its canvases cannot be read.
    }
  }
  return docs;
}

function isShown(canvas: HTMLCanvasElement): boolean {
  const rect = canvas.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Every canvas that could be the game: in the root or its same-origin iframes, shown, with pixels. */
export function candidateCanvases(root: Element): HTMLCanvasElement[] {
  const found: HTMLCanvasElement[] = Array.from(root.querySelectorAll("canvas"));
  for (const doc of sameOriginDocuments(root)) {
    found.push(...Array.from(doc.querySelectorAll("canvas")));
  }
  return found.filter(
    (c) => !c.hasAttribute(IGNORE_ATTRIBUTE) && c.width > 0 && c.height > 0 && isShown(c),
  );
}

/** The largest candidate by backing-store pixels; ties go to the larger shown size. */
export function findLargestCanvas(root: Element): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  let bestPixels = -1;
  let bestShown = -1;
  for (const c of candidateCanvases(root)) {
    const pixels = c.width * c.height;
    const rect = c.getBoundingClientRect();
    const shown = rect.width * rect.height;
    if (pixels > bestPixels || (pixels === bestPixels && shown > bestShown)) {
      best = c;
      bestPixels = pixels;
      bestShown = shown;
    }
  }
  return best;
}

export function autoDiscover(options: AutoDiscoverOptions): AutoDiscovery {
  const { root, startFrames = 3, checkMs = 500, onRegistered, ...sourceOptions } = options;
  const handles = new Map<RafRealm, RafDispatcher>();
  let source: CanvasSource | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let stopped = false;

  const watchRealms = () => {
    const realms: RafRealm[] = [];
    const pageView = root.ownerDocument?.defaultView;
    if (pageView) realms.push(pageView);
    for (const doc of sameOriginDocuments(root)) if (doc.defaultView) realms.push(doc.defaultView);
    for (const realm of realms) {
      if (!handles.has(realm)) handles.set(realm, installRafDispatcher(realm));
    }
  };

  const started = () => {
    for (const d of handles.values()) if (d.gameFrames() >= startFrames) return true;
    return false;
  };

  const release = () => {
    source?.unregister();
    source = null;
    canvas = null;
  };

  const check = () => {
    if (stopped) return;
    watchRealms();
    if (canvas && !canvas.isConnected) release();
    if (source || !started()) return;
    const pick = findLargestCanvas(root);
    if (!pick) return;
    try {
      source = registerCanvasSource({ ...sourceOptions, canvas: pick });
      canvas = pick;
      onRegistered?.(source, pick);
    } catch (error) {
      source = null;
      canvas = null;
      sourceOptions.onError?.(error);
    }
  };

  watchRealms();
  // The first check runs from a post hook as soon as the game ran enough
  // frames. After that, the interval does the checks.
  let firstCheckDone = false;
  const removeHooks: Array<() => void> = [];
  for (const d of handles.values()) {
    removeHooks.push(
      d.addPostHook(() => {
        if (firstCheckDone || !started()) return;
        firstCheckDone = true;
        check();
      }),
    );
  }
  const timer = setInterval(check, checkMs);

  return {
    get source() {
      return source;
    },
    get canvas() {
      return canvas;
    },
    check,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      for (const remove of removeHooks) remove();
      release();
      for (const d of handles.values()) d.uninstall();
      handles.clear();
    },
  };
}
