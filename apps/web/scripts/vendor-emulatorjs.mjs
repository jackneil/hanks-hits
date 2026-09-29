#!/usr/bin/env node
/**
 * Copies the EmulatorJS files that Retro Arcade uses from the official
 * EmulatorJS release into public/emulator/ejs/<version>/, and writes
 * manifest.json there (the source, the size and the SHA-256 of each file).
 *
 * Why: the emulator page runs in the same origin as the clip library
 * (IndexedDB hh-clips, OPFS lib/). A script from a third-party CDN in that
 * origin can read every clip on the device. So the site serves its own
 * reviewed copy of EmulatorJS and never loads code from cdn.emulatorjs.org.
 *
 * Usage (from apps/web):
 *   node scripts/vendor-emulatorjs.mjs 4.2.3
 *   node scripts/vendor-emulatorjs.mjs 4.2.3 --asset /path/to/4.2.3.7z
 * The --asset option uses a copy of the asset that you downloaded before.
 * The script checks its SHA-256 the same way.
 *
 * Requirements: Node 20+ and bsdtar (macOS `tar` is bsdtar). GNU tar cannot
 * read the .7z release asset.
 *
 * The script:
 *   1. Reads the GitHub release v<version> and its asset <version>.7z.
 *   2. Downloads the asset and stops if its SHA-256 is not the digest that
 *      GitHub publishes for it.
 *   3. Selects the files: the loader, the bundle and its CSS, the
 *      decompression helpers, the localization files, and for each console
 *      in src/games/retro-arcade/lib/constants.ts every core that EmulatorJS
 *      can pick for it (its getCores() table), in the WebGL 2 and the legacy
 *      (WebGL 1) builds, with the core report.
 *   4. Replaces the release files in public/emulator/ejs/<version>/ with
 *      these files and writes the manifest. It keeps NOTICE.txt, licenses/,
 *      source/ and their manifest entries ("notice", "components", "sources",
 *      "licenses", and "revision", "revisionEvidence", "licenseText" and
 *      "sources" of each core). scripts/emulatorjs-sources.mjs owns them.
 *
 * After a run: change EJS_pathtodata, the loader URL and the license link in
 * public/emulator/index.html and PINNED_EMULATORJS_VERSION in the tests, then
 * play a game on each console. For a new version, also do the license and
 * source steps in the header of scripts/emulatorjs-sources.mjs. The test
 * src/games/retro-arcade/__tests__/emulator-selfhost.test.ts re-hashes the
 * files against the manifest and fails while a core has no license text or
 * no source archive.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const REPO = "EmulatorJS/EmulatorJS";
const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONSTANTS = join(WEB_ROOT, "src", "games", "retro-arcade", "lib", "constants.ts");

// A file this large does not belong in git. Host it another way instead.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// The license of each core. Read license.txt in the core archive (and the
// upstream repository when the archive has no license.txt) before you add a
// core here.
const CORE_LICENSES = {
  fceumm: "GPL-2.0",
  nestopia: "GPL-2.0",
  gambatte: "GPL-2.0",
  genesis_plus_gx: "Genesis Plus GX license (non-commercial use only)",
  picodrive: "PicoDrive license (non-commercial use only)",
  mgba: "MPL-2.0",
  mupen64plus_next: "GPL-2.0",
  parallel_n64: "GPL-2.0 (Mupen64Plus-Core; the core archive has no license file)",
  snes9x: "Snes9x license (non-commercial use only)",
  stella2014: "GPL-2.0 (Stella; the core archive has no license file)",
};

// Manifest entries that scripts/emulatorjs-sources.mjs and NOTICE.txt own. A
// run for the same version keeps them.
const COMPLIANCE_KEYS = ["components", "sources", "licenses"];
const CORE_COMPLIANCE_KEYS = ["revision", "revisionEvidence", "licenseText", "sources"];

// The loader, the bundle and the helpers that EmulatorJS 4.x loads.
const RUNTIME_FILES = [
  "loader.js",
  "emulator.min.js",
  "emulator.min.css",
  // Every core file is a 7z archive, so extract7z.js loads for each game.
  "compression/extract7z.js",
  "compression/extractzip.js",
  "compression/libunrar.js",
  "compression/libunrar.wasm",
];

function fail(message) {
  console.error(`vendor-emulatorjs: ${message}`);
  process.exit(1);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function findBsdtar() {
  for (const cmd of ["bsdtar", "tar"]) {
    try {
      const version = execFileSync(cmd, ["--version"], { encoding: "utf8" });
      if (version.includes("bsdtar")) return cmd;
    } catch {
      // Try the next name.
    }
  }
  return fail("bsdtar is not installed. Install libarchive (bsdtar) and run again.");
}

/** Reads the system-to-cores table from the getCores() method of the bundle. */
export function parseCoreTable(bundleText) {
  const match = /getCores\(\)\{let [A-Za-z_$][\w$]*=(\{[^}]*\})/.exec(bundleText);
  if (!match) throw new Error("getCores() table not found in emulator.min.js");
  const json = match[1].replace(/([{,])([A-Za-z_$][\w$]*):/g, '$1"$2":');
  return JSON.parse(json);
}

/** Reads the EmulatorJS system name of each Retro Arcade console. */
export function parseArcadeSystems(constantsText) {
  const systems = [...constantsText.matchAll(/ejsCore:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (systems.length === 0) throw new Error("no ejsCore values found in constants.ts");
  return [...new Set(systems)];
}

async function main() {
  const version = process.argv[2];
  const assetFlag = process.argv.indexOf("--asset");
  const localAsset = assetFlag > 0 ? process.argv[assetFlag + 1] : undefined;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    fail("give the EmulatorJS version, for example: node scripts/vendor-emulatorjs.mjs 4.2.3");
  }

  const headers = { "User-Agent": "hanks-hits-vendor-emulatorjs", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const releaseRes = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`, { headers });
  if (!releaseRes.ok) fail(`GitHub release v${version}: HTTP ${releaseRes.status}`);
  const release = await releaseRes.json();
  const asset = release.assets.find((a) => a.name === `${version}.7z`);
  if (!asset) fail(`release v${version} has no asset named ${version}.7z`);
  const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? "")?.[1];
  if (!digest) fail(`GitHub publishes no sha256 digest for ${asset.name}; the download cannot be checked`);

  const work = mkdtempSync(join(tmpdir(), "vendor-emulatorjs-"));
  try {
    let archive = join(work, asset.name);
    if (localAsset) {
      archive = localAsset;
      console.log(`Using the local asset ${archive}`);
    } else {
      console.log(`Downloading ${asset.browser_download_url} (${asset.size} bytes)`);
      const download = await fetch(asset.browser_download_url, { headers: { "User-Agent": headers["User-Agent"] } });
      if (!download.ok || !download.body) fail(`download: HTTP ${download.status}`);
      await pipeline(Readable.fromWeb(download.body), createWriteStream(archive));
    }
    const archiveSha = sha256File(archive);
    if (archiveSha !== digest) fail(`SHA-256 of ${asset.name} is ${archiveSha}, GitHub publishes ${digest}`);
    console.log(`Asset SHA-256 matches the published digest: ${digest}`);

    const tar = findBsdtar();
    const extracted = join(work, "x");
    mkdirSync(extracted);
    execFileSync(tar, ["-xf", archive, "-C", extracted, "data", "LICENSE"], { stdio: "inherit" });
    const data = join(extracted, "data");

    const bundle = readFileSync(join(data, "emulator.min.js"), "utf8");
    const bundleVersion = /ejs_version="([^"]+)"/.exec(bundle)?.[1];
    if (bundleVersion !== version) fail(`emulator.min.js says version ${bundleVersion}, expected ${version}`);

    const table = parseCoreTable(bundle);
    const systems = parseArcadeSystems(readFileSync(CONSTANTS, "utf8"));
    const cores = {};
    for (const system of systems) {
      const list = table[system];
      if (!list) fail(`EmulatorJS ${version} has no cores for the arcade system "${system}"`);
      for (const core of list) {
        cores[core] ??= { systems: [] };
        cores[core].systems.push(system);
      }
    }

    const files = [...RUNTIME_FILES];
    for (const name of readdirSync(join(data, "localization")).sort()) {
      // The loader requests localization/<browser language>.json. It never
      // requests retroarch.json (core option names for RetroArch).
      if (name.endsWith(".json") && name !== "retroarch.json") files.push(`localization/${name}`);
    }
    for (const core of Object.keys(cores).sort()) {
      if (!CORE_LICENSES[core]) fail(`add the license of core "${core}" to CORE_LICENSES`);
      // The -thread- builds are left out: EmulatorJS uses them only when
      // SharedArrayBuffer exists, which needs a cross-origin isolated page.
      files.push(`cores/reports/${core}.json`, `cores/${core}-wasm.data`, `cores/${core}-legacy-wasm.data`);
      const coreJson = JSON.parse(execFileSync(tar, ["-xOf", join(data, "cores", `${core}-wasm.data`), "core.json"], { encoding: "utf8" }));
      cores[core] = {
        systems: cores[core].systems,
        license: CORE_LICENSES[core],
        source: coreJson.repo,
      };
    }
    const sortedCores = Object.fromEntries(Object.keys(cores).sort().map((core) => [core, cores[core]]));

    const out = join(WEB_ROOT, "public", "emulator", "ejs", version);
    // Remove only the release files of an earlier run. NOTICE.txt, licenses/
    // and source/ stay: they are the license texts and the Corresponding
    // Source that the site must serve with these files.
    const previousPath = join(out, "manifest.json");
    const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, "utf8")) : undefined;
    for (const file of previous?.files ?? []) rmSync(join(out, file.path), { force: true });
    for (const core of Object.keys(sortedCores)) {
      for (const key of CORE_COMPLIANCE_KEYS) {
        const value = previous?.cores?.[core]?.[key];
        if (value !== undefined) sortedCores[core][key] = value;
      }
    }
    const entries = [];
    const assetUrl = asset.browser_download_url;
    const copy = (from, rel, member) => {
      const bytes = statSync(from).size;
      if (bytes > MAX_FILE_BYTES) fail(`${rel} is ${bytes} bytes, more than ${MAX_FILE_BYTES}. Host it outside git.`);
      mkdirSync(dirname(join(out, rel)), { recursive: true });
      copyFileSync(from, join(out, rel));
      entries.push({ path: rel, bytes, sha256: sha256File(from), source: `${assetUrl}#${member}` });
    };
    for (const rel of files) {
      const from = join(data, rel);
      if (!existsSync(from)) fail(`the release has no data/${rel}`);
      copy(from, rel, `data/${rel}`);
    }
    copy(join(extracted, "LICENSE"), "LICENSE", "LICENSE");

    const manifest = {
      name: "EmulatorJS",
      version,
      license: "GPL-3.0",
      licenseFile: "LICENSE",
      homepage: "https://emulatorjs.org",
      sourceCode: `https://github.com/${REPO}/tree/v${version}`,
      release: {
        url: release.html_url,
        asset: assetUrl,
        bytes: asset.size,
        sha256: digest,
      },
      notes: [
        "Retro Arcade loads EmulatorJS only from this folder. The site does not load code from the EmulatorJS CDN.",
        "Each file comes from the release asset above. The SHA-256 of the asset is the digest that GitHub publishes for it.",
        "The source of each file is the asset URL plus the path of the file in the asset.",
        "The -thread- core builds are not here. EmulatorJS uses them only when SharedArrayBuffer exists, and this site is not cross-origin isolated.",
        "localization/retroarch.json is not here. The loader does not request it.",
        "Each core file (.data) is a 7z archive. It holds the core, core.json and, for most cores, license.txt.",
        "To change the version, run apps/web/scripts/vendor-emulatorjs.mjs with the new version and do the license and source steps in apps/web/scripts/emulatorjs-sources.mjs. Then change the paths in public/emulator/index.html and the version in the tests.",
        "NOTICE.txt lists each part of this folder, its license, and where its license text and its source code are.",
        "source/ holds the Corresponding Source (GPL-3.0 section 6(d), GPL-2.0 section 3, MPL-2.0 section 3.2): the EmulatorJS tag, the RetroArch fork, each core and the picodrive submodules at the commit that the binaries name, the core build scripts and libunrar-js. licenses/ holds each license text. scripts/emulatorjs-sources.mjs gets and checks them.",
        "Git does not hold source/. The Docker build (stage emulator-sources) downloads each entry in \"sources\", checks its size and SHA-256, and stops when one is not correct. For a local copy, run pnpm --filter web emulator:sources. See public/emulator/ejs/README.md.",
        "Genesis Plus GX, PicoDrive and Snes9x allow only non-commercial use. The site is free, with no ads and no payments. If that changes, remove these three cores first.",
      ],
      ...(previous?.notice ? { notice: previous.notice } : {}),
      cores: sortedCores,
      ...Object.fromEntries(COMPLIANCE_KEYS.filter((key) => previous?.[key] !== undefined).map((key) => [key, previous[key]])),
      files: entries,
    };
    writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const total = entries.reduce((sum, e) => sum + e.bytes, 0);
    const largest = entries.reduce((a, b) => (b.bytes > a.bytes ? b : a));
    console.log(`Wrote ${entries.length} files (${total} bytes) and manifest.json to ${out}`);
    console.log(`Largest file: ${largest.path} (${largest.bytes} bytes)`);
    console.log(`Cores: ${Object.keys(sortedCores).join(", ")}`);
    const noCompliance = Object.keys(sortedCores).filter((core) => !sortedCores[core].licenseText || !sortedCores[core].revision);
    if (noCompliance.length > 0) {
      console.log(
        `No license text or source commit yet for: ${noCompliance.join(", ")}. ` +
          "Do the steps in scripts/emulatorjs-sources.mjs before you ship this version."
      );
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
