// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createLabHandle, installLabHandle, type LabHandleSource, type LabStatus } from "../labHandle";
import type { BeatTruth } from "../labSchedule";

function source(overrides: Partial<LabHandleSource> = {}): LabHandleSource {
  return {
    status: () => ({ service: "ready" }) as LabStatus,
    truth: () => [],
    lastFile: () => null,
    clip: vi.fn(async () => null),
    recordStart: vi.fn(async () => null),
    recordStop: vi.fn(async () => null),
    wake: vi.fn(),
    ...overrides,
  };
}

describe("createLabHandle", () => {
  it("reads the live status and the live truth at each call", () => {
    let service: LabStatus["service"] = "loading";
    const truth: BeatTruth[] = [];
    const handle = createLabHandle(source({ status: () => ({ service }) as LabStatus, truth: () => truth }));
    expect(handle.version).toBe(1);
    expect(handle.status().service).toBe("loading");
    service = "ready";
    truth.push({ index: 0, ctxTime: 1, rafTs: 16, perfNow: 18, holdFrames: 1, mark: 1 });
    expect(handle.status().service).toBe("ready");
    expect(handle.truth()).toEqual(truth);
  });

  it("gives copies of the truth, so a driver cannot change the lab's log", () => {
    const truth: BeatTruth[] = [{ index: 0, ctxTime: 1, rafTs: 16, perfNow: 18, holdFrames: 1, mark: 0 }];
    const handle = createLabHandle(source({ truth: () => truth }));
    const copy = handle.truth();
    copy[0].ctxTime = 99;
    copy.push({ ...copy[0] });
    expect(truth).toEqual([{ index: 0, ctxTime: 1, rafTs: 16, perfNow: 18, holdFrames: 1, mark: 0 }]);
  });

  it("reads the bytes of the last clip in base64 chunks", async () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff);
    const handle = createLabHandle(source({ lastFile: (part) => (part === 0 ? new Blob([bytes]) : null) }));
    const first = Buffer.from(await handle.readClipBase64(0, 200), "base64");
    const second = Buffer.from(await handle.readClipBase64(200, 200), "base64");
    expect(Buffer.concat([first, second]).equals(Buffer.from(bytes))).toBe(true);
  });

  it("reads each part of a Record by its number", async () => {
    const parts = [new Blob([Uint8Array.from([1, 2, 3])]), new Blob([Uint8Array.from([9, 8])])];
    const asked: number[] = [];
    const handle = createLabHandle(
      source({
        lastFile: (part) => {
          asked.push(part);
          return parts[part] ?? null;
        },
      }),
    );
    expect([...Buffer.from(await handle.readClipBase64(0, 10, 1), "base64")]).toEqual([9, 8]);
    expect([...Buffer.from(await handle.readClipBase64(0, 10), "base64")]).toEqual([1, 2, 3]);
    expect(asked).toEqual([1, 0]);
    await expect(handle.readClipBase64(0, 10, 2)).rejects.toThrow(/no part 2/);
  });

  it("rejects a read when the lab has no clip, and a part number that is not a whole number", async () => {
    const handle = createLabHandle(source());
    await expect(handle.readClipBase64(0, 10)).rejects.toThrow(/no clip/);
    await expect(handle.readClipBase64(0, 10, -1)).rejects.toThrow(RangeError);
    await expect(handle.readClipBase64(0, 10, 0.5)).rejects.toThrow(RangeError);
  });

  it("passes the actions through", async () => {
    const s = source();
    const handle = createLabHandle(s);
    await handle.clip();
    await handle.recordStart();
    await handle.recordStop();
    handle.wake();
    expect(s.clip).toHaveBeenCalledOnce();
    expect(s.recordStart).toHaveBeenCalledOnce();
    expect(s.recordStop).toHaveBeenCalledOnce();
    expect(s.wake).toHaveBeenCalledOnce();
  });

  it("is frozen", () => {
    expect(Object.isFrozen(createLabHandle(source()))).toBe(true);
  });
});

describe("installLabHandle", () => {
  it("puts the handle on the target, and the remover takes off only its own handle", () => {
    const target: { __clipsLab?: unknown } = {};
    const a = createLabHandle(source());
    const b = createLabHandle(source());
    const removeA = installLabHandle(target, a);
    expect(target.__clipsLab).toBe(a);
    const removeB = installLabHandle(target, b);
    removeA();
    expect(target.__clipsLab).toBe(b);
    removeB();
    expect("__clipsLab" in target).toBe(false);
  });
});
