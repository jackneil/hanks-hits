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

import { RetroArcadeGame } from "../Game";
import { SaveStateError } from "../lib/saveStates";
import { useRetroArcadeStore } from "../lib/store";

const GAME = { gameId: "snes-Test ROM", name: "Test ROM", system: "snes" };

function play(restartNonce = 0) {
  useRetroArcadeStore.setState({
    currentSystem: "snes",
    currentRomUrl: "/api/roms/snes/test.sfc",
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
  useRetroArcadeStore.setState({ isPlaying: false, currentRomUrl: null, currentRomName: null, restartNonce: 0 });
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
});
