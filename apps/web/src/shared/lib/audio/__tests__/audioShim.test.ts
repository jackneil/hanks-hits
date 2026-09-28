import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FakeAudioContext,
  FakeAudioDestinationNode,
  FakeGainNode,
  installAudioMock,
  isConnected,
  pathExists,
  removeAudioMock,
} from "@/__tests__/audio-mock";

import {
  AUDIO_SHIM_BEGIN_MARKER,
  AUDIO_SHIM_END_MARKER,
  AUDIO_SHIM_GLOBAL,
  AUDIO_SHIM_VERSION,
  buildAudioShimSource,
  type RealmAudioBus,
  type RealmAudioBusEntry,
} from "../audioShim";

type FakeRealm = {
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
  document: Document;
  [AUDIO_SHIM_GLOBAL]?: RealmAudioBus;
};

/**
 * A fake iframe realm: its own window object, its own document, and a
 * fake AudioContext class. The shim runs against it the way a classic
 * script runs against an iframe's window.
 */
function makeRealm(
  options: { webkit?: boolean; webkitOnly?: boolean; noAudio?: boolean } = {}
): FakeRealm {
  class RealmAudioContext extends FakeAudioContext {}
  const realm: FakeRealm = {
    document: document.implementation.createHTMLDocument("iframe"),
  };
  if (!options.noAudio) {
    if (!options.webkitOnly) realm.AudioContext = RealmAudioContext;
    if (options.webkit || options.webkitOnly) realm.webkitAudioContext = RealmAudioContext;
  }
  return realm;
}

/** Run the (constant, trusted) shim source as a classic script against `realm`. */
function runShim(realm: FakeRealm): void {
  new Function("window", buildAudioShimSource())(realm);
}

/** The real speakers: the prototype getter the shim shadows. */
function realSpeakers(context: FakeAudioContext): FakeAudioDestinationNode {
  const descriptor = Object.getOwnPropertyDescriptor(FakeAudioContext.prototype, "destination");
  return descriptor!.get!.call(context) as FakeAudioDestinationNode;
}

function newRealmContext(realm: FakeRealm, ...args: unknown[]): FakeAudioContext {
  const Ctor = realm.AudioContext as new (...a: unknown[]) => FakeAudioContext;
  return new Ctor(...args);
}

function busOf(realm: FakeRealm): RealmAudioBus {
  const bus = realm[AUDIO_SHIM_GLOBAL];
  if (!bus) throw new Error("the shim did not install");
  return bus;
}

afterEach(() => {
  removeAudioMock();
});

describe("buildAudioShimSource", () => {
  it("is a marked, self-contained classic script that is safe to inline", () => {
    const source = buildAudioShimSource();
    expect(source.startsWith(AUDIO_SHIM_BEGIN_MARKER)).toBe(true);
    expect(source.endsWith(AUDIO_SHIM_END_MARKER)).toBe(true);
    expect(source).not.toMatch(/<\/script/i);
    expect(source).not.toMatch(/^\s*(import|export)\s/m);
    expect(buildAudioShimSource()).toBe(source);
  });

  it("routes new AudioContext() through a bus in the same realm", () => {
    const realm = makeRealm();
    runShim(realm);

    const context = newRealmContext(realm);
    const speakers = realSpeakers(context);
    const bus = context.destination as unknown as FakeGainNode;

    expect(context).toBeInstanceOf(FakeAudioContext);
    expect(bus).toBeInstanceOf(FakeGainNode);
    expect(bus).not.toBe(speakers);
    expect(speakers).toBeInstanceOf(FakeAudioDestinationNode);
    // Pass-through: the bus goes straight to the real speakers, at full level.
    expect(isConnected(bus, speakers)).toBe(true);
    expect(bus.gain.value).toBe(1);

    // A game that plays "to the speakers" now plays through the bus.
    const osc = context.createOscillator();
    osc.connect(context.destination);
    expect(pathExists(osc, bus)).toBe(true);
    expect(pathExists(osc, speakers)).toBe(true);
  });

  it("publishes every context and bus on window.__hhAudioBus", () => {
    const realm = makeRealm();
    runShim(realm);
    const registry = busOf(realm);
    expect(registry.version).toBe(AUDIO_SHIM_VERSION);
    expect(registry.bus).toBeNull();
    expect(registry.entries).toEqual([]);

    const first = newRealmContext(realm);
    const second = newRealmContext(realm);
    expect(registry.entries.map((entry) => entry.context)).toEqual([first, second]);
    expect(registry.bus).toBe(second.destination);
    expect(registry.entries[0].output).toBeInstanceOf(FakeAudioDestinationNode);
    expect(Object.isFrozen(registry.entries[0])).toBe(true);
  });

  it("keeps the real speakers' channel count visible on the bus", () => {
    const realm = makeRealm();
    runShim(realm);
    const context = newRealmContext(realm);
    const bus = context.destination as unknown as { maxChannelCount: number };
    expect(bus.maxChannelCount).toBe(2);
  });

  it("passes constructor options through to the real context", () => {
    const realm = makeRealm();
    runShim(realm);
    const context = newRealmContext(realm, { sampleRate: 44100 });
    expect(context.sampleRate).toBe(44100);
  });

  it("replays existing contexts to a late subscriber, then reports new ones", () => {
    const realm = makeRealm();
    runShim(realm);
    const early = newRealmContext(realm);
    const seen: RealmAudioBusEntry[] = [];
    const stop = busOf(realm).subscribe((entry) => seen.push(entry));
    expect(seen.map((entry) => entry.context)).toEqual([early]);

    const late = newRealmContext(realm);
    expect(seen.map((entry) => entry.context)).toEqual([early, late]);

    stop();
    newRealmContext(realm);
    expect(seen).toHaveLength(2);
  });

  it("keeps notifying the other subscribers when one throws", () => {
    const realm = makeRealm();
    runShim(realm);
    const good = vi.fn();
    busOf(realm).subscribe(() => {
      throw new Error("bad subscriber");
    });
    busOf(realm).subscribe(good);
    expect(() => newRealmContext(realm)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("drops a context from the list when it closes", async () => {
    const realm = makeRealm();
    runShim(realm);
    const context = newRealmContext(realm);
    await context.close();
    expect(busOf(realm).entries).toEqual([]);
    expect(busOf(realm).bus).toBeNull();
  });

  it("resumes a suspended context on the first tap inside the iframe", async () => {
    const realm = makeRealm();
    runShim(realm);
    const context = newRealmContext(realm);
    expect(context.state).toBe("suspended");

    realm.document.dispatchEvent(new Event("pointerdown"));
    expect(context.resume).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(context.state).toBe("running");

    // Running: another tap does not call resume() again.
    realm.document.dispatchEvent(new Event("touchend"));
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it("swallows a refused resume() inside the iframe", async () => {
    const realm = makeRealm();
    runShim(realm);
    const context = newRealmContext(realm);
    context.resumeAllowed = false;
    realm.document.dispatchEvent(new Event("keydown"));
    await Promise.resolve();
    expect(context.state).toBe("suspended");
  });

  it("wraps webkitAudioContext too, so old code finds the same class", () => {
    const realm = makeRealm({ webkit: true });
    runShim(realm);
    expect(realm.webkitAudioContext).toBe(realm.AudioContext);

    const webkitOnly = makeRealm({ webkitOnly: true });
    runShim(webkitOnly);
    const Ctor = webkitOnly.webkitAudioContext as new () => FakeAudioContext;
    const context = new Ctor();
    expect(context.destination).toBeInstanceOf(FakeGainNode);
    expect(busOf(webkitOnly).entries).toHaveLength(1);
  });

  it("installs once per realm, so a second copy does not wrap twice", () => {
    const realm = makeRealm();
    runShim(realm);
    const wrapped = realm.AudioContext;
    runShim(realm);
    expect(realm.AudioContext).toBe(wrapped);
    const context = newRealmContext(realm);
    const bus = context.destination as unknown as FakeGainNode;
    // One bus between the game and the speakers, not two.
    expect([...bus.outputs][0]).toBeInstanceOf(FakeAudioDestinationNode);
  });

  it("does nothing in a realm with no Web Audio", () => {
    const realm = makeRealm({ noAudio: true });
    expect(() => runShim(realm)).not.toThrow();
    expect(realm[AUDIO_SHIM_GLOBAL]).toBeUndefined();
  });

  it("never touches the page's own AudioContext", () => {
    installAudioMock();
    const pageClass = window.AudioContext;
    const realm = makeRealm();
    runShim(realm);
    expect(window.AudioContext).toBe(pageClass);
    expect((window as unknown as FakeRealm)[AUDIO_SHIM_GLOBAL]).toBeUndefined();
  });
});
