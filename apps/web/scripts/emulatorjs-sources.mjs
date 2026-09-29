#!/usr/bin/env node
/**
 * Gets and checks the source archives and the license texts that the site
 * serves with EmulatorJS, in public/emulator/ejs/<version>/source/ and
 * public/emulator/ejs/<version>/licenses/.
 *
 * Why: the site sends the EmulatorJS files and the emulator cores to each
 * browser, so the site distributes them. GPL-3.0 section 6(d) and GPL-2.0
 * section 3 let a network server give the object code when the same place
 * gives the Corresponding Source. MPL-2.0 section 3.2 and the Snes9x, Genesis
 * Plus GX and PicoDrive licenses also ask for the source or for the license
 * text with each copy. NOTICE.txt in the same folder tells people what each
 * part is and where its license and its source are.
 *
 * Git holds the license texts and NOTICE.txt. Git does not hold the source
 * archives (about 131 MB): each clone would keep them for ever. The Docker
 * build gets them with this script (--fetch --sources) and stops when one
 * archive is not correct. Thus the site never sends the emulator files
 * without their source code.
 *
 * manifest.json is the list. Each entry in "sources" and "licenses" has a
 * "from" object that tells where the file comes from:
 *   { "url": "https://..." }                      the file at this URL
 *   { "url": "https://...", "member": "a/b" }     a member of the archive at this URL
 *   { "archive": "cores/x.data", "member": "a" }  a member of a file in the folder
 * An entry can also have "mirrors": other URLs that give the same bytes. The
 * script tries each mirror first, then "from". The SHA-256 check makes each
 * copy safe to use.
 * A source archive with a "commit" must be a GitHub tar.gz of that commit
 * (its pax header holds the commit ID).
 *
 * Usage (from apps/web):
 *   node scripts/emulatorjs-sources.mjs 4.2.3
 *        Check the files in the folder (no network). The license texts and
 *        NOTICE.txt must be there. The script checks each source archive
 *        that is there and tells you which are not there.
 *   node scripts/emulatorjs-sources.mjs 4.2.3 --fetch --sources
 *        Get each source archive that is not there or not correct, and check
 *        it (pnpm --filter web emulator:sources does this).
 *   node scripts/emulatorjs-sources.mjs 4.2.3 --fetch
 *        Get each source archive and each license text again, and check it.
 *   node scripts/emulatorjs-sources.mjs 4.2.3 --fetch --record
 *        Get new entries (no sha256 yet) and write their size and SHA-256
 *        into manifest.json. It also records the size and SHA-256 of NOTICE.txt.
 *   node scripts/emulatorjs-sources.mjs 4.2.3 --probe
 *        Print the git version strings in each core.
 * Options:
 *   --sources          Use only the "sources" entries.
 *   --out DIR          Put the source archives in DIR/source/, not in the
 *                      folder (the Docker build uses this). Without --fetch,
 *                      check the source archives in DIR and require all of them.
 *   --manifest FILE    Read this manifest.json, not the one in the folder.
 *   --asset FILE       Use a local copy of the release asset (303 MB for 4.2.3).
 * Environment:
 *   EMULATORJS_SOURCES_RETRY_DELAY_MS   The first wait before a retry
 *                                       (default 2000). Each next wait is
 *                                       two times longer.
 *
 * --fetch tries each URL 4 times. It stops with exit code 1 and names the
 * file when no URL gives the bytes that the manifest records. It writes a
 * file only after the check.
 *
 * When you change the EmulatorJS version:
 *   1. Run scripts/vendor-emulatorjs.mjs <version>.
 *   2. Run this script with --probe. Each core prints the short git hash that
 *      its Makefile put in the binary (git rev-parse --short HEAD at build
 *      time). The hash that all cores share is the RetroArch fork.
 *   3. Find the full commit of each hash in the core repository (core.json
 *      "repo") and add the entries to manifest.json. Copy the entries of the
 *      old version and change them.
 *   4. Run --fetch --record, then update NOTICE.txt and run --record again.
 *   5. Change the version in the Dockerfile (stage emulator-sources) and in
 *      the "emulator:sources" script of package.json.
 *   6. Run the tests in src/games/retro-arcade/__tests__/.
 *
 * Requirements: Node 20+. bsdtar (macOS `tar` is bsdtar; Alpine and Debian:
 * libarchive-tools) only for a member of an archive and for --probe. GNU tar
 * cannot read the 7z core files.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USER_AGENT = "hanks-hits-emulatorjs-sources";
// Tries per URL: 1 + the number of waits.
const RETRY_WAITS = 3;
// A download that gets no bytes for this time stops, and the script tries again.
const STALL_MS = 60_000;
// Downloads at the same time. GitHub codeload serves each archive from its own
// request; 4 keeps the build fast without a burst of requests.
const PARALLEL = 4;

/** A problem that stops the script. main() prints it and exits with code 1. */
class StopError extends Error {}

function stop(message) {
  throw new StopError(message);
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Reads the pax global header of a tar.gz and returns its "comment" value.
 * GitHub writes the commit ID there (git archive does the same).
 */
export function tarGzCommit(path) {
  return new Promise((resolve, reject) => {
    const chunks = [];
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
      // A pax global header has the type flag "g" at offset 156.
      if (data.length < 1024 || data[156] !== 0x67) return resolve(null);
      const length = parseInt(data.subarray(124, 136).toString("latin1").trim(), 8);
      const body = data.subarray(512, 512 + length).toString("utf8");
      const comment = /(?:^|\n)\d+ comment=([^\n]*)\n/.exec(body);
      resolve(comment ? comment[1] : null);
    };
    gunzip.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= 4096) finish();
    });
    gunzip.on("end", finish);
    // A file that is not gzip is not a GitHub archive: the commit check fails.
    gunzip.on("error", () => (done ? undefined : ((done = true), resolve(null))));
    input.on("error", reject);
    input.pipe(gunzip);
  });
}

function findBsdtar() {
  for (const cmd of ["bsdtar", "tar"]) {
    try {
      if (execFileSync(cmd, ["--version"], { encoding: "utf8" }).includes("bsdtar")) return cmd;
    } catch {
      // Try the next name.
    }
  }
  return stop("bsdtar is not installed. Install libarchive (bsdtar) and run again.");
}

function safeRelative(path) {
  if (isAbsolute(path) || normalize(path).startsWith("..")) stop(`${path}: path leaves the folder`);
  return path;
}

function retryDelayMs() {
  const value = Number(process.env.EMULATORJS_SOURCES_RETRY_DELAY_MS ?? 2000);
  return Number.isFinite(value) && value >= 0 ? value : 2000;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Downloads a URL to a file once. It stops when no data comes for STALL_MS. */
async function downloadOnce(url, to) {
  const controller = new AbortController();
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error(`no data for ${STALL_MS / 1000} s`)), STALL_MS);
  };
  arm();
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const watch = new Transform({
      transform(chunk, _encoding, callback) {
        arm();
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), watch, createWriteStream(to));
  } catch (error) {
    rmSync(to, { force: true });
    const reason = controller.signal.aborted ? controller.signal.reason : error;
    throw new Error(reason?.cause?.message ?? reason?.message ?? String(reason));
  } finally {
    clearTimeout(timer);
  }
}

/** Returns why a produced or stored file does not match its entry, or null. */
async function problem(entry, file) {
  const bytes = statSync(file).size;
  if (entry.bytes !== undefined && bytes !== entry.bytes) return `${bytes} bytes, the manifest says ${entry.bytes}`;
  const sha = await sha256File(file);
  if (entry.sha256 !== undefined && sha !== entry.sha256) return `SHA-256 ${sha}, the manifest says ${entry.sha256}`;
  if (entry.commit) {
    const commit = await tarGzCommit(file);
    if (commit !== entry.commit) return `the archive is of commit ${commit}, the manifest says ${entry.commit}`;
  }
  return null;
}

/** Downloads a whole archive once per run (for a "member" entry) and checks the release asset. */
function getArchive(url, ctx) {
  if (!ctx.downloads.has(url)) {
    const job = (async () => {
      if (url === ctx.manifest.release.asset && ctx.localAsset) return ctx.localAsset;
      const file = join(ctx.work, `archive-${ctx.counter++}`);
      console.log(`Downloading ${url}`);
      await downloadOnce(url, file);
      return file;
    })().then(async (file) => {
      if (url === ctx.manifest.release.asset) {
        const actual = await sha256File(file);
        if (actual !== ctx.manifest.release.sha256) {
          throw new Error(`release asset SHA-256 is ${actual}, the manifest says ${ctx.manifest.release.sha256}`);
        }
      }
      return file;
    });
    // A failed download is not kept, so the next try downloads it again.
    job.catch(() => ctx.downloads.delete(url));
    ctx.downloads.set(url, job);
  }
  return ctx.downloads.get(url);
}

/** Makes the bytes of one entry from one place ("from" or a mirror) in a temporary file. */
async function produceFrom(from, entry, ctx) {
  const out = join(ctx.work, `${ctx.counter++}`);
  if (from.url && !from.member) {
    await downloadOnce(from.url, out);
    return out;
  }
  let archive;
  if (from.url) archive = await getArchive(from.url, ctx);
  else if (from.archive) {
    archive = join(ctx.dir, safeRelative(from.archive));
    if (!existsSync(archive)) throw new Error(`${from.archive} is not in the folder`);
  } else stop(`${entry.path}: "from" needs "url" or "archive"`);
  ctx.tar ??= findBsdtar();
  writeFileSync(out, execFileSync(ctx.tar, ["-xOf", archive, from.member], { maxBuffer: 1 << 30 }));
  return out;
}

function describePlace(from) {
  if (from.url) return from.member ? `${from.url} (member ${from.member})` : from.url;
  return `${from.archive}#${from.member}`;
}

/**
 * Gets one entry: each mirror, then "from", each with retries. Returns the
 * temporary file that matches the entry. Throws a StopError that names the
 * file when no place gives the correct bytes.
 */
async function fetchEntry(entry, ctx) {
  const places = [...(entry.mirrors ?? []), entry.from];
  const tried = [];
  const firstDelay = retryDelayMs();
  for (const from of places) {
    for (let attempt = 1; attempt <= RETRY_WAITS + 1; attempt++) {
      let made;
      try {
        made = await produceFrom(from, entry, ctx);
        const why = await problem(entry, made);
        if (!why) return made;
        throw new Error(why);
      } catch (error) {
        if (error instanceof StopError) throw error;
        if (made) rmSync(made, { force: true });
        tried.push(`${describePlace(from)}, try ${attempt}: ${error.message}`);
        // A file from the folder does not change on a retry.
        if (!from.url || attempt > RETRY_WAITS) break;
        const wait = firstDelay * 2 ** (attempt - 1);
        console.warn(`${entry.path}: try ${attempt} failed (${error.message}). Next try in ${wait / 1000} s.`);
        await sleep(wait);
      }
    }
  }
  return stop(
    `could not get ${entry.path}${entry.id ? ` (source "${entry.id}")` : ""}.\n    ` +
      `${tried.join("\n    ")}\n  ` +
      "The site must not send the emulator files without their source code and license texts, so this stops here. " +
      "Read apps/web/public/emulator/ejs/README.md."
  );
}

/** Copies a checked temporary file into place. A reader never sees half a file. */
function install(made, target) {
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  copyFileSync(made, partial);
  renameSync(partial, target);
  rmSync(made, { force: true });
}

/** Runs jobs with at most `limit` at the same time. Every job runs, then the first error is thrown. */
async function runLimited(items, limit, job) {
  const errors = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await job(item);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (errors.length > 0) {
    if (errors.length > 1) for (const error of errors.slice(1)) console.error(`emulatorjs-sources: ${error.message}`);
    throw errors[0];
  }
}

/** Prints the short git hashes that each core Makefile put in the core binary. */
function probe(ctx) {
  ctx.tar ??= findBsdtar();
  const shared = new Map();
  for (const core of Object.keys(ctx.manifest.cores)) {
    const dir = mkdtempSync(join(ctx.work, `${core}-`));
    execFileSync(ctx.tar, ["-xf", join(ctx.dir, "cores", `${core}-wasm.data`), "-C", dir]);
    const wasm = join(dir, `${core}_libretro.wasm`);
    if (!existsSync(wasm)) {
      console.log(`${core}: no ${core}_libretro.wasm in the core file`);
      continue;
    }
    const text = readFileSync(wasm).toString("latin1");
    const found = new Set();
    for (const run of text.match(/[\x20-\x7e]{7,40}/g) ?? []) {
      const m = /^(?:\(SVN\) |v?\d[\w.-]*[ -]| )?([0-9a-f]{7,10})$/.exec(run);
      if (m && /[a-f]/.test(m[1]) && /\d/.test(m[1])) found.add(run);
    }
    for (const value of found) shared.set(value.trim(), (shared.get(value.trim()) ?? 0) + 1);
    console.log(`${core}: ${[...found].map((v) => JSON.stringify(v)).join(", ") || "(none)"}`);
    const recorded = ctx.manifest.cores[core].revision;
    if (recorded) console.log(`  manifest revision: ${recorded}`);
  }
  const common = [...shared.entries()].filter(([, n]) => n === Object.keys(ctx.manifest.cores).length);
  console.log(`In every core (the RetroArch fork): ${common.map(([v]) => v).join(", ") || "(none)"}`);
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) stop(`${name} needs a value`);
  return value;
}

async function run() {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    stop("give the EmulatorJS version, for example: node scripts/emulatorjs-sources.mjs 4.2.3 --fetch --sources");
  }
  const args = process.argv.slice(3);
  const dir = join(WEB_ROOT, "public", "emulator", "ejs", version);
  const manifestPath = resolve(optionValue(args, "--manifest") ?? join(dir, "manifest.json"));
  if (!existsSync(manifestPath)) stop(`${manifestPath} does not exist. Run scripts/vendor-emulatorjs.mjs ${version} first.`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== version) stop(`${manifestPath} is for version ${manifest.version}, not ${version}`);
  const outDir = optionValue(args, "--out");
  const ctx = {
    dir,
    manifest,
    tar: undefined,
    work: mkdtempSync(join(tmpdir(), "emulatorjs-sources-")),
    downloads: new Map(),
    counter: 0,
    localAsset: optionValue(args, "--asset"),
  };
  const fetchMode = args.includes("--fetch");
  const record = args.includes("--record");
  const sourcesOnly = args.includes("--sources") || outDir !== undefined;
  // The folder for the source archives: --out DIR, or the version folder.
  const sourceRoot = outDir ? resolve(outDir) : dir;
  const targetOf = (entry, isSource) => join(isSource ? sourceRoot : dir, safeRelative(entry.path));

  try {
    if (args.includes("--probe")) {
      probe(ctx);
      return;
    }
    const sources = manifest.sources ?? [];
    const licenses = sourcesOnly ? [] : (manifest.licenses ?? []);
    if (sources.length === 0) stop('manifest.json has no "sources" entries');
    for (const entry of sources) {
      if (!entry.path?.startsWith("source/")) stop(`${entry.path}: a source archive must be in source/`);
    }
    if (record && outDir) stop("--record writes manifest.json; do not use it with --out");
    let changed = false;

    if (fetchMode) {
      const started = Date.now();
      // The sources first: some license texts are members of a source archive.
      for (const [group, isSource] of [
        [sources, true],
        [licenses, false],
      ]) {
        await runLimited(group, PARALLEL, async (entry) => {
          const begin = Date.now();
          const target = targetOf(entry, isSource);
          if (!record && (entry.sha256 === undefined || entry.bytes === undefined)) {
            stop(`${entry.path}: no sha256 in the manifest. Run with --record to add it.`);
          }
          // A correct file stays. A local run after a first run is fast.
          if (entry.sha256 !== undefined && existsSync(target) && !(await problem(entry, target))) {
            console.log(`OK ${entry.path} (already there)`);
            return;
          }
          const made = await fetchEntry(entry, ctx);
          if (entry.sha256 === undefined) {
            entry.bytes = statSync(made).size;
            entry.sha256 = await sha256File(made);
            changed = true;
            console.log(`Recorded ${entry.path}: ${entry.bytes} bytes, SHA-256 ${entry.sha256}`);
          }
          install(made, target);
          console.log(`OK ${entry.path} (${entry.bytes} bytes, ${((Date.now() - begin) / 1000).toFixed(1)} s)`);
        });
      }
      console.log(`Fetched and checked in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    }

    // Check: the files that git holds must be there. A source archive must be
    // there only after --fetch or with --out.
    const problems = [];
    const absent = [];
    for (const [group, isSource] of [
      [sources, true],
      [licenses, false],
    ]) {
      for (const entry of group) {
        const target = targetOf(entry, isSource);
        if (!existsSync(target)) {
          if (isSource && !fetchMode && !outDir) absent.push(entry.path);
          else problems.push(`${entry.path}: missing`);
          continue;
        }
        const why = await problem(entry, target);
        if (why) problems.push(`${entry.path}: ${why}`);
        else if (!isSource && entry.from?.archive) {
          // Check that the text is still the member of the archive in the
          // folder, when that archive is there.
          const archive = join(dir, safeRelative(entry.from.archive));
          if (!existsSync(archive)) continue;
          const made = await produceFrom(entry.from, entry, ctx);
          if (!readFileSync(made).equals(readFileSync(target))) {
            problems.push(`${entry.path}: not the same as ${entry.from.archive}#${entry.from.member}`);
          }
        }
      }
    }
    const notice = !sourcesOnly && manifest.notice ? join(dir, safeRelative(manifest.notice.path)) : undefined;
    if (record && notice && !existsSync(notice)) {
      console.warn(`${manifest.notice.path} is missing. Write it, then run with --record again.`);
    } else if (record && notice) {
      const bytes = statSync(notice).size;
      const sha256 = await sha256File(notice);
      if (bytes !== manifest.notice.bytes || sha256 !== manifest.notice.sha256) {
        manifest.notice.bytes = bytes;
        manifest.notice.sha256 = sha256;
        changed = true;
        console.log(`Recorded ${manifest.notice.path}: ${bytes} bytes, SHA-256 ${sha256}`);
      }
    } else if (notice) {
      if (!existsSync(notice)) problems.push(`${manifest.notice.path}: missing`);
      else {
        const why = await problem(manifest.notice, notice);
        if (why) problems.push(`${manifest.notice.path}: ${why}. Run with --record after you change it.`);
      }
    }
    if (changed) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    if (problems.length > 0) stop(`\n  ${problems.join("\n  ")}`);
    const checked = [...sources, ...licenses].filter((e) => !absent.includes(e.path));
    const total = checked.reduce((sum, e) => sum + (e.bytes ?? 0), 0);
    console.log(`${checked.length} files match manifest.json (${total} bytes).`);
    if (absent.length > 0) {
      console.log(
        `${absent.length} source archives are not here (git does not hold them). ` +
          "To get them, run: pnpm --filter web emulator:sources"
      );
    }
  } finally {
    rmSync(ctx.work, { recursive: true, force: true });
  }
}

async function main() {
  try {
    await run();
  } catch (error) {
    console.error(`emulatorjs-sources: ${error instanceof StopError ? error.message : error.stack}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
