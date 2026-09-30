import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SHORT_VIEWPORT_QUERY, useShortViewport } from "../useShortViewport";

const listeners = new Map<string, Set<() => void>>();
let shortNow = false;

function mockMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      get matches() {
        return query === SHORT_VIEWPORT_QUERY ? shortNow : false;
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_: string, fn: () => void) => {
        if (!listeners.has(query)) listeners.set(query, new Set());
        listeners.get(query)!.add(fn);
      },
      removeEventListener: (_: string, fn: () => void) => {
        listeners.get(query)?.delete(fn);
      },
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  listeners.clear();
  shortNow = false;
});

describe("useShortViewport", () => {
  it("is the same query as the short: variant in globals.css", () => {
    const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");
    expect(css).toContain(`@custom-variant short (@media ${SHORT_VIEWPORT_QUERY});`);
  });

  it("reports a short screen, and follows the phone when it turns", () => {
    mockMatchMedia();
    shortNow = true;
    const { result } = renderHook(() => useShortViewport());
    expect(result.current).toBe(true);
    act(() => {
      shortNow = false;
      for (const fn of listeners.get(SHORT_VIEWPORT_QUERY) ?? []) fn();
    });
    expect(result.current).toBe(false);
  });
});
