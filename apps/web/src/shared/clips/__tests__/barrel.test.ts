import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Plan 4.1: the public barrel is safe on every page. It must never reach a
 * worker, mediabunny or WASM through a STATIC import (dynamic imports load
 * later, only when capture is on), and it must import on the server.
 */

const CLIPS_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.resolve(CLIPS_DIR, "../..");
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC = /import\(\s*["']([^"']+)["']\s*\)/g;

function resolveFile(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? path.join(SRC_DIR, specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Files and packages that `entry` reaches through static (value) imports; dynamic ones listed apart. */
function walk(entry: string): { files: Set<string>; packages: Set<string>; dynamic: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const dynamic = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT)) {
      if (match[1]) continue;
      const spec = match[2];
      const resolved = spec.startsWith(".") || spec.startsWith("@/") ? resolveFile(file, spec) : null;
      if (resolved) visit(resolved);
      else packages.add(spec);
    }
    for (const match of source.matchAll(DYNAMIC)) {
      const resolved = resolveFile(file, match[1]);
      dynamic.add(resolved ? path.relative(CLIPS_DIR, resolved) : match[1]);
    }
  };
  visit(entry);
  return { files, packages, dynamic };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("public barrel", () => {
  it("reaches no worker, engine, runtime, mediabunny or WASM code through static imports", () => {
    const { files, packages, dynamic } = walk(path.join(CLIPS_DIR, "index.ts"));
    const rel = [...files].map((f) => path.relative(CLIPS_DIR, f));
    for (const file of rel) {
      expect(file, file).not.toMatch(/^(engine|runtime|sources)\//);
      expect(file, file).not.toMatch(/(workers|engineHost|ClipService|audioTap)\.tsx?$/);
      expect(file, file).not.toMatch(/\.worker\.ts$/);
    }
    for (const pkg of packages) {
      expect(pkg).not.toMatch(/mediabunny|aac-encoder|wasm/i);
    }
    // The heavy parts are still reachable, but only through dynamic imports.
    expect(dynamic).toContain("service/ClipService.ts");
    expect(dynamic).toContain("service/workers.ts");
  });

  it("the walker sees the workers behind the capture engine (a control)", () => {
    const { dynamic, files } = walk(path.join(CLIPS_DIR, "service/engineHost.ts"));
    expect(dynamic).toContain("service/workers.ts");
    expect([...files].some((f) => f.includes(`${path.sep}runtime${path.sep}`))).toBe(true);
  });

  it("imports on the server, where every clip entry point is off", async () => {
    vi.resetModules();
    for (const name of ["window", "document", "navigator", "localStorage", "sessionStorage", "Worker", "requestAnimationFrame"]) {
      vi.stubGlobal(name, undefined);
    }
    const clips = await import("../index");
    expect(clips.getClipService()).toBeNull();
    expect(clips.getClipLibrary()).toBeNull();
    expect(await clips.loadClipsVerdict()).toEqual({ mode: "off", capture: false });
    expect(clips.clipsEnabledFor("breakout")).toBe(false);
    expect(clips.HIDDEN_SNAPSHOT.button).toBe("hidden");
  });
});
