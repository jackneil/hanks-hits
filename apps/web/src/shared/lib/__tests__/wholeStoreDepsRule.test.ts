import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

import {
  OTHER_STORE_HOOKS,
  WHOLE_STORE_DEPS_LINT_FILES,
  isStoreHookName,
} from "../wholeStoreDepsRule.mjs";

// The ESLint rule behind issue #56: a hook that lists a whole Zustand store
// (useXStore() with no selector) in its deps runs again on every state
// change. This test lints fixture components through the real
// eslint.config.mjs, so a change to the config or the rule that lets the
// bug back in fails here. The source scan at the end keeps the store-hook
// names complete: a new store whose name the rule cannot see fails here.

const WEB_ROOT = path.resolve(__dirname, "../../../..");
const RULE_ID = "hanks-hits/no-whole-store-deps";

/** A path under src/games, where the rule applies. */
const GAME_FILE = "src/games/fixture-game/Game.tsx";
/** A shared path: the rule applies to all of src, not only games and apps. */
const SHARED_FILE = "src/shared/components/Fixture.tsx";
/** A test path, where the rule is off. */
const GAME_TEST_FILE = "src/games/fixture-game/__tests__/Game.test.tsx";

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: WEB_ROOT,
    overrideConfigFile: path.join(WEB_ROOT, "eslint.config.mjs"),
  });
});

async function storeMessages(code: string, filePath = GAME_FILE): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(WEB_ROOT, filePath) });
  const fatal = result.messages.filter((m) => m.fatal);
  expect(fatal, "the fixture must parse").toEqual([]);
  return result.messages.filter((m) => m.ruleId === RULE_ID).map((m) => m.message);
}

/** A component module with a fake store hook and `body` inside the component. */
const MODULE = (body: string, hook = "useFixtureStore") => `
"use client";
import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo } from "react";
import { ${hook} } from "./lib/store";
export function Fixture({ id, ref }: { id: number; ref: React.Ref<unknown> }) {
${body}
  return null;
}
`;

describe("hanks-hits/no-whole-store-deps ESLint rule", () => {
  it("covers every source module", () => {
    expect(WHOLE_STORE_DEPS_LINT_FILES).toEqual(["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"]);
  });

  it("flags a whole store in a useEffect deps array (the Memory Match interval)", async () => {
    const messages = await storeMessages(
      MODULE(`
  const store = useFixtureStore();
  useEffect(() => {
    const t = setInterval(() => store.tick(), 100);
    return () => clearInterval(t);
  }, [store]);`)
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("'store' is the whole useFixtureStore() state");
    expect(messages[0]).toContain("useFixtureStore.getState()");
    expect(messages[0]).toContain("useFixtureStore((s) => s.field)");
  });

  it("flags useCallback, useMemo, useLayoutEffect and React.useEffect, whatever the variable is called", async () => {
    const messages = await storeMessages(
      MODULE(`
  const game = useFixtureStore();
  const fire = useCallback(() => game.fire(), [game]);
  const total = useMemo(() => game.score + id, [game, id]);
  useLayoutEffect(() => { fire(); }, [fire, game]);
  React.useEffect(() => { void total; }, [total, game]);`)
    );
    expect(messages).toHaveLength(4);
    for (const message of messages) expect(message).toContain("'game' is the whole useFixtureStore() state");
  });

  it("reads the deps array of useImperativeHandle (its third argument)", async () => {
    const messages = await storeMessages(
      MODULE(`
  const store = useFixtureStore();
  useImperativeHandle(ref, () => ({ reset: store.reset }), [store]);`)
    );
    expect(messages).toHaveLength(1);
  });

  it("sees through `as` and non-null assertions on the store call", async () => {
    const messages = await storeMessages(
      MODULE(`
  const a = useFixtureStore() as { tick: () => void };
  const b = useFixtureStore()!;
  useEffect(() => { a.tick(); b.tick(); }, [a, b]);`)
    );
    expect(messages).toHaveLength(2);
  });

  it("flags a store hook whose name does not end in Store, in shared code", async () => {
    const messages = await storeMessages(
      MODULE(
        `
  const overlays = useShellOverlays();
  useEffect(() => { void overlays.count; }, [overlays]);`,
        "useShellOverlays"
      ),
      SHARED_FILE
    );
    expect(messages).toEqual([expect.stringContaining("'overlays' is the whole useShellOverlays() state")]);
  });

  it("allows the fixes: getState() in the handler, a selector, and a field of the store", async () => {
    const messages = await storeMessages(
      MODULE(`
  const store = useFixtureStore();
  const score = useFixtureStore((s) => s.score);
  useEffect(() => {
    const t = setInterval(() => useFixtureStore.getState().tick(), 100);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { void score; }, [score]);
  useEffect(() => { void store.level; }, [store.level, store.paddle.x]);`)
    );
    expect(messages).toEqual([]);
  });

  it("allows fields taken out of the store by destructuring", async () => {
    const messages = await storeMessages(
      MODULE(`
  const { level, tick } = useFixtureStore();
  useEffect(() => { tick(); }, [level, tick]);`)
    );
    expect(messages).toEqual([]);
  });

  it("allows a prop or parameter that is only called `store` (the retro-arcade save-state store)", async () => {
    const messages = await storeMessages(`
"use client";
import { useCallback, useEffect } from "react";
type SaveStateStore = { put: () => Promise<void> };
export function useAutoSave({ store }: { store: SaveStateStore }) {
  const save = useCallback(() => store.put(), [store]);
  useEffect(() => { void save(); }, [save, store]);
}
`);
    expect(messages).toEqual([]);
  });

  it("allows a store hook called with arguments (a selector or useShallow)", async () => {
    const messages = await storeMessages(
      MODULE(`
  const picked = useFixtureStore((s) => ({ a: s.a }));
  useEffect(() => { void picked; }, [picked]);`)
    );
    expect(messages).toEqual([]);
  });

  it("does not run on test files", async () => {
    const messages = await storeMessages(
      MODULE(`
  const store = useFixtureStore();
  useEffect(() => { store.tick(); }, [store]);`),
      GAME_TEST_FILE
    );
    expect(messages).toEqual([]);
  });
});

describe("store-hook names", () => {
  it("knows a store hook by its Store suffix or by the list", () => {
    expect(isStoreHookName("useSnakeStore")).toBe(true);
    expect(isStoreHookName("use2048Store")).toBe(true);
    expect(isStoreHookName("useGameBreaks")).toBe(true);
    expect(isStoreHookName("useStore")).toBe(false);
    expect(isStoreHookName("useRestore")).toBe(false);
    expect(isStoreHookName("useCoarsePointer")).toBe(false);
  });

  /** Every non-test source file under src. */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "__tests__" && entry !== "node_modules") sourceFiles(full, out);
      } else if (/\.(m|c)?(j|t)sx?$/.test(entry) && !/\.(test|spec)\./.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  /** The names of the hooks made by Zustand's create() in the source tree. */
  function zustandHooks(): { name: string; file: string }[] {
    const hooks: { name: string; file: string }[] = [];
    for (const file of sourceFiles(path.join(WEB_ROOT, "src"))) {
      const code = readFileSync(file, "utf8");
      if (!/import\s*\{[^}]*\bcreate\b[^}]*\}\s*from\s*["']zustand["']/.test(code)) continue;
      const names = [...code.matchAll(/(?:const|let|var)\s+(use[A-Za-z0-9_]*)\s*=\s*create\b/g)].map((m) => m[1]);
      const calls = [...code.matchAll(/\bcreate\s*[<(]/g)].length;
      // A create() call that is not `const useX = create...` (an export
      // default, or a store made inside a function) would hide its hook
      // name from this scan. Fail so a person looks at it.
      expect(names.length, `${path.relative(WEB_ROOT, file)}: every zustand create() is \`const useX = create...\``).toBe(calls);
      for (const name of names) hooks.push({ name, file: path.relative(WEB_ROOT, file) });
    }
    return hooks;
  }

  it("covers every Zustand store hook in src, so no store gets past the rule by its name", () => {
    const hooks = zustandHooks();
    expect(hooks.length).toBeGreaterThan(30);
    const missed = hooks.filter((h) => !isStoreHookName(h.name)).map((h) => `${h.name} (${h.file})`);
    expect(missed, "add each name to OTHER_STORE_HOOKS in src/shared/lib/wholeStoreDepsRule.mjs").toEqual([]);
  });

  it("lists in OTHER_STORE_HOOKS only names that are still Zustand hooks without the Store suffix", () => {
    const names = new Set(zustandHooks().map((h) => h.name));
    const stale = OTHER_STORE_HOOKS.filter((name) => !names.has(name) || /Store$/.test(name));
    expect(stale, "remove each stale name from OTHER_STORE_HOOKS").toEqual([]);
  });
});
