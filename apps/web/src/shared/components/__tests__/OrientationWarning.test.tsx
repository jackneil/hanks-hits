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
    const { container } = render(<OrientationWarning />);
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.className).toMatch(/z-\[100\]/);
  });
});
