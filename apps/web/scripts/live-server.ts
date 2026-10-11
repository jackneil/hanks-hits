import { fork } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import path from "node:path";
import fs from "node:fs";
import { startGateway } from "./live/gateway";

// Reserve a private ephemeral port; the public port belongs to the gateway.
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const address = reservation.address();
if (!address || typeof address === "string") throw new Error("Private port unavailable");
const upstreamPort = address.port;
await new Promise<void>(resolve => reservation.close(() => resolve()));
const development = process.argv.includes("--dev");
const release = JSON.parse(fs.readFileSync(path.resolve(".release.json"), "utf8"));
const child = fork(development ? "node_modules/next/dist/bin/next" : "server.js",
  development ? ["dev", "--hostname", "127.0.0.1", "--port", String(upstreamPort)] : [],
  { env: { ...process.env, PORT: String(upstreamPort), HOSTNAME: "127.0.0.1" }, stdio: "inherit",
    execArgv: ["--import", path.resolve(development ? "dist/live-child-watch.mjs" : "live-child-watch.mjs")] });
const gateway = startGateway({ port: Number(process.env.PORT || 3000), upstreamPort,
  secret: process.env.AUTH_SECRET || "", databaseUrl: process.env.DATABASE_URL, release, development });
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => { child.kill("SIGKILL"); process.exit(code); }, 8000);
  force.unref();
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, "exit");
  child.kill("SIGTERM");
  await Promise.allSettled([gateway.close(), exited]);
  clearTimeout(force); process.exit(code);
}
child.on("exit", code => { void stop(code ?? 1); });
child.on("error", () => { console.error("[live] web child unavailable"); void stop(1); });
process.on("SIGTERM", () => { void stop(0); });
process.on("SIGINT", () => { void stop(0); });
gateway.server.on("error", () => { console.error("[live] public listener unavailable"); void stop(1); });
process.on("exit", () => { child.kill("SIGTERM"); });
console.info(`[live] gateway started pid=${process.pid} child=${child.pid} port=${process.env.PORT || 3000}`);
