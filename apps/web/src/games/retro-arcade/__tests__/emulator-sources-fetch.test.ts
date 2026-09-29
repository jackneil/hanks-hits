import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The Docker build runs scripts/emulatorjs-sources.mjs --fetch --sources to
 * get the source code of EmulatorJS and its cores. The site must not go live
 * without it, so the script must stop the build (exit code 1, with the name
 * of the file) when it cannot get the correct bytes. These tests run the real
 * script against a local HTTP server.
 */
const WEB_ROOT = join(__dirname, "..", "..", "..", "..");
const SCRIPT = join(WEB_ROOT, "scripts", "emulatorjs-sources.mjs");
const VERSION = "9.9.9";

const GOOD = Buffer.from("the source code of a core\n".repeat(200));
const GOOD_SHA = createHash("sha256").update(GOOD).digest("hex");

/** Requests per path, and what each path sends. */
const hits = new Map<string, number>();
let server: Server;
let base = "";
let work = "";

function route(path: string, count: number): { status: number; body: Buffer } {
  switch (path) {
    case "/good.bin":
      return { status: 200, body: GOOD };
    case "/flaky.bin":
      // Fails two times, then sends the file.
      return count <= 2 ? { status: 503, body: Buffer.from("busy") } : { status: 200, body: GOOD };
    case "/wrong.bin":
      return { status: 200, body: Buffer.from("not the source code") };
    default:
      return { status: 404, body: Buffer.from("not found") };
  }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    const count = (hits.get(path) ?? 0) + 1;
    hits.set(path, count);
    const { status, body } = route(path, count);
    res.writeHead(status, { "Content-Length": body.length });
    res.end(body);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  work = mkdtempSync(join(tmpdir(), "ejs-fetch-test-"));
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(work, { recursive: true, force: true });
});

interface Entry {
  id: string;
  path: string;
  from: { url: string };
  mirrors?: { url: string }[];
  bytes: number;
  sha256: string;
}

let caseNumber = 0;

/** Runs the script with --fetch --sources for these entries. The HTTP server keeps running. */
function runFetch(sources: Entry[], prepare?: (out: string) => void) {
  const dir = join(work, `case-${caseNumber++}`);
  const out = join(dir, "out");
  mkdirSync(out, { recursive: true });
  const manifest = join(dir, "manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify({ name: "EmulatorJS", version: VERSION, release: { asset: `${base}/asset.7z`, sha256: "0".repeat(64) }, sources })
  );
  prepare?.(out);
  hits.clear();
  // spawn, not spawnSync: the HTTP server in this process must keep answering.
  return new Promise<{ code: number | null; output: string; out: string }>((done) => {
    const child = spawn(process.execPath, [SCRIPT, VERSION, "--fetch", "--sources", "--manifest", manifest, "--out", out], {
      env: { ...process.env, EMULATORJS_SOURCES_RETRY_DELAY_MS: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => done({ code, output, out }));
  });
}

const entry = (id: string, url: string, extra: Partial<Entry> = {}): Entry => ({
  id,
  path: `source/${id}.tar.gz`,
  from: { url },
  bytes: GOOD.length,
  sha256: GOOD_SHA,
  ...extra,
});

describe("emulatorjs-sources.mjs --fetch --sources", () => {
  it("writes each archive after it checks the SHA-256", async () => {
    const run = await runFetch([entry("good", `${base}/good.bin`)]);
    expect(run.code, run.output).toBe(0);
    expect(readFileSync(join(run.out, "source", "good.tar.gz")).equals(GOOD)).toBe(true);
    expect(readdirSync(join(run.out, "source"))).toEqual(["good.tar.gz"]);
  });

  it("tries a failed download again", async () => {
    const run = await runFetch([entry("flaky", `${base}/flaky.bin`)]);
    expect(run.code, run.output).toBe(0);
    expect(hits.get("/flaky.bin")).toBe(3);
    expect(run.output).toContain("try 1 failed (HTTP 503)");
    expect(readFileSync(join(run.out, "source", "flaky.tar.gz")).equals(GOOD)).toBe(true);
  });

  it("stops the build and names the archive when the bytes are wrong", async () => {
    const run = await runFetch([entry("wrong", `${base}/wrong.bin`)]);
    expect(run.code).toBe(1);
    expect(run.output).toContain('could not get source/wrong.tar.gz (source "wrong")');
    expect(run.output).toMatch(/bytes, the manifest says|SHA-256/);
    expect(run.output).toContain("must not send the emulator files without their source code");
    // 4 tries, and no file in the output folder.
    expect(hits.get("/wrong.bin")).toBe(4);
    expect(existsSync(join(run.out, "source", "wrong.tar.gz"))).toBe(false);
  });

  it("stops the build when the host is down", async () => {
    const run = await runFetch([entry("down", "http://127.0.0.1:9/down.bin")]);
    expect(run.code).toBe(1);
    expect(run.output).toContain("could not get source/down.tar.gz");
    expect(run.output.match(/down\.bin, try \d/g)).toHaveLength(4);
  });

  it("stops the build when one archive of many fails, and names it", async () => {
    const run = await runFetch([entry("ok", `${base}/good.bin`), entry("missing", `${base}/missing.bin`)]);
    expect(run.code).toBe(1);
    expect(run.output).toContain("could not get source/missing.tar.gz");
    expect(run.output).toContain("HTTP 404");
  });

  it("uses the next place when a mirror fails", async () => {
    const run = await runFetch([entry("mirrored", `${base}/good.bin`, { mirrors: [{ url: `${base}/missing.bin` }] })]);
    expect(run.code, run.output).toBe(0);
    expect(hits.get("/missing.bin")).toBe(4);
    expect(hits.get("/good.bin")).toBe(1);
  });

  it("keeps a correct archive and does not download it again", async () => {
    const run = await runFetch([entry("kept", `${base}/good.bin`)], (out) => {
      mkdirSync(join(out, "source"));
      writeFileSync(join(out, "source", "kept.tar.gz"), GOOD);
    });
    expect(run.code, run.output).toBe(0);
    expect(run.output).toContain("OK source/kept.tar.gz (already there)");
    expect(hits.size).toBe(0);
  });

  it("replaces a wrong archive with a checked one", async () => {
    const run = await runFetch([entry("stale", `${base}/good.bin`)], (out) => {
      mkdirSync(join(out, "source"));
      writeFileSync(join(out, "source", "stale.tar.gz"), "old bytes");
    });
    expect(run.code, run.output).toBe(0);
    expect(readFileSync(join(run.out, "source", "stale.tar.gz")).equals(GOOD)).toBe(true);
  });
});
