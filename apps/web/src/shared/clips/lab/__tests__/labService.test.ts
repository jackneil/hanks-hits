/**
 * The lab's service loader (lab/labService.ts) does the same load as
 * ClipProvider: the clips flag first, then the service, and only when the
 * flag turns capture on (plan 4.1). The service module is counted, so a
 * test sees whether its dynamic import ran at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ verdict: { mode: "on", capture: true } as { mode: string; capture: boolean } }));
vi.mock("../../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config")>();
  return { ...actual, loadClipsVerdict: vi.fn(async () => flag.verdict) };
});

const loads = vi.hoisted(() => ({ service: 0, started: { name: "the tab's service" } }));
vi.mock("../../service/ClipService", () => {
  loads.service++;
  return { startClipService: vi.fn(() => loads.started) };
});

beforeEach(() => {
  vi.resetModules();
  loads.service = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadLabService", () => {
  it("returns null and never loads the service while the flag is off", async () => {
    flag.verdict = { mode: "off", capture: false };
    const { loadLabService } = await import("../labService");
    await expect(loadLabService()).resolves.toBeNull();
    expect(loads.service).toBe(0);
  });

  it("starts the tab's clip service when the flag turns capture on", async () => {
    flag.verdict = { mode: "on", capture: true };
    const { loadLabService } = await import("../labService");
    await expect(loadLabService()).resolves.toBe(loads.started);
    expect(loads.service).toBe(1);
    const { startClipService } = await import("../../service/ClipService");
    expect(startClipService).toHaveBeenCalledTimes(1);
  });

  it("dogfood mode for a visitor who is not in the dogfood list: no capture, no service", async () => {
    flag.verdict = { mode: "dogfood", capture: false };
    const { loadLabService } = await import("../labService");
    await expect(loadLabService()).resolves.toBeNull();
    expect(loads.service).toBe(0);
  });
});
