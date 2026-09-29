// Node file checks (fs and crypto). It runs in the default jsdom environment
// because src/__tests__/setup.ts on this branch needs a window.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { createGunzip } from "node:zlib";

import nextConfig from "../../../../next.config";
import webPackage from "../../../../package.json";
import { SYSTEMS } from "../lib/constants";

/**
 * The site serves its own copy of EmulatorJS from public/emulator/ejs/<version>/
 * (clips security review, finding sec15). manifest.json in that folder records
 * the source URL, the size and the SHA-256 of each file. This test re-hashes
 * the files, so a changed, missing or extra file fails the gate. It also
 * checks that every core that EmulatorJS can pick for a Retro Arcade console
 * is in the folder. When a core is missing, EmulatorJS tries to download it
 * from its CDN (the emulator CSP blocks that, and the game does not start).
 *
 * The site distributes these files, so the folder also holds NOTICE.txt, the
 * license texts (licenses/) and the Corresponding Source (source/): GPL-3.0
 * section 6(d) and GPL-2.0 section 3 accept the source code from the same
 * server as the object code. The tests below check that every core and every
 * other part has a license text and a source entry, that each file matches
 * its SHA-256, and that each source archive is of the commit that the core
 * binary names. scripts/emulatorjs-sources.mjs gets and checks these files.
 *
 * Git holds the license texts and NOTICE.txt, so the tests always check them.
 * Git does not hold source/ (about 136 MB). The Docker build downloads each
 * archive and checks its SHA-256 (stage emulator-sources), and the tests
 * check that it does. The tests check a source archive only when it is on
 * disk (after pnpm --filter web emulator:sources).
 *
 * To change the version, see scripts/vendor-emulatorjs.mjs.
 */
const PINNED_EMULATORJS_VERSION = "4.2.3";
const RELEASE_ASSET = `https://github.com/EmulatorJS/EmulatorJS/releases/download/v${PINNED_EMULATORJS_VERSION}/${PINNED_EMULATORJS_VERSION}.7z`;

const WEB_ROOT = join(__dirname, "..", "..", "..", "..");
const REPO_ROOT = join(WEB_ROOT, "..", "..");
const EJS_DIR = join(WEB_ROOT, "public", "emulator", "ejs", PINNED_EMULATORJS_VERSION);
const MANIFEST_PATH = `apps/web/public/emulator/ejs/${PINNED_EMULATORJS_VERSION}/manifest.json`;
const EMULATOR_PAGE = join(WEB_ROOT, "public", "emulator", "index.html");
const NOTICE_URL = `/emulator/ejs/${PINNED_EMULATORJS_VERSION}/NOTICE.txt`;

interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  source: string;
}

interface From {
  url?: string;
  archive?: string;
  member?: string;
}

/** A source archive (Corresponding Source) that the site serves. */
interface SourceEntry {
  id: string;
  path: string;
  from: From;
  /** Other URLs with the same bytes. The fetch script tries them first. */
  mirrors?: From[];
  repository: string;
  commit?: string;
  for: string;
  bytes: number;
  sha256: string;
}

/** A license text that the site serves. */
interface LicenseEntry {
  path: string;
  from: From;
  for: string;
  bytes: number;
  sha256: string;
}

interface CoreEntry {
  systems: string[];
  license: string;
  source: string;
  revision: string;
  revisionEvidence: string;
  licenseText: string;
  sources: string[];
}

interface Component {
  id: string;
  name: string;
  version: string;
  license: string;
  files: string[];
  licenseTexts: string[];
  sources: string[];
  sourceUrl?: string;
  evidence?: string;
}

interface Manifest {
  name: string;
  version: string;
  license: string;
  licenseFile: string;
  sourceCode: string;
  release: { url: string; asset: string; bytes: number; sha256: string };
  notice: { path: string; bytes: number; sha256: string };
  cores: Record<string, CoreEntry>;
  components: Component[];
  sources: SourceEntry[];
  licenses: LicenseEntry[];
  files: ManifestFile[];
}

const manifest = JSON.parse(readFileSync(join(EJS_DIR, "manifest.json"), "utf8")) as Manifest;
const manifestPaths = new Set(manifest.files.map((f) => f.path));
const sourceById = new Map(manifest.sources.map((s) => [s.id, s]));
const sourcePaths = new Set(manifest.sources.map((s) => s.path));
/** The source archives on disk. Git does not hold them; see the header. */
const presentSources = manifest.sources.filter((s) => existsSync(join(EJS_DIR, s.path)));
const licensePaths = new Set(manifest.licenses.map((l) => l.path));
const notice = readFileSync(join(EJS_DIR, manifest.notice.path), "utf8");

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** SHA-256 and size of a file, read as a stream (source/ holds a 71 MB archive). */
function hashFile(path: string): Promise<{ bytes: number; sha256: string }> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => {
        const buf = chunk as Buffer;
        bytes += buf.length;
        hash.update(buf);
      })
      .on("end", () => resolve({ bytes, sha256: hash.digest("hex") }));
  });
}

/**
 * Returns the "comment" of the pax global header of a tar.gz, or null. GitHub
 * (git archive) writes the commit ID there. Only the first 4 KB are unpacked.
 */
function tarGzCommit(path: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const input = createReadStream(path);
    const gunzip = createGunzip();
    const finish = () => {
      if (done) return;
      done = true;
      input.destroy();
      gunzip.destroy();
      const data = Buffer.concat(chunks);
      if (data.length < 1024 || data[156] !== 0x67) return resolve(null);
      const length = parseInt(data.subarray(124, 136).toString("latin1").trim(), 8);
      const body = data.subarray(512, 512 + length).toString("utf8");
      resolve(/(?:^|\n)\d+ comment=([^\n]*)\n/.exec(body)?.[1] ?? null);
    };
    gunzip.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= 4096) finish();
    });
    gunzip.on("end", finish);
    gunzip.on("error", (error) => (done ? undefined : reject(error)));
    input.on("error", reject);
    input.pipe(gunzip);
  });
}

/** Returns why a file does not match its manifest entry, or null. */
function entryProblem(entry: { path: string; bytes: number; sha256: string }, data: Buffer): string | null {
  if (data.length !== entry.bytes) return `${entry.path}: ${data.length} bytes, manifest says ${entry.bytes}`;
  const actual = sha256(data);
  if (actual !== entry.sha256) return `${entry.path}: SHA-256 ${actual}, manifest says ${entry.sha256}`;
  return null;
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else out.push(relative(EJS_DIR, full).split(sep).join("/"));
  }
  return out;
}

/** Reads the system-to-cores table from getCores() in the shipped bundle. */
function coreTable(bundle: string): Record<string, string[]> {
  const match = /getCores\(\)\{let [A-Za-z_$][\w$]*=(\{[^}]*\})/.exec(bundle);
  if (!match) throw new Error("getCores() table not found in emulator.min.js");
  return JSON.parse(match[1].replace(/([{,])([A-Za-z_$][\w$]*):/g, '$1"$2":'));
}

/**
 * Every core that EmulatorJS can load for an EJS_core value (the same rule
 * as coresFor() in scripts/vendor-emulatorjs.mjs). A system name gives all
 * cores of the system. A core name gives the core and the cores of the first
 * system that lists it: the settings menu offers those (getCore(true)).
 */
function coresFor(ejsCore: string, table: Record<string, string[]>): string[] | null {
  if (table[ejsCore]) return [...table[ejsCore]];
  const system = Object.keys(table).find((key) => table[key].includes(ejsCore));
  return system ? [...new Set([ejsCore, ...table[system]])] : null;
}

describe("self-hosted EmulatorJS files", () => {
  it("come from the official release of the pinned version", () => {
    expect(manifest.name).toBe("EmulatorJS");
    expect(manifest.version).toBe(PINNED_EMULATORJS_VERSION);
    expect(manifest.release.asset).toBe(RELEASE_ASSET);
    expect(manifest.release.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sourceCode).toBe(
      `https://github.com/EmulatorJS/EmulatorJS/tree/v${PINNED_EMULATORJS_VERSION}`
    );
    for (const file of manifest.files) {
      expect(file.source, file.path).toMatch(new RegExp(`^${RELEASE_ASSET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#`));
      expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("match the size and the SHA-256 in the manifest", () => {
    const problems: string[] = [];
    for (const entry of manifest.files) {
      const full = join(EJS_DIR, entry.path);
      if (isAbsolute(entry.path) || normalize(entry.path).startsWith("..")) {
        problems.push(`${entry.path}: path leaves the folder`);
      } else if (!existsSync(full)) {
        problems.push(`${entry.path}: missing`);
      } else {
        const problem = entryProblem(entry, readFileSync(full));
        if (problem) problems.push(problem);
      }
    }
    expect(problems).toEqual([]);
  });

  it("are the only files in the folder", () => {
    const onDisk = listFiles(EJS_DIR).filter((p) => p !== "manifest.json").sort();
    const listed = [
      ...manifestPaths,
      ...manifest.sources.map((s) => s.path),
      ...manifest.licenses.map((l) => l.path),
      manifest.notice.path,
    ];
    expect(new Set(listed).size, "a path is in the manifest twice").toBe(listed.length);
    // Git holds every file outside source/, so each one must be on disk.
    const committed = listed.filter((p) => !sourcePaths.has(p)).sort();
    expect(onDisk.filter((p) => !p.startsWith("source/"))).toEqual(committed);
    // source/ can be empty (a clone) or full (after emulator:sources), but it
    // never holds a file that the manifest does not list.
    expect(onDisk.filter((p) => p.startsWith("source/") && !sourcePaths.has(p))).toEqual([]);
  });

  it("detect a changed file (guards the hash check)", () => {
    const entry = manifest.files.find((f) => f.path === "loader.js")!;
    const data = readFileSync(join(EJS_DIR, entry.path));
    expect(entryProblem(entry, data)).toBeNull();
    const changed = Buffer.from(data);
    changed[0] ^= 0xff;
    expect(entryProblem(entry, changed)).toMatch(/SHA-256/);
  });

  it("hold the loader, the bundle, its CSS, the decompression helpers and the license", () => {
    for (const path of [
      "loader.js",
      "emulator.min.js",
      "emulator.min.css",
      "compression/extract7z.js",
      "compression/extractzip.js",
      "compression/libunrar.js",
      "compression/libunrar.wasm",
      "localization/en-US.json",
      "LICENSE",
    ]) {
      expect(manifestPaths.has(path), path).toBe(true);
    }
    expect(manifest.license).toBe("GPL-3.0");
    const license = readFileSync(join(EJS_DIR, manifest.licenseFile), "utf8");
    expect(license).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(license).toContain("Version 3");
  });

  it("hold a bundle of the pinned version", () => {
    const bundle = readFileSync(join(EJS_DIR, "emulator.min.js"), "utf8");
    expect(/ejs_version="([^"]+)"/.exec(bundle)?.[1]).toBe(PINNED_EMULATORJS_VERSION);
  });

  it("hold every core that EmulatorJS can pick for a Retro Arcade console", () => {
    const table = coreTable(readFileSync(join(EJS_DIR, "emulator.min.js"), "utf8"));
    const missing: string[] = [];
    for (const [system, info] of Object.entries(SYSTEMS)) {
      const cores = coresFor(info.ejsCore, table);
      if (!cores) {
        missing.push(`EmulatorJS has no core for ${info.ejsCore} (${system})`);
        continue;
      }
      // Every core in the list: the kid can pick another core in the
      // EmulatorJS settings, and iPhone Safari reverses the N64 order.
      for (const core of cores) {
        // The WebGL 2 build and the legacy (WebGL 1) build, and the report
        // that EmulatorJS reads first to pick one of them.
        for (const path of [`cores/${core}-wasm.data`, `cores/${core}-legacy-wasm.data`, `cores/reports/${core}.json`]) {
          if (!manifestPaths.has(path)) missing.push(`${system}: ${path}`);
        }
        const info = manifest.cores[core];
        if (!info) missing.push(`${system}: no license entry for core ${core}`);
        else {
          expect(info.systems, core).toContain(system);
          expect(info.license, core).not.toBe("");
          expect(info.source, core).toMatch(/^https:\/\/github\.com\//);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("hold no core that no console uses", () => {
    // A core that no console can load is dead weight, and its license and
    // source entries would be wrong (Game Boy moved from gambatte to mgba).
    const table = coreTable(readFileSync(join(EJS_DIR, "emulator.min.js"), "utf8"));
    const used = new Set(Object.values(SYSTEMS).flatMap((s) => coresFor(s.ejsCore, table) ?? []));
    expect(Object.keys(manifest.cores).sort()).toEqual([...used].sort());
    const coreFiles = [...manifestPaths].filter((p) => p.startsWith("cores/"));
    const unused = coreFiles.filter((p) => {
      const core = /^cores\/(?:reports\/)?(.+?)(?:-legacy)?(?:-wasm\.data|\.json)$/.exec(p)?.[1];
      return !core || !used.has(core);
    });
    expect(unused).toEqual([]);
  });

  it("find the cores of a system name and of a core name (guards coresFor)", () => {
    const table = { gb: ["gambatte"], segaMS: ["smsplus", "picodrive"], gba: ["mgba"] };
    expect(coresFor("gb", table)).toEqual(["gambatte"]);
    expect(coresFor("mgba", table)).toEqual(["mgba"]);
    expect(coresFor("picodrive", table)).toEqual(["picodrive", "smsplus"]);
    expect(coresFor("psx", table)).toBeNull();
  });

  it("are enough because the page never asks for the thread cores", () => {
    // The -thread- core builds are not hosted. EmulatorJS uses them only
    // when EJS_threads is set and SharedArrayBuffer exists.
    const page = readFileSync(EMULATOR_PAGE, "utf8");
    expect(page).not.toMatch(/EJS_threads/);
    for (const path of manifestPaths) expect(path).not.toMatch(/-thread-/);
  });
});

describe("self-hosted EmulatorJS licenses and source code", () => {
  it("serve each license text and NOTICE.txt unchanged", async () => {
    const problems: string[] = [];
    for (const entry of [...manifest.licenses, manifest.notice]) {
      const full = join(EJS_DIR, entry.path);
      if (isAbsolute(entry.path) || normalize(entry.path).startsWith("..")) {
        problems.push(`${entry.path}: path leaves the folder`);
      } else if (!existsSync(full)) {
        problems.push(`${entry.path}: missing`);
      } else {
        const actual = await hashFile(full);
        if (actual.bytes !== entry.bytes) problems.push(`${entry.path}: ${actual.bytes} bytes, manifest says ${entry.bytes}`);
        else if (actual.sha256 !== entry.sha256) {
          problems.push(`${entry.path}: SHA-256 ${actual.sha256}, manifest says ${entry.sha256}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("serve each source archive on disk unchanged", async () => {
    // A clone has no source archives (git ignores source/). The Docker build
    // gets and checks all of them; the tests below check that it does.
    const problems: string[] = [];
    for (const entry of presentSources) {
      const actual = await hashFile(join(EJS_DIR, entry.path));
      if (actual.bytes !== entry.bytes) problems.push(`${entry.path}: ${actual.bytes} bytes, manifest says ${entry.bytes}`);
      else if (actual.sha256 !== entry.sha256) {
        problems.push(`${entry.path}: SHA-256 ${actual.sha256}, manifest says ${entry.sha256}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("detect a changed license text (guards the hash check)", () => {
    const entry = manifest.licenses.find((l) => l.path === "licenses/cores/snes9x.txt")!;
    const data = readFileSync(join(EJS_DIR, entry.path));
    expect(entryProblem(entry, data)).toBeNull();
    const changed = Buffer.from(data);
    changed[0] ^= 0xff;
    expect(entryProblem(entry, changed)).toMatch(/SHA-256/);
  });

  it("name GitHub archives of the commits that the manifest names", async () => {
    const problems: string[] = [];
    for (const source of manifest.sources) {
      expect(source.path, source.id).toMatch(/^source\//);
      if (!source.commit) continue;
      expect(source.commit, source.id).toMatch(/^[0-9a-f]{40}$/);
      const repo = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)$/.exec(source.repository)?.[1];
      expect(repo, `${source.id}: repository`).toBeTruthy();
      expect(source.from.url, source.id).toBe(`https://codeload.github.com/${repo}/tar.gz/${source.commit}`);
      expect(source.path, source.id).toContain(source.commit.slice(0, 12));
      // The archive header holds the commit. The fetch script checks it at
      // build time; here only an archive on disk can be read.
      if (!presentSources.includes(source)) continue;
      const commit = await tarGzCommit(join(EJS_DIR, source.path));
      if (commit !== source.commit) problems.push(`${source.path}: archive of ${commit}, manifest says ${source.commit}`);
    }
    expect(problems).toEqual([]);
  });

  it("give every core a license text and its source code at the commit in the binary", () => {
    const problems: string[] = [];
    for (const [core, info] of Object.entries(manifest.cores)) {
      if (!licensePaths.has(info.licenseText)) problems.push(`${core}: license text ${info.licenseText} is not served`);
      if (!/^[0-9a-f]{40}$/.test(info.revision ?? "")) problems.push(`${core}: no source commit`);
      if (!info.revisionEvidence?.includes(info.revision?.slice(0, 7) ?? "?")) {
        problems.push(`${core}: revisionEvidence does not name the short commit`);
      }
      const own = sourceById.get(info.sources?.[0] ?? "");
      if (!own) problems.push(`${core}: no source archive`);
      else {
        if (own.commit !== info.revision) problems.push(`${core}: source archive is of ${own.commit}, the core of ${info.revision}`);
        if (own.repository !== info.source) problems.push(`${core}: source archive is from ${own.repository}, core.json says ${info.source}`);
      }
      // Each core file is RetroArch and the core, built by the build scripts.
      for (const id of ["retroarch", "build"]) {
        if (!info.sources?.includes(id)) problems.push(`${core}: sources has no ${id}`);
      }
      for (const id of info.sources ?? []) if (!sourceById.has(id)) problems.push(`${core}: unknown source ${id}`);
    }
    expect(problems).toEqual([]);
  });

  it("give every other part a license text and a source", () => {
    const problems: string[] = [];
    const ids = manifest.components.map((c) => c.id);
    for (const id of ["emulatorjs", "retroarch", "build", "emscripten", "nipplejs", "socket.io-client", "font-awesome", "libunrar", "extract-helpers"]) {
      if (!ids.includes(id)) problems.push(`no component ${id}`);
    }
    for (const component of manifest.components) {
      for (const text of component.licenseTexts) {
        if (!licensePaths.has(text) && text !== manifest.licenseFile) problems.push(`${component.id}: license text ${text} is not served`);
      }
      for (const id of component.sources) if (!sourceById.has(id)) problems.push(`${component.id}: unknown source ${id}`);
      if (component.sources.length === 0 && !component.sourceUrl) problems.push(`${component.id}: no source`);
      // A part with no known license must record why, so NOTICE.txt can say so.
      if (component.licenseTexts.length === 0 && !component.evidence) problems.push(`${component.id}: no license text and no evidence`);
    }
    const used = new Set([...Object.values(manifest.cores).flatMap((c) => c.sources), ...manifest.components.flatMap((c) => c.sources)]);
    for (const source of manifest.sources) if (!used.has(source.id)) problems.push(`source ${source.id} belongs to no part`);
    expect(problems).toEqual([]);
  });

  it("keep the full license of each non-commercial core", () => {
    for (const core of ["genesis_plus_gx", "picodrive", "snes9x"]) {
      expect(manifest.cores[core].license, core).toMatch(/non-commercial/);
      const text = readFileSync(join(EJS_DIR, manifest.cores[core].licenseText), "utf8");
      expect(text, core).toMatch(/non-commercial|may not be sold/);
    }
  });

  it("have a NOTICE.txt that names every part, license text and source archive", () => {
    const missing: string[] = [];
    for (const path of [...manifest.sources.map((s) => s.path), ...licensePaths]) {
      if (!notice.includes(path)) missing.push(path);
    }
    for (const core of Object.keys(manifest.cores)) if (!notice.includes(`(${core})`)) missing.push(core);
    for (const source of manifest.sources) if (source.commit && !notice.includes(source.commit)) missing.push(source.commit);
    expect(notice).toContain(manifest.release.sha256);
    expect(notice).toContain(manifest.release.asset);
    expect(missing).toEqual([]);
  });

  it("state the known license problem of the upstream core files", () => {
    // Each core file links the core with GPL-3.0 RetroArch. The licenses of
    // the non-commercial cores and of Stella 2014 (GPL-2.0 only) do not agree
    // with GPL-3.0. NOTICE.txt says so, names the upstream copies and points
    // to the source code.
    const section = notice.split(/\n(?=[A-Z]\. )/).find((s) => s.startsWith("D. A known license problem"));
    expect(section, "NOTICE.txt has no section about the license problem").toBeDefined();
    const names = new Map([...notice.matchAll(/^ {3}4\.\d+ (.+?) \((\w+)\)/gm)].map((m) => [m[2], m[1]]));
    const nonCommercial = Object.entries(manifest.cores)
      .filter(([, info]) => /non-commercial/.test(info.license))
      .map(([core]) => core);
    expect(nonCommercial.sort()).toEqual(["genesis_plus_gx", "picodrive", "snes9x"]);
    for (const core of [...nonCommercial, "stella2014"]) {
      expect(names.get(core), `${core} has no part in NOTICE.txt`).toBeDefined();
      expect(section, core).toContain(names.get(core)!);
    }
    expect(section).toContain(`https://cdn.emulatorjs.org/${PINNED_EMULATORJS_VERSION}/data/cores/`);
    expect(section).toContain("source/");
  });

  it("have a NOTICE.txt in plain text for people", () => {
    // User-facing text on this site has no em dash or en dash.
    expect(notice).not.toMatch(/[\u2013\u2014]/);
    const long = notice.split("\n").filter((line) => line.length > 80);
    expect(long).toEqual([]);
  });

  it("link NOTICE.txt from the emulator page and keep it fresh in caches", async () => {
    const page = readFileSync(EMULATOR_PAGE, "utf8");
    expect(page).toContain(`<link rel="license" href="${NOTICE_URL}">`);
    const rules = (await nextConfig.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
    const ejsRule = rules.findIndex((r) => r.source === "/emulator/ejs/:path*");
    const noticeRule = rules.findIndex((r) => r.source === "/emulator/ejs/:version/NOTICE.txt");
    // Next.js applies every matching rule; the later rule wins for the same key.
    expect(noticeRule).toBeGreaterThan(ejsRule);
    const cacheControl = rules[noticeRule].headers.find((h) => h.key.toLowerCase() === "cache-control")?.value;
    expect(cacheControl).not.toMatch(/immutable/);
    expect(Number(/max-age=(\d+)/.exec(cacheControl ?? "")?.[1])).toBeLessThanOrEqual(86400);
  });
});

/** The stages of a Dockerfile: name (or image) and the instruction lines of each. */
function dockerStages(dockerfile: string): { name: string; lines: string[] }[] {
  const stages: { name: string; lines: string[] }[] = [];
  // Join continuation lines, drop comments and blank lines.
  const lines = dockerfile
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  for (const line of lines) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) stages.push({ name: from[2] ?? from[1], lines: [] });
    else stages.at(-1)?.lines.push(line);
  }
  return stages;
}

describe("the source archives come from the build, not from git", () => {
  const FETCH_STAGE = "emulator-sources";
  const SCRIPT = "apps/web/scripts/emulatorjs-sources.mjs";
  const SOURCE_DEST = `./apps/web/public/emulator/ejs/${PINNED_EMULATORJS_VERSION}/source`;
  const stages = dockerStages(readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8"));
  const stage = (name: string) => stages.find((s) => s.name === name);

  it("give every source entry a URL, a size and a SHA-256", () => {
    const problems: string[] = [];
    for (const source of manifest.sources) {
      if (!/^https:\/\/[^/\s]+\/\S+$/.test(source.from?.url ?? "")) problems.push(`${source.id}: no https URL in "from"`);
      if (!Number.isInteger(source.bytes) || source.bytes <= 0) problems.push(`${source.id}: no size (bytes)`);
      if (!/^[0-9a-f]{64}$/.test(source.sha256 ?? "")) problems.push(`${source.id}: no SHA-256`);
      for (const mirror of source.mirrors ?? []) {
        if (!/^https:\/\/[^/\s]+\/\S+$/.test(mirror.url ?? "")) problems.push(`${source.id}: a mirror has no https URL`);
      }
    }
    expect(manifest.sources.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it("keep the source archives out of git", () => {
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
    expect(gitignore).toContain("apps/web/public/emulator/ejs/*/source/");
    // The Docker context keeps its default. The builder stage removes a local
    // copy, and the runner gets the checked archives from the fetch stage.
    const dockerignore = readFileSync(join(REPO_ROOT, ".dockerignore"), "utf8");
    expect(dockerignore).not.toMatch(/emulator|source\/|scripts|public|\.mjs|\.json/);
  });

  it("fetch every source archive in an early Docker stage that uses only the manifest and the script", () => {
    const fetch = stage(FETCH_STAGE);
    expect(fetch, `the Dockerfile has no stage ${FETCH_STAGE}`).toBeDefined();
    const names = stages.map((s) => s.name);
    expect(names.indexOf(FETCH_STAGE), "the fetch stage comes before the builder").toBeLessThan(names.indexOf("builder"));
    // Only these two files go into the stage, so a change to other files
    // keeps the downloaded layer in the Docker cache.
    const copies = fetch!.lines.filter((l) => /^(COPY|ADD)\s/i.test(l));
    expect(copies.map((l) => l.split(/\s+/)[1]).sort()).toEqual([MANIFEST_PATH, SCRIPT].sort());
    const runs = fetch!.lines.filter((l) => /^RUN\s/i.test(l));
    const fetchRun = runs.find((l) => l.includes("emulatorjs-sources.mjs"));
    expect(fetchRun, "the stage does not run emulatorjs-sources.mjs").toBeDefined();
    expect(fetchRun).toContain(`emulatorjs-sources.mjs ${PINNED_EMULATORJS_VERSION} --fetch --sources`);
    expect(fetchRun).toMatch(/--manifest\s+\S*manifest\.json/);
    expect(fetchRun).toMatch(/--out\s+\/out(\s|$)/);
    // The command must fail the build: no "|| true", no "; exit 0".
    expect(fetchRun).not.toMatch(/\|\||;\s*exit\s+0|\|\s*true/);
    // The manifest copy is the manifest of the pinned version.
    const manifestCopy = copies.find((l) => l.includes("manifest.json"))!.split(/\s+/);
    expect(manifestCopy[2]).toMatch(/manifest\.json$/);
    expect(fetchRun!.match(/--manifest\s+(\S+)/)?.[1]).toBe(manifestCopy[2].replace(/^\.\//, ""));
  });

  it("serve the checked archives next to the files in the image", () => {
    const runner = stages.at(-1)!;
    const fromFetch = runner.lines.filter((l) => l.includes(`--from=${FETCH_STAGE}`));
    expect(fromFetch).toHaveLength(1);
    expect(fromFetch[0]).toMatch(new RegExp(`\\s/out/source\\s+${SOURCE_DEST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    // After the public folder, so nothing replaces the checked archives.
    const publicCopy = runner.lines.findIndex((l) => /--from=builder\s.*\/app\/apps\/web\/public\s/.test(l));
    expect(publicCopy).toBeGreaterThanOrEqual(0);
    expect(runner.lines.indexOf(fromFetch[0])).toBeGreaterThan(publicCopy);
    // The builder removes a local source/ from the build context.
    const builder = stage("builder")!;
    const removal = builder.lines.findIndex((l) => l === "RUN rm -rf apps/web/public/emulator/ejs/*/source");
    const appCopy = builder.lines.findIndex((l) => /^COPY\s+apps\/web\s/.test(l));
    expect(removal).toBeGreaterThan(appCopy);
  });

  it("give maintainers one command that fetches the same archives", () => {
    expect(webPackage.scripts["emulator:sources"]).toBe(
      `node scripts/emulatorjs-sources.mjs ${PINNED_EMULATORJS_VERSION} --fetch --sources`
    );
    const readme = readFileSync(join(WEB_ROOT, "public", "emulator", "ejs", "README.md"), "utf8");
    expect(readme).toContain("pnpm --filter web emulator:sources");
    expect(readme).toContain(FETCH_STAGE);
    expect(readme).not.toMatch(/[–—]/);
  });

  it("parse the Dockerfile stages (guards the checks above)", () => {
    const parsed = dockerStages("FROM a AS one\nRUN x \\\n  y\n# c\nFROM one AS two\nCOPY --from=one /o ./p\n");
    expect(parsed).toEqual([
      { name: "one", lines: ["RUN x    y"] },
      { name: "two", lines: ["COPY --from=one /o ./p"] },
    ]);
  });
});
