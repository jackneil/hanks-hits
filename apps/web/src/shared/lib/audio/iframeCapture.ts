/**
 * Capture-only audio bridge for explicitly registered, same-origin game iframes.
 * Web Audio nodes cannot connect across contexts. A MediaStream destination in
 * the game realm and a source in the page realm bridge that boundary. The page
 * source connects ONLY to the recording tap, never to speakers. The original
 * iframe graph continues to play normally. No device/media permissions are used.
 * Nodes exist only while an encoder holds an active capture lease.
 */
import { AUDIO_SHIM_GLOBAL, type RealmAudioBusEntry, type WindowWithAudioShim } from "./audioShim";
import { getGameAudio, getGameAudioTapPoint, onGameAudioCreated, unlockGameAudio, type GameAudio } from "./gameAudio";

const entries = new Map<RealmAudioBusEntry, number>();
const changes = new Set<() => void>();
const notify = () => { for (const listener of changes) listener(); };

function retain(entry: RealmAudioBusEntry): () => void {
  entries.set(entry, (entries.get(entry) ?? 0) + 1);
  notify();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const count = (entries.get(entry) ?? 1) - 1;
    if (count > 0) entries.set(entry, count);
    else entries.delete(entry);
    notify();
  };
}

/** Watches only this game's iframe, including reloads; never scans other frames. */
export function watchIframeGameAudio(iframe: HTMLIFrameElement): () => void {
  let clearRealm = () => {};
  let stopped = false;
  const load = () => {
    clearRealm();
    clearRealm = () => {};
    if (stopped) return;
    let realm: WindowWithAudioShim;
    try {
      const candidate = iframe.contentWindow as WindowWithAudioShim | null;
      // Accessing document is the browser-enforced same-origin check. No
      // instanceof checks: an iframe has different constructor identities.
      if (!candidate?.document) return;
      realm = candidate;
    } catch { return; }
    const document = realm.document;
    const registry = realm[AUDIO_SHIM_GLOBAL];
    if (!registry) return;
    const releases: (() => void)[] = [];
    const unsubscribe = registry.subscribe((entry) => {
      if (entry.context.state === "closed") return;
      const release = retain(entry);
      const state = () => { if (entry.context.state === "closed") release(); };
      entry.context.addEventListener("statechange", state);
      releases.push(() => { entry.context.removeEventListener("statechange", state); release(); });
    });
    // A trusted gesture inside an iframe does not bubble to the page. Resume
    // its existing capture bus too; unlockGameAudio creates nothing on its own.
    const unlock = () => unlockGameAudio();
    const gestures = ["pointerdown", "pointerup", "touchend", "keydown", "click"];
    for (const name of gestures) document.addEventListener(name, unlock, { capture: true, passive: true });
    const unload = () => clearRealm();
    realm.addEventListener("pagehide", unload);
    clearRealm = () => {
      unsubscribe();
      for (const release of releases.splice(0)) release();
      for (const name of gestures) document.removeEventListener(name, unlock, true);
      try { realm.removeEventListener("pagehide", unload); } catch { /* navigated cross-origin */ }
    };
  };
  iframe.addEventListener("load", load);
  load();
  return () => { stopped = true; iframe.removeEventListener("load", load); clearRealm(); };
}

interface Bridge {
  entry: RealmAudioBusEntry;
  destination: MediaStreamAudioDestinationNode;
  source: MediaStreamAudioSourceNode | null;
  parent: BaseAudioContext | null;
}
const bridges = new Map<RealmAudioBusEntry, Bridge>();
let active = 0;
let stopParent: (() => void) | null = null;

function disconnect(bridge: Bridge): void {
  try { bridge.source?.disconnect(); } catch { /* already gone */ }
  try { bridge.entry.bus.disconnect(bridge.destination); } catch { /* realm unloaded */ }
  for (const track of bridge.destination.stream.getTracks()) track.stop();
  bridge.source = null;
  bridge.parent = null;
}

function connectParent(bridge: Bridge, parent: GameAudio): void {
  if (bridge.parent === parent.context) return;
  try { bridge.source?.disconnect(); } catch { /* old context closed */ }
  bridge.source = null;
  bridge.parent = null;
  const tap = getGameAudioTapPoint();
  const context = parent.context as AudioContext;
  if (!tap || typeof context.createMediaStreamSource !== "function") return;
  try {
    const source = context.createMediaStreamSource(bridge.destination.stream);
    source.connect(tap);
    bridge.source = source;
    bridge.parent = context;
  } catch {
    // Unsupported context/stream: leave normal game sound untouched.
  }
}

function reconcile(): void {
  for (const [entry, bridge] of bridges) {
    if (!active || !entries.has(entry) || entry.context.state === "closed") {
      disconnect(bridge);
      bridges.delete(entry);
    }
  }
  if (!active) return;
  for (const entry of entries.keys()) {
    if (bridges.has(entry) || entry.context.state === "closed") continue;
    try {
      if (typeof entry.context.createMediaStreamDestination !== "function") continue;
      const destination = entry.context.createMediaStreamDestination();
      const bridge: Bridge = { entry, destination, source: null, parent: null };
      bridges.set(entry, bridge);
      entry.bus.connect(destination);
      const parent = getGameAudio();
      if (parent) connectParent(bridge, parent);
    } catch {
      const failed = bridges.get(entry);
      if (failed) disconnect(failed);
      bridges.delete(entry);
    }
  }
}

export interface IframeAudioCapture {
  suspend(): void;
  resume(): void;
  dispose(): void;
}

/** One shared bridge even while engines hand capture ownership to each other. */
export function startIframeGameAudioCapture(): IframeAudioCapture {
  let live = false;
  let disposed = false;
  const resume = () => {
    if (disposed || live) return;
    live = true;
    if (++active === 1) {
      changes.add(reconcile);
      stopParent = onGameAudioCreated((parent) => { for (const bridge of bridges.values()) connectParent(bridge, parent); });
    }
    reconcile();
  };
  const suspend = () => {
    if (!live) return;
    live = false;
    if (--active === 0) {
      changes.delete(reconcile);
      stopParent?.();
      stopParent = null;
    }
    reconcile();
  };
  resume();
  return { suspend, resume, dispose: () => { suspend(); disposed = true; } };
}
