import { render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useAuthSync -> useSession needs a SessionProvider we don't mount in tests.
// Stub it to guest mode so the game renders without a provider or network.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import PlatformerGame from "../Game";
import { usePlatformerStore } from "../lib/store";
import { LEVELS } from "../lib/constants";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { fingerCancel, fingerDown, fingerTap, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";

// The global setup stubs matchMedia to always return matches:false. Swap in a
// stub where "(pointer: coarse)" resolves to the requested value so we can
// simulate touch vs keyboard/mouse viewports (mirrors GameStartOverlay tests).

beforeEach(() => {
  mockPointer(false);
  act(() => {
    usePlatformerStore.setState({ gameState: "ready", currentLevelIndex: 0 });
  });
});

afterEach(() => {
  liftAllFingers();
  resetPointerMock();
});

describe("Platformer start overlay", () => {
  it("renders the shared DOM start overlay with the title exactly once", () => {
    render(<PlatformerGame />);
    // The canvas ready-screen title and the duplicate module <h1> are gone;
    // only the overlay heading remains.
    expect(
      screen.getAllByRole("heading", { name: "Hank's Hopper" })
    ).toHaveLength(1);
  });

  it("shows one DOM level button per level, each a >=44px touch target", () => {
    render(<PlatformerGame />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(LEVELS.length);
    for (const button of buttons) {
      expect(button.className).toMatch(/min-h-\[44px\]/);
    }

    LEVELS.forEach((_level, index) => {
      expect(
        screen.getByRole("button", { name: new RegExp(`Level ${index + 1}`) })
      ).toBeInTheDocument();
    });
  });

  it("starts the picked level (leaves 'ready') when its button is clicked", () => {
    render(<PlatformerGame />);
    expect(usePlatformerStore.getState().gameState).toBe("ready");

    fireEvent.click(screen.getByRole("button", { name: /Level 2/ }));

    expect(usePlatformerStore.getState().gameState).toBe("playing");
    expect(usePlatformerStore.getState().currentLevelIndex).toBe(1);
  });
});

describe("Platformer canvas touch zones", () => {
  // The zone math divides by `scale`, which the resize handler derives from
  // the container's clientWidth/clientHeight (zero in jsdom). Pin rects and
  // client sizes to the canvas's natural 800x450 so scale resolves to 1 and
  // clientX maps 1:1 onto canvas coordinates.
  const realGetRect = HTMLElement.prototype.getBoundingClientRect;
  beforeEach(() => {
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 450,
        width: 800,
        height: 450,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 450,
    });
    act(() => {
      usePlatformerStore.setState({ movingLeft: false, movingRight: false });
    });
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realGetRect;
    delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  });

  function getCanvas(container: HTMLElement): HTMLCanvasElement {
    const canvas = container.querySelector("canvas");
    if (!canvas) throw new Error("canvas not rendered");
    return canvas;
  }

  // The canvas listens through the shared native touch hook (useTouchInput),
  // which reads changedTouches by identifier; the finger double sends what a
  // browser sends, compatibility click included.
  it("a middle-zone tap jumps ONCE: touchstart is default-prevented, so no compatibility click", () => {
    const jump = vi.fn();
    act(() => {
      usePlatformerStore.setState({ gameState: "playing", jump });
    });
    const { container } = render(<PlatformerGame />);

    fingerTap(getCanvas(container), { x: 400, y: 200 });
    expect(jump).toHaveBeenCalledTimes(1);
  });

  it("maps left/right zone touches to movement and releases on touchend", () => {
    act(() => {
      usePlatformerStore.setState({ gameState: "playing" });
    });
    const { container } = render(<PlatformerGame />);
    const canvas = getCanvas(container);

    fingerDown(canvas, { id: 1, x: 100, y: 200 });
    expect(usePlatformerStore.getState().movingLeft).toBe(true);

    fingerUp(canvas, { id: 1 });
    expect(usePlatformerStore.getState().movingLeft).toBe(false);

    fingerDown(canvas, { id: 2, x: 700, y: 200 });
    expect(usePlatformerStore.getState().movingRight).toBe(true);

    fingerCancel(canvas, { id: 2 });
    expect(usePlatformerStore.getState().movingRight).toBe(false);
  });

  it("still handles taps on non-playing states (game over -> ready) via touchstart", () => {
    act(() => {
      usePlatformerStore.setState({ gameState: "gameOver" });
    });
    const { container } = render(<PlatformerGame />);

    fingerDown(getCanvas(container), { x: 400, y: 200 });
    expect(usePlatformerStore.getState().gameState).toBe("ready");
    fingerUp(getCanvas(container));
  });
});

describe("Platformer on-screen mobile controls", () => {
  it("renders the touch controls while playing on a coarse (touch) pointer", () => {
    mockPointer(true);
    act(() => {
      usePlatformerStore.setState({ gameState: "playing" });
    });
    render(<PlatformerGame />);

    // The move + jump buttons must exist regardless of viewport width, since
    // the game forces a 844px-wide landscape posture.
    expect(screen.getByRole("button", { name: "JUMP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "◀" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▶" })).toBeInTheDocument();
  });

  it("hides the touch controls while playing on a fine (mouse) pointer", () => {
    mockPointer(false);
    act(() => {
      usePlatformerStore.setState({ gameState: "playing" });
    });
    render(<PlatformerGame />);

    expect(screen.queryByRole("button", { name: "JUMP" })).toBeNull();
    expect(screen.queryByRole("button", { name: "◀" })).toBeNull();
    expect(screen.queryByRole("button", { name: "▶" })).toBeNull();
  });
});

describe("platformer spoken choices", () => {
  it("says the picker choices out loud, so a kid who cannot read hears them", () => {
    const speech = installSpeechMock();
    render(<PlatformerGame  />);

    fireEvent.click(screen.getByTestId("read-aloud-button"));

    const spoken = speech.lastUtterance().text;
    expect(spoken).toContain("Level 1");
    expect(spoken).toContain("Grassland Start");
    expect(spoken).toContain("and the game starts");
    removeSpeechMock();
  });
});
