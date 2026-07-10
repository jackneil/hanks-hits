import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Canvas } from "../components/Canvas";

/**
 * Regression test for the drawing-app mount crash (audit Blocker #2).
 *
 * On a short viewport the canvas container can be laid out with 0 height, so
 * initialization called `ctx.getImageData(0, 0, w, 0)`, which throws
 * IndexSizeError and error-boundaries the whole page. The fix guards every
 * getImageData/init path so a zero-dimension canvas is a no-op that retries on
 * the next layout instead of throwing.
 */
describe("Canvas crash guard (zero-height container)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not throw when the container has zero height on mount", () => {
    // Real browsers throw IndexSizeError from getImageData when a dimension is 0.
    const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => {
      if (w === 0 || h === 0) {
        throw new DOMException("Index or size is negative or greater than the allowed amount", "IndexSizeError");
      }
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h } as ImageData;
    });

    const fakeCtx = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      getImageData,
      putImageData: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      quadraticCurveTo: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineCap: "",
      lineJoin: "",
      lineWidth: 0,
      globalCompositeOperation: "source-over",
    };

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      ((id: string) =>
        id === "2d" ? (fakeCtx as unknown as CanvasRenderingContext2D) : null) as typeof HTMLCanvasElement.prototype.getContext
    );

    // Simulate a container that is laid out with a width but 0 height.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    expect(() => render(<Canvas />)).not.toThrow();

    // The guard must prevent any zero-dimension getImageData call.
    for (const call of getImageData.mock.calls) {
      expect(call[2]).not.toBe(0);
      expect(call[3]).not.toBe(0);
    }
  });
});
