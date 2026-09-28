// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ClipRecord } from "../../protocol";
import {
  LIBRARY_CHANNEL,
  LIBRARY_LOCK,
  clipFileName,
  downloadName,
  extensionFor,
  isStoredMime,
  parseClipFileName,
} from "../shared";

describe("library names", () => {
  it("keeps the lock and channel names of plan 8.1", () => {
    expect(LIBRARY_LOCK).toBe("hh-clips-lib");
    expect(LIBRARY_CHANNEL).toBe("hh-clips");
  });

  it("names stored files by mime type and reads the names back", () => {
    expect(extensionFor("video/mp4")).toBe("mp4");
    expect(extensionFor("video/webm")).toBe("webm");
    expect(extensionFor("image/png")).toBe("png");
    expect(clipFileName("abc", "video/webm")).toBe("abc.webm");
    expect(parseClipFileName("abc.mp4")).toEqual({ id: "abc", mime: "video/mp4" });
    expect(parseClipFileName("abc.webm")).toEqual({ id: "abc", mime: "video/webm" });
    expect(parseClipFileName("pic_1.png")).toEqual({ id: "pic_1", mime: "image/png" });
  });

  it("ignores files that are not clips", () => {
    for (const name of ["notes.txt", "abc.mp4.part", ".mp4", "a b.mp4", "abc.MP4", ".space-probe", "x".repeat(65) + ".mp4"]) {
      expect(parseClipFileName(name)).toBeNull();
    }
  });

  it("knows which mime types the library stores", () => {
    expect(isStoredMime("video/mp4")).toBe(true);
    expect(isStoredMime("image/png")).toBe(true);
    expect(isStoredMime("video/quicktime")).toBe(false);
    expect(isStoredMime("toString")).toBe(false);
    expect(isStoredMime(undefined)).toBe(false);
  });

  it("downloadName uses the game id, the kind and the local date, with safe characters only", () => {
    const record = {
      id: "a",
      ownerKey: "guest",
      gameId: "../Monster Truck!!",
      kind: "record",
      createdAt: new Date(2026, 0, 5).getTime(),
      mime: "video/mp4",
    } as ClipRecord;
    expect(downloadName(record)).toBe("monster-truck-record-2026-01-05.mp4");
    expect(downloadName({ ...record, gameId: "", mime: "image/png", kind: "picture" })).toBe("game-picture-2026-01-05.png");
    expect(downloadName({ ...record, mime: "video/webm", createdAt: Number.NaN })).toBe("monster-truck-record-clip.webm");
  });
});

/**
 * Plan 4: mediabunny must never reach the main bundle. The UI imports the library
 * names from shared.ts (and the small pure modules). This guard walks their real
 * imports and fails when any of them reaches a package.
 */
describe("main-thread imports", () => {
  const libraryDir = path.resolve(__dirname, "..");
  const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g;
  const DYNAMIC = /import\(\s*["']([^"']+)["']\s*\)/g;

  function resolveFile(from: string, specifier: string): string {
    const base = path.resolve(path.dirname(from), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`cannot resolve "${specifier}" from ${from}`);
  }

  /** Every package that a module reaches at run time, through relative imports. */
  function packagesReachedFrom(entry: string): Set<string> {
    const packages = new Set<string>();
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      const specifiers: string[] = [];
      for (const match of source.matchAll(IMPORT)) if (!match[1]) specifiers.push(match[2]);
      for (const match of source.matchAll(DYNAMIC)) specifiers.push(match[1]);
      for (const specifier of specifiers) {
        if (specifier.startsWith(".")) visit(resolveFile(file, specifier));
        else packages.add(specifier);
      }
    };
    visit(entry);
    return packages;
  }

  it.each(["shared.ts", "ownerKey.ts", "eviction.ts", "errors.ts", "budget.ts", "patch.ts", "db.ts"])(
    "%s reaches no package (so no mediabunny)",
    (file) => {
      expect([...packagesReachedFrom(path.join(libraryDir, file))]).toEqual([]);
    },
  );

  it("the walker does see mediabunny behind the io-worker modules (a control)", () => {
    expect(packagesReachedFrom(path.join(libraryDir, "opfsStore.ts")).has("mediabunny")).toBe(true);
  });
});
