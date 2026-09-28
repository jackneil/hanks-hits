// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createOpfsMock } from "../../../../__tests__/opfs-mock";
import { PROBE_FILE_NAME, PROBE_LIMIT_BYTES, PROBE_REFINE_STEPS, PROBE_START_BYTES, probeFreeBytes } from "../budget";
import type { DirectoryHandleLike } from "../fsTypes";

const MiB = 1024 * 1024;

describe("probeFreeBytes (write-then-truncate)", () => {
  it("measures the free space within the refine precision, and never more than is free", async () => {
    const mock = createOpfsMock({ quota: 300 * MiB });
    mock.writeFile("lib/guest/old.mp4", new Uint8Array(20 * MiB));
    const used = mock.usage();
    expect(used).toBe(20 * MiB);
    const free = (await probeFreeBytes(mock.root as unknown as DirectoryHandleLike))!;
    const truth = 300 * MiB - used;
    // Doubling stops at 512 MiB; halving 256..512 MiB six times gives 4 MiB steps.
    const precision = 256 * MiB / 2 ** PROBE_REFINE_STEPS;
    expect(free).toBeLessThanOrEqual(truth);
    expect(truth - free).toBeLessThanOrEqual(precision);
  });

  it("writes no real data and leaves no probe file", async () => {
    const mock = createOpfsMock({ quota: 300 * MiB });
    await probeFreeBytes(mock.root as unknown as DirectoryHandleLike);
    expect(mock.listFiles()).toEqual([]);
    expect(mock.usage()).toBe(0);
    expect(mock.openSyncHandles()).toBe(0);
  });

  it("stops at the limit when there is a lot of space", async () => {
    const mock = createOpfsMock({ quota: 2 * PROBE_LIMIT_BYTES });
    expect(await probeFreeBytes(mock.root as unknown as DirectoryHandleLike)).toBe(PROBE_LIMIT_BYTES);
  });

  it("measures space smaller than the first probe size", async () => {
    const mock = createOpfsMock({ quota: 10 * MiB });
    const free = (await probeFreeBytes(mock.root as unknown as DirectoryHandleLike))!;
    expect(free).toBeLessThanOrEqual(10 * MiB);
    expect(10 * MiB - free).toBeLessThanOrEqual(PROBE_START_BYTES / 2 ** PROBE_REFINE_STEPS);
  });

  it("returns null where there is no SyncAccessHandle (a window)", async () => {
    const mock = createOpfsMock({ context: "window" });
    expect(await probeFreeBytes(mock.root as unknown as DirectoryHandleLike)).toBeNull();
    expect(mock.listFiles()).toEqual([]);
  });

  it("returns null and cleans up on an error that is not a quota error", async () => {
    const mock = createOpfsMock();
    mock.failNext("syncWrite", new DOMException("disk", "InvalidStateError"));
    expect(await probeFreeBytes(mock.root as unknown as DirectoryHandleLike)).toBeNull();
    expect(mock.exists(PROBE_FILE_NAME)).toBe(false);
    expect(mock.openSyncHandles()).toBe(0);
  });
});
