import path from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

import { AUDIO_BUS_MESSAGE, LEGACY_AUDIO_SITE_PATHS } from "../../audio/audioBusRule.mjs";
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
/**
 * A legacy audio file: the touch ban must still apply there. It comes from
 * the list, so it stays a legacy file when a game moves onto the bus.
 */
const LEGACY_AUDIO_FILE = LEGACY_AUDIO_SITE_PATHS.find((file) => file.endsWith(".tsx"));

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
    expect(LEGACY_AUDIO_FILE, "the legacy list must name a .tsx file").toBeDefined();
    expect(LEGACY_AUDIO_SITE_PATHS).toContain(LEGACY_AUDIO_FILE);
    const messages = await touchMessages(
      COMPONENT(`<canvas onClick={act} onTouchStart={act} />`),
      LEGACY_AUDIO_FILE!
    );
    expect(messages).toEqual([DOUBLE_PATH_MESSAGE]);
  });

  it("reaches the legacy audio files through their own block (the audio ban is off there)", async () => {
    // A legacy file skips the first block, so the touch ban there comes
    // from the "hanks-hits/touch-input-legacy-audio" block. An ordinary
    // game file would pass the test above through the first block.
    const code = `"use client";
export function Fixture({ act }: { act: () => void }) {
  const ctx = new AudioContext();
  void ctx;
  return <canvas onClick={act} onTouchStart={act} />;
}
`;
    const [result] = await eslint.lintText(code, { filePath: path.join(WEB_ROOT, LEGACY_AUDIO_FILE!) });
    const messages = result.messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
    expect(messages).toEqual([DOUBLE_PATH_MESSAGE]);
    expect(messages.some((m) => m.startsWith(AUDIO_BUS_MESSAGE))).toBe(false);
  });

  it("is off in test files, which may build any element", async () => {
    const messages = await touchMessages(
      COMPONENT(`<canvas onClick={act} onTouchStart={act} />`),
      GAME_TEST_FILE
    );
    expect(messages).toEqual([]);
  });
});
