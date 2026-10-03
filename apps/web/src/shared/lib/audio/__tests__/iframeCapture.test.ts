import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealmAudioBusEntry, RealmAudioBus } from "../audioShim";
import { startIframeGameAudioCapture, watchIframeGameAudio } from "../iframeCapture";

const parent = vi.hoisted(() => ({ bus: null as unknown, tap: null as unknown, listeners: new Set<(bus: unknown) => void>(), unlock: vi.fn() }));
vi.mock("../gameAudio", () => ({
  getGameAudio: () => parent.bus,
  getGameAudioTapPoint: () => parent.tap,
  unlockGameAudio: () => parent.unlock(),
  onGameAudioCreated: (listener: (bus: unknown) => void) => {
    parent.listeners.add(listener);
    if (parent.bus) listener(parent.bus);
    return () => parent.listeners.delete(listener);
  },
}));

const cleanups: (() => void)[] = [];
function node(context: object) {
  return { context, connect: vi.fn(), disconnect: vi.fn() };
}
function makeRealm(frame: HTMLIFrameElement) {
  const context = new EventTarget() as EventTarget & { state: string; createMediaStreamDestination: ReturnType<typeof vi.fn> };
  context.state = "running";
  const tracks: { stop: ReturnType<typeof vi.fn> }[] = [];
  const destinations: ReturnType<typeof node>[] = [];
  context.createMediaStreamDestination = vi.fn(() => {
    const track = { stop: vi.fn() };
    tracks.push(track);
    const destination = { ...node(context), stream: { getTracks: () => [track] } };
    destinations.push(destination);
    return destination;
  });
  const bus = node(context);
  const entry = { context, bus, output: node(context) } as unknown as RealmAudioBusEntry;
  const listeners = new Set<(entry: RealmAudioBusEntry) => void>();
  const registry = {
    version: 1, entries: [entry], bus: entry.bus,
    subscribe(listener: (entry: RealmAudioBusEntry) => void) {
      listeners.add(listener); listener(entry);
      return () => listeners.delete(listener);
    }, unlock: vi.fn(),
  } satisfies RealmAudioBus;
  Object.defineProperty(frame.contentWindow!, "__hhAudioBus", { value: registry, configurable: true });
  return { context, bus, entry, tracks, destinations, listeners };
}
function iframe() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  return frame;
}
let sources: ReturnType<typeof node>[];
let speakers: object;
beforeEach(() => {
  sources = [];
  speakers = {};
  const context = { destination: speakers, createMediaStreamSource: vi.fn(() => {
    const source = node(context);
    sources.push(source);
    return source;
  }) };
  parent.bus = { context };
  parent.tap = node(context);
  parent.unlock.mockClear();
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.innerHTML = "";
  parent.listeners.clear();
  parent.bus = null; parent.tap = null;
});

describe("same-origin iframe capture audio", () => {
  it("does no capture work while clips are off, then connects only to the page recording tap", () => {
    const frame = iframe();
    const realm = makeRealm(frame);
    cleanups.push(watchIframeGameAudio(frame));
    expect(realm.context.createMediaStreamDestination).not.toHaveBeenCalled();
    const capture = startIframeGameAudioCapture(); cleanups.push(capture.dispose);
    expect(realm.context.createMediaStreamDestination).toHaveBeenCalledTimes(1);
    expect(realm.bus.connect).toHaveBeenCalledWith(realm.destinations[0]);
    expect(sources).toHaveLength(1);
    expect(sources[0].connect).toHaveBeenCalledExactlyOnceWith(parent.tap);
    expect(sources[0].connect).not.toHaveBeenCalledWith(speakers);
    capture.dispose();
    expect(sources[0].disconnect).toHaveBeenCalled();
    expect(realm.bus.disconnect).toHaveBeenCalledWith(realm.destinations[0]);
    expect(realm.tracks[0].stop).toHaveBeenCalledOnce();
  });

  it("shares one bridge across encoder handoff and releases it while parked", () => {
    const frame = iframe(); const realm = makeRealm(frame);
    cleanups.push(watchIframeGameAudio(frame));
    const first = startIframeGameAudioCapture(); cleanups.push(first.dispose);
    const second = startIframeGameAudioCapture(); cleanups.push(second.dispose);
    expect(sources).toHaveLength(1);
    first.dispose();
    expect(realm.tracks[0].stop).not.toHaveBeenCalled();
    second.suspend();
    expect(realm.tracks[0].stop).toHaveBeenCalledOnce();
    second.resume();
    expect(sources).toHaveLength(2);
    second.resume();
    expect(sources).toHaveLength(2);
  });

  it("drops stale realm audio on reload, takes new contexts, and unlocks on iframe gestures", () => {
    const frame = iframe(); const old = makeRealm(frame);
    cleanups.push(watchIframeGameAudio(frame));
    const capture = startIframeGameAudioCapture(); cleanups.push(capture.dispose);
    const current = makeRealm(frame);
    frame.dispatchEvent(new Event("load"));
    expect(old.listeners.size).toBe(0);
    expect(old.tracks[0].stop).toHaveBeenCalledOnce();
    expect(current.context.createMediaStreamDestination).toHaveBeenCalledOnce();
    frame.contentDocument!.dispatchEvent(new Event("pointerdown"));
    expect(parent.unlock).toHaveBeenCalledOnce();
    current.context.state = "closed";
    current.context.dispatchEvent(new Event("statechange"));
    expect(current.tracks[0].stop).toHaveBeenCalledOnce();
  });

  it("ignores inaccessible cross-origin documents and never touches their audio", () => {
    const frame = iframe();
    Object.defineProperty(frame, "contentWindow", { get: () => ({ get document() { throw new DOMException("cross origin", "SecurityError"); } }) });
    expect(() => cleanups.push(watchIframeGameAudio(frame))).not.toThrow();
    const capture = startIframeGameAudioCapture(); cleanups.push(capture.dispose);
    expect(sources).toHaveLength(0);
  });

  it("handles context/realm duplication without doubling the recorded sound", () => {
    const frame = iframe(); const realm = makeRealm(frame);
    const first = watchIframeGameAudio(frame); cleanups.push(first);
    const second = watchIframeGameAudio(frame); cleanups.push(second);
    const capture = startIframeGameAudioCapture(); cleanups.push(capture.dispose);
    expect(sources).toHaveLength(1);
    first();
    expect(realm.tracks[0].stop).not.toHaveBeenCalled();
    second();
    expect(realm.tracks[0].stop).toHaveBeenCalledOnce();
  });
});
