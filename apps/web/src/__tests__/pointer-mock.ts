/**
 * Shared coarse-pointer (touchscreen) test double.
 *
 * The vitest setup file installs a matchMedia stub whose every query
 * returns matches: false. Any test that renders touch-aware UI needs a
 * stub where "(pointer: coarse)" resolves to a chosen value instead.
 * Keep this the single copy: 28 test files used to carry their own.
 */

/**
 * Install a matchMedia stub where "(pointer: coarse)" matches `coarse`.
 * Every other media query still reports matches: false.
 */
export function mockPointer(coarse: boolean): void {
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

/** Put the pointer back to fine (mouse/keyboard), for test teardown. */
export function resetPointerMock(): void {
  mockPointer(false);
}
