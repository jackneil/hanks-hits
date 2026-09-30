// The touch-input rule: one source of truth for the ESLint ban
// (apps/web/eslint.config.mjs) and its test
// (src/shared/lib/input/__tests__/touchInputRule.test.ts).
//
// Plain ESM JavaScript, not TypeScript: eslint.config.mjs loads it with
// Node, with no build step. Paths are relative to apps/web.
//
// Why: React registers touch listeners passive, so a preventDefault() in a
// React onTouch* handler does nothing (and logs an error on every tap). The
// browser then also sends the compatibility mouse events and a click. An
// element with onTouchStart AND onClick (or onMouseDown) runs its action
// twice per tap: Hextris spun 120 degrees for one tap, the Oregon Trail hunt
// spent two bullets, Bomberman placed two bombs. See design/ARCHITECTURE.md,
// section "Touch input".

/** The rule covers every game and app module. */
export const TOUCH_INPUT_LINT_FILES = Object.freeze([
  "src/games/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  "src/apps/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
]);

/** Tests may build any element they like. */
export const TOUCH_INPUT_TEST_IGNORES = Object.freeze([
  "**/__tests__/**",
  "**/*.{test,spec}.*",
]);

export const DOUBLE_PATH_MESSAGE =
  "One tap runs this twice (touchstart, then the compatibility click). Use one input path: usePointerTap from @/shared/lib/input for a tap, usePointerHold from @/shared/hooks for a hold, or useTouchInput from @/shared/hooks for a play surface.";

export const PASSIVE_PREVENT_DEFAULT_MESSAGE =
  "preventDefault() does nothing in a React onTouch* handler (React registers it passive) and logs an error on every tap. Use useTouchInput from @/shared/hooks (native listeners with { passive: false }) or pointer events.";

/**
 * no-restricted-syntax entries.
 *
 * The first two catch the double path: a JSX element with onTouchStart next
 * to onClick or onMouseDown. The third catches a preventDefault() call
 * written inside an inline onTouch* handler.
 */
export const TOUCH_INPUT_RESTRICTED_SYNTAX = Object.freeze([
  {
    selector:
      "JSXOpeningElement:has(> JSXAttribute[name.name='onTouchStart']):has(> JSXAttribute[name.name='onClick'])",
    message: DOUBLE_PATH_MESSAGE,
  },
  {
    selector:
      "JSXOpeningElement:has(> JSXAttribute[name.name='onTouchStart']):has(> JSXAttribute[name.name='onMouseDown'])",
    message: DOUBLE_PATH_MESSAGE,
  },
  {
    selector:
      "JSXAttribute[name.name=/^onTouch(Start|Move|End|Cancel)$/] CallExpression[callee.property.name='preventDefault']",
    message: PASSIVE_PREVENT_DEFAULT_MESSAGE,
  },
]);
