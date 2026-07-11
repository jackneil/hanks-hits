import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AsteroidsGame } from "../Game";
import { useAsteroidsStore } from "../lib/store";

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

/**
 * The global setup installs a matchMedia stub that always returns
 * matches: false. This swaps in one where "(pointer: coarse)" resolves to the
 * requested value so we can simulate touch vs keyboard/mouse viewports.
 */
function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  useAsteroidsStore.setState({ status: "ready" });
});

afterEach(() => {
  mockPointer(false);
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

  it("press-and-hold sets the control active, release clears it", () => {
    render(<AsteroidsGame />);

    const rotateLeft = screen.getByRole("button", { name: "↺" });
    const thrust = screen.getByRole("button", { name: "🔥" });
    const fire = screen.getByRole("button", { name: "●" });
    const rotateRight = screen.getByRole("button", { name: "↻" });

    fireEvent.touchStart(rotateLeft);
    expect(useAsteroidsStore.getState().rotatingLeft).toBe(true);
    fireEvent.touchEnd(rotateLeft);
    expect(useAsteroidsStore.getState().rotatingLeft).toBe(false);

    fireEvent.touchStart(thrust);
    expect(useAsteroidsStore.getState().thrusting).toBe(true);
    fireEvent.touchEnd(thrust);
    expect(useAsteroidsStore.getState().thrusting).toBe(false);

    fireEvent.touchStart(fire);
    expect(useAsteroidsStore.getState().shooting).toBe(true);
    fireEvent.touchEnd(fire);
    expect(useAsteroidsStore.getState().shooting).toBe(false);

    fireEvent.touchStart(rotateRight);
    expect(useAsteroidsStore.getState().rotatingRight).toBe(true);
    fireEvent.touchEnd(rotateRight);
    expect(useAsteroidsStore.getState().rotatingRight).toBe(false);
  });

  it("marks every touch control with touchAction:none so the page can't scroll mid-game", () => {
    render(<AsteroidsGame />);

    for (const label of ["↺", "🔥", "●", "↻"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button.style.touchAction).toBe("none");
    }
  });
});
