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
const INLINE_SCRIPTS = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (INLINE_SCRIPTS.length === 0) throw new Error("the emulator page has no inline scripts");
/** Classic scripts execute in document order: first the realm shim, then the game host. */
function runInlineScripts(win: PageWindow): void {
  for (const source of INLINE_SCRIPTS) new Function("window", "document", source)(win, document);
}
const BODY = (() => {
  const match = /<body>([\s\S]*?)<script>/.exec(PAGE);
  if (!match) throw new Error("the emulator page has no body markup");
  return match[1];
})();

const ORIGIN = "https://hankshits.test";

type PageWindow = Record<string, unknown> & {
  location: { origin: string; search: string };
};

function runPage(params: Record<string, string>, extra: Record<string, unknown> = {}) {
  document.body.innerHTML = BODY;
  const win: PageWindow = {
    location: { origin: ORIGIN, search: `?${new URLSearchParams(params).toString()}` },
    parent: { postMessage: vi.fn() },
    addEventListener: vi.fn(),
    ...extra,
  };
  let error: Error | null = null;
  try {
    runInlineScripts(win);
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

  it("disables only the pinned class's optional update check when it registers", () => {
    const page = runPage({ core: "snes", rom: "/api/roms/snes/demo.smc" });
    expect(page.error).toBeNull();
    const vendor = readFileSync(join(WEB_ROOT, "public/emulator/ejs/4.2.3/emulator.min.js"), "utf8");
    const start = vendor.indexOf("class EmulatorJS{");
    const registration = "window.EmulatorJS=EmulatorJS;";
    const end = vendor.indexOf(registration, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const fetchVersion = vi.fn().mockResolvedValue({ ok: false });
    // Load the real class definition, without starting a core or changing
    // browser defaults. Register exactly as the vendored bundle does.
    const original = new Function("window", "fetch", `${vendor.slice(start, end)}
      const original = {
        update: EmulatorJS.prototype.checkForUpdates,
        start: EmulatorJS.prototype.startButtonClicked,
      };
      ${registration}
      return original;
    `)(page.win, fetchVersion);
    original.update.call({ ejs_version: "4.2.3" });
    expect(fetchVersion).toHaveBeenCalledWith("https://cdn.emulatorjs.org/stable/data/version.json");
    fetchVersion.mockClear();
    const Emulator = page.win.EmulatorJS as { prototype: { checkForUpdates: () => void; startButtonClicked: unknown } };
    Emulator.prototype.checkForUpdates.call({ ejs_version: "4.2.3" });
    expect(fetchVersion).not.toHaveBeenCalled();
    expect(Emulator.prototype.startButtonClicked).toBe(original.start);
    expect(Object.getOwnPropertyDescriptor(page.win, "EmulatorJS")).toMatchObject({ writable: true, configurable: true, value: Emulator });
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

  it("refuses to start outside a frame, so a direct link cannot skip the heads-up card", () => {
    // Retro Arcade is the one gate that starts a game (Jack, 2026-10-02).
    // A top-level window is its own parent.
    document.body.innerHTML = BODY;
    const win: PageWindow = {
      location: { origin: ORIGIN, search: "?core=snes&rom=%2Fapi%2Froms%2Fsnes%2Fmortal_kombat_1.smc&name=MK" },
      addEventListener: vi.fn(),
    };
    win.parent = win;
    let error: Error | null = null;
    try {
      runInlineScripts(win);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).toMatch(/only inside Retro Arcade/);
    expect(document.body.querySelector("script[src]")).toBeNull();
    expect(win.EJS_gameUrl).toBeUndefined();
    const loading = document.getElementById("loading");
    expect(loading?.textContent).toContain("Play this game in Retro Arcade");
    expect(loading?.querySelector("a")?.getAttribute("href")).toBe("/games/retro-arcade");
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

  it("plays Nintendo 64 games on mupen64plus_next with the N64 buttons", () => {
    // Not "n64": for that system name EmulatorJS 4.2.3 picks parallel_n64 on
    // an iPhone, which stopped at boot and hung on a resume on a real iPhone.
    const page = runPage({ core: "n64", rom: "/api/roms/n64/demo.z64" });
    expect(page.win.EJS_core).toBe("mupen64plus_next");
    expect(page.win.EJS_controlScheme).toBe("n64");
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

/** The system-to-cores table of getCores() in the vendored bundle. */
const CORE_TABLE: Record<string, string[]> = (() => {
  const bundle = readFileSync(join(WEB_ROOT, "public", "emulator", "ejs", "4.2.3", "emulator.min.js"), "utf8");
  const match = /getCores\(\)\{let [A-Za-z_$][\w$]*=(\{[^}]*\})/.exec(bundle);
  if (!match) throw new Error("getCores() table not found in emulator.min.js");
  return JSON.parse(match[1].replace(/([{,])([A-Za-z_$][\w$]*):/g, '$1"$2":'));
})();

describe("emulator page: a core name pins the core", () => {
  const settingsKey = (system: string, name: string) => `ejs-1-${system}-${name}-settings`;
  afterEach(() => localStorage.clear());

  it.each(SYSTEM_IDS)("hides the Core setting of %s exactly when its ejsCore is a core name", (id) => {
    const page = runPage({ core: id, rom: `/api/roms/${id}/demo.bin`, name: "Demo" }, { localStorage });
    const isSystemName = Object.prototype.hasOwnProperty.call(CORE_TABLE, SYSTEMS[id].ejsCore);
    expect(page.win.EJS_hideSettings).toEqual(isSystemName ? undefined : ["retroarch_core"]);
  });

  it("hides the Core setting for the Nintendo 64, so the player cannot pick parallel_n64", () => {
    const page = runPage({ core: "n64", rom: "/api/roms/n64/demo.z64", name: "Demo" }, { localStorage });
    expect(page.win.EJS_hideSettings).toEqual(["retroarch_core"]);
  });

  it("forgets a core choice that EmulatorJS kept for this game and keeps its other settings", () => {
    // EmulatorJS reads this key before EJS_core (getCore, preGetSetting).
    localStorage.setItem(
      settingsKey("n64", "Demo"),
      JSON.stringify({ settings: { retroarch_core: "parallel_n64", shader: "crt-zfast" }, controlSettings: { 0: {} } })
    );
    runPage({ core: "n64", rom: "/api/roms/n64/demo.z64", name: "Demo" }, { localStorage });
    const saved = JSON.parse(localStorage.getItem(settingsKey("n64", "Demo")) ?? "{}");
    expect(saved.settings).toEqual({ shader: "crt-zfast" });
    expect(saved.controlSettings).toEqual({ 0: {} });
  });

  it("leaves the settings of other games and of consoles with a system name alone", () => {
    const other = JSON.stringify({ settings: { retroarch_core: "parallel_n64" } });
    const nes = JSON.stringify({ settings: { retroarch_core: "nestopia" } });
    localStorage.setItem(settingsKey("n64", "Other"), other);
    localStorage.setItem(settingsKey("nes", "Demo"), nes);
    runPage({ core: "n64", rom: "/api/roms/n64/demo.z64", name: "Demo" }, { localStorage });
    runPage({ core: "nes", rom: "/api/roms/nes/demo.nes", name: "Demo" }, { localStorage });
    expect(localStorage.getItem(settingsKey("n64", "Other"))).toBe(other);
    // The NES player may still pick fceumm or nestopia.
    expect(localStorage.getItem(settingsKey("nes", "Demo"))).toBe(nes);
  });

  it("starts the game when the stored settings are not JSON", () => {
    localStorage.setItem(settingsKey("n64", "Demo"), "{not json");
    const page = runPage({ core: "n64", rom: "/api/roms/n64/demo.z64", name: "Demo" }, { localStorage });
    expect(page.error).toBeNull();
    expect(page.loaderSrc).toBe("/emulator/ejs/4.2.3/loader.js");
  });
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

describe("emulator page: the landscape strips follow the on-screen gamepad", () => {
  /** Starts the game with a gamepad element in the given style, as EmulatorJS makes it. */
  function startWithGamepad(style: string) {
    const page = runPage({ core: "snes", rom: "/api/roms/snes/demo.smc" });
    const pad = document.createElement("div");
    pad.className = "ejs_virtualGamepad_parent";
    pad.setAttribute("style", style);
    document.getElementById("game")!.appendChild(pad);
    page.win.EJS_emulator = { on: vi.fn(), virtualGamepad: pad };
    (page.win.EJS_onGameStart as () => void)();
    const game = document.getElementById("game")!;
    const parent = page.win.parent as { postMessage: ReturnType<typeof vi.fn> };
    return { game, pad, parent };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("marks #game when the game starts with the gamepad shown (a phone)", () => {
    const { game, parent } = startWithGamepad("");
    expect(game.classList.contains("hh_gamepad_shown")).toBe(true);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "ready" }, ORIGIN);
  });

  it("does not mark #game when EmulatorJS hides the gamepad (a computer)", () => {
    const { game } = startWithGamepad("display: none;");
    expect(game.classList.contains("hh_gamepad_shown")).toBe(false);
  });

  it("follows the gamepad when the player turns it off and on in Settings", async () => {
    const { game, pad } = startWithGamepad("");
    pad.style.display = "none";
    await settle();
    expect(game.classList.contains("hh_gamepad_shown")).toBe(false);
    pad.style.display = "";
    await settle();
    expect(game.classList.contains("hh_gamepad_shown")).toBe(true);
  });

  it("ignores the 250 ms that EmulatorJS shows a hidden gamepad at opacity 0 to measure it", async () => {
    const { game, pad } = startWithGamepad("display: none;");
    pad.style.opacity = "0";
    pad.style.display = "";
    await settle();
    expect(game.classList.contains("hh_gamepad_shown")).toBe(false);
  });

  it("still tells the parent that the game is ready when there is no gamepad element", () => {
    const page = runPage({ core: "nes", rom: "/api/roms/nes/demo.nes" });
    page.win.EJS_emulator = { on: vi.fn() };
    (page.win.EJS_onGameStart as () => void)();
    expect((page.win.parent as { postMessage: ReturnType<typeof vi.fn> }).postMessage).toHaveBeenCalledWith({ type: "ready" }, ORIGIN);
    expect(document.getElementById("game")!.classList.contains("hh_gamepad_shown")).toBe(false);
  });
});

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

/** The style rules of the emulator page, parsed by jsdom (media rules flattened). */
function pageStyleRules(): { media: string; selector: string; style: CSSStyleDeclaration }[] {
  const match = /<style>([\s\S]*?)<\/style>/.exec(PAGE);
  if (!match) throw new Error("the emulator page has no style block");
  const style = document.createElement("style");
  style.textContent = match[1];
  document.head.appendChild(style);
  const out: { media: string; selector: string; style: CSSStyleDeclaration }[] = [];
  const walk = (rules: CSSRuleList, media: string) => {
    for (const rule of Array.from(rules)) {
      if ("media" in rule && "cssRules" in rule) {
        walk((rule as CSSMediaRule).cssRules, (rule as CSSMediaRule).media.mediaText);
      } else if ("selectorText" in rule) {
        const styleRule = rule as CSSStyleRule;
        for (const selector of styleRule.selectorText.split(",")) {
          out.push({ media, selector: selector.trim(), style: styleRule.style });
        }
      }
    }
  };
  walk((style.sheet as CSSStyleSheet).cssRules, "");
  style.remove();
  return out;
}

describe("emulator page: on-screen gamepad touch targets", () => {
  const rules = pageStyleRules();
  const find = (selector: string, media = "") =>
    rules.filter((rule) => rule.selector === selector && rule.media === media).map((rule) => rule.style);
  const px = (value: string) => Number.parseFloat(value);

  it("makes every gamepad button at least 44 px wide and tall, over the inline 31 px height", () => {
    const [button] = find("#game .ejs_virtualGamepad_button");
    expect(button, "a rule for the gamepad buttons").toBeDefined();
    // EmulatorJS writes height:31px inline on Start, Select, L, R, Fast and
    // Slow. min-height is not inline, so it wins over that height.
    expect(px(button.getPropertyValue("min-height"))).toBeGreaterThanOrEqual(44);
    expect(px(button.getPropertyValue("min-width"))).toBeGreaterThanOrEqual(44);
    expect(button.getPropertyValue("height")).toBe("");
  });

  it("makes the menu button (24x24 px in EmulatorJS) at least 44 px", () => {
    const [open] = find("#game .ejs_virtualGamepad_open");
    expect(open, "a rule for the menu button").toBeDefined();
    expect(px(open.getPropertyValue("width"))).toBeGreaterThanOrEqual(44);
    expect(px(open.getPropertyValue("height"))).toBeGreaterThanOrEqual(44);
  });

  it("makes the menu bar buttons (Save State, Load State) at least 44 px and lets the phone menu scroll", () => {
    const [menuButton] = find("#game .ejs_menu_bar .ejs_menu_button");
    expect(menuButton, "a rule for the menu bar buttons").toBeDefined();
    expect(px(menuButton.getPropertyValue("min-height"))).toBeGreaterThanOrEqual(44);
    expect(px(menuButton.getPropertyValue("min-width"))).toBeGreaterThanOrEqual(44);
    // EmulatorJS puts "ejs_small_screen" on #game itself (handleResize), so
    // "#game .ejs_small_screen ..." never matched a thing.
    const selector = "#game.ejs_small_screen .ejs_menu_bar";
    const [phoneMenu] = find(selector);
    expect(phoneMenu.getPropertyValue("overflow-y")).toBe("auto");
    document.body.innerHTML = '<div id="game" class="ejs_parent ejs_small_screen"><div class="ejs_menu_bar"></div></div>';
    expect(document.querySelector(".ejs_menu_bar")!.matches(selector)).toBe(true);
    expect(rules.some((rule) => /#game \.ejs_small_screen/.test(rule.selector))).toBe(false);
  });

  it("gives each button of the bottom row its own slot in portrait", () => {
    const media = "(orientation: portrait)";
    const lefts = [
      "#game .ejs_virtualGamepad_bottom .b_speed_fast",
      "#game .ejs_virtualGamepad_bottom .b_select",
      "#game .ejs_virtualGamepad_bottom .b_start",
      "#game .ejs_virtualGamepad_bottom .b_speed_slow",
    ].map((selector) => find(selector, media)[0]?.getPropertyValue("left"));
    expect(lefts.every(Boolean)).toBe(true);
    expect(new Set(lefts).size).toBe(4);
  });

  it("moves the bottom row to the corners in landscape, off the picture in the middle", () => {
    const media = "(orientation: landscape)";
    expect(find("#game .ejs_virtualGamepad_bottom .b_speed_fast", media)[0]?.getPropertyValue("left")).toBe("8px");
    expect(find("#game .ejs_virtualGamepad_bottom .b_speed_slow", media)[0]?.getPropertyValue("right")).toBe("8px");
  });
});
