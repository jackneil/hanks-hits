/**
 * Auto-discovery for canvas games with no clip hook (plan 6.1).
 *
 * It watches the page realm of the root element and each same-origin iframe
 * inside the root. In each realm it installs the rAF dispatcher and the
 * canvas activity tracker (canvasActivity.ts). It picks the largest canvas
 * that the GAME drew on in at least startFrames frames, then registers it.
 *
 * It never calls getContext. A canvas is a candidate only when the tracker
 * saw the game's own context on it (from the game's getContext, or from its
 * draw calls), and the recorded context type chooses the capture path. So a
 * canvas that the game has not set up yet is never touched, whatever other
 * rAF users run in the page.
 *
 * Checks run:
 * - at the end of the frame in which a canvas reached startFrames drawn
 *   frames, while no canvas is registered;
 * - at an interval (checkMs), which also finds new iframes and sees canvases
 *   and realms that went away.
 *
 * A realm goes away when its iframe is removed from the root or loads a new
 * document. In Chrome, a canvas in a removed iframe still says
 * isConnected === true; only its document's defaultView becomes null. So a
 * canvas counts as gone when it is disconnected, when its document has no
 * window, when its realm is no longer watched, or when it (or its iframe)
 * left the root. The realm handles of a gone document are released at once:
 * a kept handle would keep the old document's whole heap alive (for Retro
 * Arcade, the emulator and the ROM). After a release, the next canvas must
 * pass the same drawn-frames gate.
 *
 * A canvas with the attribute data-clips-ignore is never picked (the clip UI
 * marks its own canvases with it). OffscreenCanvas is not watched: capture
 * reads DOM canvases only.
 */
import type { RafDispatcher } from "../runtime/rafDispatcher";
import { installRafDispatcher } from "../runtime/rafDispatcher";
import { installCanvasActivity, type ActivityRealm, type CanvasActivity } from "./canvasActivity";
import { registerCanvasSource, type CanvasSource, type CanvasSourceOptions } from "./canvasSource";

export interface AutoDiscoverOptions extends Omit<CanvasSourceOptions, "canvas"> {
  /** The play area. Canvases outside it are never picked. */
  root: Element;
  /** Frames with game draws on a canvas before it can be picked. Default 3. */
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
  /** The documents whose realms are watched now (for diagnostics and tests). */
  readonly watched: readonly Document[];
  /** Check now instead of at the next interval. */
  check(): void;
  stop(): void;
}

export const IGNORE_ATTRIBUTE = "data-clips-ignore";

interface WatchedRealm {
  doc: Document;
  activity: CanvasActivity;
  dispatcher: RafDispatcher;
  removers: Array<() => void>;
}

/** Same-origin iframes in the root with a document that has a window. */
function liveFrames(root: Element): Array<{ frame: HTMLIFrameElement; doc: Document }> {
  const found: Array<{ frame: HTMLIFrameElement; doc: Document }> = [];
  for (const frame of Array.from(root.querySelectorAll("iframe"))) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.defaultView) found.push({ frame, doc });
    } catch {
      // A cross-origin iframe: its canvases cannot be read.
    }
  }
  return found;
}

function isShown(canvas: HTMLCanvasElement): boolean {
  const rect = canvas.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Every canvas that could be the game: in the root or its same-origin
 * iframes, not ignored, shown, with pixels, and accepted by `accept` (in
 * auto-discovery: the game drew on it in enough frames).
 */
export function candidateCanvases(root: Element, accept: (canvas: HTMLCanvasElement) => boolean): HTMLCanvasElement[] {
  const found: HTMLCanvasElement[] = Array.from(root.querySelectorAll("canvas"));
  for (const { doc } of liveFrames(root)) found.push(...Array.from(doc.querySelectorAll("canvas")));
  return found.filter(
    (c) => !c.hasAttribute(IGNORE_ATTRIBUTE) && c.width > 0 && c.height > 0 && isShown(c) && accept(c),
  );
}

/** The largest candidate by backing-store pixels; ties go to the larger shown size. */
export function findLargestCanvas(root: Element, accept: (canvas: HTMLCanvasElement) => boolean): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  let bestPixels = -1;
  let bestShown = -1;
  for (const c of candidateCanvases(root, accept)) {
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
  const realms = new Map<Document, WatchedRealm>();
  /** Canvases whose registration threw. They are not tried again. */
  const failed = new WeakSet<HTMLCanvasElement>();
  const gate = Math.max(1, startFrames);
  let source: CanvasSource | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let stopped = false;
  let checkQueued = false;

  const pageDocument = (): Document | null => {
    const doc = root.ownerDocument;
    return doc && doc.defaultView ? doc : null;
  };

  const releaseRealm = (entry: WatchedRealm) => {
    realms.delete(entry.doc);
    for (const remove of entry.removers.splice(0)) remove();
    entry.activity.uninstall();
    entry.dispatcher.uninstall();
  };

  const watchRealm = (doc: Document) => {
    const win = doc.defaultView as unknown as ActivityRealm | null;
    if (!win) return;
    const activity = installCanvasActivity(win);
    const dispatcher = installRafDispatcher(win);
    const entry: WatchedRealm = { doc, activity, dispatcher, removers: [] };
    entry.removers.push(
      // Once, in the frame in which a canvas passes the gate. The interval
      // check finds canvases that passed it while another one was registered.
      activity.onFrameDrawn((record) => {
        if (!source && record.drawFrames === gate) checkQueued = true;
      }),
      // Check at the end of the frame, never inside the game's draw call.
      dispatcher.addPostHook(() => {
        if (!checkQueued) return;
        checkQueued = false;
        check();
      }),
    );
    realms.set(doc, entry);
  };

  /** Release realms that went away FIRST (a reloaded iframe reuses its WindowProxy), then watch new ones. */
  const watchRealms = () => {
    const live = new Set<Document>();
    const page = pageDocument();
    if (page) live.add(page);
    for (const { doc } of liveFrames(root)) live.add(doc);
    for (const entry of Array.from(realms.values())) {
      if (!live.has(entry.doc) || entry.doc.defaultView === null) releaseRealm(entry);
    }
    for (const doc of live) if (!realms.has(doc)) watchRealm(doc);
  };

  const drawnEnough = (c: HTMLCanvasElement): boolean => {
    if (failed.has(c)) return false;
    const entry = realms.get(c.ownerDocument);
    const record = entry?.activity.record(c);
    return record !== undefined && record.drawFrames >= gate;
  };

  /**
   * Gone: disconnected, in a document with no window, or out of the play
   * area. A watched iframe document is always reached through an iframe in
   * the root (watchRealms), so for its canvases "watched" means "inside".
   */
  const isGone = (c: HTMLCanvasElement): boolean => {
    if (!c.isConnected) return true;
    const doc = c.ownerDocument;
    if (!doc || doc.defaultView === null || !realms.has(doc)) return true;
    return doc === root.ownerDocument && !root.contains(c);
  };

  const release = () => {
    source?.unregister();
    source = null;
    canvas = null;
  };

  function check(): void {
    if (stopped) return;
    watchRealms();
    if (canvas && isGone(canvas)) release();
    if (source) return;
    const pick = findLargestCanvas(root, drawnEnough);
    if (!pick) return;
    try {
      source = registerCanvasSource({ ...sourceOptions, canvas: pick });
      canvas = pick;
      onRegistered?.(source, pick);
    } catch (error) {
      // Report once per canvas, and keep watching for other canvases.
      failed.add(pick);
      source = null;
      canvas = null;
      sourceOptions.onError?.(error);
    }
  }

  watchRealms();
  const timer = setInterval(check, checkMs);

  return {
    get source() {
      return source;
    },
    get canvas() {
      return canvas;
    },
    get watched() {
      return Array.from(realms.keys());
    },
    check,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      release();
      for (const entry of Array.from(realms.values())) releaseRealm(entry);
    },
  };
}
