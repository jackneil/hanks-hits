import { afterEach, describe, expect, it, vi } from "vitest";
import { progressSyncTransport } from "../progressSyncTransport";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("progress HTTP transport", () => {
  it("fences uncached reads and serializes conditional writes", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ protocol: 1, data: null, revision: null })));
    vi.stubGlobal("fetch", fetcher);
    const transport = progressSyncTransport("drawing-app", "owner");
    expect(await transport.read()).toEqual({ status: 200, body: { protocol: 1, data: null, revision: null } });
    expect(fetcher.mock.calls[0]).toEqual(["/api/progress/drawing-app", { cache: "no-store", headers: { "x-hh-expected-owner": "owner" } }]);
    const payload = { data: {}, merge: true as const, baseRevision: null, expectedOwnerId: "owner" };
    fetcher.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    expect(await transport.write(payload)).toEqual({ status: 502, body: null });
    expect(fetcher.mock.calls[1]).toEqual(["/api/progress/drawing-app", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }]);
  });

  it("uses an application/json beacon and returns the actual admission result", () => {
    const sendBeacon = vi.fn(() => false);
    vi.stubGlobal("navigator", { sendBeacon });
    const transport = progressSyncTransport("drawing-app", "owner");
    expect(transport.beacon!("{}" )).toBe(false);
    expect(sendBeacon).toHaveBeenCalledWith("/api/progress/drawing-app", expect.any(Blob));
    const blob = (sendBeacon.mock.calls as unknown[][])[0][1] as Blob;
    expect(blob.type).toBe("application/json");
    expect(blob.size).toBe(2);
  });
});
