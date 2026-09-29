import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
