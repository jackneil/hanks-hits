// @vitest-environment node
/**
 * The real public/clips/tap-worklet.js, run in a sandbox that stands in for an
 * AudioWorkletGlobalScope (AudioWorkletProcessor, registerProcessor,
 * currentFrame, sampleRate).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

import type { PcmBatch } from "../../protocol";

const SOURCE = readFileSync(path.resolve(__dirname, "../../../../../public/clips/tap-worklet.js"), "utf-8");

class ScopePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send(data: unknown): void {
    this.onmessage?.({ data });
  }
}

/**
 * The data port. Like a real MessagePort, it copies the message when it is
 * posted (structured clone), so a later change of the worklet's own buffer
 * never changes a batch that was already sent.
 */
class DataPort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  readonly posted: Array<{ message: PcmBatch; transfer: Transferable[] | undefined; sent: unknown }> = [];
  postMessage(message: PcmBatch, transfer?: Transferable[]): void {
    this.posted.push({ message: structuredClone(message), transfer, sent: message });
  }
  close(): void {
    this.closed = true;
  }
}

interface Processor {
  port: ScopePort;
  process(inputs: Float32Array[][]): boolean;
}

function loadWorklet(sampleRate = 48000) {
  const registered = new Map<string, new () => Processor>();
  class AudioWorkletProcessor {
    port = new ScopePort();
  }
  // Counts the typed arrays and buffers the worklet makes (the audio thread must make none per batch).
  const made = { int16: 0, buffers: 0 };
  class CountingInt16Array extends Int16Array {
    constructor(length: number) {
      super(length);
      made.int16++;
    }
  }
  class CountingArrayBuffer extends ArrayBuffer {
    constructor(length: number) {
      super(length);
      made.buffers++;
    }
  }
  const scope = {
    AudioWorkletProcessor,
    registerProcessor: (name: string, ctor: new () => Processor) => registered.set(name, ctor),
    currentFrame: 0,
    sampleRate,
    Math,
    Number,
    ArrayBuffer: CountingArrayBuffer,
    Int16Array: CountingInt16Array,
  };
  vm.createContext(scope);
  vm.runInContext(SOURCE, scope);
  const Ctor = registered.get("hh-clip-tap");
  if (!Ctor) throw new Error("the worklet did not register hh-clip-tap");
  const processor = new Ctor();
  const data = new DataPort();
  return {
    scope,
    made,
    processor,
    data,
    start(streamId = "page") {
      processor.port.send({ t: "port", port: data, streamId });
    },
    /** Runs one 128-frame quantum at the scope's currentFrame, then moves the clock. */
    quantum(left: Float32Array | null, right?: Float32Array | null) {
      const input = left ? (right ? [left, right] : [left]) : [];
      const alive = processor.process([input]);
      scope.currentFrame += 128;
      return alive;
    },
  };
}

function ramp(start: number, frames = 128, step = 1 / 1024): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = start + i * step;
  return out;
}

describe("tap worklet", () => {
  it("posts 2048-frame Int16 stereo batches with the stream-clock first frame, as a copy", () => {
    const w = loadWorklet();
    w.scope.currentFrame = 96_000;
    w.start("page");
    for (let q = 0; q < 16; q++) w.quantum(new Float32Array(128).fill(0.5), new Float32Array(128).fill(-0.25));
    expect(w.data.posted).toHaveLength(1);
    const { message, transfer } = w.data.posted[0];
    expect(message).toMatchObject({ t: "pcm", streamId: "page", firstFrame: 96_000, sampleRate: 48000 });
    // Nothing is transferred: the port copies the bytes and the worklet keeps its buffer.
    expect(transfer).toBeUndefined();
    expect(message.data).toBeInstanceOf(ArrayBuffer);
    const pcm = new Int16Array(message.data);
    expect(pcm).toHaveLength(4096);
    expect(pcm[0]).toBe(16384);
    expect(pcm[1]).toBe(-8192);
    expect(pcm[4094]).toBe(16384);
    expect(pcm[4095]).toBe(-8192);
    // The next batch starts where this one ended in the stream clock.
    for (let q = 0; q < 16; q++) w.quantum(new Float32Array(128));
    expect(w.data.posted[1].message.firstFrame).toBe(96_000 + 2048);
  });

  it("interleaves left and right exactly, sample by sample", () => {
    const w = loadWorklet();
    w.start();
    const lefts: Float32Array[] = [];
    const rights: Float32Array[] = [];
    for (let q = 0; q < 16; q++) {
      lefts.push(ramp(q / 32));
      rights.push(ramp(-q / 32, 128, -1 / 2048));
      w.quantum(lefts[q], rights[q]);
    }
    const pcm = new Int16Array(w.data.posted[0].message.data);
    for (let q = 0; q < 16; q++) {
      for (let i = 0; i < 128; i++) {
        const f = q * 128 + i;
        // "+ 0" turns a rounded -0 into 0: Int16 has no negative zero.
        expect(pcm[f * 2]).toBe(Math.round(lefts[q][i] * 32768) + 0);
        expect(pcm[f * 2 + 1]).toBe(Math.round(rights[q][i] * 32768) + 0);
      }
    }
  });

  it("clamps, rounds, zeroes NaN, copies mono to both sides and writes silence with no input", () => {
    const w = loadWorklet();
    w.start();
    const loud = new Float32Array(128);
    loud[0] = 1;
    loud[1] = -1;
    loud[2] = 2;
    loud[3] = -2;
    loud[4] = Number.NaN;
    loud[5] = 1 / 65536; // rounds to 1 (0.5 up)
    w.quantum(loud);
    for (let q = 1; q < 8; q++) w.quantum(null);
    for (let q = 8; q < 16; q++) w.quantum(new Float32Array(128).fill(0.25));
    const pcm = new Int16Array(w.data.posted[0].message.data);
    expect(Array.from(pcm.slice(0, 12))).toEqual([32767, 32767, -32768, -32768, 32767, 32767, -32768, -32768, 0, 0, 1, 1]);
    // No-input quanta are silence, and the stream stays contiguous.
    expect(pcm[128 * 2]).toBe(0);
    expect(pcm[8 * 128 * 2]).toBe(8192);
    expect(pcm[8 * 128 * 2 + 1]).toBe(8192);
  });

  it("posts nothing before it has a port, and keeps running", () => {
    const w = loadWorklet();
    for (let q = 0; q < 32; q++) expect(w.quantum(new Float32Array(128).fill(0.1))).toBe(true);
    w.start();
    for (let q = 0; q < 16; q++) w.quantum(new Float32Array(128));
    expect(w.data.posted).toHaveLength(1);
    // The first batch begins at the first quantum after the port came.
    expect(w.data.posted[0].message.firstFrame).toBe(32 * 128);
  });

  it("makes no buffer, typed array or message per batch on the audio thread (plan 6.4)", () => {
    const w = loadWorklet();
    w.start();
    const primed = { ...w.made };
    for (let q = 0; q < 16 * 20; q++) w.quantum(new Float32Array(128).fill(q / 1000));
    expect(w.data.posted).toHaveLength(20);
    expect(w.made).toEqual(primed);
    // One message object, changed in place and copied by the port at each post.
    const sent = new Set(w.data.posted.map((p) => p.sent));
    expect(sent.size).toBe(1);
    // Each posted batch kept its own samples (the port copied them before the next fill).
    expect(new Int16Array(w.data.posted[0].message.data)[0]).toBe(0);
    expect(new Int16Array(w.data.posted[19].message.data)[0]).toBe(Math.round((304 / 1000) * 32768));
  });

  it("posts the part batch at flush, and starts the next batch at the new stream frame (the tap paused)", () => {
    const w = loadWorklet();
    w.scope.currentFrame = 1000;
    w.start();
    w.quantum(new Float32Array(128).fill(0.5));
    w.quantum(new Float32Array(128).fill(0.5));
    w.processor.port.send({ t: "flush" });
    expect(w.data.posted).toHaveLength(1);
    expect(w.data.posted[0].message).toMatchObject({ firstFrame: 1000 });
    expect(w.data.posted[0].message.data.byteLength).toBe(256 * 4);
    // A flush with nothing open posts nothing.
    w.processor.port.send({ t: "flush" });
    expect(w.data.posted).toHaveLength(1);
    // The tap was out of the graph for a while: the stream clock moved on.
    w.scope.currentFrame = 50_000;
    for (let q = 0; q < 16; q++) w.quantum(new Float32Array(128).fill(0.25));
    expect(w.data.posted[1].message).toMatchObject({ firstFrame: 50_000 });
    expect(w.data.posted[1].message.data.byteLength).toBe(2048 * 4);
    expect(w.data.closed).toBe(false);
  });

  it("posts the part batch at stop, closes the port and ends the node", () => {
    const w = loadWorklet();
    w.start();
    w.quantum(new Float32Array(128).fill(0.5));
    w.quantum(new Float32Array(128).fill(0.5));
    w.processor.port.send({ t: "stop" });
    expect(w.data.posted).toHaveLength(1);
    expect(w.data.posted[0].message.data.byteLength).toBe(256 * 4);
    expect(w.data.closed).toBe(true);
    expect(w.quantum(new Float32Array(128))).toBe(false);
  });

  it("reports the context sample rate", () => {
    const w = loadWorklet(44100);
    w.start();
    for (let q = 0; q < 16; q++) w.quantum(new Float32Array(128));
    expect(w.data.posted[0].message.sampleRate).toBe(44100);
  });
});
