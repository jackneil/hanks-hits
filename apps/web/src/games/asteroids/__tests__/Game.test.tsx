import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AsteroidsGame } from "../Game";
import { useAsteroidsStore } from "../lib/store";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// useAuthSync pulls in next-auth's useSession, which needs a provider we don't
// mount in unit tests. Stub it with the shape the game destructures.
vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: vi.fn(),
  }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

beforeEach(() => {
  localStorage.clear();
  useAsteroidsStore.setState({ status: "ready" });
});

afterEach(() => {
  resetPointerMock();
});

describe("AsteroidsGame start overlay", () => {
  it("shows the title exactly once, as a single heading, with a start button", () => {
    render(<AsteroidsGame />);

    expect(screen.getAllByRole("heading", { name: "Asteroids" })).toHaveLength(1);
    expect(screen.getAllByText("Asteroids")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
  });

  it("shows touch fire/rotate hints (not keyboard copy) on coarse pointers", () => {
    mockPointer(true);
    render(<AsteroidsGame />);

    expect(screen.getByText("Tap ● to fire")).toBeInTheDocument();
    expect(screen.getByText("Tap ⟲ ⟳ to rotate")).toBeInTheDocument();
    expect(screen.getByText("Hold 🔥 to thrust")).toBeInTheDocument();
    expect(screen.queryByText("SPACE to fire")).not.toBeInTheDocument();
    expect(screen.queryByText("A/D or ← → to rotate")).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<AsteroidsGame />);

    expect(screen.getByText("SPACE to fire")).toBeInTheDocument();
    expect(screen.getByText("A/D or ← → to rotate")).toBeInTheDocument();
    expect(screen.queryByText("Tap ● to fire")).not.toBeInTheDocument();
  });
});

describe("AsteroidsGame touch controls", () => {
  beforeEach(() => {
    useAsteroidsStore.setState({
      status: "playing",
      rotatingLeft: false,
      rotatingRight: false,
      thrusting: false,
      shooting: false,
    });
  });

  // The pad is pointer events now (shared usePointerHold): a press is a
  // pointerdown, a release is the pointerup of that same pointer.
  const press = (button: HTMLElement, pointerId = 1) =>
    fireEvent.pointerDown(button, { pointerId, pointerType: "touch", button: 0 });
  const release = (button: HTMLElement, pointerId = 1) =>
    fireEvent.pointerUp(button, { pointerId, pointerType: "touch", button: 0 });

  it("press-and-hold sets the control active, release clears it", () => {
    render(<AsteroidsGame />);

    const rotateLeft = screen.getByRole("button", { name: "↺" });
    const thrust = screen.getByRole("button", { name: "🔥" });
    const fire = screen.getByRole("button", { name: "●" });
    const rotateRight = screen.getByRole("button", { name: "↻" });

    press(rotateLeft);
    expect(useAsteroidsStore.getState().rotatingLeft).toBe(true);
    release(rotateLeft);
    expect(useAsteroidsStore.getState().rotatingLeft).toBe(false);

    press(thrust);
    expect(useAsteroidsStore.getState().thrusting).toBe(true);
    release(thrust);
    expect(useAsteroidsStore.getState().thrusting).toBe(false);

    press(fire);
    expect(useAsteroidsStore.getState().shooting).toBe(true);
    release(fire);
    expect(useAsteroidsStore.getState().shooting).toBe(false);

    press(rotateRight);
    expect(useAsteroidsStore.getState().rotatingRight).toBe(true);
    release(rotateRight);
    expect(useAsteroidsStore.getState().rotatingRight).toBe(false);
  });

  it("marks every touch control touch-none so the browser never takes the press for a scroll", () => {
    render(<AsteroidsGame />);

    for (const label of ["↺", "🔥", "●", "↻"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button.className).toMatch(/\btouch-none\b/);
    }
  });
});
