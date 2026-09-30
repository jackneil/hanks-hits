import { vi } from "vitest";

/**
 * A 2D canvas context that draws nothing, for a game-loop test in jsdom
 * (jsdom has no canvas contexts, so getContext("2d") returns null and a
 * game's loop effect returns before it starts). Every method is a no-op,
 * every property can be set, and the few methods a game reads a value
 * from (measureText, the gradients, getImageData) return a plain stand-in.
 * Keep this the single copy: every loop test uses it.
 *
 *   const restore = installNoop2dContext();
 *   ...
 *   restore();
 */
export function installNoop2dContext(): () => void {
  const gradient = { addColorStop: () => undefined };
  const make = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
    const values: Record<string | symbol, unknown> = {};
    return new Proxy(values, {
      get(target, prop) {
        if (prop === "canvas") return canvas;
        if (prop === "measureText") return () => ({ width: 0 });
        if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") {
          return () => gradient;
        }
        if (prop === "getImageData") {
          return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
        }
        if (prop in target) return target[prop];
        return () => undefined;
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
