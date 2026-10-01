/**
 * The site's pause menu pauses the ride (phone UX audit 2026-09-30). Before,
 * the game hid the header pause button and only Escape paused, so a phone
 * could not pause at all. Escape still closes an open panel first, and one
 * press never does both.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// The 3D scene stands in as a stub that keeps the game's real Escape rule.
vi.mock("..", async () => {
  const store = await import("../lib/store");
  const { useAdventureEscape } = await import("../hooks/useAdventureEscape");
  function FourWheeler3dGame() {
    useAdventureEscape();
    return <div data-testid="fw3-scene" />;
  }
  return {
    FourWheeler3dGame,
    useFourWheeler3dStore: store.useFourWheeler3dStore,
  };
});

import FourWheeler3dGameShell from "../GameShell";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";

function pressEscape() {
  act(() => {
    window.dispatchEvent(
      // A real key press is cancelable, which is what lets the game mark it used.
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  useAdventureSession.getState().reset();
  useFourWheeler3dStore.setState({ hasStarted: false, isPaused: false });
});

afterEach(() => {
  resetPointerMock();
  vi.restoreAllMocks();
});

describe("pausing Four-Wheeler Adventure 3D", () => {
  it("offers the header pause only once the ride has started", () => {
    mockPointer(true);
    render(<FourWheeler3dGameShell />);
    expect(screen.queryByRole("button", { name: "Pause game" })).toBeNull();

    act(() => useFourWheeler3dStore.setState({ hasStarted: true }));
    expect(screen.getByRole("button", { name: "Pause game" })).toBeInTheDocument();
  });

  it("pauses the ride from the header button and resumes it from the menu", () => {
    mockPointer(true);
    useFourWheeler3dStore.setState({ hasStarted: true });
    render(<FourWheeler3dGameShell />);

    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    expect(useFourWheeler3dStore.getState().isPaused).toBe(true);
    const menu = screen.getByTestId("pause-menu");

    fireEvent.click(within(menu).getAllByRole("button", { name: /Resume/ })[0]);
    expect(useFourWheeler3dStore.getState().isPaused).toBe(false);
  });

  it("closes an open panel on Escape without pausing, then pauses on the next Escape", () => {
    useFourWheeler3dStore.setState({ hasStarted: true });
    render(<FourWheeler3dGameShell />);
    act(() => useAdventureSession.getState().openPanel("map"));

    pressEscape();
    expect(useAdventureSession.getState().panel).toBeNull();
    expect(useFourWheeler3dStore.getState().isPaused).toBe(false);
    expect(screen.queryByTestId("pause-menu")).toBeNull();

    pressEscape();
    expect(useFourWheeler3dStore.getState().isPaused).toBe(true);
    expect(screen.getByTestId("pause-menu")).toBeInTheDocument();
  });

  it("lowers the hunting scope on Escape without pausing", () => {
    useFourWheeler3dStore.setState({ hasStarted: true });
    render(<FourWheeler3dGameShell />);
    act(() => useAdventureSession.setState({ scope: true }));

    pressEscape();
    expect(useAdventureSession.getState().scope).toBe(false);
    expect(useFourWheeler3dStore.getState().isPaused).toBe(false);
  });
});
