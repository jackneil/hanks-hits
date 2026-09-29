/**
 * Keyboard shortcuts for clips (plan 11.2): Alt+C (Option+C on a Mac) and
 * F8 clip, Alt+R starts or stops a video.
 *
 * Rules:
 * - Ctrl or Meta cancels the shortcut. On Windows, AltGr is Ctrl+Alt, so a
 *   kid who types a character with AltGr never clips by accident.
 * - The physical key (event.code) decides, because Option+C on a Mac
 *   gives the key "ç".
 * - A key that belongs to a text field is never a shortcut (keyBelongsToTarget,
 *   plus a check that also works for elements inside an iframe).
 * - A held key repeats; only the first press acts. The repeats of a
 *   shortcut still do not reach the game.
 * - A matched shortcut stops at the clip listener (ClipButton): the games
 *   match event.code and do not look at Alt, so Alt+R would also reset a
 *   truck.
 * - The shortcuts also work while focus is inside a same-origin iframe
 *   (iframe games), because the listener is on every same-origin window.
 */

import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";

export type HotkeyAction = "clip" | "record";

type KeyFacts = Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

/** Which clip action a key press asks for, or null. */
export function matchClipHotkey(event: KeyFacts): HotkeyAction | null {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === "F8" && !event.altKey) return "clip";
  if (!event.altKey) return null;
  if (event.code === "KeyC") return "clip";
  if (event.code === "KeyR") return "record";
  return null;
}

/**
 * True when the key belongs to a text field. It checks with closest(), not
 * instanceof, so it also works for an element in an iframe (another realm).
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  if (!element || typeof element.closest !== "function") return false;
  return element.closest("input, textarea, select, [contenteditable]") !== null;
}

/** True when the key belongs to a text field or to the focused control, not to the clip shortcuts. */
export function hotkeyBelongsToTarget(event: KeyboardEvent): boolean {
  return isTextEntryTarget(event.target) || keyBelongsToTarget(event);
}

/** True when this key press must not act as a clip shortcut. */
export function ignoreForHotkey(event: KeyboardEvent): boolean {
  return event.repeat || hotkeyBelongsToTarget(event);
}

/**
 * Listen for keydown on `root` and on every same-origin iframe inside it,
 * including iframes that load later. Returns the cleanup.
 */
export function listenOnSameOriginWindows(root: Window, onKeyDown: (event: KeyboardEvent) => void): () => void {
  // Keyed by document: an iframe that navigates gets a new document, and
  // the listener must go on the new one.
  const attached = new Map<Document, () => void>();

  // A capture listener on a document sees the load event of every iframe
  // in it (load does not bubble, but capture listeners still get it). A
  // new or reloaded iframe then gets its listener.
  const onLoad = (event: Event) => {
    const target = event.target as { tagName?: string } | null;
    if (target && typeof target.tagName === "string" && target.tagName.toUpperCase() === "IFRAME") {
      scanFrames(root.document);
    }
  };

  const attach = (win: Window) => {
    let doc: Document;
    try {
      doc = win.document;
    } catch {
      return; // Another origin: its keys are its own.
    }
    if (!doc || attached.has(doc)) return;
    win.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("load", onLoad, true);
    attached.set(doc, () => {
      win.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("load", onLoad, true);
    });
    scanFrames(doc);
  };

  const scanFrames = (doc: Document) => {
    for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
      let child: Window | null = null;
      try {
        child = frame.contentWindow;
      } catch {
        child = null;
      }
      if (child) attach(child);
    }
  };

  attach(root);

  return () => {
    for (const detach of attached.values()) detach();
    attached.clear();
  };
}
