// Node file checks (fs and crypto). It runs in the default jsdom environment
// because src/__tests__/setup.ts on this branch needs a window.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

import { SYSTEMS } from "../lib/constants";

/**
 * The site serves its own copy of EmulatorJS from public/emulator/ejs/<version>/
 * (clips security review, finding sec15). manifest.json in that folder records
 * the source URL, the size and the SHA-256 of each file. This test re-hashes
 * the files, so a changed, missing or extra file fails the gate. It also
 * checks that every core that EmulatorJS can pick for a Retro Arcade console
 * is in the folder. When a core is missing, EmulatorJS tries to download it
 * from its CDN (the emulator CSP blocks that, and the game does not start).
 *
 * To change the version, see scripts/vendor-emulatorjs.mjs.
 */
const PINNED_EMULATORJS_VERSION = "4.2.3";
const RELEASE_ASSET = `https://github.com/EmulatorJS/EmulatorJS/releases/download/v${PINNED_EMULATORJS_VERSION}/${PINNED_EMULATORJS_VERSION}.7z`;

const WEB_ROOT = join(__dirname, "..", "..", "..", "..");
const EJS_DIR = join(WEB_ROOT, "public", "emulator", "ejs", PINNED_EMULATORJS_VERSION);
const EMULATOR_PAGE = join(WEB_ROOT, "public", "emulator", "index.html");

interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  source: string;
}

interface Manifest {
  name: string;
  version: string;
  license: string;
  licenseFile: string;
  sourceCode: string;
  release: { url: string; asset: string; bytes: number; sha256: string };
  cores: Record<string, { systems: string[]; license: string; source: string }>;
  files: ManifestFile[];
}

const manifest = JSON.parse(readFileSync(join(EJS_DIR, "manifest.json"), "utf8")) as Manifest;
const manifestPaths = new Set(manifest.files.map((f) => f.path));

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Returns why a file does not match its manifest entry, or null. */
function entryProblem(entry: ManifestFile, data: Buffer): string | null {
  if (data.length !== entry.bytes) return `${entry.path}: ${data.length} bytes, manifest says ${entry.bytes}`;
  const actual = sha256(data);
  if (actual !== entry.sha256) return `${entry.path}: SHA-256 ${actual}, manifest says ${entry.sha256}`;
  return null;
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else out.push(relative(EJS_DIR, full).split(sep).join("/"));
  }
  return out;
}

/** Reads the system-to-cores table from getCores() in the shipped bundle. */
function coreTable(bundle: string): Record<string, string[]> {
  const match = /getCores\(\)\{let [A-Za-z_$][\w$]*=(\{[^}]*\})/.exec(bundle);
  if (!match) throw new Error("getCores() table not found in emulator.min.js");
  return JSON.parse(match[1].replace(/([{,])([A-Za-z_$][\w$]*):/g, '$1"$2":'));
}

describe("self-hosted EmulatorJS files", () => {
  it("come from the official release of the pinned version", () => {
    expect(manifest.name).toBe("EmulatorJS");
    expect(manifest.version).toBe(PINNED_EMULATORJS_VERSION);
    expect(manifest.release.asset).toBe(RELEASE_ASSET);
    expect(manifest.release.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sourceCode).toBe(
      `https://github.com/EmulatorJS/EmulatorJS/tree/v${PINNED_EMULATORJS_VERSION}`
    );
    for (const file of manifest.files) {
      expect(file.source, file.path).toMatch(new RegExp(`^${RELEASE_ASSET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#`));
      expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("match the size and the SHA-256 in the manifest", () => {
    const problems: string[] = [];
    for (const entry of manifest.files) {
      const full = join(EJS_DIR, entry.path);
      if (isAbsolute(entry.path) || normalize(entry.path).startsWith("..")) {
        problems.push(`${entry.path}: path leaves the folder`);
      } else if (!existsSync(full)) {
        problems.push(`${entry.path}: missing`);
      } else {
        const problem = entryProblem(entry, readFileSync(full));
        if (problem) problems.push(problem);
      }
    }
    expect(problems).toEqual([]);
  });

  it("are the only files in the folder", () => {
    const onDisk = listFiles(EJS_DIR).filter((p) => p !== "manifest.json").sort();
    expect(onDisk).toEqual([...manifestPaths].sort());
  });

  it("detect a changed file (guards the hash check)", () => {
    const entry = manifest.files.find((f) => f.path === "loader.js")!;
    const data = readFileSync(join(EJS_DIR, entry.path));
    expect(entryProblem(entry, data)).toBeNull();
    const changed = Buffer.from(data);
    changed[0] ^= 0xff;
    expect(entryProblem(entry, changed)).toMatch(/SHA-256/);
  });

  it("hold the loader, the bundle, its CSS, the decompression helpers and the license", () => {
    for (const path of [
      "loader.js",
      "emulator.min.js",
      "emulator.min.css",
      "compression/extract7z.js",
      "compression/extractzip.js",
      "compression/libunrar.js",
      "compression/libunrar.wasm",
      "localization/en-US.json",
      "LICENSE",
    ]) {
      expect(manifestPaths.has(path), path).toBe(true);
    }
    expect(manifest.license).toBe("GPL-3.0");
    const license = readFileSync(join(EJS_DIR, manifest.licenseFile), "utf8");
    expect(license).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(license).toContain("Version 3");
  });

  it("hold a bundle of the pinned version", () => {
    const bundle = readFileSync(join(EJS_DIR, "emulator.min.js"), "utf8");
    expect(/ejs_version="([^"]+)"/.exec(bundle)?.[1]).toBe(PINNED_EMULATORJS_VERSION);
  });

  it("hold every core that EmulatorJS can pick for a Retro Arcade console", () => {
    const table = coreTable(readFileSync(join(EJS_DIR, "emulator.min.js"), "utf8"));
    const missing: string[] = [];
    for (const system of new Set(Object.values(SYSTEMS).map((s) => s.ejsCore))) {
      const cores = table[system];
      if (!cores) {
        missing.push(`EmulatorJS has no cores for ${system}`);
        continue;
      }
      // Every core in the list: the kid can pick another core in the
      // EmulatorJS settings, and iPhone Safari reverses the N64 order.
      for (const core of cores) {
        // The WebGL 2 build and the legacy (WebGL 1) build, and the report
        // that EmulatorJS reads first to pick one of them.
        for (const path of [`cores/${core}-wasm.data`, `cores/${core}-legacy-wasm.data`, `cores/reports/${core}.json`]) {
          if (!manifestPaths.has(path)) missing.push(`${system}: ${path}`);
        }
        const info = manifest.cores[core];
        if (!info) missing.push(`${system}: no license entry for core ${core}`);
        else {
          expect(info.systems, core).toContain(system);
          expect(info.license, core).not.toBe("");
          expect(info.source, core).toMatch(/^https:\/\/github\.com\//);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("are enough because the page never asks for the thread cores", () => {
    // The -thread- core builds are not hosted. EmulatorJS uses them only
    // when EJS_threads is set and SharedArrayBuffer exists.
    const page = readFileSync(EMULATOR_PAGE, "utf8");
    expect(page).not.toMatch(/EJS_threads/);
    for (const path of manifestPaths) expect(path).not.toMatch(/-thread-/);
  });
});
