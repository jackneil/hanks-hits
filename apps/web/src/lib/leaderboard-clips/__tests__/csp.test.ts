// @vitest-environment node
/**
 * The CSP side of leaderboard clips: the video and poster routes answer with
 * a 302 to the bucket, and a browser checks the redirect target against
 * media-src and img-src (CSP Level 3, section 7.6). next.config.ts builds
 * the header once, at build time.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RAILWAY_BUCKET_SOURCES,
  clipMediaSources,
  endpointOrigin,
  sourceAllows,
  sourcesAllow,
} from "../csp";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

function parseCsp(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) out.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return out;
}

/** next.config.ts loaded fresh, with LEADERBOARD_CLIPS_S3_ENDPOINT as the build saw it. */
async function loadConfig(endpoint: string | undefined) {
  vi.resetModules();
  if (endpoint === undefined) vi.stubEnv("LEADERBOARD_CLIPS_S3_ENDPOINT", "");
  else vi.stubEnv("LEADERBOARD_CLIPS_S3_ENDPOINT", endpoint);
  const config = (await import("../../../../next.config")).default;
  const rules = (await config.headers!()) as HeaderRule[];
  const catchAll = rules.find((rule) => rule.source === "/:path*")!;
  const csp = catchAll.headers.find((header) => header.key === "Content-Security-Policy")!.value;
  return { csp: parseCsp(csp), env: config.env ?? {} };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the site CSP (next.config.ts)", () => {
  it("lets media and images load from both Railway bucket URL styles", async () => {
    const { csp, env } = await loadConfig(undefined);
    for (const directive of ["media-src", "img-src"]) {
      const sources = csp.get(directive)!;
      for (const host of RAILWAY_BUCKET_SOURCES) expect(sources, directive).toContain(host);
    }
    // The old sources stay.
    expect(csp.get("media-src")).toEqual(expect.arrayContaining(["'self'", "blob:"]));
    expect(csp.get("img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "https:", "blob:"]));
    // The build tells the server what it allowed.
    expect(env.LEADERBOARD_CLIPS_CSP_MEDIA_SOURCES).toBe(RAILWAY_BUCKET_SOURCES.join(" "));
  });

  it("adds the endpoint origin that the build sees (another provider, or a local MinIO)", async () => {
    const { csp, env } = await loadConfig("http://127.0.0.1:9100");
    expect(csp.get("media-src")).toContain("http://127.0.0.1:9100");
    expect(csp.get("img-src")).toContain("http://127.0.0.1:9100");
    expect(env.LEADERBOARD_CLIPS_CSP_MEDIA_SOURCES).toContain("http://127.0.0.1:9100");
  });

  it("does not add a Railway endpoint twice", async () => {
    const { csp } = await loadConfig("https://t3.storageapi.dev");
    expect(csp.get("media-src")!.filter((source) => source === "https://t3.storageapi.dev")).toHaveLength(1);
  });

  it("never lets the emulator page load bucket media (its own CSP is unchanged)", async () => {
    vi.resetModules();
    const config = (await import("../../../../next.config")).default;
    const rules = (await config.headers!()) as HeaderRule[];
    const emulator = rules.find((rule) => rule.source === "/emulator/:path*")!;
    const csp = parseCsp(emulator.headers.find((header) => header.key === "Content-Security-Policy")!.value);
    expect(csp.get("media-src")).toEqual(["'self'", "blob:"]);
  });
});

describe("endpointOrigin", () => {
  it.each([
    ["https://t3.storageapi.dev", "https://t3.storageapi.dev"],
    ["https://t3.storageapi.dev/", "https://t3.storageapi.dev"],
    ["t3.storageapi.dev", "https://t3.storageapi.dev"],
    ["http://localhost:9000", "http://localhost:9000"],
    ["http://127.0.0.1:9100", "http://127.0.0.1:9100"],
  ])("%s -> %s", (input, origin) => {
    expect(endpointOrigin(input)).toBe(origin);
  });

  it.each(["", "http://t3.storageapi.dev", "https://x/y", "https://u:p@x.dev", "ftp://x.dev", "https://x.dev/?a=1", "not a url ::"])(
    "rejects %j",
    (input) => {
      expect(endpointOrigin(input)).toBeNull();
    }
  );
});

describe("sourceAllows (the CSP host-source rules the list uses)", () => {
  it("matches a wildcard only for a subdomain", () => {
    expect(sourceAllows("https://*.t3.storageapi.dev", "https://b.t3.storageapi.dev")).toBe(true);
    expect(sourceAllows("https://*.t3.storageapi.dev", "https://t3.storageapi.dev")).toBe(false);
    expect(sourceAllows("https://*.t3.storageapi.dev", "https://evil-t3.storageapi.dev")).toBe(false);
  });

  it("matches scheme and port", () => {
    expect(sourceAllows("https://t3.storageapi.dev", "http://t3.storageapi.dev")).toBe(false);
    expect(sourceAllows("https://t3.storageapi.dev", "https://t3.storageapi.dev:443")).toBe(true);
    expect(sourceAllows("http://127.0.0.1:9100", "http://127.0.0.1:9100")).toBe(true);
    expect(sourceAllows("http://127.0.0.1:9100", "http://127.0.0.1:9000")).toBe(false);
  });

  it("clipMediaSources adds a new origin once", () => {
    expect(clipMediaSources(undefined)).toEqual([...RAILWAY_BUCKET_SOURCES]);
    expect(clipMediaSources("https://r2.example.com")).toEqual([...RAILWAY_BUCKET_SOURCES, "https://r2.example.com"]);
    expect(sourcesAllow(clipMediaSources(undefined), "https://anything.t3.storageapi.dev")).toBe(true);
  });
});
