import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ESLint, Linter } from "eslint";

import {
  AUDIO_BUS_LINT_FILES,
  AUDIO_BUS_MESSAGE,
  AUDIO_BUS_RESTRICTED_SYNTAX,
  LEGACY_AUDIO_SITE_PATHS,
  LEGACY_AUDIO_SITES,
  SHIMMED_REALM_DOCUMENTS,
} from "../audioBusRule.mjs";
import {
  AUDIO_SHIM_BEGIN_MARKER,
  AUDIO_SHIM_END_MARKER,
  buildAudioShimSource,
} from "../audioShim";

/**
 * Every game and app plays its sound through the shared game-audio bus
 * (getGameAudio), so clips can hear it. ESLint bans the other ways in
 * TypeScript, and this test is the second net: it scans the real source
 * tree, including the static HTML games under public/, which ESLint never
 * reads (pattern: src/lib/__tests__/storage-keys.test.ts).
 *
 * It also makes the legacy list a one-way ratchet. Each listed file has a
 * ceiling: the number of bypasses in it today. A listed file that gets a
 * new bypass fails (ESLint skips listed files, so this test is the only
 * net for them). A file below its ceiling fails until the ceiling comes
 * down, and a file with no bypass left fails until its entry goes. So each
 * migration PR takes its files off the list, and the list only gets
 * shorter.
 */

// src/shared/lib/audio/__tests__ -> apps/web
const WEB_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const SOURCE_ROOTS = ["src/games", "src/apps"];
const DOCUMENT_ROOT = "public";
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;

/**
 * Each form makes sound that skips the bus. Mirrors the ESLint selectors.
 * Every pattern has the g flag: the ratchet counts each match.
 */
const AUDIO_BYPASS_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "new AudioContext()", pattern: /\bnew\s+AudioContext\b/g },
  // Any object, so a TypeScript cast is no way around it: (window as any).AudioContext
  { label: ".AudioContext", pattern: /\.\s*AudioContext\b/g },
  { label: '["AudioContext"]', pattern: /\[\s*["'`](?:webkit)?AudioContext["'`]\s*\]/g },
  { label: "{ AudioContext } =", pattern: /\{[^{}]*\bAudioContext\b[^{}]*\}\s*=(?!=)/g },
  { label: "webkitAudioContext", pattern: /\bwebkitAudioContext\b/g },
  { label: ".destination", pattern: /\.\s*destination(?![\w$-])/g },
  { label: '["destination"]', pattern: /\[\s*["'`]destination["'`]\s*\]/g },
  { label: "{ destination } =", pattern: /\{[^{}]*\bdestination\b[^{}]*\}\s*=(?!=)/g },
  { label: "new Audio()", pattern: /\bnew\s+(?:[\w$]+\s*\.\s*)?Audio\b/g },
  { label: 'createElement("audio")', pattern: /createElement\s*\(\s*["'`]audio["'`]/gi },
  { label: "<audio>", pattern: /<audio\b/gi },
  // three.js and drei audio: each makes three's own AudioContext.
  { label: "three.js audio", pattern: /\b(?:AudioListener|AudioLoader|PositionalAudio)\b/g },
  { label: "<positionalAudio>", pattern: /<\s*(?:positionalAudio|audioListener)\b/g },
  {
    label: "three.js audio import",
    pattern:
      /\bimport\s*\{[^}]*\b(?:Audio|AudioContext)\b[^}]*\}\s*from\s*["'](?:three|@react-three\/drei)(?:[^a-z"'][^"']*)?["']/g,
  },
];

/**
 * Remove // and block comments, keep strings (a string can still build
 * audio code, for example a srcdoc). A regex literal that holds "//" can
 * hide the rest of its line; ESLint still covers TypeScript files.
 */
function stripJsComments(code: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Cut out every inlined copy of the audio shim (it names the banned APIs on purpose). */
function stripAudioShim(code: string): string {
  let out = code;
  for (;;) {
    const start = out.indexOf(AUDIO_SHIM_BEGIN_MARKER);
    if (start === -1) return out;
    const end = out.indexOf(AUDIO_SHIM_END_MARKER, start);
    if (end === -1) return out;
    out = out.slice(0, start) + out.slice(end + AUDIO_SHIM_END_MARKER.length);
  }
}

type Bypasses = { labels: string[]; count: number };

/** Which forms the text uses (labels, in pattern order), and how many matches in all. */
function countBypasses(text: string): Bypasses {
  const labels: string[] = [];
  let count = 0;
  for (const { label, pattern } of AUDIO_BYPASS_PATTERNS) {
    const found = text.match(pattern)?.length ?? 0;
    if (found > 0) {
      labels.push(label);
      count += found;
    }
  }
  return { labels, count };
}

/** Bypasses in a JS/TS source file. */
function scanSourceCounted(code: string): Bypasses {
  return countBypasses(stripJsComments(code));
}

function scanSource(code: string): string[] {
  return scanSourceCounted(code).labels;
}

/** Bypasses in an HTML document: its inline scripts and its markup. */
function scanHtmlCounted(html: string): Bypasses {
  const scripts: string[] = [];
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi, (_match, body: string) => {
      scripts.push(stripJsComments(stripAudioShim(body)));
      return " ";
    });
  return countBypasses([markup, ...scripts].join("\n"));
}

function scanHtml(html: string): string[] {
  return scanHtmlCounted(html).labels;
}

function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, keep, out);
    } else if (keep(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** apps/web-relative path with forward slashes, the form the lists use. */
function webPath(full: string): string {
  return relative(WEB_ROOT, full).split(sep).join("/");
}

type Scanned = { path: string; bypasses: string[]; count: number };

function scannedFile(path: string, found: Bypasses): Scanned {
  return { path, bypasses: found.labels, count: found.count };
}

function scanTree(): Scanned[] {
  const files: Scanned[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of walk(
      join(WEB_ROOT, root),
      (name) => SOURCE_FILE.test(name) && !TEST_FILE.test(name)
    )) {
      files.push(scannedFile(webPath(file), scanSourceCounted(readFileSync(file, "utf8"))));
    }
  }
  for (const file of walk(join(WEB_ROOT, DOCUMENT_ROOT), (name) => /\.html?$/i.test(name))) {
    files.push(scannedFile(webPath(file), scanHtmlCounted(readFileSync(file, "utf8"))));
  }
  return files;
}

/** Every way a legacy entry can be wrong, one line each, in list order. */
function ratchetProblems(files: Scanned[], ceilings: Map<string, number>): string[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const problems: string[] = [];
  for (const [path, ceiling] of ceilings) {
    const file = byPath.get(path);
    if (!file) {
      problems.push(`${path}: the file is gone. Remove its entry from LEGACY_AUDIO_SITES.`);
    } else if (file.count === 0) {
      problems.push(
        `${path}: it now uses the bus. Remove its entry from LEGACY_AUDIO_SITES, so the lint rule protects it.`
      );
    } else if (file.count > ceiling) {
      problems.push(
        `${path}: ${file.count} bypasses, above its ceiling of ${ceiling} (${file.bypasses.join(", ")}). New sound in this file must use getGameAudio() (see change-a-game, "Sounds"). Never raise the ceiling.`
      );
    } else if (file.count < ceiling) {
      problems.push(
        `${path}: ${file.count} bypasses, below its ceiling of ${ceiling}. Lower its ceiling in LEGACY_AUDIO_SITES to ${file.count}.`
      );
    }
  }
  return problems;
}

const legacyCeilings = new Map<string, number>(Object.entries(LEGACY_AUDIO_SITES));
const legacy = new Set<string>(legacyCeilings.keys());
const shimmed = new Map<string, string>(Object.entries(SHIMMED_REALM_DOCUMENTS));
const RULE_FILE = "src/shared/lib/audio/audioBusRule.mjs";

describe("game audio goes through the shared bus", () => {
  const scanned = scanTree();

  it("scans the real tree (games, apps, and the HTML games)", () => {
    expect(scanned.length).toBeGreaterThan(100);
    expect(scanned.some((file) => file.path.startsWith("public/games/"))).toBe(true);
    // The scanner still sees a real bypass in the code: the legacy games
    // still on the list play to ctx.destination. (Read from the list, not
    // one named game, so the PR that moves a game onto the bus does not
    // break this check.)
    const legacyGames = [...legacy].filter((path) => path.startsWith("src/"));
    if (legacyGames.length > 0) {
      const seen = legacyGames.filter((path) =>
        scanned.find((file) => file.path === path)?.bypasses.includes(".destination")
      );
      expect(seen.length, "no legacy game file shows ctx.destination to the scanner").toBeGreaterThan(0);
    }
  });

  it("finds no new file that makes its own sound", () => {
    const offenders = scanned.filter(
      (file) => file.count > 0 && !legacy.has(file.path) && !shimmed.has(file.path)
    );
    expect(
      offenders,
      `These files make sound that skips the game-audio bus, so clips cannot hear it: ${offenders
        .map((file) => `${file.path} (${file.bypasses.join(", ")})`)
        .join("; ")}. ${AUDIO_BUS_MESSAGE}: make a channel with getGameAudio()?.channel("<app id>") and connect sounds to channel.input. An HTML game needs buildAudioShimSource() from its host (see SHIMMED_REALM_DOCUMENTS).`
    ).toEqual([]);
  });

  it("holds each legacy file at its ceiling: no new bypass, and no stale entry or ceiling", () => {
    const problems = ratchetProblems(scanned, legacyCeilings);
    expect(problems, `Fix LEGACY_AUDIO_SITES in ${RULE_FILE}:\n${problems.join("\n")}`).toEqual(
      []
    );
  });

  it("the ceiling check catches a new bypass in a legacy file, and each stale state", () => {
    const ceilings = new Map([
      ["src/games/a/lib/sounds.ts", 3],
      ["src/games/b/lib/sounds.ts", 3],
      ["src/games/c/lib/sounds.ts", 3],
      ["src/games/d/lib/sounds.ts", 3],
      ["src/games/e/lib/sounds.ts", 3],
    ]);
    const files: Scanned[] = [
      // "Add a horn to this game" wired one more sound to ctx.destination.
      { path: "src/games/a/lib/sounds.ts", bypasses: [".destination"], count: 4 },
      { path: "src/games/b/lib/sounds.ts", bypasses: [".destination"], count: 2 },
      { path: "src/games/c/lib/sounds.ts", bypasses: [], count: 0 },
      { path: "src/games/e/lib/sounds.ts", bypasses: [".destination"], count: 3 },
    ];
    const problems = ratchetProblems(files, ceilings);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/^src\/games\/a\/lib\/sounds\.ts: 4 bypasses, above its ceiling of 3/);
    expect(problems[1]).toMatch(/^src\/games\/b\/lib\/sounds\.ts: .*Lower its ceiling .* to 2\.$/);
    expect(problems[2]).toMatch(/^src\/games\/c\/lib\/sounds\.ts: it now uses the bus/);
    expect(problems[3]).toMatch(/^src\/games\/d\/lib\/sounds\.ts: the file is gone/);
  });

  it("keeps the legacy list clean: only game, app and public paths, each with a whole-number ceiling", () => {
    expect(LEGACY_AUDIO_SITE_PATHS).toEqual([...legacyCeilings.keys()]);
    for (const [path, ceiling] of legacyCeilings) {
      expect(path).toMatch(/^(src\/games\/|src\/apps\/|public\/)/);
      expect(path).not.toMatch(/\\|\*/);
      expect(Number.isInteger(ceiling) && ceiling > 0, `${path} ceiling`).toBe(true);
    }
  });

  it("checks that each shimmed HTML game has a host that prepends the shim", () => {
    for (const [documentPath, hostPath] of shimmed) {
      expect(legacy.has(documentPath), `${documentPath} is on both lists`).toBe(false);
      expect(existsSync(join(WEB_ROOT, documentPath)), documentPath).toBe(true);
      const host = join(WEB_ROOT, hostPath);
      expect(existsSync(host), hostPath).toBe(true);
      expect(readFileSync(host, "utf8"), `${hostPath} must use buildAudioShimSource()`).toMatch(
        /\bbuildAudioShimSource\s*\(/
      );
    }
  });

  it("scans the same folders that the ESLint rule covers", () => {
    const lintRoots = AUDIO_BUS_LINT_FILES.map((glob) => glob.split("/**")[0]);
    expect([...new Set(lintRoots)].sort()).toEqual([...SOURCE_ROOTS].sort());
  });
});

describe("the bypass detector", () => {
  it.each([
    ["new AudioContext()", "const ctx = new AudioContext();"],
    [".AudioContext", "const C = window.AudioContext ?? null;"],
    [".AudioContext", "const ctx = new (window.AudioContext)();"],
    [".AudioContext", "const C = (window as any).AudioContext;"],
    [".AudioContext", "const C = (globalThis as unknown as Win)?.AudioContext;"],
    [".AudioContext", "const ctx = THREE.AudioContext.getContext();"],
    ['["AudioContext"]', 'const ctx = new (globalThis as any)["AudioContext"]();'],
    ['["AudioContext"]', "const C = window['webkitAudioContext'];"],
    ["{ AudioContext } =", "const { AudioContext: C } = window;"],
    ["webkitAudioContext", "type W = { webkitAudioContext?: typeof AudioContext };"],
    [".destination", "gain.connect(ctx.destination);"],
    [".destination", "gain.connect(ctx?.destination);"],
    ['["destination"]', 'gain.connect(ctx["destination"]);'],
    ["{ destination } =", "const { destination } = ctx;"],
    ["{ destination } =", "const { destination: out, currentTime } = ctx;"],
    ["new Audio()", 'const horn = new Audio("/horn.mp3");'],
    ["new Audio()", "const horn = new window.Audio();"],
    ["new Audio()", "const horn = new THREE.Audio(listener);"],
    ['createElement("audio")', "document.createElement('audio');"],
    ["<audio>", 'return <audio src="/song.mp3" />;'],
    ["three.js audio", 'import { PositionalAudio } from "@react-three/drei";'],
    ["three.js audio", "const listener = new THREE.AudioListener();"],
    ["three.js audio", "new AudioLoader().load('/horn.mp3', onLoad);"],
    ["<positionalAudio>", "return <positionalAudio args={[listener]} />;"],
    ["three.js audio import", 'import { Audio, Vector3 } from "three";'],
    ["three.js audio import", "import { AudioContext as TC } from 'three/webgpu';"],
  ])("finds %s in %s", (label, code) => {
    expect(scanSource(code)).toContain(label);
  });

  it.each([
    "// never call ctx.destination or new AudioContext() here",
    "/* old code: new Audio('/x.mp3') */",
    "const trip = { destination: 'Oregon' };",
    "const name = trip.destinationName;",
    "el.className = 'fw-destination-list';",
    "document.querySelector('.destination-list');",
    "const offline = new OfflineAudioContext(1, 48000, 48000);",
    "function play(ctx: BaseAudioContext, out: AudioNode) {}",
    "const state: AudioContextState = 'running';",
    "const bus = getGameAudio(); bus?.channel('snake').input;",
    "const buf = new AudioBuffer({ length: 1, sampleRate: 48000 });",
    'import { Vector3, Mesh } from "three";',
    "const same = { destination: 1 } === other;",
  ])("allows %s", (code) => {
    expect(scanSource(code)).toEqual([]);
  });

  it("counts every match, so a legacy file cannot hide a second bypass", () => {
    expect(scanSourceCounted("a.connect(ctx.destination);").count).toBe(1);
    expect(
      scanSourceCounted("a.connect(ctx.destination);\nb.connect(ctx.destination);").count
    ).toBe(2);
    expect(scanSourceCounted("const c = new AudioContext(); g.connect(c.destination);")).toEqual({
      labels: ["new AudioContext()", ".destination"],
      count: 2,
    });
  });

  it("reads an HTML game's scripts and markup, and skips an inlined shim", () => {
    const shimOnly = `<html><head><script>${buildAudioShimSource()}</script></head><body></body></html>`;
    expect(scanHtml(shimOnly)).toEqual([]);

    const legacyGame =
      "<html><body><script>var a = new (window.AudioContext || window.webkitAudioContext)();</script></body></html>";
    expect(scanHtml(legacyGame)).toEqual([".AudioContext", "webkitAudioContext"]);

    expect(scanHtml('<body><audio src="/theme.mp3" autoplay></audio></body>')).toContain("<audio>");
    expect(scanHtml("<body><!-- <audio> was removed --><p>Pick a destination.</p></body>")).toEqual(
      []
    );
  });
});

describe("the ESLint rule", () => {
  const linter = new Linter({ configType: "flat" });
  const config = [
    {
      files: ["**/*.js"],
      languageOptions: {
        ecmaVersion: "latest" as const,
        sourceType: "module" as const,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      rules: {
        "no-restricted-syntax": ["error", ...AUDIO_BUS_RESTRICTED_SYNTAX] as Linter.RuleEntry,
      },
    },
  ];
  const lint = (code: string) =>
    linter.verify(code, config, { filename: "game.js" }).map((message) => message.message);

  it.each([
    "const ctx = new AudioContext();",
    "const ctx = new window.AudioContext();",
    "const ctx = new (window.AudioContext || window.webkitAudioContext)();",
    "const ctx = new globalThis.AudioContext();",
    "const ctx = THREE.AudioContext.getContext();",
    "const ctx = new window['AudioContext']();",
    "const C = self['webkitAudioContext'];",
    "const { AudioContext } = window;",
    "gain.connect(ctx.destination);",
    'gain.connect(ctx["destination"]);',
    "const { destination } = ctx;",
    'const horn = new Audio("/horn.mp3");',
    "const horn = new window.Audio();",
    "const horn = new THREE.Audio(listener);",
    "document.createElement('audio');",
    "const song = <audio src='/song.mp3' />;",
    'import { PositionalAudio } from "@react-three/drei";',
    'import { AudioListener, Vector3 } from "three";',
    "import { Audio } from 'three/webgpu';",
    "const listener = new THREE.AudioListener();",
    "const horn = <PositionalAudio url='/horn.mp3' distance={2} />;",
    "const horn = <positionalAudio args={[listener]} />;",
    "const ears = <audioListener />;",
  ])("bans %s", (code) => {
    const messages = lint(code);
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(message.startsWith(AUDIO_BUS_MESSAGE)).toBe(true);
  });

  it.each([
    "const trip = { destination: 'Oregon' };",
    "const bus = getGameAudio(); if (bus) osc.connect(bus.channel('snake').input);",
    "const offline = new OfflineAudioContext(1, 48000, 48000);",
    "const el = document.createElement('div');",
    "const box = <div className='fw-destination-list' />;",
    'import { Vector3, Mesh } from "three";',
    'import { OrbitControls, Text } from "@react-three/drei";',
    "import { Audio } from './my-own-audio';",
  ])("allows %s", (code) => {
    expect(lint(code)).toEqual([]);
  });

  it("is wired into apps/web/eslint.config.mjs with the shared legacy list", () => {
    const configSource = readFileSync(join(WEB_ROOT, "eslint.config.mjs"), "utf8");
    expect(configSource).toContain('from "./src/shared/lib/audio/audioBusRule.mjs"');
    expect(configSource).toMatch(/\.\.\.LEGACY_AUDIO_SITE_PATHS/);
    expect(configSource).toMatch(/\.\.\.AUDIO_BUS_RESTRICTED_SYNTAX/);
    expect(configSource).toMatch(/\.\.\.AUDIO_BUS_LINT_FILES/);
  });
});

/**
 * The real apps/web ESLint config, with its real TypeScript parser. The
 * checks above use a plain JavaScript parser, so they cannot see
 * TypeScript-only forms such as `(window as any).AudioContext`.
 */
describe("the real ESLint config on TypeScript game code", () => {
  const eslint = new ESLint({ cwd: WEB_ROOT });
  const busMessages = async (code: string, filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath: join(WEB_ROOT, filePath) });
    return result.messages
      .filter((message) => message.ruleId === "no-restricted-syntax")
      .map((message) => message.message);
  };

  it.each([
    "export const C = (window as any).AudioContext;",
    'export const ctx = new (globalThis as any)["AudioContext"]();',
    "export function out(ctx: BaseAudioContext) { const { destination } = ctx; return destination; }",
    "export const ctx = new (window.AudioContext as typeof AudioContext)();",
    'import { PositionalAudio } from "@react-three/drei";\nexport const Horn = () => <PositionalAudio url="/horn.mp3" />;',
  ])("bans %s in a new game file", async (code) => {
    const messages = await busMessages(code, "src/games/new-game/lib/sounds.tsx");
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(message.startsWith(AUDIO_BUS_MESSAGE)).toBe(true);
  }, 60_000);

  it("allows bus code in a new game file", async () => {
    const code =
      'import { getGameAudio } from "@/shared/lib/audio";\n' +
      "export function beep(): void {\n" +
      '  const channel = getGameAudio()?.channel("new-game");\n' +
      "  if (!channel) return;\n" +
      "  const osc = channel.context.createOscillator();\n" +
      "  osc.connect(channel.input);\n" +
      "  osc.start();\n" +
      "}\n";
    expect(await busMessages(code, "src/games/new-game/lib/sounds.ts")).toEqual([]);
  }, 60_000);

  it("skips a legacy file (the source-scan ceiling guards it instead)", async () => {
    const [legacyPath] = LEGACY_AUDIO_SITE_PATHS.filter((path) => path.startsWith("src/"));
    const code = "export const ctx = new AudioContext();\nexport const out = ctx.destination;\n";
    expect(await busMessages(code, legacyPath)).toEqual([]);
  }, 60_000);
});
