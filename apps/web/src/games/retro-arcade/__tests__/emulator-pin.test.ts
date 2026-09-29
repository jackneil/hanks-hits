import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import nextConfig from "../../../../next.config";
import { SYSTEMS } from "../lib/constants";

/**
 * EmulatorJS is pinned to one version and served from this site (issues #22
 * and the clips security review). The emulator page runs in the same origin
 * as the clip library (IndexedDB hh-clips, OPFS lib/), so a script from a
 * third-party CDN there could read every clip on the device. The page must
 * load EmulatorJS only from /emulator/ejs/<version>/, and its CSP must not
 * let EmulatorJS fetch code from its CDN.
 *
 * To change the version: run apps/web/scripts/vendor-emulatorjs.mjs, change
 * the paths in public/emulator/index.html and PINNED_EMULATORJS_VERSION here
 * and in emulator-selfhost.test.ts, and the paths in emulator-page.test.ts, in
 * the same pull request. Then play a game on each console.
 */
const PINNED_EMULATORJS_VERSION = "4.2.3";
const SELF_HOSTED_BASE = `/emulator/ejs/${PINNED_EMULATORJS_VERSION}/`;

const WEB_ROOT = join(__dirname, "..", "..", "..", "..");
const EMULATOR_PAGE = join(WEB_ROOT, "public", "emulator", "index.html");
const VENDORED_ROOT = join(WEB_ROOT, "public", "emulator", "ejs");
const SCAN_ROOTS = [join(WEB_ROOT, "src"), join(WEB_ROOT, "public")];
const SCAN_FILES = [join(WEB_ROOT, "next.config.ts")];
const SCAN_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|html|json)$/;

// Any reference to the EmulatorJS CDN: a URL with a path or a bare CSP source.
const CDN_HOST = /cdn\.emulatorjs\.org/;

// Third-party script hosts that the emulator page may load. Cloudflare serves
// the whole site, so its analytics host is not a new party.
const ALLOWED_SCRIPT_HOSTS = ["https://static.cloudflareinsights.com"];

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    // The vendored release files contain the CDN URLs of EmulatorJS's own
    // update check and core fallback. The CSP tests below block those
    // requests, and emulator-selfhost.test.ts checks the files by SHA-256.
    if (full === VENDORED_ROOT) continue;
    if (statSync(full).isDirectory()) collectFiles(full, out);
    else if (SCAN_EXTENSIONS.test(entry)) out.push(full);
  }
  return out;
}

/** Parses a CSP string into directive name -> sources. */
function parseCsp(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    out.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return out;
}

function metaCsp(page: string): string {
  const match = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(page);
  if (!match) throw new Error("the emulator page has no meta CSP");
  return match[1];
}

async function headerCsp(): Promise<string> {
  if (!nextConfig.headers) throw new Error("next.config.ts has no headers() function");
  const rules = (await nextConfig.headers()) as { source: string; headers: { key: string; value: string }[] }[];
  const rule = rules.find((r) => r.source === "/emulator/:path*");
  const csp = rule?.headers.find((h) => h.key.toLowerCase() === "content-security-policy")?.value;
  if (!csp) throw new Error("the /emulator header rule sets no CSP");
  return csp;
}

/** Sources that are not a keyword, a scheme or this site. */
function hostSources(sources: string[]): string[] {
  return sources.filter((s) => !s.startsWith("'") && !/^[a-z][a-z0-9+.-]*:$/.test(s));
}

function checkEmulatorCsp(label: string, csp: string) {
  const policy = parseCsp(csp);
  expect(csp, `${label}: names the EmulatorJS CDN`).not.toMatch(CDN_HOST);

  // EmulatorJS downloads a missing core from cdn.emulatorjs.org with XHR and
  // runs it from a blob: URL. Only connect-src can stop that, so it must not
  // allow any https: host.
  expect(policy.get("connect-src"), `${label}: connect-src`).toEqual(["'self'", "blob:"]);

  for (const directive of ["script-src", "style-src", "font-src", "worker-src", "default-src"]) {
    const sources = policy.get(directive) ?? [];
    expect(sources, `${label}: ${directive} allows every https: host`).not.toContain("https:");
    const allowed = directive === "script-src" ? ALLOWED_SCRIPT_HOSTS : [];
    for (const host of hostSources(sources)) {
      expect(allowed, `${label}: ${directive} allows the third-party host ${host}`).toContain(host);
    }
  }
}

describe("EmulatorJS is self-hosted at the pinned version", () => {
  const page = readFileSync(EMULATOR_PAGE, "utf8");

  it("loads the data folder and the loader from this site", () => {
    expect(page).toContain(`window.EJS_pathtodata = '${SELF_HOSTED_BASE}';`);
    expect(page).toContain(`script.src = '${SELF_HOSTED_BASE}loader.js';`);
  });

  it("has no EmulatorJS CDN reference anywhere in the web app", () => {
    const offenders: string[] = [];
    for (const file of [...SCAN_ROOTS.flatMap((root) => collectFiles(root)), ...SCAN_FILES]) {
      if (CDN_HOST.test(readFileSync(file, "utf8"))) offenders.push(relative(WEB_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it("gives the emulator page a meta CSP that blocks the EmulatorJS CDN", () => {
    checkEmulatorCsp("meta CSP", metaCsp(page));
  });

  it("sends a /emulator CSP header that blocks the EmulatorJS CDN", async () => {
    checkEmulatorCsp("header CSP", await headerCsp());
  });

  it("keeps the meta CSP and the header CSP the same", async () => {
    const meta = parseCsp(metaCsp(page));
    const header = parseCsp(await headerCsp());
    // frame-ancestors has no effect in a meta CSP, so only the header has it.
    header.delete("frame-ancestors");
    const sorted = (m: Map<string, string[]>) =>
      Object.fromEntries([...m.entries()].map(([k, v]) => [k, [...v].sort()]).sort());
    expect(sorted(meta)).toEqual(sorted(header));
  });

  it("lets browsers keep the versioned EmulatorJS files", async () => {
    // The CDN sent max-age=432000. The self-hosted files must not be slower:
    // their path holds the version and their bytes never change.
    const rules = (await nextConfig.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
    const rule = rules.find((r) => r.source === "/emulator/ejs/:path*");
    const cacheControl = rule?.headers.find((h) => h.key.toLowerCase() === "cache-control")?.value;
    expect(cacheControl).toBe("public, max-age=31536000, immutable");
    expect(page).toContain(`'/emulator/ejs/${PINNED_EMULATORJS_VERSION}/'`);
  });

  it("accepts only the systems that Retro Arcade offers", () => {
    // The top-level keys of SYSTEM_CONFIG are the consoles that the page
    // accepts. emulator-page.test.ts checks the core of each one.
    const match = /const SYSTEM_CONFIG = \{\n([\s\S]*?)\n {4}\};/.exec(page);
    expect(match, "the emulator page has no SYSTEM_CONFIG table").not.toBeNull();
    const pageSystems = [...match![1].matchAll(/^ {6}(\w+): \{/gm)].map((m) => m[1]).sort();
    expect(pageSystems).toEqual(Object.keys(SYSTEMS).sort());
  });

  it("flags a CDN URL and an https: connect-src (guards the checks above)", () => {
    expect("https://cdn.emulatorjs.org/stable/data/loader.js").toMatch(CDN_HOST);
    expect(() => checkEmulatorCsp("old", "default-src 'self'; connect-src 'self' https: blob:")).toThrow();
    expect(() =>
      checkEmulatorCsp("old", "default-src 'self'; connect-src 'self' blob:; script-src 'self' https://cdn.emulatorjs.org")
    ).toThrow();
  });
});
