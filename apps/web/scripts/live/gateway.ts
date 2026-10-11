import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Client } from "pg";
import { connect, type Socket } from "node:net";
import { pipeline } from "node:stream";
import { verifyLiveTicket } from "../../src/lib/live/ticket";
import type { Release } from "../../src/lib/live/release";

type Options = { port: number; upstreamPort: number; secret: string; release: Release; databaseUrl?: string; host?: string; development?: boolean };
const safeError = (error: unknown) => ({ name: error instanceof Error ? error.name : "Error",
  code: typeof error === "object" && error && "code" in error ? String(error.code).slice(0, 10) : undefined });

export function startGateway(options: Options) {
  let stopping = false;
  const developmentSockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const upstream = httpRequest({ hostname: "127.0.0.1", port: options.upstreamPort,
      path: req.url, method: req.method, headers: req.headers }, reply => {
      const headers = { ...reply.headers };
      const csp = headers["content-security-policy"];
      // 'self' does not include WebSocket schemes in every browser. Add
      // only this gateway's allowed origin to the app's connection policy.
      // The emulator's stricter policy has no https: source and stays intact.
      const sources = typeof csp === "string" ? csp.match(/(?:^|;\s*)connect-src\s+([^;]*)/)?.[1].split(/\s+/) : undefined;
      if (sources?.includes("https:")) {
        try {
          const site = new URL(process.env.AUTH_URL ?? `${process.env.NODE_ENV === "production" ? "https" : "http"}://${req.headers.host}`);
          if (site.protocol === "https:" || site.protocol === "http:") {
            site.protocol = site.protocol === "https:" ? "wss:" : "ws:";
            headers["content-security-policy"] = (csp as string).replace(/(^|;\s*)connect-src([^;]*)/, `$1connect-src$2 ${site.origin}`);
          }
        } catch { /* Origin validation also refuses malformed configuration. */ }
      }
      res.writeHead(reply.statusCode ?? 502, headers);
      pipeline(reply, res, () => { /* A truncated upstream closes the downstream too. */ });
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("Please try again shortly"); });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  // Sockets carry bounded invalidations, not unbounded notification history.
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024,
    perMessageDeflate: false, handleProtocols: () => "hh-live" });
  const owners = new Map<WebSocket, { userId: string | null; ip: string; alive: boolean; since: number }>();
  function send(socket: WebSocket, value: unknown) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 16_384) { socket.terminate(); return; }
    socket.send(JSON.stringify(value));
  }
  const invalidate = (userId?: string) => {
    for (const [socket, owner] of owners) if (owner.userId && (!userId || owner.userId === userId)) send(socket, { type: "inbox" });
  };
  const reject = (socket: { end: (data: string) => unknown }, status = 403) => socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\n\r\n`);
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    // Node hands raw socket ownership to this handler, including rejected
    // handshakes. A reset must not become an unhandled process error.
    socket.on("error", () => socket.destroy());
    if (!stopping && options.development && /^\/_next\/hmr(?:\?|$)/.test(req.url ?? "")) {
      const upstream = connect(options.upstreamPort, "127.0.0.1");
      developmentSockets.add(upstream);
      upstream.on("connect", () => {
        let header = `GET ${req.url} HTTP/1.1\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) header += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        upstream.write(`${header}\r\n`); if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on("error", () => socket.destroy());
      upstream.on("close", () => { developmentSockets.delete(upstream); socket.destroy(); });
      socket.on("close", () => upstream.destroy());
      socket.on("error", () => upstream.destroy());
      return;
    }
    if (stopping || req.url !== "/api/live") { reject(socket, 404); return; }
    const origin = req.headers.origin;
    let allowed = false;
    try {
      const parsed = new URL(origin ?? "");
      const configured = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : null;
      // Do not trust a caller-controlled X-Forwarded-Host to grant origins.
      allowed = configured ? parsed.origin === configured
        : parsed.host === req.headers.host && (parsed.protocol === "https:" || (process.env.NODE_ENV !== "production" && parsed.protocol === "http:"));
    } catch { /* Reject malformed or opaque origins. */ }
    const protocols = req.headers["sec-websocket-protocol"]?.split(",").map(part => part.trim()) ?? [];
    const token = protocols.find(part => part.startsWith("ticket."))?.slice(7) ?? "";
    const ticket = verifyLiveTicket(token, options.secret);
    if (!allowed || !protocols.includes("hh-live") || !ticket) { reject(socket); return; }
    const ip = String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "unknown");
    let sameOwner = 0, sameIp = 0;
    for (const owner of owners.values()) {
      if (ticket.userId && owner.userId === ticket.userId) sameOwner++;
      if (owner.ip === ip) sameIp++;
    }
    if (owners.size >= 2000 || sameOwner >= 8 || sameIp >= 40) { reject(socket, 429); return; }
    sockets.handleUpgrade(req, socket, head, ws => {
      owners.set(ws, { userId: ticket.userId, ip, alive: true, since: Date.now() });
      ws.on("pong", () => { const owner = owners.get(ws); if (owner) owner.alive = true; });
      ws.on("message", () => ws.close(1008, "Server events only"));
      ws.on("error", () => ws.terminate());
      ws.on("close", () => owners.delete(ws));
      send(ws, { type: "release", release: options.release });
      if (ticket.userId) send(ws, { type: "inbox" });
    });
  });
  const heartbeat = setInterval(() => {
    for (const [socket, owner] of owners) {
      if (!owner.alive) { socket.terminate(); continue; }
      // Reauthenticate periodically, including a session which expired
      // while a tab stayed open. Fresh tickets come from the HTTP session.
      if (Date.now() - owner.since >= 5 * 60_000) { socket.close(1000, "Renew session"); continue; }
      owner.alive = false; socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  let listener: Client | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 1000;
  async function listen() {
    if (stopping || !options.databaseUrl) return;
    const client = new Client({ connectionString: options.databaseUrl, connectionTimeoutMillis: 5000,
      statement_timeout: 5000, application_name: "hh-live-listener", keepAlive: true });
    listener = client;
    let lost = false;
    const recover = () => {
      if (lost) return;
      lost = true;
      if (listener === client) listener = null;
      void client.end().catch(() => {});
      if (!stopping) {
        console.warn("[live] database listener reconnecting");
        retry = setTimeout(() => { retry = null; void listen(); }, retryDelay + Math.random() * 500);
        retry.unref(); retryDelay = Math.min(30_000, retryDelay * 2);
      }
    };
    client.on("error", recover);
    client.on("end", recover);
    client.on("notification", message => { if (message.channel === "hh_live" && message.payload) invalidate(message.payload); });
    try {
      await client.connect();
      await client.query("LISTEN hh_live");
      if (stopping || lost) { await client.end().catch(() => {}); return; }
      retryDelay = 1000;
      // LISTEN has committed before clients read history. This closes the
      // recovery gap even when their WebSocket connection stayed healthy.
      invalidate();
      console.info("[live] database listener ready");
    } catch (error) { console.warn("[live] database listener unavailable", safeError(error)); recover(); }
  }
  void listen();
  server.listen(options.port, options.host ?? "0.0.0.0");
  return {
    server,
    async close() {
      stopping = true;
      clearInterval(heartbeat);
      if (retry) clearTimeout(retry);
      for (const socket of owners.keys()) socket.terminate();
      for (const socket of developmentSockets) socket.destroy();
      sockets.close();
      if (listener) await listener.end().catch(() => {});
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    },
  };
}
