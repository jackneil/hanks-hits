import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FakeAudioContext,
  FakeAudioNode,
  FakeGainNode,
  installAudioMock,
  pathExists,
  removeAudioMock,
  type AudioMock,
} from "@/__tests__/audio-mock";
import { getGameAudio, getGameAudioTapPoint } from "@/shared/lib/audio/gameAudio";
import type { ClockAnchor } from "../../protocol";
import { ANCHOR_INTERVAL_MS, AudioTap, PAGE_STREAM_ID, TAP_WORKLET_URL, type TapNode } from "../audioTap";

class FakeWorkletNode extends FakeAudioNode {
  readonly messages: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  readonly port = {
    postMessage: (message: unknown, transfer?: Transferable[]) => this.messages.push({ message, transfer }),
  };
  constructor(context: FakeAudioContext) {
    super(context, 1, 1);
  }
}

interface Harness {
  tap: AudioTap;
  nodes: FakeWorkletNode[];
  anchors: ClockAnchor[];
  timers: Map<number, () => void>;
  logs: string[];
  now: { value: number };
  port: MessagePort;
}

function harness(): Harness {
  const nodes: FakeWorkletNode[] = [];
  const anchors: ClockAnchor[] = [];
  const timers = new Map<number, () => void>();
  const logs: string[] = [];
  const now = { value: 1234.5 };
  let id = 0;
  const tap = new AudioTap({
    createNode: (context) => {
      const node = new FakeWorkletNode(context as unknown as FakeAudioContext);
      nodes.push(node);
      return node as unknown as TapNode;
    },
    now: () => now.value,
    setInterval: (fn, ms) => {
      expect(ms).toBe(ANCHOR_INTERVAL_MS);
      timers.set(++id, fn);
      return id;
    },
    clearInterval: (h) => timers.delete(h as number),
    log: (m) => logs.push(m),
  });
  const port = new MessageChannel().port1;
  return { tap, nodes, anchors, timers, logs, now, port };
}

const sink = (h: Harness) => ({ postAnchor: (a: ClockAnchor) => h.anchors.push(a) });
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let mock: AudioMock;
beforeEach(() => {
  mock = installAudioMock({ initialState: "running" });
});
afterEach(() => {
  removeAudioMock();
});

describe("audio tap", () => {
  it("never makes an AudioContext: it waits for the game's bus", async () => {
    const h = harness();
    h.tap.attach(h.port, sink(h));
    await settle();
    expect(mock.contexts).toHaveLength(0);
    expect(h.nodes).toHaveLength(0);
    expect(h.tap.live).toBe(false);
  });

  it("connects a worklet on the tap point when the bus appears, pulled through a silent gain", async () => {
    const h = harness();
    h.tap.attach(h.port, sink(h));
    getGameAudio();
    await settle();
    const ctx = mock.lastContext();
    expect(ctx.audioWorklet.modules).toEqual([TAP_WORKLET_URL]);
    expect(h.nodes).toHaveLength(1);
    const node = h.nodes[0];
    const tapPoint = getGameAudioTapPoint() as unknown as FakeAudioNode;
    expect(pathExists(tapPoint, node)).toBe(true);
    const zero = [...node.outputs][0] as FakeGainNode;
    expect(zero).toBeInstanceOf(FakeGainNode);
    expect(zero.gain.value).toBe(0);
    expect(pathExists(node, ctx.destination)).toBe(true);
    // The PCM port goes to the worklet, transferred.
    expect(node.messages[0]).toEqual({ message: { t: "port", port: h.port, streamId: PAGE_STREAM_ID }, transfer: [h.port] });
    expect(h.tap.live).toBe(true);
  });

  it("connects at once when the bus already exists", async () => {
    getGameAudio();
    const h = harness();
    h.tap.attach(h.port, sink(h));
    await settle();
    expect(h.nodes).toHaveLength(1);
  });

  it("anchors on production time at start, every 250 ms and at each state change, never with getOutputTimestamp", async () => {
    const h = harness();
    h.tap.attach(h.port, sink(h));
    getGameAudio();
    await settle();
    const ctx = mock.lastContext();
    expect(h.anchors).toEqual([
      { t: "anchor", streamId: "page", perfMs: 1234.5, ctxTimeSec: 0, timeOriginOffsetMs: 0, state: "running" },
    ]);
    ctx.advanceTime(0.25);
    h.now.value += 250;
    [...h.timers.values()][0]();
    expect(h.anchors[1]).toMatchObject({ perfMs: 1484.5, ctxTimeSec: 0.25, state: "running" });
    ctx.interrupt();
    expect(h.anchors[2]).toMatchObject({ state: "interrupted" });
    expect(ctx.getOutputTimestamp).not.toHaveBeenCalled();
  });

  it("stops at detach: the worklet ends, the nodes leave the graph, anchors stop", async () => {
    const h = harness();
    h.tap.attach(h.port, sink(h));
    getGameAudio();
    await settle();
    const node = h.nodes[0];
    h.tap.detach();
    expect(node.messages.at(-1)).toEqual({ message: { t: "stop" }, transfer: undefined });
    expect(node.outputs.size).toBe(0);
    expect(node.inputs.size).toBe(0);
    expect(h.timers.size).toBe(0);
    const count = h.anchors.length;
    mock.lastContext().interrupt();
    expect(h.anchors).toHaveLength(count);
    expect(h.tap.live).toBe(false);
  });

  it("marks the stream closed when the bus context is replaced, and does not reuse the spent port", async () => {
    const h = harness();
    h.tap.attach(h.port, sink(h));
    getGameAudio();
    await settle();
    const first = mock.lastContext();
    first.simulateState("closed");
    getGameAudio();
    await settle();
    expect(mock.contexts).toHaveLength(2);
    expect(h.nodes).toHaveLength(1);
    expect(h.anchors.at(-1)).toMatchObject({ state: "closed" });
    expect(h.logs.some((m) => m.includes("replaced"))).toBe(true);
    expect(h.tap.live).toBe(false);
  });

  it("logs and carries on when the worklet module cannot load", async () => {
    const h = harness();
    const bus = getGameAudio()!;
    (bus.context as unknown as FakeAudioContext).audioWorklet.addModule.mockRejectedValueOnce(new DOMException("x", "AbortError"));
    h.tap.attach(h.port, sink(h));
    await settle();
    expect(h.nodes).toHaveLength(0);
    expect(h.logs).toEqual([expect.stringContaining("AbortError")]);
  });

  it("drops a connect that finishes after detach", async () => {
    const h = harness();
    h.tap.attach(h.port, sink(h));
    getGameAudio();
    h.tap.detach();
    await settle();
    expect(h.nodes).toHaveLength(0);
    expect(h.anchors).toHaveLength(0);
  });

  it("loads the worklet module once per context across attaches", async () => {
    const h = harness();
    getGameAudio();
    h.tap.attach(h.port, sink(h));
    await settle();
    h.tap.detach();
    h.tap.attach(new MessageChannel().port1, sink(h));
    await settle();
    expect(mock.lastContext().audioWorklet.addModule).toHaveBeenCalledTimes(1);
    expect(h.nodes).toHaveLength(2);
  });

  it("maps a WebKit-only state name and unknown states", async () => {
    const h = harness();
    h.tap.attach(h.port, sink(h));
    getGameAudio();
    await settle();
    const spy = vi.spyOn(mock.lastContext(), "state", "get").mockReturnValue("weird" as never);
    [...h.timers.values()][0]();
    expect(h.anchors.at(-1)!.state).toBe("suspended");
    spy.mockRestore();
  });
});
