import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Linter } from "eslint";

import {
  AUDIO_BUS_LINT_FILES,
  AUDIO_BUS_MESSAGE,
  AUDIO_BUS_RESTRICTED_SYNTAX,
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
 * It also makes the legacy list a one-way ratchet: an entry must still
 * exist and still break the rule, so each migration PR has to take its
 * files off the list, and the list can only get shorter.
 */

// src/shared/lib/audio/__tests__ -> apps/web
const WEB_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const SOURCE_ROOTS = ["src/games", "src/apps"];
const DOCUMENT_ROOT = "public";
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;

/** Each form makes sound that skips the bus. Mirrors the ESLint selectors. */
const AUDIO_BYPASS_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "new AudioContext()", pattern: /\bnew\s+AudioContext\b/ },
  { label: "window.AudioContext", pattern: /\b(?:window|globalThis|self)\s*\.\s*AudioContext\b/ },
  { label: "webkitAudioContext", pattern: /\bwebkitAudioContext\b/ },
  { label: ".destination", pattern: /\.\s*destination(?![\w$-])/ },
  { label: '["destination"]', pattern: /\[\s*["'`]destination["'`]\s*\]/ },
  { label: "new Audio()", pattern: /\bnew\s+(?:(?:window|globalThis|self)\s*\.\s*)?Audio\b/ },
  { label: 'createElement("audio")', pattern: /createElement\s*\(\s*["'`]audio["'`]/i },
  { label: "<audio>", pattern: /<audio\b/i },
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

function findBypasses(text: string): string[] {
  return AUDIO_BYPASS_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ label }) => label
  );
}

/** Bypasses in a JS/TS source file. */
function scanSource(code: string): string[] {
  return findBypasses(stripJsComments(code));
}

/** Bypasses in an HTML document: its inline scripts and its markup. */
function scanHtml(html: string): string[] {
  const scripts: string[] = [];
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi, (_match, body: string) => {
      scripts.push(stripJsComments(stripAudioShim(body)));
      return " ";
    });
  return findBypasses([markup, ...scripts].join("\n"));
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

type Scanned = { path: string; bypasses: string[] };

function scanTree(): Scanned[] {
  const scanned: Scanned[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of walk(
      join(WEB_ROOT, root),
      (name) => SOURCE_FILE.test(name) && !TEST_FILE.test(name)
    )) {
      scanned.push({ path: webPath(file), bypasses: scanSource(readFileSync(file, "utf8")) });
    }
  }
  for (const file of walk(join(WEB_ROOT, DOCUMENT_ROOT), (name) => /\.html?$/i.test(name))) {
    scanned.push({ path: webPath(file), bypasses: scanHtml(readFileSync(file, "utf8")) });
  }
  return scanned;
}

const legacy = new Set<string>(LEGACY_AUDIO_SITES);
const shimmed = new Map<string, string>(Object.entries(SHIMMED_REALM_DOCUMENTS));

describe("game audio goes through the shared bus", () => {
  const scanned = scanTree();

  it("scans the real tree (games, apps, and the HTML games)", () => {
    expect(scanned.length).toBeGreaterThan(100);
    expect(scanned.some((file) => file.path.startsWith("public/games/"))).toBe(true);
    // The scanner still sees a known legacy site.
    const breakout = scanned.find((file) => file.path === "src/games/breakout/lib/store.ts");
    expect(breakout?.bypasses).toContain(".destination");
  });

  it("finds no new file that makes its own sound", () => {
    const offenders = scanned.filter(
      (file) => file.bypasses.length > 0 && !legacy.has(file.path) && !shimmed.has(file.path)
    );
    expect(
      offenders,
      `These files make sound that skips the game-audio bus, so clips cannot hear it: ${offenders
        .map((file) => `${file.path} (${file.bypasses.join(", ")})`)
        .join("; ")}. ${AUDIO_BUS_MESSAGE}: make a channel with getGameAudio()?.channel("<app id>") and connect sounds to channel.input. An HTML game needs buildAudioShimSource() from its host (see SHIMMED_REALM_DOCUMENTS).`
    ).toEqual([]);
  });

  it("has no stale legacy entry: each one still exists and still breaks the rule", () => {
    const byPath = new Map(scanned.map((file) => [file.path, file]));
    const stale = LEGACY_AUDIO_SITES.filter((path) => {
      const file = byPath.get(path);
      return !file || file.bypasses.length === 0;
    });
    expect(
      stale,
      `Take these off LEGACY_AUDIO_SITES in src/shared/lib/audio/audioBusRule.mjs (they are gone, or they now use the bus), so the lint rule protects them: ${stale.join(", ")}`
    ).toEqual([]);
  });

  it("keeps the legacy list clean: no duplicates, only game, app and public paths", () => {
    expect(new Set(LEGACY_AUDIO_SITES).size).toBe(LEGACY_AUDIO_SITES.length);
    for (const path of LEGACY_AUDIO_SITES) {
      expect(path).toMatch(/^(src\/games\/|src\/apps\/|public\/)/);
      expect(path).not.toMatch(/\\|\*/);
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
    ["window.AudioContext", "const C = window.AudioContext ?? null;"],
    ["window.AudioContext", "const ctx = new (window.AudioContext)();"],
    ["webkitAudioContext", "type W = { webkitAudioContext?: typeof AudioContext };"],
    [".destination", "gain.connect(ctx.destination);"],
    [".destination", "gain.connect(ctx?.destination);"],
    ['["destination"]', 'gain.connect(ctx["destination"]);'],
    ["new Audio()", 'const horn = new Audio("/horn.mp3");'],
    ["new Audio()", "const horn = new window.Audio();"],
    ['createElement("audio")', "document.createElement('audio');"],
    ["<audio>", 'return <audio src="/song.mp3" />;'],
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
    "const bus = getGameAudio(); bus?.channel('snake').input;",
    "const buf = new AudioBuffer({ length: 1, sampleRate: 48000 });",
  ])("allows %s", (code) => {
    expect(scanSource(code)).toEqual([]);
  });

  it("reads an HTML game's scripts and markup, and skips an inlined shim", () => {
    const shimOnly = `<html><head><script>${buildAudioShimSource()}</script></head><body></body></html>`;
    expect(scanHtml(shimOnly)).toEqual([]);

    const legacyGame =
      "<html><body><script>var a = new (window.AudioContext || window.webkitAudioContext)();</script></body></html>";
    expect(scanHtml(legacyGame)).toEqual(["window.AudioContext", "webkitAudioContext"]);

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
    "gain.connect(ctx.destination);",
    'gain.connect(ctx["destination"]);',
    'const horn = new Audio("/horn.mp3");',
    "const horn = new window.Audio();",
    "document.createElement('audio');",
    "const song = <audio src='/song.mp3' />;",
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
  ])("allows %s", (code) => {
    expect(lint(code)).toEqual([]);
  });

  it("is wired into apps/web/eslint.config.mjs with the shared legacy list", () => {
    const configSource = readFileSync(join(WEB_ROOT, "eslint.config.mjs"), "utf8");
    expect(configSource).toContain('from "./src/shared/lib/audio/audioBusRule.mjs"');
    expect(configSource).toMatch(/\.\.\.LEGACY_AUDIO_SITES/);
    expect(configSource).toMatch(/\.\.\.AUDIO_BUS_RESTRICTED_SYNTAX/);
    expect(configSource).toMatch(/\.\.\.AUDIO_BUS_LINT_FILES/);
  });
});
