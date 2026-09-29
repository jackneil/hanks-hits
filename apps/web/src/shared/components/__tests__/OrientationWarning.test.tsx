import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OrientationWarning } from "../OrientationWarning";

/**
 * The global setup mock returns matches:false for every query. These helpers
 * simulate a device: portrait orientation via matchMedia, size via innerWidth.
 */
function mockDevice({ portrait, width }: { portrait: boolean; width: number }) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("orientation: portrait") ? portrait : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
}

afterEach(() => {
  mockDevice({ portrait: false, width: 1024 });
});

describe("OrientationWarning", () => {
  it("shows on a portrait phone (< 768px wide)", () => {
    mockDevice({ portrait: true, width: 375 });
    render(<OrientationWarning />);
    expect(screen.getByText("Rotate Your Phone")).toBeInTheDocument();
  });

  it("does NOT fire on a portrait tablet (>= 768px wide)", () => {
    mockDevice({ portrait: true, width: 768 });
    render(<OrientationWarning />);
    expect(screen.queryByText("Rotate Your Phone")).not.toBeInTheDocument();
  });

  it("does not show in landscape", () => {
    mockDevice({ portrait: false, width: 375 });
    render(<OrientationWarning />);
    expect(screen.queryByText("Rotate Your Phone")).not.toBeInTheDocument();
  });

  it("keeps the continue-anyway escape hatch", () => {
    mockDevice({ portrait: true, width: 375 });
    render(<OrientationWarning />);
    fireEvent.click(screen.getByText("Continue in portrait anyway"));
    expect(screen.queryByText("Rotate Your Phone")).not.toBeInTheDocument();
  });

  it("stacks above game HUDs (z-100 layer)", () => {
    mockDevice({ portrait: true, width: 375 });
    render(<OrientationWarning />);
    const overlay = screen.getByTestId("orientation-warning");
    expect(overlay.className).toMatch(/z-\[100\]/);
  });

  it("portals to document.body, so a game root with its own stacking context cannot put it under the start card", () => {
    // Regression: monster-truck's root is `fixed inset-0`, a stacking
    // context. Inside it, z-100 painted under the start card (z-90), which
    // portals to document.body, and "Continue in portrait anyway" could not
    // be tapped.
    mockDevice({ portrait: true, width: 375 });
    render(
      <div data-testid="game-root" className="fixed inset-0 bg-black">
        <OrientationWarning />
      </div>
    );
    const overlay = screen.getByTestId("orientation-warning");
    expect(overlay.parentElement).toBe(document.body);
    expect(screen.getByTestId("game-root")).not.toContainElement(overlay);
  });
});
