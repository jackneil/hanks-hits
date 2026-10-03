/**
 * The iframe audio shim.
 *
 * An iframe game (a srcdoc document, or the emulator page) has its own
 * JavaScript realm and its own AudioContext class. The page's shared bus
 * (getGameAudio) cannot reach nodes in another realm: Web Audio refuses to
 * connect two contexts. So each iframe realm gets a small script, run
 * before the game's own scripts, that wraps the realm's AudioContext:
 *
 * - `new AudioContext()` in that realm still makes a real context.
 * - Its `destination` becomes a GainNode "bus" in the same realm, and the
 *   bus connects to the real speakers. For now the bus is only a
 *   pass-through: the game sounds the same.
 * - `window.__hhAudioBus` lists every context and bus in the realm, so the
 *   clip service can attach a recorder to a bus later.
 * - A capture-phase gesture listener in that realm resumes a suspended
 *   context. Taps inside an iframe never reach the parent document, so the
 *   parent's unlock listener cannot do this.
 *
 * Use: put buildAudioShimSource() at the very start of the realm (the
 * first child of <head> in a srcdoc, or an inline <script> as the first
 * script of the emulator page). It must run before any game script makes
 * a context. The source is plain ES2015 with no imports, so it runs in
 * any realm as a classic script. It installs itself once per realm.
 */

/** The window property the shim publishes in the iframe realm. */
export const AUDIO_SHIM_GLOBAL = "__hhAudioBus";

/** Bump when the shape of RealmAudioBus changes. */
export const AUDIO_SHIM_VERSION = 1;

/**
 * Markers around the shim source. The audio source-scan test skips the
 * text between them when the shim is written into a static HTML file.
 */
export const AUDIO_SHIM_BEGIN_MARKER = "/*hh-audio-shim:begin*/";
export const AUDIO_SHIM_END_MARKER = "/*hh-audio-shim:end*/";

/** One AudioContext made in the iframe realm, and its bus. */
export interface RealmAudioBusEntry {
  /** The context the game made. */
  readonly context: AudioContext;
  /** What the game now sees as `context.destination`. */
  readonly bus: GainNode;
  /** The real speakers of that context. The bus connects here. */
  readonly output: AudioDestinationNode;
}

/** What the shim publishes as `window.__hhAudioBus` in the iframe realm. */
export interface RealmAudioBus {
  readonly version: number;
  /** Every live (not closed) context in the realm, oldest first. */
  readonly entries: ReadonlyArray<RealmAudioBusEntry>;
  /** The bus of the newest live context, or null before the game makes one. */
  readonly bus: GainNode | null;
  /**
   * Call `listener` for every entry that exists now and for every entry
   * made later. Returns a function that stops the future calls.
   */
  subscribe(listener: (entry: RealmAudioBusEntry) => void): () => void;
  /** Resume every suspended context in the realm. Call inside a gesture. */
  unlock(): void;
}

/** The shape of an iframe window that ran the shim. */
export type WindowWithAudioShim = Window & { [AUDIO_SHIM_GLOBAL]?: RealmAudioBus };

// Plain ES2015 on purpose: this text runs as a classic script in another
// realm, with no build step. No imports, no TypeScript, no "</script".
const SHIM_SOURCE = `${AUDIO_SHIM_BEGIN_MARKER}
;(function () {
  "use strict";
  var w = window;
  if (w.${AUDIO_SHIM_GLOBAL}) return;
  var Native = w.AudioContext || w.webkitAudioContext;
  if (typeof Native !== "function") return;

  var entries = [];
  var listeners = [];

  function emit(entry) {
    var current = listeners.slice();
    for (var i = 0; i < current.length; i++) {
      try { current[i](entry); } catch (e) { /* one bad listener must not stop the rest */ }
    }
  }

  function drop(context) {
    for (var i = entries.length - 1; i >= 0; i--) {
      if (entries[i].context === context) entries.splice(i, 1);
    }
  }

  function unlock() {
    for (var i = 0; i < entries.length; i++) {
      var context = entries[i].context;
      if (context.state === "running" || context.state === "closed") continue;
      try {
        var pending = context.resume();
        if (pending && typeof pending.catch === "function") pending.catch(function () {});
      } catch (e) { /* the next gesture tries again */ }
    }
  }

  var HHAudioContext = class extends Native {
    constructor() {
      super(...arguments);
      var context = this;
      var output = context.destination;
      var bus = context.createGain();
      bus.connect(output);
      try {
        Object.defineProperty(bus, "maxChannelCount", {
          configurable: true,
          get: function () { return output.maxChannelCount; }
        });
      } catch (e) { /* a missing extra is harmless */ }
      Object.defineProperty(context, "destination", {
        configurable: true,
        enumerable: true,
        value: bus
      });
      try {
        context.addEventListener("statechange", function () {
          if (context.state === "closed") drop(context);
        });
      } catch (e) { /* an old engine without events keeps the entry */ }
      var entry = Object.freeze({ context: context, bus: bus, output: output });
      entries.push(entry);
      emit(entry);
    }
  };

  w.AudioContext = HHAudioContext;
  if (w.webkitAudioContext) w.webkitAudioContext = HHAudioContext;

  var registry = Object.freeze({
    version: ${AUDIO_SHIM_VERSION},
    get entries() { return entries.slice(); },
    get bus() { return entries.length ? entries[entries.length - 1].bus : null; },
    subscribe: function (listener) {
      var existing = entries.slice();
      for (var i = 0; i < existing.length; i++) {
        try { listener(existing[i]); } catch (e) { /* ignore */ }
      }
      listeners.push(listener);
      return function () {
        var index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    },
    unlock: unlock
  });
  Object.defineProperty(w, "${AUDIO_SHIM_GLOBAL}", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: registry
  });

  var doc = w.document;
  if (doc && typeof doc.addEventListener === "function") {
    var events = ["pointerdown", "pointerup", "touchend", "keydown", "click"];
    for (var j = 0; j < events.length; j++) {
      doc.addEventListener(events[j], unlock, { capture: true, passive: true });
    }
  }
})();
${AUDIO_SHIM_END_MARKER}`;

/**
 * JavaScript source for the iframe audio shim. Prepend it to an iframe
 * document so every AudioContext in that realm plays through a bus in
 * that realm. See the file comment for where to put it.
 */
export function buildAudioShimSource(): string {
  return SHIM_SOURCE;
}

/** Add the shim before game scripts in our trusted, same-origin srcdoc document. */
export function withGameAudioShim(html: string): string {
  if (html.includes(AUDIO_SHIM_BEGIN_MARKER)) return html;
  const script = `<script>${buildAudioShimSource()}</script>`;
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${script}`)
    : script + html;
}
