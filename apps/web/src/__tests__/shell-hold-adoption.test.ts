import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every game or app that runs its own loop and mounts GameShell with
// canPause={false} reads the shell's hold (useShellHold, or the
// onShellOverlayOpen callback), so it stands still under a shell overlay
// (the restart question, the leaderboard, the install steps, a clip sheet,
// the orientation tip) and in a hidden tab. So does every game whose
// metadata declares a preferredOrientation: the tip shows in the commit
// that starts the run. design/ARCHITECTURE.md, "Pause, holds and shell
// overlays".
//
// Why: the shell's hold had no subscribers. Flappy Bird fell to the floor
// under "Turn your phone upright", Math Attack lost two lives in a 25 s
// background, Hill Climb drove 213 m to 890 m under "Restart game?" (phone
// UX audit 2026-09-29, S7 and S8; review of phone/foundation). A unit test
// of GameShell proves the callback fires; only a scan of the games proves
// that a game listens.
//
// This test reads the source, because a module's loop runs in a browser.

const SRC = path.resolve(__dirname, "..");

/** A wrapper file mounts GameShell with a literal canPause={false}. */
const NO_PAUSE_SHELL = /<GameShell\b[\s\S]*?canPause=\{false\}/;
/** The module runs its own loop. */
// useGameLoop counts too: the shared fixed-step loop does not read the hold
// itself, so a game that runs through it still must.
const OWN_LOOP = /\b(?:requestAnimationFrame|setInterval|useFrame|useGameLoop)\s*\(/;
/** The module declares an orientation, so the tip can show over it. */
const ORIENTATION = /\bpreferredOrientation:\s*["'](?:portrait|landscape)["']/;
/** The module reads the hold. */
const ADOPTED = /\buseShellHold\s*\(|\bonShellOverlayOpen=/;

/**
 * Modules with an own loop that do not read the hold, each with the
 * reason. Add nothing here for a game: read useShellHold in its loop.
 */
const EXEMPT: { module: string; reason: string }[] = [
  {
    module: "games/cookie-clicker",
    reason: "an idle game: time passes by design, with offline earnings; a held clock would be a bug there",
  },
  {
    module: "apps/virtual-pet",
    reason: "an idle pet: its needs grow by design while the kid is away",
  },
  {
    module: "apps/drum-machine",
    reason: "a music toy: the sequencer's beat is not game time, and no life or score depends on it",
  },
  {
    module: "apps/drawing-app",
    reason: "a toy with no game time: its frame loop draws the stroke under the finger",
  },
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

/** Source text without comments, so a loop named in prose does not count. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The module id (games/<id> or apps/<id>) of a file under src, or null. */
function moduleOf(file: string): string | null {
  const rel = path.relative(SRC, file).split(path.sep);
  return (rel[0] === "games" || rel[0] === "apps") && rel.length > 2 ? `${rel[0]}/${rel[1]}` : null;
}

interface Module {
  id: string;
  wrapper: string;
  files: string[];
  ownLoop: boolean;
  orientation: boolean;
  adopted: boolean;
}

/** Every module behind a canPause={false} GameShell mount. */
function noPauseModules(): Module[] {
  const wrappers = [
    ...sourceFiles(path.join(SRC, "games")),
    ...sourceFiles(path.join(SRC, "apps")),
    ...sourceFiles(path.join(SRC, "app")),
  ].filter((file) => NO_PAUSE_SHELL.test(code(file)));

  const modules = new Map<string, Module>();
  for (const wrapper of wrappers) {
    const text = readFileSync(wrapper, "utf8");
    const ids = new Set<string>();
    const own = moduleOf(wrapper);
    if (own) ids.add(own);
    for (const m of text.matchAll(/["']@\/((?:games|apps)\/[a-z0-9-]+)/g)) ids.add(m[1]);
    for (const id of ids) {
      const dir = path.join(SRC, id);
      const files = [wrapper, ...sourceFiles(dir)];
      const texts = files.map(code);
      const metadata = path.join(dir, "metadata.ts");
      modules.set(id, {
        id,
        wrapper: path.relative(SRC, wrapper),
        files: files.map((f) => path.relative(SRC, f)),
        ownLoop: texts.some((t) => OWN_LOOP.test(t)),
        orientation: existsSync(metadata) && ORIENTATION.test(code(metadata)),
        adopted: texts.some((t) => ADOPTED.test(t)),
      });
    }
  }
  return [...modules.values()].sort((a, b) => a.id.localeCompare(b.id));
}

describe("every own-loop game behind a canPause={false} GameShell reads the shell's hold", () => {
  const modules = noPauseModules();
  const exempt = new Map(EXEMPT.map((e) => [e.module, e.reason]));

  it("finds the audited modules (the scan patterns work)", () => {
    const ids = modules.map((m) => m.id);
    for (const id of [
      "games/flappy-bird",
      "games/endless-runner",
      // Math Attack left the list in PR-G5: it pauses through the shell now
      // (and still reads the hold).
      "games/dino-runner",
      "games/hill-climb",
      "games/monster-truck",
      // four-wheeler-3d left this list in PR-G1: it pauses through the shell
      // once the ride starts (canPause={hasStarted}), and still reads the hold.
      "apps/trivia",
    ]) {
      expect(ids, `${id} mounts GameShell with canPause={false}`).toContain(id);
      const m = modules.find((x) => x.id === id)!;
      expect(m.ownLoop || m.orientation, `${id} has an own loop or an orientation`).toBe(true);
    }
    expect(modules.find((m) => m.id === "games/flappy-bird")!.orientation).toBe(true);
  });

  it("each module with an own loop or an orientation reads the hold, unless it is exempt for a reason", () => {
    const missing = modules
      .filter((m) => (m.ownLoop || m.orientation) && !m.adopted && !exempt.has(m.id))
      .map(
        (m) =>
          `${m.id} (${m.wrapper}): ${m.orientation ? "declares preferredOrientation" : "runs its own loop"} and never reads useShellHold() or passes onShellOverlayOpen`
      );
    expect(
      missing,
      `Own-loop games that the shell cannot hold. Read useShellHold() in the loop (skip the update while it is true), or pass onShellOverlayOpen/onShellOverlayClose to GameShell:\n${missing.join("\n")}`
    ).toEqual([]);
  });

  it("a game with an orientation is never exempt: the tip shows over a run", () => {
    for (const m of modules) {
      if (m.orientation) expect(exempt.has(m.id), `${m.id} declares preferredOrientation and is exempt`).toBe(false);
    }
  });

  it("every exemption still names a canPause={false} module with an own loop (a stale entry hides a new game)", () => {
    for (const { module: id } of EXEMPT) {
      const m = modules.find((x) => x.id === id);
      expect(m, `${id} no longer mounts GameShell with canPause={false}: delete its exemption`).toBeDefined();
      expect(m!.ownLoop, `${id} no longer runs its own loop: delete its exemption`).toBe(true);
      expect(m!.adopted, `${id} reads the hold now: delete its exemption`).toBe(false);
    }
  });

  it("the patterns match the shapes they are for", () => {
    for (const good of [
      '<GameShell gameName="Flappy Bird" appId="flappy-bird" canPause={false} onRestart={reset}>',
      '<GameShell\n  gameName="Hill Climb"\n  appId="hill-climb"\n  canPause={false}\n  showPauseButton={false}\n>',
    ]) {
      expect(NO_PAUSE_SHELL.test(good), good).toBe(true);
    }
    expect(NO_PAUSE_SHELL.test('<GameShell gameName="Hopper" canPause={canPause} onPause={pauseGame}>')).toBe(false);
    expect(OWN_LOOP.test("animationFrameRef.current = requestAnimationFrame(gameLoop);")).toBe(true);
    expect(OWN_LOOP.test("timerRef.current = setInterval(() => {")).toBe(true);
    expect(OWN_LOOP.test("useFrame((state, delta) => {")).toBe(true);
    expect(OWN_LOOP.test("useGameLoop({ update, render }, { running: true, paused: held });")).toBe(true);
    expect(OWN_LOOP.test("useEffect(() => {")).toBe(false);
    expect(ORIENTATION.test('preferredOrientation: "portrait",')).toBe(true);
    expect(ORIENTATION.test('preferredOrientation: "any",')).toBe(false);
    expect(ADOPTED.test("const held = useShellHold();")).toBe(true);
    expect(ADOPTED.test("onShellOverlayOpen={() => store.hold()}")).toBe(true);
    expect(ADOPTED.test("const held = false;")).toBe(false);
  });
});
