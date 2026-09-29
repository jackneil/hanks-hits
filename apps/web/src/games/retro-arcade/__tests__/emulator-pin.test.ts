import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * EmulatorJS is pinned to one version (issue #22). The "stable", "latest"
 * and "nightly" CDN paths change when EmulatorJS makes a release, so the
 * emulator could change on the site with no review from us. Later work
 * (clips, audio, pause) reads EmulatorJS internals, so an unreviewed update
 * can break Retro Arcade without an error.
 *
 * To change the version: change the URLs in public/emulator/index.html and
 * PINNED_EMULATORJS_VERSION below in the same pull request, then play a
 * game on each console.
 */
const PINNED_EMULATORJS_VERSION = "4.2.3";
const PINNED_BASE = `https://cdn.emulatorjs.org/${PINNED_EMULATORJS_VERSION}/data/`;

const WEB_ROOT = join(__dirname, "..", "..", "..", "..");
const EMULATOR_PAGE = join(WEB_ROOT, "public", "emulator", "index.html");
// The vendored EmulatorJS release (public/emulator/ejs/). Its bundle holds
// the CDN URLs of EmulatorJS's own update check and core fallback.
// emulator-selfhost.test.ts checks these files by SHA-256 instead.
const VENDORED_ROOT = join(WEB_ROOT, "public", "emulator", "ejs");
const SCAN_ROOTS = [join(WEB_ROOT, "src"), join(WEB_ROOT, "public")];
const SCAN_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|html|json)$/;

// Any URL on the EmulatorJS CDN. A bare origin (no path) is a CSP source
// and loads nothing by itself, so only URLs with a path must be pinned.
const CDN_URL = /https?:\/\/cdn\.emulatorjs\.org(\/[^\s'"`)<>;,]*)?/g;
const PINNED_PATH = /^\/(\d+\.\d+\.\d+)\/data\//;

function cdnUrlsWithPath(text: string): string[] {
  return [...text.matchAll(CDN_URL)].filter((m) => m[1] && m[1] !== "/").map((m) => m[0]);
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (full === VENDORED_ROOT) continue;
    if (statSync(full).isDirectory()) collectFiles(full, out);
    else if (SCAN_EXTENSIONS.test(entry)) out.push(full);
  }
  return out;
}

describe("EmulatorJS version pin", () => {
  const page = readFileSync(EMULATOR_PAGE, "utf8");

  it("loads the data folder and the loader from the pinned version", () => {
    expect(page).toContain(`window.EJS_pathtodata = '${PINNED_BASE}';`);
    expect(page).toContain(`script.src = '${PINNED_BASE}loader.js';`);
  });

  it("uses only pinned EmulatorJS URLs on the emulator page", () => {
    const urls = cdnUrlsWithPath(page);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) {
      expect(url.startsWith(PINNED_BASE), `${url} is not pinned to ${PINNED_EMULATORJS_VERSION}`).toBe(
        true
      );
    }
  });

  it("has no floating or other-version EmulatorJS URL anywhere in the web app", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of collectFiles(root)) {
        for (const url of cdnUrlsWithPath(readFileSync(file, "utf8"))) {
          const path = url.replace(/^https?:\/\/cdn\.emulatorjs\.org/, "");
          const version = PINNED_PATH.exec(path)?.[1];
          if (!url.startsWith("https://") || version !== PINNED_EMULATORJS_VERSION) {
            offenders.push(`${relative(WEB_ROOT, file)}: ${url}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("flags the floating paths that issue #22 removed", () => {
    // Guards the scan itself: a URL shape that must fail does fail.
    for (const floating of ["stable", "latest", "nightly"]) {
      const url = `https://cdn.emulatorjs.org/${floating}/data/loader.js`;
      const [found] = cdnUrlsWithPath(`script.src = '${url}';`);
      expect(found).toBe(url);
      expect(PINNED_PATH.test(found.replace("https://cdn.emulatorjs.org", ""))).toBe(false);
    }
  });
});
