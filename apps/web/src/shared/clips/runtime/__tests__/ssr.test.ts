import { afterEach, describe, expect, it, vi } from "vitest";

// The shared test setup needs jsdom, so this file hides the browser globals
// instead of running in the node environment. Any access to them at import
// time then throws, as it would during server rendering.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function hideBrowserGlobals(): void {
  for (const name of ["window", "document", "navigator", "localStorage", "requestAnimationFrame", "Worker"]) {
    vi.stubGlobal(name, undefined);
  }
}

describe("SSR safety", () => {
  it("imports the runtime and sources with no window, document or navigator", async () => {
    vi.resetModules();
    hideBrowserGlobals();
    const runtime = await import("../index");
    const sources = await import("../../sources/index");
    expect(typeof runtime.installRafDispatcher).toBe("function");
    expect(typeof runtime.probeCapabilities).toBe("function");
    expect(typeof sources.registerCanvasSource).toBe("function");
    expect(typeof sources.autoDiscover).toBe("function");
  });

  it("probes in a server-like scope without throwing", async () => {
    vi.resetModules();
    hideBrowserGlobals();
    const { probeCapabilityReport } = await import("../capabilities");
    const report = await probeCapabilityReport({
      globals: {},
      measureHz: async () => 60,
      fallbackProbe: async () => ({
        scope: "window",
        video: { ok: false, hardware: false, levels: [], codecByLevel: {}, portrait: false, attempts: [] },
        audio: { aac: false, reason: "missing", description: "none" },
        audioData: false,
        audioDecoder: false,
        opfsSyncAccess: false,
      }),
    });
    expect(report.caps.tier).toBe("none");
    expect(report.probeScope).toBe("window");
  });
});
