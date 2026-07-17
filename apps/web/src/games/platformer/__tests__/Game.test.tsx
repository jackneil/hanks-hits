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

// The global setup stubs matchMedia to always return matches:false. Swap in a
// stub where "(pointer: coarse)" resolves to the requested value so we can
// simulate touch vs keyboard/mouse viewports (mirrors GameStartOverlay tests).
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
  mockPointer(false);
  act(() => {
    usePlatformerStore.setState({ gameState: "ready", currentLevelIndex: 0 });
  });
});

afterEach(() => {
  mockPointer(false);
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

  it("prevents touchstart's default so the tap's compatibility click can't double-fire jump", () => {
    act(() => {
      usePlatformerStore.setState({ gameState: "playing" });
    });
    const { container } = render(<PlatformerGame />);

    // fireEvent returns false when preventDefault was called on the event.
    const notPrevented = fireEvent.touchStart(getCanvas(container), {
      touches: [{ clientX: 400, clientY: 200 }],
    });
    expect(notPrevented).toBe(false);
  });

  it("maps left/right zone touches to movement and releases on touchend", () => {
    act(() => {
      usePlatformerStore.setState({ gameState: "playing" });
    });
    const { container } = render(<PlatformerGame />);
    const canvas = getCanvas(container);

    fireEvent.touchStart(canvas, { touches: [{ clientX: 100, clientY: 200 }] });
    expect(usePlatformerStore.getState().movingLeft).toBe(true);

    fireEvent.touchEnd(canvas);
    expect(usePlatformerStore.getState().movingLeft).toBe(false);

    fireEvent.touchStart(canvas, { touches: [{ clientX: 700, clientY: 200 }] });
    expect(usePlatformerStore.getState().movingRight).toBe(true);

    fireEvent.touchCancel(canvas);
    expect(usePlatformerStore.getState().movingRight).toBe(false);
  });

  it("still handles taps on non-playing states (game over -> ready) via touchstart", () => {
    act(() => {
      usePlatformerStore.setState({ gameState: "gameOver" });
    });
    const { container } = render(<PlatformerGame />);

    fireEvent.touchStart(getCanvas(container), {
      touches: [{ clientX: 400, clientY: 200 }],
    });
    expect(usePlatformerStore.getState().gameState).toBe("ready");
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
