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


/** Runs the page for a console and returns its message listener and a fake emulator. */
function startSavePage(core = "gb") {
  const page = runPage({ core, rom: `/api/roms/${core}/demo.bin` });
  const addListener = page.win.addEventListener as ReturnType<typeof vi.fn>;
  const call = addListener.mock.calls.find(([type]) => type === "message");
  if (!call) throw new Error("the page adds no message listener");
  const listener = call[1] as (event: { origin: string; source: unknown; data: unknown }) => void;
  const loadState = vi.fn();
  const getState = vi.fn();
  page.win.EJS_emulator = { on: vi.fn(), gameManager: { loadState, getState } };
  const parent = page.win.parent as { postMessage: ReturnType<typeof vi.fn> };
  const send = (data: unknown, from: { origin?: string; source?: unknown } = {}) =>
    listener({ origin: from.origin ?? ORIGIN, source: from.source ?? parent, data });
  return { page, parent, send, loadState, getState };
}

const pattern = (length: number) => {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) & 0xff;
  return bytes;
};

describe("emulator page: save states", () => {
  it("sends the bytes of a Save State to the parent as a transferred ArrayBuffer", () => {
    const { page, parent } = startSavePage();
    const state = pattern(202_840);
    // EmulatorJS 4.2.3 calls the handler with this object (emulator.js, saveState button).
    (page.win.EJS_onSaveState as (event: unknown) => void)({ screenshot: undefined, format: "png", state });
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    const [message, origin, transfer] = parent.postMessage.mock.calls[0];
    expect(origin).toBe(ORIGIN);
    expect(message.type).toBe("saveState");
    expect(Object.prototype.toString.call(message.state)).toBe("[object ArrayBuffer]");
    expect(message.state.byteLength).toBe(202_840);
    expect(new Uint8Array(message.state)).toEqual(pattern(202_840));
    expect(transfer).toEqual([message.state]);
  });

  it("sends only the bytes of the state when the Uint8Array is a view into a bigger buffer", () => {
    const { page, parent } = startSavePage();
    const heap = pattern(64);
    (page.win.EJS_onSaveState as (event: unknown) => void)({ state: heap.subarray(8, 24) });
    const [message] = parent.postMessage.mock.calls[0];
    expect(message.state.byteLength).toBe(16);
    expect(new Uint8Array(message.state)).toEqual(pattern(64).slice(8, 24));
  });

  it.each([
    ["an empty state", { state: new Uint8Array(0) }],
    ["no state", {}],
    ["no event", undefined],
    ["a plain object", { state: { length: 3 } }],
  ])("reports a failed save for %s", (_label, event) => {
    const { page, parent } = startSavePage();
    (page.win.EJS_onSaveState as (event: unknown) => void)(event);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "saveStateFailed" }, ORIGIN);
  });

  it("asks the parent for the manual save when the kid presses Load State", () => {
    const { page, parent } = startSavePage();
    (page.win.EJS_onLoadState as () => void)();
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "requestLoadState" }, ORIGIN);
  });

  it("loads a state that the parent sends and answers with the reason", () => {
    const { parent, send, loadState } = startSavePage();
    const bytes = pattern(1000);
    send({ type: "loadState", state: bytes.slice().buffer, reason: "resume" });
    expect(loadState).toHaveBeenCalledTimes(1);
    expect(loadState.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(loadState.mock.calls[0][0]).toEqual(bytes);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "stateLoaded", reason: "resume" }, ORIGIN);
  });

  it("answers stateLoadFailed when the state is empty or the core refuses it", () => {
    const { parent, send, loadState } = startSavePage();
    send({ type: "loadState", state: new ArrayBuffer(0) });
    expect(loadState).not.toHaveBeenCalled();
    expect(parent.postMessage).toHaveBeenLastCalledWith({ type: "stateLoadFailed", reason: "manual" }, ORIGIN);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadState.mockImplementation(() => {
      throw new Error("bad state");
    });
    send({ type: "loadState", state: pattern(4).buffer, reason: "manual" });
    expect(parent.postMessage).toHaveBeenLastCalledWith({ type: "stateLoadFailed", reason: "manual" }, ORIGIN);
    warn.mockRestore();
  });

  it("sends the current state when the parent asks (the auto save)", () => {
    const { parent, send, getState } = startSavePage();
    getState.mockReturnValue(pattern(300));
    send({ type: "captureState", requestId: 7 });
    const [message, origin, transfer] = parent.postMessage.mock.calls[0];
    expect(origin).toBe(ORIGIN);
    expect(message).toMatchObject({ type: "capturedState", requestId: 7 });
    expect(new Uint8Array(message.state)).toEqual(pattern(300));
    expect(transfer).toEqual([message.state]);
  });

  it("answers a null state when the core cannot make one", () => {
    const { parent, send, getState } = startSavePage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getState.mockImplementation(() => {
      throw new Error("not running");
    });
    send({ type: "captureState", requestId: 2 });
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "capturedState", requestId: 2, state: null }, ORIGIN, []);
    warn.mockRestore();
  });

  it.each([
    ["another origin", { origin: "https://example.com" }],
    ["another window of this origin", { source: { postMessage: vi.fn() } }],
  ])("ignores a message from %s", (_label, from) => {
    const { parent, send, loadState, getState } = startSavePage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getState.mockReturnValue(pattern(10));
    send({ type: "loadState", state: pattern(10).buffer }, from);
    send({ type: "captureState", requestId: 1 }, from);
    expect(loadState).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
    expect(parent.postMessage).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

