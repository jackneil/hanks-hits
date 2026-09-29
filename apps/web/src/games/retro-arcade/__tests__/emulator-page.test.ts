import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SYSTEMS, SYSTEM_IDS } from "../lib/constants";

/**
 * Runs the inline script of public/emulator/index.html against a stand-in
 * window, with the real jsdom document. It checks that the page loads
 * EmulatorJS from this site, and that it refuses a system or a ROM that
 * would make the emulator reach another site.
 */
const WEB_ROOT = join(__dirname, "..", "..", "..", "..");
const PAGE = readFileSync(join(WEB_ROOT, "public", "emulator", "index.html"), "utf8");
const INLINE_SCRIPT = (() => {
  const match = /<script>([\s\S]*?)<\/script>/.exec(PAGE);
  if (!match) throw new Error("the emulator page has no inline script");
  return match[1];
})();
const BODY = (() => {
  const match = /<body>([\s\S]*?)<script>/.exec(PAGE);
  if (!match) throw new Error("the emulator page has no body markup");
  return match[1];
})();

const ORIGIN = "https://hankshits.test";

type PageWindow = Record<string, unknown> & {
  location: { origin: string; search: string };
};

function runPage(params: Record<string, string>) {
  document.body.innerHTML = BODY;
  const win: PageWindow = {
    location: { origin: ORIGIN, search: `?${new URLSearchParams(params).toString()}` },
    parent: { postMessage: vi.fn() },
    addEventListener: vi.fn(),
  };
  let error: Error | null = null;
  try {
    new Function("window", "document", INLINE_SCRIPT)(win, document);
  } catch (e) {
    error = e as Error;
  }
  const loaderScript = document.body.querySelector("script[src]") as HTMLScriptElement | null;
  return {
    win,
    error,
    loaderSrc: loaderScript?.getAttribute("src") ?? null,
    message: document.getElementById("loading")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("emulator page", () => {
  it("loads EmulatorJS from this site for an arcade system and a proxied ROM", () => {
    const page = runPage({ core: "atari2600", rom: "/api/roms/atari2600/demo.bin", name: "Demo" });
    expect(page.error).toBeNull();
    expect(page.win.EJS_core).toBe("atari2600");
    expect(page.win.EJS_gameUrl).toBe("/api/roms/atari2600/demo.bin");
    expect(page.win.EJS_pathtodata).toBe("/emulator/ejs/4.2.3/");
    expect(page.loaderSrc).toBe("/emulator/ejs/4.2.3/loader.js");
  });

  it("accepts an uploaded ROM from a blob: URL of this site", () => {
    const page = runPage({ core: "nes", rom: `blob:${ORIGIN}/0b6f9f7e-2c5c-4d8e-9f1a-1234567890ab` });
    expect(page.error).toBeNull();
    expect(page.loaderSrc).toBe("/emulator/ejs/4.2.3/loader.js");
  });

  it("refuses a system that Retro Arcade does not offer", () => {
    // The site hosts no core for psx. EmulatorJS would try to download the
    // core from its CDN and run it.
    const page = runPage({ core: "psx", rom: "/api/roms/snes/demo.smc" });
    expect(page.error?.message).toMatch(/Unsupported core/);
    expect(page.loaderSrc).toBeNull();
    expect(page.win.EJS_pathtodata).toBeUndefined();
    expect(page.message).toContain("We cannot play this game here");
    expect(page.message).toContain("Go back and pick a different game.");
  });

  it.each([
    ["a Railway CDN URL", "https://cdn-hankshits.up.railway.app/roms/snes/demo.smc"],
    ["a Railway storage URL", "https://storage.railway.app/bucket/demo.smc"],
    ["another site", "https://example.com/demo.smc"],
    ["a protocol-relative URL", "//example.com/demo.smc"],
    ["a blob: URL of another site", "blob:https://example.com/0b6f9f7e-2c5c-4d8e-9f1a-1234567890ab"],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("refuses a ROM from %s", (_label, rom) => {
    const page = runPage({ core: "snes", rom });
    expect(page.error?.message).toMatch(/Invalid ROM URL/);
    expect(page.loaderSrc).toBeNull();
    expect(page.message).toContain("Invalid ROM URL");
  });
});

describe("emulator page: the core of each console", () => {
  it.each(SYSTEM_IDS)("gives %s the core and the control layout in constants.ts", (id) => {
    const page = runPage({ core: id, rom: `/api/roms/${id}/demo.bin` });
    expect(page.error).toBeNull();
    expect(page.win.EJS_core).toBe(SYSTEMS[id].ejsCore);
    expect(page.win.EJS_controlScheme).toBe(SYSTEMS[id].ejsControlScheme);
    expect(page.loaderSrc).toBe("/emulator/ejs/4.2.3/loader.js");
  });

  it("plays Game Boy games on mGBA with the Game Boy buttons", () => {
    const page = runPage({ core: "gb", rom: "/api/roms/gb/demo.gb" });
    expect(page.win.EJS_core).toBe("mgba");
    expect(page.win.EJS_controlScheme).toBe("gb");
  });

  it.each(["mgba", "gambatte", "snes9x", "constructor", "__proto__", "toString", "hasOwnProperty"])(
    "refuses %s, which is not a Retro Arcade console",
    (core) => {
      // A core name or an Object.prototype name must not reach EJS_core.
      const page = runPage({ core, rom: "/api/roms/gb/demo.gb" });
      expect(page.error?.message).toMatch(/Unsupported core/);
      expect(page.win.EJS_core).toBeUndefined();
      expect(page.loaderSrc).toBeNull();
    }
  );
});

/** A small stand-in for the Emscripten FS calls that the page uses. */
function fakeFs(files: Record<string, Uint8Array>) {
  const dirs = new Set(["/data", "/data/saves"]);
  for (const path of Object.keys(files)) dirs.add(path.slice(0, path.lastIndexOf("/")));
  return {
    files,
    dirs,
    analyzePath: (path: string) => ({ exists: dirs.has(path) || path in files }),
    readdir: (dir: string) => [
      ".",
      "..",
      ...Object.keys(files)
        .filter((p) => p.slice(0, p.lastIndexOf("/")) === dir)
        .map((p) => p.slice(dir.length + 1)),
    ],
    readFile: (path: string) => files[path],
    writeFile: (path: string, data: Uint8Array) => {
      files[path] = data;
    },
    mkdir: (dir: string) => {
      if (dirs.has(dir)) throw new Error("EEXIST");
      dirs.add(dir);
    },
  };
}

/** Runs the page for a console, makes the emulator object, and returns its handlers. */
function startEmulator(core: string) {
  const page = runPage({ core, rom: `/api/roms/${core}/demo.bin` });
  const handlers: Record<string, ((data: unknown) => void)[]> = {};
  const emulator = {
    on: (event: string, fn: (data: unknown) => void) => (handlers[event] ??= []).push(fn),
  };
  // loader.js does this right after it makes the emulator.
  page.win.EJS_emulator = emulator;
  return { page, emulator, handlers };
}

describe("emulator page: old Game Boy saves", () => {
  const OLD = "/data/saves/Gambatte";
  const NEW = "/data/saves/mGBA";
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("copies each old Gambatte battery save to mGBA before the game loads", () => {
    const { page, emulator, handlers } = startEmulator("gb");
    expect(page.win.EJS_emulator).toBe(emulator);
    expect(handlers.saveDatabaseLoaded).toHaveLength(1);
    const fs = fakeFs({
      [`${OLD}/Tetris.srm`]: bytes(1, 2, 3),
      [`${OLD}/ucity.srm`]: bytes(4, 5),
      [`${OLD}/ucity.rtc`]: bytes(9),
    });
    handlers.saveDatabaseLoaded[0](fs);
    expect(fs.files[`${NEW}/Tetris.srm`]).toEqual(bytes(1, 2, 3));
    expect(fs.files[`${NEW}/ucity.srm`]).toEqual(bytes(4, 5));
    // Only battery saves (.srm) move. The old files stay.
    expect(fs.files[`${NEW}/ucity.rtc`]).toBeUndefined();
    expect(fs.files[`${OLD}/Tetris.srm`]).toEqual(bytes(1, 2, 3));
  });

  it("never replaces an mGBA save", () => {
    const { handlers } = startEmulator("gb");
    const fs = fakeFs({ [`${OLD}/Tetris.srm`]: bytes(1), [`${NEW}/Tetris.srm`]: bytes(7, 7) });
    handlers.saveDatabaseLoaded[0](fs);
    expect(fs.files[`${NEW}/Tetris.srm`]).toEqual(bytes(7, 7));
  });

  it("does nothing when there are no old saves", () => {
    const { handlers } = startEmulator("gb");
    const fs = fakeFs({});
    handlers.saveDatabaseLoaded[0](fs);
    expect(Object.keys(fs.files)).toEqual([]);
    expect(fs.dirs.has(NEW)).toBe(false);
  });

  it("starts the game when the copy fails", () => {
    const { handlers } = startEmulator("gb");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fs = { ...fakeFs({ [`${OLD}/a.srm`]: bytes(1) }), readFile: () => { throw new Error("EIO"); } };
    expect(() => handlers.saveDatabaseLoaded[0](fs)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each(SYSTEM_IDS.filter((id) => id !== "gb"))("leaves the saves of %s alone", (id) => {
    const { page } = startEmulator(id);
    // No setter: EJS_emulator is a plain property on the other consoles.
    expect(Object.getOwnPropertyDescriptor(page.win, "EJS_emulator")?.set).toBeUndefined();
  });
});

