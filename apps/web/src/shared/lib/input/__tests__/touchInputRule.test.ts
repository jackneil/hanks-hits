import path from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

import {
  DOUBLE_PATH_MESSAGE,
  PASSIVE_PREVENT_DEFAULT_MESSAGE,
  TOUCH_INPUT_LINT_FILES,
} from "../touchInputRule.mjs";

// The ESLint ban behind the 2026 phone audit (root cause S4): a JSX element
// with onTouchStart next to onClick or onMouseDown runs its action twice per
// tap, and preventDefault() inside a React onTouch* handler is a no-op that
// logs an error. This test lints fixture components through the real
// eslint.config.mjs, so a change to the config or the selectors that lets
// the double path back in fails here.

const WEB_ROOT = path.resolve(__dirname, "../../../../..");

/** A path under src/games, where the rule applies. */
const GAME_FILE = "src/games/fixture-game/Game.tsx";
/** A test path under src/games, where the rule is off. */
const GAME_TEST_FILE = "src/games/fixture-game/__tests__/Game.test.tsx";
/** A legacy audio file: the touch ban must still apply there. */
const LEGACY_AUDIO_FILE = "src/games/space-invaders/Game.tsx";

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: WEB_ROOT,
    overrideConfigFile: path.join(WEB_ROOT, "eslint.config.mjs"),
  });
});

async function touchMessages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(WEB_ROOT, filePath) });
  return result.messages
    .filter((m) => m.ruleId === "no-restricted-syntax")
    .map((m) => m.message)
    .filter((m) => m === DOUBLE_PATH_MESSAGE || m === PASSIVE_PREVENT_DEFAULT_MESSAGE);
}

const COMPONENT = (jsx: string) => `
"use client";
export function Fixture({ act }: { act: () => void }) {
  return ${jsx};
}
`;

describe("hanks-hits/touch-input ESLint rule", () => {
  it("covers every game and app module", () => {
    expect(TOUCH_INPUT_LINT_FILES).toEqual([
      "src/games/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "src/apps/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ]);
  });

  it("flags onTouchStart together with onClick on one element (the Hextris double spin)", async () => {
    const messages = await touchMessages(
      COMPONENT(`<canvas onClick={act} onTouchStart={act} />`),
      GAME_FILE
    );
    expect(messages).toEqual([DOUBLE_PATH_MESSAGE]);
  });

  it("flags onTouchStart together with onMouseDown on one element (the Asteroids pad)", async () => {
    const messages = await touchMessages(
      COMPONENT(`<button type="button" onTouchStart={act} onMouseDown={act} />`),
      GAME_FILE
    );
    expect(messages).toEqual([DOUBLE_PATH_MESSAGE]);
  });

  it("flags preventDefault() inside an inline onTouch* handler", async () => {
    const messages = await touchMessages(
      COMPONENT(
        `<button type="button" onTouchStart={(e) => { e.preventDefault(); act(); }} onTouchEnd={(e) => e.preventDefault()} />`
      ),
      GAME_FILE
    );
    expect(messages).toEqual([PASSIVE_PREVENT_DEFAULT_MESSAGE, PASSIVE_PREVENT_DEFAULT_MESSAGE]);
  });

  it("does not flag a nested element's onClick as the parent's", async () => {
    const messages = await touchMessages(
      COMPONENT(`<div onTouchStart={act}><button type="button" onClick={act} /></div>`),
      GAME_FILE
    );
    expect(messages).toEqual([]);
  });

  it("allows one input path: onClick alone, pointer handlers, or a spread from the shared hooks", async () => {
    const messages = await touchMessages(
      COMPONENT(`<>
        <canvas onClick={act} />
        <button type="button" onPointerDown={act} onPointerUp={act} onPointerCancel={act} />
      </>`),
      GAME_FILE
    );
    expect(messages).toEqual([]);
  });

  it("still applies to the legacy audio files", async () => {
    const messages = await touchMessages(
      COMPONENT(`<canvas onClick={act} onTouchStart={act} />`),
      LEGACY_AUDIO_FILE
    );
    expect(messages).toEqual([DOUBLE_PATH_MESSAGE]);
  });

  it("is off in test files, which may build any element", async () => {
    const messages = await touchMessages(
      COMPONENT(`<canvas onClick={act} onTouchStart={act} />`),
      GAME_TEST_FILE
    );
    expect(messages).toEqual([]);
  });
});
