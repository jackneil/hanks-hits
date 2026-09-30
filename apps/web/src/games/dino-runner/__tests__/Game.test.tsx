import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DinoRunnerGame } from "../Game";
import { useDinoRunnerStore } from "../lib/store";
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
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
  useDinoRunnerStore.setState({ gameState: "idle" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetPointerMock();
});

describe("DinoRunnerGame start overlay", () => {
  it("shows the title exactly once, as a single heading, with a start button", () => {
    render(<DinoRunnerGame />);

    expect(
      screen.getAllByRole("heading", { name: "Dino Runner" })
    ).toHaveLength(1);
    expect(screen.getAllByText("Dino Runner")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
  });

  it("shows touch jump/duck hints (not keyboard copy) on coarse pointers", () => {
    mockPointer(true);
    render(<DinoRunnerGame />);

    expect(screen.getByText("👆 Tap to jump (hold = higher)")).toBeInTheDocument();
    expect(screen.getByText("👇 Hold DUCK or swipe down to duck")).toBeInTheDocument();
    expect(
      screen.queryByText("SPACE or ↑ to jump (hold = higher)")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<DinoRunnerGame />);

    expect(
      screen.getByText("SPACE or ↑ to jump (hold = higher)")
    ).toBeInTheDocument();
    expect(screen.getByText("↓ to duck")).toBeInTheDocument();
    expect(
      screen.queryByText("👆 Tap to jump (hold = higher)")
    ).not.toBeInTheDocument();
  });
});

describe("DinoRunnerGame play surface", () => {
  it("fills the play box and takes no scroll: the start card portals out of it", () => {
    const { container } = render(<DinoRunnerGame />);

    const overlay = screen.getByTestId("game-start-overlay");
    expect(overlay.parentElement).toBe(document.body);

    const surface = screen.getByTestId("dino-surface");
    expect(surface).not.toContainElement(overlay);
    expect(surface.className.split(/\s+/)).toContain("h-full");
    expect(surface.className.split(/\s+/)).toContain("touch-none");
    expect(surface.className).not.toMatch(/min-h-screen|100vh/);
    // The picture is a window onto the world, never a scrolling box.
    expect(container.querySelector('[data-testid="dino-viewport"]')?.className).toContain("overflow-hidden");
  });

  it("draws no words into the canvas at game over: the result is DOM and the chip has the buttons", () => {
    const texts: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "fillText") return (text: string) => texts.push(text);
          if (key === "canvas") return null;
          return () => undefined;
        },
        set: () => true,
      }
    );
    vi.unstubAllGlobals();
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    (vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
      mockImplementation: (fn: () => unknown) => void;
    }).mockImplementation(() => ctx);
    useDinoRunnerStore.setState({ gameState: "game-over", score: 123 });
    render(<DinoRunnerGame />);
    // Two frames: the first seeds the clock, both draw.
    (frame as unknown as FrameRequestCallback | null)?.(1000);
    (frame as unknown as FrameRequestCallback | null)?.(1017);
    expect(texts.some((t) => /game over|restart|space|tap/i.test(t))).toBe(false);
    expect(screen.getByTestId("dino-result-card")).toHaveTextContent("Game over!");
    expect(screen.getByTestId("dino-result-card")).toHaveTextContent("Score 123");
    expect(screen.getByTestId("result-chip")).toBeInTheDocument();
  });
});
