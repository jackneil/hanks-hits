/**
 * A 2D canvas context for the Endless Runner picture tests: it draws
 * nothing and writes down every call, with the fill colour, the stroke
 * colour and the line width at the time of the call, so a test can read
 * where each box was drawn.
 *
 *   const calls: Call[] = [];
 *   const restore = installRecordingContext(calls);
 *   ...
 *   restore();
 */
import { vi } from "vitest";

export type Call = { name: string; args: number[]; fillStyle: unknown; strokeStyle?: unknown; lineWidth?: unknown };

/**
 * A 2D context that draws nothing and writes down every call, with the fill
 * colour at the time. `measure` gives measureText's width (0 by default).
 */
export function installRecordingContext(calls: Call[], measure: (text: string) => number = () => 0): () => void {
  const gradient = { addColorStop: () => undefined };
  const make = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
    const values: Record<string | symbol, unknown> = {};
    return new Proxy(values, {
      get(target, prop) {
        if (prop === "canvas") return canvas;
        if (prop === "measureText") return (text: string) => ({ width: measure(text) });
        if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
        if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
        if (prop in target) return target[prop];
        return (...args: number[]) => {
          calls.push({ name: String(prop), args, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle, lineWidth: target.lineWidth });
        };
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  };
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(function (this: HTMLCanvasElement, kind: string) {
      return kind === "2d" ? make(this) : null;
    } as typeof HTMLCanvasElement.prototype.getContext);
  return () => spy.mockRestore();
}

