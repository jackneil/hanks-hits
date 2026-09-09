import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Four-Wheeler Adventure 3D uses procedural models, locally vendored CC0
 * textures, engine recordings and procedural WebAudio. Nothing may call out to another site: the
 * site CSP blocks cross-origin media anyway, and a kids' game must never phone
 * an outside server. This scan pins that invariant for every source file in
 * the module.
 */
const MODULE_DIR = join(__dirname, "..");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("four-wheeler-3d module media", () => {
  const files = collectSourceFiles(MODULE_DIR);

  it("scans the module source", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("vendors both ground maps within the mobile download budget", () => {
    const assets = join(
      MODULE_DIR,
      "../../../public/games/four-wheeler-3d/textures",
    );
    let bytes = 0;
    for (const name of ["ground-color.jpg", "ground-height.jpg"]) {
      const content = readFileSync(join(assets, name));
      expect([...content.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      bytes += content.length;
    }
    expect(bytes).toBeLessThan(1024 * 1024);
  });

  for (const pattern of [
    { name: "<img tags", regex: /<img(?:\s|>)/i },
    { name: "<audio tags", regex: /<audio(?:\s|>)/i },
    {
      name: "nonlocal fetch calls",
      regex: /fetch\((?!\s*"\/games\/four-wheeler-3d\/)/,
    },
    { name: "http:// URLs", regex: /http:\/\// },
    { name: "https:// URLs", regex: /https:\/\// },
  ]) {
    it(`has no ${pattern.name}`, () => {
      const offenders = files.filter((file) =>
        pattern.regex.test(readFileSync(file, "utf8")),
      );
      expect(offenders).toEqual([]);
    });
  }
});
