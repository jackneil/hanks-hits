// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type RequestListener } from "node:http";
import { once, EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { startGateway } from "../../../../scripts/live/gateway";
import { issueLiveTicket } from "../ticket";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; vi.unstubAllEnvs(); });
async function setup(handler?: RequestListener) {
  vi.stubEnv("AUTH_URL", "http://127.0.0.1");
  const upstream = createServer(handler ?? ((req, res) => { res.end(`${req.method}:${req.url}`); }));
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  cleanups.push(() => new Promise<void>(resolve => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("port");
  const gateway = startGateway({ port: 0, host: "127.0.0.1", upstreamPort: upstreamAddress.port,
    secret: "test-secret", release: { id: "release-a", builtAt: 100 } });
  await once(gateway.server, "listening"); cleanups.push(() => gateway.close());
  const address = gateway.server.address();
  if (!address || typeof address === "string") throw new Error("port");
  return `127.0.0.1:${address.port}`;
}
function connect(host: string, owner: string | null, origin = "http://127.0.0.1", forged?: string) {
  const socket = new WebSocket(`ws://${host}/api/live`, ["hh-live", `ticket.${forged ?? issueLiveTicket(owner, "test-secret")}`], { origin });
  cleanups.push(async () => { socket.terminate(); });
  return socket;
}
describe("live gateway", () => {
  it("handles connection resets even for a rejected raw upgrade", async () => {
    const gateway = startGateway({ port: 0, host: "127.0.0.1", upstreamPort: 1,
      secret: "test-secret", release: { id: "test", builtAt: 1 } });
    await once(gateway.server, "listening"); cleanups.push(() => gateway.close());
    const raw = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
    gateway.server.emit("upgrade", { url: "/unknown" }, raw, Buffer.alloc(0));
    expect(raw.end).toHaveBeenCalled();
    expect(() => raw.emit("error", new Error("connection reset"))).not.toThrow();
    expect(raw.destroy).toHaveBeenCalledOnce();
  });
  it("closes downstream responses when the upstream body is truncated", async () => {
    const host = await setup((_req, res) => {
      res.writeHead(200, { "Content-Length": "100" }); res.write("partial");
      setImmediate(() => res.destroy());
    });
    await expect((async () => (await fetch(`http://${host}/truncated`)).text())()).rejects.toThrow();
  });
  it("forwards normal HTTP and sends guests only release information", async () => {
    const host = await setup();
    expect(await (await fetch(`http://${host}/page?x=1`)).text()).toBe("GET:/page?x=1");
    const guest = connect(host, null);
    const [data] = await once(guest, "message");
    expect(JSON.parse(String(data))).toEqual({ type: "release", release: { id: "release-a", builtAt: 100 } });
    expect(guest.protocol).toBe("hh-live");
  });
  it("invalidates a signed-in inbox without exposing its contents over the socket", async () => {
    const host = await setup(), events: unknown[] = [];
    const owner = connect(host, "owner-a"); owner.on("message", data => events.push(JSON.parse(String(data))));
    await once(owner, "open");
    await new Promise(resolve => setImmediate(resolve));
    expect(events).toEqual([{ type: "release", release: { id: "release-a", builtAt: 100 } }, { type: "inbox" }]);
    const closed = once(owner, "close"); owner.send("arbitrary command");
    expect((await closed)[0]).toBe(1008);
  });
  it("rejects cross-origin access and forged identity tickets", async () => {
    const host = await setup();
    for (const socket of [connect(host, "owner-a", "https://evil.example"), connect(host, "owner-b", "http://127.0.0.1", "forged")]) {
      await expect(once(socket, "open")).rejects.toThrow("403");
    }
  });
});
