import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HIDDEN_HOLD, useGameShell } from "../useGameShell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * The pause contract of the shell (phone UX audit 2026-09-29, S8): the
 * pause menu and a hold (a shell overlay, a hidden tab) both stop the
 * game, the game hears onPause and onResume once each, and a game with
 * its own loop hears onShellOverlayOpen and onShellOverlayClose.
 */

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

afterEach(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});

describe("useGameShell: the pause menu", () => {
  it("tells the game once on pause and once on resume", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { result } = renderHook(() => useGameShell({ onPause, onResume }));
    act(() => result.current.pause());
    act(() => result.current.pause());
    expect(result.current.isPaused).toBe(true);
    expect(onPause).toHaveBeenCalledTimes(1);
    act(() => result.current.resume());
    expect(result.current.isPaused).toBe(false);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a game that cannot pause", () => {
    const onPause = vi.fn();
    const { result } = renderHook(() => useGameShell({ canPause: false, onPause }));
    act(() => result.current.pause());
    expect(result.current.isPaused).toBe(false);
    expect(onPause).not.toHaveBeenCalled();
  });
});

describe("useGameShell: holds (shell overlays)", () => {
  it("pauses the game with no menu while a hold is on, and resumes when it is released", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { result } = renderHook(() => useGameShell({ onPause, onResume }));
    act(() => result.current.hold("leaderboard"));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(result.current.isPaused).toBe(false);
    act(() => result.current.release("leaderboard"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("counts each hold source once, and frees the game only when every source is released", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { result } = renderHook(() => useGameShell({ onPause, onResume }));
    act(() => {
      result.current.hold("tip");
      result.current.hold("tip");
      result.current.hold("dialog");
    });
    expect(onPause).toHaveBeenCalledTimes(1);
    act(() => result.current.release("tip"));
    expect(onResume).not.toHaveBeenCalled();
    act(() => result.current.release("dialog"));
    expect(onResume).toHaveBeenCalledTimes(1);
    // A release with no hold is nothing.
    act(() => result.current.release("dialog"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("sends nothing extra when a hold starts over the menu, or the menu closes under a hold", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { result } = renderHook(() => useGameShell({ onPause, onResume }));
    act(() => result.current.pause());
    act(() => result.current.hold("leaderboard"));
    expect(onPause).toHaveBeenCalledTimes(1);
    act(() => result.current.resume());
    expect(onResume).not.toHaveBeenCalled();
    act(() => result.current.release("leaderboard"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("tells a game with its own loop about the first hold and the last release, with or without pause", () => {
    const onShellOverlayOpen = vi.fn();
    const onShellOverlayClose = vi.fn();
    const onPause = vi.fn();
    const { result } = renderHook(() =>
      useGameShell({ canPause: false, onPause, onShellOverlayOpen, onShellOverlayClose })
    );
    act(() => {
      result.current.hold("dialog");
      result.current.hold("tip");
    });
    expect(onShellOverlayOpen).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
    act(() => result.current.release("dialog"));
    expect(onShellOverlayClose).not.toHaveBeenCalled();
    act(() => result.current.release("tip"));
    expect(onShellOverlayClose).toHaveBeenCalledTimes(1);
  });

  it("pauses a held game as soon as it can pause (the tip shows in the commit that starts the run)", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { result, rerender } = renderHook(
      ({ canPause }: { canPause: boolean }) => useGameShell({ canPause, onPause, onResume }),
      { initialProps: { canPause: false } }
    );
    act(() => result.current.hold("tip"));
    expect(onPause).not.toHaveBeenCalled();
    rerender({ canPause: true });
    expect(onPause).toHaveBeenCalledTimes(1);
    act(() => result.current.release("tip"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("frees a game that ended under a hold, and sends no resume later", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { result, rerender } = renderHook(
      ({ canPause }: { canPause: boolean }) => useGameShell({ canPause, onPause, onResume }),
      { initialProps: { canPause: true } }
    );
    act(() => result.current.hold("leaderboard"));
    expect(onPause).toHaveBeenCalledTimes(1);
    rerender({ canPause: false });
    expect(onResume).toHaveBeenCalledTimes(1);
    act(() => result.current.release("leaderboard"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe("useGameShell: a hidden tab", () => {
  it("opens the pause menu for a game that can pause, and keeps it when the tab comes back", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { result } = renderHook(() => useGameShell({ onPause, onResume }));
    setHidden(true);
    expect(result.current.isPaused).toBe(true);
    expect(onPause).toHaveBeenCalledTimes(1);
    setHidden(false);
    expect(result.current.isPaused).toBe(true);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("holds a game that cannot pause until the tab comes back", () => {
    const onShellOverlayOpen = vi.fn();
    const onShellOverlayClose = vi.fn();
    const onPause = vi.fn();
    const { result } = renderHook(() =>
      useGameShell({ canPause: false, onPause, onShellOverlayOpen, onShellOverlayClose })
    );
    setHidden(true);
    expect(result.current.isPaused).toBe(false);
    expect(onShellOverlayOpen).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
    setHidden(false);
    expect(onShellOverlayClose).toHaveBeenCalledTimes(1);
  });

  it("holds a game that can pause but asked for no pause-on-blur, and frees it when the tab comes back", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { result } = renderHook(() => useGameShell({ pauseOnBlur: false, onPause, onResume }));
    setHidden(true);
    expect(result.current.isPaused).toBe(false);
    expect(onPause).toHaveBeenCalledTimes(1);
    setHidden(false);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("uses one named hold for the hidden tab, so an overlay hold survives a tab switch", () => {
    const onResume = vi.fn();
    const { result } = renderHook(() => useGameShell({ canPause: false, onResume }));
    act(() => result.current.hold("leaderboard"));
    setHidden(true);
    setHidden(false);
    // The leaderboard is still open: the hidden hold went, the other stays.
    act(() => result.current.release(HIDDEN_HOLD));
    expect(onResume).not.toHaveBeenCalled();
  });
});
