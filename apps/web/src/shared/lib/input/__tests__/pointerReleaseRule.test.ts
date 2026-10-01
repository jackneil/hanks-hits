import path from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

import { AUDIO_BUS_MESSAGE, LEGACY_AUDIO_SITE_PATHS } from "../../audio/audioBusRule.mjs";
import {
  POINTER_RELEASE_LINT_FILES,
  POINTER_RELEASE_MESSAGE,
  R3F_POINTER_UP_MESSAGE,
  R3F_RELEASE_FIELD_MESSAGE,
} from "../pointerReleaseRule.mjs";
import { DOUBLE_PATH_MESSAGE } from "../touchInputRule.mjs";

// The pointer-release rule: a decision about where a pointer let go must
// not read the position of the pointerup event. iPhone Safari can send a
// pointerup at (0, 0) (iPhone SE, iOS 27, 2026-10-01), so the clip button
// took every tap for a drag off. Read createPointerTrail().release().
//
// This test lints fixture modules through the real eslint.config.mjs, so a
// change to the config or the rule that lets a pointerup position read back
// in fails here.

const WEB_ROOT = path.resolve(__dirname, "../../../../..");
const RULE_ID = "hanks-hits/no-pointerup-position";

/** A path under src/games: the rule shares the file with the audio and touch bans. */
const GAME_FILE = "src/games/fixture-game/Game.tsx";
/** A path under src/shared. */
const SHARED_FILE = "src/shared/fixture/Control.tsx";
/** A legacy audio file (it skips the audio ban, not this rule). */
const LEGACY_AUDIO_FILE = LEGACY_AUDIO_SITE_PATHS.find((file) => file.endsWith(".tsx"));
/** Test paths, where the rule is off. */
const GAME_TEST_FILE = "src/games/fixture-game/__tests__/Game.test.tsx";
const SHARED_TEST_FILE = "src/shared/fixture/__tests__/Control.test.tsx";

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: WEB_ROOT,
    overrideConfigFile: path.join(WEB_ROOT, "eslint.config.mjs"),
  });
});

async function lint(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(WEB_ROOT, filePath) });
  const fatal = result.messages.filter((m) => m.fatal);
  expect(fatal, "the fixture must parse").toEqual([]);
  return result.messages;
}

async function releaseMessages(code: string, filePath: string): Promise<string[]> {
  return (await lint(code, filePath)).filter((m) => m.ruleId === RULE_ID).map((m) => m.message);
}

const RELEASE = POINTER_RELEASE_MESSAGE;

/** [name, code, expected messages]. Each form reads a pointerup position. */
const BANNED_FORMS: Array<[string, string, string[]]> = [
  [
    "an inline JSX onPointerUp handler",
    `export function Fixture({ act }: { act: (x: number, y: number) => void }) {
  return <div onPointerUp={(e) => act(e.clientX, e.clientY)} />;
}`,
    [RELEASE, RELEASE],
  ],
  [
    "an onPointerUp method in an object (a handler set)",
    `export const handlers = {
  onPointerUp(event: PointerEvent) {
    return event.pageX;
  },
};`,
    [RELEASE],
  ],
  [
    'an inline listener for addEventListener("pointerup")',
    `export function listen(target: EventTarget, act: (y: number) => void) {
  target.addEventListener("pointerup", (event) => act((event as PointerEvent).screenY));
}`,
    [RELEASE],
  ],
  [
    "a named release handler that is bound in another module (the clip button's endPointer)",
    `export const endPointer = (event: PointerEvent) => event.offsetX;
export function handlePointerUp(event: PointerEvent) {
  return event.offsetY;
}`,
    [RELEASE, RELEASE],
  ],
  [
    "a destructured position and the x and y aliases",
    `export function Fixture({ act }: { act: (x: number, y: number) => void }) {
  return (
    <>
      <div onPointerUp={({ clientX }) => act(clientX, 0)} />
      <div onPointerUpCapture={(e) => act(e.x, e.nativeEvent.y)} />
    </>
  );
}`,
    [RELEASE, RELEASE, RELEASE],
  ],
  [
    "an onpointerup property",
    `export function listen(el: HTMLElement, act: (x: number) => void) {
  el.onpointerup = (e) => act(e.clientX);
}`,
    [RELEASE],
  ],
  // A handler bound by reference: the rule finds its declaration.
  [
    "a JSX onPointerUp bound to a handler with another name",
    `export function Fixture({ act }: { act: (x: number) => void }) {
  const handleUp = (e: React.PointerEvent) => act(e.clientX);
  return <div onPointerUp={handleUp} />;
}`,
    [RELEASE],
  ],
  [
    'addEventListener("pointerup", up) with a named listener (the ChaseCamera shape)',
    `export function listen(canvas: HTMLCanvasElement, act: (x: number) => void) {
  const up = (e: PointerEvent) => act(e.clientX);
  canvas.addEventListener("pointerup", up);
}`,
    [RELEASE],
  ],
  [
    "a useCallback handler",
    `import { useCallback } from "react";
export function Fixture({ act }: { act: (x: number) => void }) {
  const onRelease = useCallback((e: React.PointerEvent) => act(e.clientX), [act]);
  return <div onPointerUp={onRelease} />;
}`,
    [RELEASE],
  ],
  [
    "a window listener in an effect",
    `import { useEffect } from "react";
export function Fixture({ act }: { act: (y: number) => void }) {
  useEffect(() => {
    function onUp(e: PointerEvent) {
      act(e.pageY);
    }
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [act]);
  return null;
}`,
    [RELEASE],
  ],
  [
    "a handler set with { onPointerUp: end } (the useTouchInput shape)",
    `export function createHold(act: (x: number) => void) {
  const end = (event: PointerEvent) => act(event.clientX);
  return { onPointerUp: end, onPointerCancel: end };
}`,
    [RELEASE],
  ],
  [
    "a template-literal event name",
    "export function listen(target: EventTarget, act: (x: number) => void) {\n  target.addEventListener(`pointerup`, (e) => act((e as PointerEvent).clientX));\n}",
    [RELEASE],
  ],
  [
    "a parameter with any name (p.x)",
    `export function Fixture({ act }: { act: (x: number) => void }) {
  return <div onPointerUp={(p) => act(p.x)} />;
}`,
    [RELEASE],
  ],
  [
    "the event handed to a function of the file",
    `function finish(ev: PointerEvent, how: string) {
  return ev.screenX + how;
}
export function Fixture() {
  return <div onPointerUp={(e) => finish(e.nativeEvent, "up")} />;
}`,
    [RELEASE],
  ],
  [
    "an alias of the event and a destructured parameter",
    `export function Fixture({ act }: { act: (x: number) => void }) {
  return <div onPointerUp={(e) => { const native = e.nativeEvent as PointerEvent; act(native.offsetX); }} />;
}
export function listen(target: EventTarget, act: (x: number) => void) {
  function onUp({ clientX }: PointerEvent) {
    act(clientX);
  }
  target.addEventListener("pointerup", onUp as EventListener);
}`,
    [RELEASE, RELEASE],
  ],
  [
    "a handler in an object literal and a class member",
    `const handlers = { up(e: PointerEvent) { return e.clientY; } };
export function Fixture() {
  return <div onPointerUp={handlers.up} />;
}
export class Dragger {
  el = document.body;
  handleUp = (e: PointerEvent) => e.clientX;
  attach() {
    this.el.addEventListener("pointerup", this.handleUp);
  }
}`,
    [RELEASE, RELEASE],
  ],
  [
    "a handler in a conditional (the World Map shape)",
    `export function Fixture({ mini, act }: { mini: boolean; act: (x: number) => void }) {
  return <div onPointerUp={mini ? undefined : (e) => act(e.clientX)} />;
}`,
    [RELEASE],
  ],
  // React Three Fiber.
  [
    "onPointerUp on a React Three Fiber object",
    `export function Fixture({ act }: { act: () => void }) {
  return <mesh onPointerUp={act} />;
}`,
    [R3F_POINTER_UP_MESSAGE],
  ],
  [
    "onPointerUp on a drei component (drei passes it to a three.js object)",
    `import { Text } from "@react-three/drei";
export function Fixture({ act }: { act: () => void }) {
  return <Text onPointerUp={act}>Hi</Text>;
}`,
    [R3F_POINTER_UP_MESSAGE],
  ],
  [
    "onPointerUp on an R3F object whose onPointerDown does not capture",
    `export function Fixture({ act }: { act: () => void }) {
  return <group onPointerDown={act} onPointerUp={act} />;
}`,
    [R3F_POINTER_UP_MESSAGE],
  ],
  [
    "the R3F release fields on a captured object",
    `export function Fixture({ act }: { act: (p: unknown) => void }) {
  return (
    <mesh
      onPointerDown={(e) => (e.target as Element).setPointerCapture(e.pointerId)}
      onPointerUp={(e) => act([e.point, e.pointer, e.ray, e.unprojectedPoint, e.intersections])}
    />
  );
}`,
    [
      R3F_RELEASE_FIELD_MESSAGE,
      R3F_RELEASE_FIELD_MESSAGE,
      R3F_RELEASE_FIELD_MESSAGE,
      R3F_RELEASE_FIELD_MESSAGE,
      R3F_RELEASE_FIELD_MESSAGE,
    ],
  ],
];

/** Code that the rule must allow. */
const ALLOWED_FORMS: Array<[string, string]> = [
  [
    "position reads on pointerdown, pointermove and click, and the trail's release point",
    `import { createPointerTrail } from "@/shared/lib/input";
const trail = createPointerTrail();
export function listen(target: EventTarget, act: (x: number) => void) {
  target.addEventListener("pointermove", (event) => act((event as PointerEvent).clientX));
  target.addEventListener("pointerdown", (event) => act((event as PointerEvent).clientX));
}
export function Fixture({ act }: { act: (x: number, y: number) => void }) {
  const onUp = (e: React.PointerEvent) => {
    const at = trail.release(e);
    act(at.x, at.y);
  };
  return (
    <>
      <div
        onPointerDown={(e) => { trail.down(e); act(e.clientX, e.clientY); }}
        onPointerMove={(e) => { trail.move(e); act(e.clientX, e.clientY); }}
        onPointerUp={(e) => { const at = trail.release(e); act(at.x, at.y); }}
        onClick={(e) => act(e.clientX, e.clientY)}
      />
      <div onPointerUp={onUp} />
    </>
  );
}`,
  ],
  [
    "a release that reads only the pointer id, the type and the time",
    `export function Fixture({ act }: { act: (n: number) => void }) {
  const end = (e: React.PointerEvent) => act(e.pointerId + e.timeStamp + e.pointerType.length);
  return <div onPointerUp={end} />;
}`,
  ],
  [
    "a captured R3F object that ends a drag without a position",
    `export function Fixture({ act }: { act: (n: number) => void }) {
  const grab = (e: { pointerId: number; target: EventTarget }) => (e.target as Element).setPointerCapture(e.pointerId);
  return <mesh onPointerDown={grab} onPointerUp={(e) => act(e.pointerId)} onClick={(e) => act(e.point.x)} />;
}`,
  ],
  [
    "onPointerUp on the R3F Canvas (a DOM element) and on an SVG element",
    `import { Canvas } from "@react-three/fiber";
export function Fixture({ act }: { act: () => void }) {
  return (
    <>
      <Canvas onPointerUp={act} />
      <svg><rect onPointerUp={act} /></svg>
    </>
  );
}`,
  ],
];

describe("hanks-hits/no-pointerup-position ESLint rule", () => {
  it("covers all of src", () => {
    expect(POINTER_RELEASE_LINT_FILES).toEqual(["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"]);
    expect(LEGACY_AUDIO_FILE, "the legacy list must name a .tsx file").toBeDefined();
  });

  for (const [where, filePath] of [
    ["a game file", GAME_FILE],
    ["a shared file", SHARED_FILE],
    ["a legacy audio file", LEGACY_AUDIO_FILE!],
  ] as const) {
    it.each(BANNED_FORMS)(`flags %s in ${where}`, async (_name, code, expected) => {
      expect(await releaseMessages(code, filePath)).toEqual(expected);
    });

    it.each(ALLOWED_FORMS)(`allows %s in ${where}`, async (_name, code) => {
      expect(await releaseMessages(code, filePath)).toEqual([]);
    });
  }

  it.each([
    ["a game test", GAME_TEST_FILE],
    ["a shared test", SHARED_TEST_FILE],
  ])("is off in %s", async (_name, filePath) => {
    for (const [, code] of BANNED_FORMS) {
      expect(await releaseMessages(code, filePath)).toEqual([]);
    }
  });

  it("keeps the audio and touch-input bans in a game file (its own rule, nothing replaced)", async () => {
    const code = `export function Fixture({ act }: { act: (x?: number) => void }) {
  const ctx = new AudioContext();
  void ctx;
  return <canvas onClick={() => act()} onTouchStart={() => act()} onPointerUp={(e) => act(e.clientX)} />;
}`;
    const messages = await lint(code, GAME_FILE);
    const restricted = messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
    expect(restricted).toContain(DOUBLE_PATH_MESSAGE);
    expect(restricted.some((m) => m.startsWith(AUDIO_BUS_MESSAGE))).toBe(true);
    expect(messages.filter((m) => m.ruleId === RULE_ID).map((m) => m.message)).toEqual([RELEASE]);
  });

  it("adds no touch or audio ban outside games and apps", async () => {
    // The clip controls stop touch events on an element that also has
    // onClick: that is not the double path, so shared code keeps it.
    const code = `export function Fixture({ act }: { act: (x?: number) => void }) {
  const ctx = new AudioContext();
  void ctx;
  return <button type="button" onClick={() => act()} onTouchStart={() => act()} onPointerUp={(e) => act(e.clientX)} />;
}`;
    const messages = await lint(code, SHARED_FILE);
    expect(messages.filter((m) => m.ruleId === "no-restricted-syntax")).toEqual([]);
    expect(messages.filter((m) => m.ruleId === RULE_ID).map((m) => m.message)).toEqual([RELEASE]);
  });
});
