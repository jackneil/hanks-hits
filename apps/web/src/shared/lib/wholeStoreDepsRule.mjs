// The whole-store hook-deps rule (issue #56): one source of truth for the
// ESLint rule (apps/web/eslint.config.mjs) and its tests
// (src/shared/lib/__tests__/wholeStoreDepsRule.test.ts).
//
// Plain ESM JavaScript, not TypeScript: eslint.config.mjs loads it with
// Node, with no build step. Paths are relative to apps/web.
//
// The bug: `const store = useXStore()` with no selector gives the WHOLE
// Zustand state. That object is new after every set(). A hook that lists
// `store` in its dependency array re-runs on every state change: a game
// loop restarts every frame (deltaTime resets, timers never build up), an
// interval or key listener is removed and added again on every tick, and a
// useCallback is a new function on every set.
//
// The fix at a site: read the state when the handler runs, with
// useXStore.getState(), and remove `store` from the deps. Or subscribe to
// one field with a selector, useXStore((s) => s.field).
//
// No esquery selector can do this check, because it must find the
// declaration of the identifier in the deps array. So this is a small
// local plugin rule that uses the scope manager.

/** The rule covers every source module. */
export const WHOLE_STORE_DEPS_LINT_FILES = Object.freeze([
  "src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
]);

/** Tests may hold a whole store to check it. */
export const WHOLE_STORE_DEPS_TEST_IGNORES = Object.freeze([
  "**/__tests__/**",
  "**/*.{test,spec}.*",
]);

/** The plugin namespace and the rule name, for eslint.config.mjs. */
export const WHOLE_STORE_DEPS_PLUGIN = "hanks-hits";
export const WHOLE_STORE_DEPS_RULE = "no-whole-store-deps";

/**
 * Zustand hooks whose names do not end in "Store". A store hook is a
 * name that ends in "Store", or a name in this list. The source-scan test
 * fails when a Zustand create() hook has a name that neither form covers,
 * so a new store cannot get past the rule by its name.
 */
export const OTHER_STORE_HOOKS = Object.freeze([
  "useActivitiesSession",
  "useAdventureSession",
  "useGameBreaks",
  "useMediaLibrary",
  "useShellOverlays",
  "useStartOverlayPresence",
]);

const STORE_SUFFIX = /^use[A-Z0-9][A-Za-z0-9_]*Store$/;

/** True when `name` is the name of a Zustand store hook. */
export function isStoreHookName(name) {
  return STORE_SUFFIX.test(name) || OTHER_STORE_HOOKS.includes(name);
}

/**
 * React hooks that take a dependency array, and the index of that array
 * in the arguments.
 */
const DEPS_INDEX = Object.freeze({
  useEffect: 1,
  useLayoutEffect: 1,
  useInsertionEffect: 1,
  useCallback: 1,
  useMemo: 1,
  useImperativeHandle: 2,
});

/** The message, with {{name}} (the variable) and {{hook}} (the store hook). */
export const WHOLE_STORE_DEPS_MESSAGE =
  "'{{name}}' is the whole {{hook}}() state. It is a new object after every set(), so this hook runs again on every state change. Read the state in the handler with {{hook}}.getState(), or subscribe to one field with {{hook}}((s) => s.field), and remove '{{name}}' from the deps.";

/** The name of a hook call: useEffect(...) or React.useEffect(...). */
function hookName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
    return callee.property.name;
  }
  return null;
}

/** The variable that `name` refers to from `scope`, or null. */
function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const variable = s.set.get(name);
    if (variable) return variable;
  }
  return null;
}

/**
 * The store hook name when `variable` is declared as `x = useXStore()`
 * (a store hook called with no arguments), else null.
 */
function wholeStoreHook(variable) {
  if (variable.defs.length !== 1) return null;
  const [def] = variable.defs;
  if (def.type !== "Variable" || def.node.id.type !== "Identifier") return null;
  let init = def.node.init;
  // `useXStore() as T` and `useXStore()!` are still the whole state.
  while (init && (init.type === "TSAsExpression" || init.type === "TSNonNullExpression" || init.type === "TSSatisfiesExpression")) {
    init = init.expression;
  }
  if (!init || init.type !== "CallExpression" || init.arguments.length !== 0) return null;
  if (init.callee.type !== "Identifier" || !isStoreHookName(init.callee.name)) return null;
  return init.callee.name;
}

/** @type {import("eslint").Rule.RuleModule} */
const noWholeStoreDeps = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a whole Zustand store (useXStore() with no selector) in a React hook dependency array",
    },
    messages: { wholeStore: WHOLE_STORE_DEPS_MESSAGE },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      CallExpression(node) {
        const name = hookName(node.callee);
        if (!name || !Object.hasOwn(DEPS_INDEX, name)) return;
        const deps = node.arguments[DEPS_INDEX[name]];
        if (!deps || deps.type !== "ArrayExpression") return;
        const scope = sourceCode.getScope(node);
        for (const element of deps.elements) {
          if (!element || element.type !== "Identifier") continue;
          const variable = findVariable(scope, element.name);
          const hook = variable && wholeStoreHook(variable);
          if (hook) {
            context.report({ node: element, messageId: "wholeStore", data: { name: element.name, hook } });
          }
        }
      },
    };
  },
};

/** The local ESLint plugin that holds the rule. */
export const wholeStoreDepsPlugin = Object.freeze({
  meta: { name: "hanks-hits-whole-store-deps" },
  rules: { [WHOLE_STORE_DEPS_RULE]: noWholeStoreDeps },
});
