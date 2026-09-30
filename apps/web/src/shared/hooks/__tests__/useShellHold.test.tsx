import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShellOverlays } from "../../lib/shellOverlays";
import { useGameShell } from "../useGameShell";
import { ShellHoldContext, useShellHold } from "../useShellHold";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * The hold as a boolean for a game that runs its own loop
 * (useShellHold.ts): GameShell provides it from useGameShell's isHeld,
 * and outside a shell the overlay count alone drives it.
 */

beforeEach(() => {
  useShellOverlays.setState({ count: 0 });
});

afterEach(() => {
  useShellOverlays.setState({ count: 0 });
});

describe("useGameShell.isHeld", () => {
  it("is true from the first hold to the last release, whether the game can pause or not", () => {
    const { result } = renderHook(() => useGameShell({ canPause: false }));
    expect(result.current.isHeld).toBe(false);
    act(() => result.current.hold("dialog"));
    expect(result.current.isHeld).toBe(true);
    act(() => result.current.hold("tip"));
    expect(result.current.isHeld).toBe(true);
    act(() => result.current.release("dialog"));
    expect(result.current.isHeld).toBe(true);
    act(() => result.current.release("tip"));
    expect(result.current.isHeld).toBe(false);
  });

  it("holds a game that cannot pause while the tab is hidden", () => {
    const { result } = renderHook(() => useGameShell({ canPause: false }));
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.isHeld).toBe(true);
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.isHeld).toBe(false);
  });
});

describe("useShellHold", () => {
  it("reads the shell's hold from ShellHoldContext", () => {
    function Probe() {
      return <div data-testid="probe">{useShellHold() ? "held" : "free"}</div>;
    }
    const tree = (held: boolean) => (
      <ShellHoldContext.Provider value={held}>
        <Probe />
      </ShellHoldContext.Provider>
    );
    const { rerender } = render(tree(false));
    expect(screen.getByTestId("probe")).toHaveTextContent("free");
    rerender(tree(true));
    expect(screen.getByTestId("probe")).toHaveTextContent("held");
    rerender(tree(false));
    expect(screen.getByTestId("probe")).toHaveTextContent("free");
  });

  it("is true while a shell overlay is open, with no shell around (an R3F scene, a hook test)", () => {
    const { result } = renderHook(() => useShellHold());
    expect(result.current).toBe(false);
    act(() => useShellOverlays.getState().open());
    expect(result.current).toBe(true);
    act(() => useShellOverlays.getState().close());
    expect(result.current).toBe(false);
  });
});
