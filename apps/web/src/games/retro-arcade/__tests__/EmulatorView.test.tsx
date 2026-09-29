import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAVE_MESSAGES } from "../lib/emulatorMessages";

const fakeStore = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../lib/saveStates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/saveStates")>();
  return { ...actual, saveStateStore: fakeStore };
});

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, syncStatus: "idle" }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

import { EMULATOR_VIEW_Z, RetroArcadeGame } from "../Game";
import { SaveStateError } from "../lib/saveStates";
import { useRetroArcadeStore } from "../lib/store";

const GAME = { gameId: "snes-Test ROM", name: "Test ROM", system: "snes" };

function play(restartNonce = 0) {
  useRetroArcadeStore.setState({
    currentSystem: "snes",
    currentRom: "/api/roms/snes/test.sfc",
    currentRomName: "Test ROM",
    isPlaying: true,
    restartNonce,
    settings: { volume: 0.5, autoSaveOnExit: true, showTouchControls: true },
  });
  render(<RetroArcadeGame />);
  const iframe = document.querySelector("iframe") as HTMLIFrameElement;
  const frame = iframe.contentWindow as Window;
  const toFrame = vi.spyOn(frame, "postMessage").mockImplementation(() => {});
  const fromFrame = (data: unknown, source: Window | null = frame) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin, source }));
    });
  return { iframe, frame, toFrame, fromFrame };
}

function bytes(length: number, seed = 1): ArrayBuffer {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i + seed) & 0xff;
  return out.buffer;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeStore.put.mockResolvedValue(undefined);
  fakeStore.get.mockResolvedValue(null);
  fakeStore.list.mockResolvedValue([]);
  fakeStore.remove.mockResolvedValue(undefined);
});

afterEach(() => {
  useRetroArcadeStore.setState({ isPlaying: false, currentRom: null, currentRomName: null, restartNonce: 0 });
});

describe("emulator view: stacking", () => {
  it("sits above the site header (1000) and toasts (1050), below celebrations (1150), sheets (2500) and dialogs (3000)", () => {
    play();
    const view = screen.getByTestId("emulator-view");
    const z = Number(/(?:^|\s)z-\[(\d+)\]/.exec(view.className)?.[1] ?? /(?:^|\s)z-(\d+)/.exec(view.className)?.[1]);
    expect(z).toBe(EMULATOR_VIEW_Z);
    expect(z).toBeGreaterThan(1050);
    expect(z).toBeLessThan(1150);
    expect(z).toBeLessThan(2500);
    expect(view.className).toMatch(/(^|\s)fixed(\s|$)/);
    expect(view.className).toMatch(/(^|\s)inset-0(\s|$)/);
  });

  it("has one Back to Games button, inside the emulator view", () => {
    play();
    const backs = screen.getAllByRole("button", { name: /Back to Games/ });
    expect(backs).toHaveLength(1);
    expect(screen.getByTestId("emulator-view")).toContainElement(backs[0]);
  });
});

describe("emulator view: save states", () => {
  it("keeps a Save State in the manual slot of this owner and says so", async () => {
    const { fromFrame } = play();
    const state = bytes(202_840);
    fromFrame({ type: "saveState", state });

    await waitFor(() => expect(fakeStore.put).toHaveBeenCalledTimes(1));
    const [owner, meta, slot, data] = fakeStore.put.mock.calls[0];
    expect(owner).toBe("guest");
    expect(meta).toEqual(GAME);
    expect(slot).toBe("manual");
    expect(data).toBe(state);
    expect(await screen.findByText(SAVE_MESSAGES.saved)).toBeInTheDocument();
  });

  it("tells the kid when the save did not fit", async () => {
    fakeStore.put.mockRejectedValue(new SaveStateError("quota"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fromFrame } = play();
    fromFrame({ type: "saveState", state: bytes(64) });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your save did not fit. Try deleting an old game save.");
    // A problem stays until the kid taps OK.
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it("tells the kid when the emulator could not make a state", async () => {
    const { fromFrame } = play();
    fromFrame({ type: "saveState", state: new ArrayBuffer(0) });
    expect(await screen.findByRole("alert")).toHaveTextContent(SAVE_MESSAGES.saveFailed);
    expect(fakeStore.put).not.toHaveBeenCalled();
  });

  it("sends the manual save to the emulator when the kid presses Load State", async () => {
    const state = bytes(4096, 9);
    fakeStore.get.mockImplementation(async (_owner: string, _game: string, slot: string) =>
      slot === "manual" ? state : null
    );
    const { fromFrame, toFrame } = play();
    fromFrame({ type: "requestLoadState" });

    await waitFor(() =>
      expect(toFrame).toHaveBeenCalledWith(
        { type: "loadState", state, reason: "manual" },
        window.location.origin,
        [state]
      )
    );
    expect(fakeStore.get).toHaveBeenCalledWith("guest", GAME.gameId, "manual");
    fromFrame({ type: "stateLoaded", reason: "manual" });
    expect(await screen.findByText(SAVE_MESSAGES.loaded)).toBeInTheDocument();
  });

  it("says there is no save yet", async () => {
    const { fromFrame, toFrame } = play();
    fromFrame({ type: "requestLoadState" });
    expect(await screen.findByText(SAVE_MESSAGES.noSave)).toBeInTheDocument();
    expect(toFrame).not.toHaveBeenCalled();
  });

  it("starts from the auto save when the game starts", async () => {
    const state = bytes(1000, 3);
    fakeStore.get.mockImplementation(async (_owner: string, _game: string, slot: string) =>
      slot === "auto" ? state : null
    );
    const { fromFrame, toFrame } = play();
    fromFrame({ type: "ready" });
    await waitFor(() =>
      expect(toFrame).toHaveBeenCalledWith(
        { type: "loadState", state, reason: "resume" },
        window.location.origin,
        [state]
      )
    );
    fromFrame({ type: "stateLoaded", reason: "resume" });
    expect(await screen.findByText(SAVE_MESSAGES.resumed)).toBeInTheDocument();
  });

  it("does not load the auto save after Start over", async () => {
    fakeStore.get.mockResolvedValue(bytes(10));
    const { fromFrame, toFrame } = play(1);
    fromFrame({ type: "ready" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fakeStore.get).not.toHaveBeenCalled();
    expect(toFrame).not.toHaveBeenCalled();
  });

  it("keeps the auto save when the kid taps Back to Games, then leaves", async () => {
    const { fromFrame, toFrame } = play();
    fromFrame({ type: "ready" });
    fireEvent.click(screen.getByRole("button", { name: /Back to Games/ }));

    await waitFor(() =>
      expect(toFrame).toHaveBeenCalledWith(
        expect.objectContaining({ type: "captureState" }),
        window.location.origin,
        []
      )
    );
    const request = toFrame.mock.calls.find(([message]) => (message as { type: string }).type === "captureState")!;
    const requestId = (request[0] as { requestId: number }).requestId;
    const state = bytes(500, 4);
    fromFrame({ type: "capturedState", requestId, state });

    await waitFor(() => expect(useRetroArcadeStore.getState().isPlaying).toBe(false));
    expect(fakeStore.put).toHaveBeenCalledWith("guest", GAME, "auto", state);
  });

  it("shows the save problem on the next screen when the auto save fails", async () => {
    fakeStore.put.mockRejectedValue(new SaveStateError("quota"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fromFrame, toFrame } = play();
    fromFrame({ type: "ready" });
    fireEvent.click(screen.getByRole("button", { name: /Back to Games/ }));
    await waitFor(() => expect(toFrame).toHaveBeenCalled());
    const request = toFrame.mock.calls.find(([message]) => (message as { type: string }).type === "captureState")!;
    fromFrame({ type: "capturedState", requestId: (request[0] as { requestId: number }).requestId, state: bytes(8) });

    await waitFor(() => expect(useRetroArcadeStore.getState().isPlaying).toBe(false));
    expect(await screen.findByRole("alert")).toHaveTextContent(SAVE_MESSAGES.didNotFit);
    warn.mockRestore();
  });

  it("keeps the auto save when the page goes to the background", async () => {
    const { fromFrame, toFrame } = play();
    fromFrame({ type: "ready" });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(toFrame).toHaveBeenCalled());
    const request = toFrame.mock.calls.find(([message]) => (message as { type: string }).type === "captureState")!;
    const state = bytes(64, 8);
    fromFrame({ type: "capturedState", requestId: (request[0] as { requestId: number }).requestId, state });
    await waitFor(() => expect(fakeStore.put).toHaveBeenCalledWith("guest", GAME, "auto", state));
    // The game keeps running.
    expect(useRetroArcadeStore.getState().isPlaying).toBe(true);
    visibility.mockRestore();
  });

  it("ignores a message that does not come from its emulator iframe", async () => {
    const { fromFrame } = play();
    fromFrame({ type: "saveState", state: bytes(64) }, window);
    fromFrame({ type: "saveState", state: bytes(64) }, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fakeStore.put).not.toHaveBeenCalled();
  });

  it("asks before it starts the game over, in a dialog above the emulator", async () => {
    play();
    fireEvent.click(screen.getByRole("button", { name: "Restart game" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Your saves stay safe.");
    fireEvent.click(screen.getByRole("button", { name: "Confirm restart" }));
    expect(useRetroArcadeStore.getState().restartNonce).toBe(1);
    expect(useRetroArcadeStore.getState().isPlaying).toBe(true);
  });
});

/**
 * EmulatorJS 4.2.3 revokes a blob: game URL after it reads the ROM
 * (emulator.js, downloadFile), and the emulator page is on this site, so the
 * revoke kills the link everywhere. These tests act as EmulatorJS: each start
 * "consumes" the URL that it got. A start must never get a consumed URL.
 */
describe("emulator view: uploaded ROMs", () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let made: string[];
  let revoked: Set<string>;
  let consumed: Set<string>;
  let blobOf: Map<string, Blob>;

  beforeEach(() => {
    made = [];
    revoked = new Set();
    consumed = new Set();
    blobOf = new Map();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        const url = `blob:${window.location.origin}/rom-${made.length + 1}`;
        made.push(url);
        blobOf.set(url, blob);
        return url;
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn((url: string) => revoked.add(url)),
    });
    useRetroArcadeStore.setState({
      currentSystem: "gb",
      currentRom: null,
      currentRomName: null,
      isPlaying: false,
      restartNonce: 0,
      customRoms: [],
      settings: { volume: 0.5, autoSaveOnExit: true, showTouchControls: true },
    });
  });

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: original.create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: original.revoke });
    useRetroArcadeStore.setState({ currentSystem: null, customRoms: [] });
  });

  const ROM = () => new File([new Uint8Array([0xce, 0xed, 0x66, 0x66])], "libbet.gb");

  /** The ROM URL of the current emulator iframe, after EmulatorJS started with it. */
  function startedRom(): string {
    const iframe = document.querySelector("iframe");
    if (!iframe) throw new Error("no emulator iframe");
    const rom = new URL(iframe.getAttribute("src") ?? "", window.location.origin).searchParams.get("rom");
    if (!rom) throw new Error("the emulator page got no ROM");
    // This start must be able to read the ROM...
    expect(consumed.has(rom), `${rom} was already read and revoked by EmulatorJS`).toBe(false);
    expect(revoked.has(rom), `${rom} was revoked before this start`).toBe(false);
    // ...and EmulatorJS reads it, then revokes it.
    consumed.add(rom);
    return rom;
  }

  function upload(file: File) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  function startOver() {
    fireEvent.click(screen.getByRole("button", { name: "Restart game" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm restart" }));
  }

  function fromCurrentFrame(data: unknown) {
    const frame = document.querySelector("iframe")!.contentWindow as Window;
    const toFrame = vi.spyOn(frame, "postMessage").mockImplementation(() => {});
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin, source: frame }));
    });
    return toFrame;
  }

  it("gives each start its own ROM URL, so Start over works twice in a row", () => {
    const file = ROM();
    render(<RetroArcadeGame />);
    upload(file);
    const first = startedRom();
    expect(blobOf.get(first)).toBe(file);

    startOver();
    const second = startedRom();
    startOver();
    const third = startedRom();

    expect(new Set([first, second, third]).size).toBe(3);
    expect([second, third].map((url) => blobOf.get(url))).toEqual([file, file]);
    expect(useRetroArcadeStore.getState().restartNonce).toBe(2);
    // The URL of a start that ended is revoked by the page too.
    expect(revoked.has(first) && revoked.has(second)).toBe(true);
    expect(revoked.has(third)).toBe(false);
  });

  it("revokes every URL it made when the kid leaves, and plays the file again after Back", async () => {
    const file = ROM();
    render(<RetroArcadeGame />);
    upload(file);
    startedRom();
    startOver();
    startedRom();

    fireEvent.click(screen.getByRole("button", { name: /Back to Games/ }));
    await waitFor(() => expect(useRetroArcadeStore.getState().isPlaying).toBe(false));
    expect(made.filter((url) => !revoked.has(url))).toEqual([]);

    // "Your ROMs" still has the file: Play starts it with a new URL.
    fireEvent.click(await screen.findByRole("button", { name: /libbet\.gb\s*Play/ }));
    startedRom();
    fireEvent.click(screen.getByRole("button", { name: /Back to Games/ }));
    await waitFor(() => expect(useRetroArcadeStore.getState().isPlaying).toBe(false));

    // A second upload of the same file also starts, and replaces the list entry.
    upload(ROM());
    startedRom();
    expect(useRetroArcadeStore.getState().customRoms.filter((rom) => rom.name === "libbet.gb")).toHaveLength(1);
    startOver();
    startedRom();
  });

  it("resumes from the auto save on a new start and skips it after Start over", async () => {
    const state = bytes(2048, 5);
    fakeStore.get.mockImplementation(async (_owner: string, _game: string, slot: string) =>
      slot === "auto" ? state : null
    );
    render(<RetroArcadeGame />);
    upload(ROM());
    startedRom();
    const toFirst = fromCurrentFrame({ type: "ready" });
    await waitFor(() =>
      expect(toFirst).toHaveBeenCalledWith({ type: "loadState", state, reason: "resume" }, window.location.origin, [state])
    );
    expect(fakeStore.get).toHaveBeenCalledWith("guest", "gb-libbet.gb", "auto");

    startOver();
    startedRom();
    const toSecond = fromCurrentFrame({ type: "ready" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fakeStore.get).toHaveBeenCalledTimes(1);
    expect(toSecond).not.toHaveBeenCalled();
  });
});
