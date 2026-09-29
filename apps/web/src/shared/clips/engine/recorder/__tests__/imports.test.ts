// @vitest-environment node
/**
 * A device loads only the engine it uses (loadEngine.ts, plan 5): the
 * MediaRecorder engine of tiers M and V must not reach the WebCodecs engine
 * host (its frame pump, audio tap and encode worker glue) through a static
 * import, and the WebCodecs engine must not reach the MediaRecorder engine.
 * The engine switch reaches each engine only through a dynamic import.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLIPS_DIR = path.resolve(__dirname, "../../..");
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

/** The files (relative to shared/clips) that `entry` reaches through static value imports, and its dynamic imports. */
function walk(entry: string): { files: string[]; dynamic: string[] } {
  const files = new Set<string>();
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
    }
    for (const match of source.matchAll(DYNAMIC)) {
      const resolved = resolveFile(file, match[1]);
      if (resolved) dynamic.add(path.relative(CLIPS_DIR, resolved));
    }
  };
  visit(entry);
  return { files: [...files].map((f) => path.relative(CLIPS_DIR, f)), dynamic: [...dynamic] };
}

describe("engine chunks", () => {
  it("the MediaRecorder engine reaches no WebCodecs engine code", () => {
    const { files } = walk(path.join(CLIPS_DIR, "engine/recorder/recorderEngine.ts"));
    expect(files).toContain("service/engineShared.ts");
    for (const heavy of ["service/engineHost.ts", "runtime/framePump.ts", "service/audioTap.ts", "service/workers.ts", "engine/encode/videoSession.ts"]) {
      expect(files, heavy).not.toContain(heavy);
    }
    // No mediabunny on the main thread: the io worker reads and joins the files.
    for (const file of files) expect(readFileSync(path.join(CLIPS_DIR, file), "utf8"), file).not.toMatch(/from\s+["']mediabunny["']/);
  });

  it("the WebCodecs engine reaches no MediaRecorder engine code", () => {
    const { files } = walk(path.join(CLIPS_DIR, "service/engineHost.ts"));
    expect(files).toContain("service/engineShared.ts");
    expect(files.filter((f) => f.startsWith("engine/recorder/"))).toEqual([]);
  });

  it("the engine switch reaches each engine only through a dynamic import", () => {
    const { files, dynamic } = walk(path.join(CLIPS_DIR, "service/loadEngine.ts"));
    expect(files).not.toContain("service/engineHost.ts");
    expect(files).not.toContain("engine/recorder/recorderEngine.ts");
    expect(dynamic).toEqual(expect.arrayContaining(["service/engineHost.ts", "engine/recorder/recorderEngine.ts"]));
  });
});
