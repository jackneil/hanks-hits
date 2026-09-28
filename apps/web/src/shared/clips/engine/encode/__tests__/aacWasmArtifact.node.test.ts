// @vitest-environment node
/**
 * The committed AAC WASM module is the reproducible build of the pinned
 * FFmpeg source, and the license files say so (plan 16, PR 0.5).
 *
 * scripts/clips/aac-wasm/build.sh records the SHA-256 of each build. These
 * checks fail when:
 * - somebody edits or replaces the module without a rebuild;
 * - the FFmpeg tarball that the site serves is not the pinned source;
 * - the build files in /licenses/aac-wasm are not the files that built it;
 * - the configure flags could change the license (GPL, nonfree, version 3);
 * - NOTICE.txt or the /licenses page data do not match the build.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as licenses from "@/apps/licenses/lib/components";
import { AAC_WASM_MODULE_PATH } from "../audio/aacBackends";
import { AAC_WASM_FILE, REPO_ROOT, WEB_ROOT } from "./aacWasmModule";

const SCRIPTS = path.join(REPO_ROOT, "scripts", "clips", "aac-wasm");
const PUBLIC = path.join(WEB_ROOT, "public");
const LICENSES = path.join(PUBLIC, "licenses");
const SOURCE_COPY = path.join(LICENSES, "aac-wasm");
/** SHA-256 of the canonical MPL 2.0 text (https://www.mozilla.org/media/MPL/2.0/index.txt). */
const MPL_2_0_SHA256 = "3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04";
/** build.sh SOURCE_FILES plus the two files that build.sh writes. */
const SOURCE_COPY_FILES = [
  "BUILD-INFO.txt",
  "README.md",
  "bridge.c",
  "build.sh",
  "configure-flags.txt",
  "container-build.sh",
  "emcc-flags.txt",
  "ffmpeg-aac-enc.mjs.sha256",
  "pins.sh",
  "verify.sh",
];

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const text = (file: string) => readFileSync(file, "utf8");

/** Reads KEY=VALUE lines of pins.sh. */
function readPins(): Record<string, string> {
  const pins: Record<string, string> = {};
  for (const line of text(path.join(SCRIPTS, "pins.sh")).split("\n")) {
    const m = /^([A-Z0-9_]+)=(\S+)$/.exec(line.trim());
    if (m) pins[m[1]] = m[2];
  }
  return pins;
}

/** Reads a flags file the way container-build.sh does: one argument per line, no empty or "#" lines. */
function readFlags(name: string): string[] {
  return text(path.join(SCRIPTS, name))
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"));
}

const pins = readPins();
const recorded = text(path.join(SCRIPTS, "ffmpeg-aac-enc.mjs.sha256"));
const recordedHash = recorded.split(/\s+/)[0];

describe("the committed AAC module", () => {
  it("is the file that the backend loads", () => {
    expect(AAC_WASM_FILE).toBe(path.join(PUBLIC, "clips", "aac", "ffmpeg-aac-enc.mjs"));
    expect(AAC_WASM_MODULE_PATH).toBe(licenses.AAC_MODULE_PATH);
    expect(existsSync(AAC_WASM_FILE)).toBe(true);
  });

  it("matches the recorded hash of the last reproducible build", () => {
    expect(recorded).toMatch(/^[0-9a-f]{64} {2}ffmpeg-aac-enc\.mjs\n$/);
    expect(sha256(AAC_WASM_FILE)).toBe(recordedHash);
  });

  it("is one self-contained ES module (the WASM is inside, no second fetch)", () => {
    const js = text(AAC_WASM_FILE);
    expect(js).toMatch(/export default Module;?\s*$/);
    expect(js).not.toMatch(/\.wasm["'`]/);
    expect(js).not.toMatch(/^\s*import\s/m);
    // The worker-only build: no Node code paths.
    expect(js).not.toMatch(/require\(|process\.versions/);
    // A module this size has the FFmpeg encoder inside. The bridge exports are there.
    expect(statSync(AAC_WASM_FILE).size).toBeGreaterThan(200_000);
    for (const name of ["aac_bridge_abi", "aac_open", "aac_input", "aac_send", "aac_receive", "aac_flush", "aac_close"]) {
      expect(js).toContain(`_${name}`);
    }
  });
});

describe("the pinned FFmpeg source", () => {
  it("is served next to the module and has the pinned SHA-256", () => {
    expect(pins.FFMPEG_VERSION).toMatch(/^\d+\.\d+(\.\d+)?$/);
    expect(pins.FFMPEG_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(pins.FFMPEG_URL).toBe(`https://ffmpeg.org/releases/ffmpeg-${pins.FFMPEG_VERSION}.tar.xz`);
    const tarball = path.join(LICENSES, `ffmpeg-${pins.FFMPEG_VERSION}.tar.xz`);
    expect(existsSync(tarball)).toBe(true);
    expect(sha256(tarball)).toBe(pins.FFMPEG_SHA256);
    // Only one FFmpeg tarball: the served source is exactly the source of the module.
    expect(readdirSync(LICENSES).filter((f) => /^ffmpeg-.*\.tar\.xz$/.test(f))).toEqual([`ffmpeg-${pins.FFMPEG_VERSION}.tar.xz`]);
  });

  it("uses a digest-pinned Emscripten image of the pinned version", () => {
    expect(pins.EMSDK_IMAGE).toMatch(new RegExp(`^emscripten/emsdk:${pins.EMSDK_VERSION.replace(/\./g, "\\.")}@sha256:[0-9a-f]{64}$`));
  });
});

describe("the build flags", () => {
  const configure = readFlags("configure-flags.txt");
  const link = readFlags("emcc-flags.txt");

  it("keep FFmpeg LGPL-2.1-or-later and build only the AAC encoder", () => {
    for (const bad of ["--enable-gpl", "--enable-nonfree", "--enable-version3"]) expect(configure).not.toContain(bad);
    expect(configure).toContain("--disable-everything");
    expect(configure).toContain("--enable-avcodec");
    expect(configure).toContain("--enable-encoder=aac");
    expect(configure.filter((f) => /^--enable-(encoder|decoder|muxer|demuxer|parser|filter|protocol)/.test(f))).toEqual([
      "--enable-encoder=aac",
    ]);
    expect(configure.find((f) => f.startsWith("--extra-cflags="))).toContain("-msimd128");
  });

  it("make one worker-only ES module with WASM SIMD", () => {
    for (const flag of ["-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sSINGLE_FILE=1", "-sENVIRONMENT=worker", "-msimd128"]) {
      expect(link).toContain(flag);
    }
  });

  it("are the flags that BUILD-INFO.txt records for the committed module", () => {
    const info = text(path.join(SOURCE_COPY, "BUILD-INFO.txt"));
    expect(info).toContain(`SHA-256: ${recordedHash}`);
    expect(info).toContain(`Source SHA-256: ${pins.FFMPEG_SHA256}`);
    expect(info).toContain(`Image: ${pins.EMSDK_IMAGE}`);
    expect(info).toContain(`emconfigure ./configure ${configure.map((f) => `'${f}'`).join(" ")}\n`);
    expect(info).toContain(`-I. ${link.map((f) => `'${f}'`).join(" ")} -o ffmpeg-aac-enc.mjs\n`);
    expect(info).toContain("License: LGPL version 2.1 or later");
    expect(info).toContain(` ${pins.EMSDK_VERSION} (`);
  });
});

describe("the build files on the site (/licenses/aac-wasm)", () => {
  it("are exactly the files in scripts/clips/aac-wasm, byte for byte", () => {
    expect(readdirSync(SOURCE_COPY).sort()).toEqual([...SOURCE_COPY_FILES].sort());
    for (const file of SOURCE_COPY_FILES) {
      if (file === "BUILD-INFO.txt") continue;
      expect(text(path.join(SOURCE_COPY, file)), file).toBe(text(path.join(SCRIPTS, file)));
    }
  });

  it("are the files that the licenses page links", () => {
    expect(licenses.AAC_BUILD_FILES.map((f) => f.file).sort()).toEqual([...SOURCE_COPY_FILES].sort());
  });
});

describe("the license files", () => {
  it("have the full license texts", () => {
    const lgpl = text(path.join(LICENSES, "LGPL-2.1.txt"));
    expect(lgpl).toContain("GNU LESSER GENERAL PUBLIC LICENSE");
    expect(lgpl).toContain("Version 2.1, February 1999");
    expect(lgpl).toContain("END OF TERMS AND CONDITIONS");
    expect(sha256(path.join(LICENSES, "MPL-2.0.txt"))).toBe(MPL_2_0_SHA256);
    expect(text(path.join(LICENSES, "Emscripten-LICENSE.txt"))).toContain("Permission is hereby granted, free of charge");
    expect(text(path.join(LICENSES, "musl-COPYRIGHT.txt"))).toContain("Rich Felker");
  });

  it("NOTICE.txt names each component, the exact source, the commands and the hashes", () => {
    const notice = text(path.join(LICENSES, "NOTICE.txt"));
    const configure = readFlags("configure-flags.txt");
    const link = readFlags("emcc-flags.txt");
    const mediabunny = JSON.parse(text(path.join(WEB_ROOT, "package.json"))).dependencies.mediabunny as string;
    expect(notice).toContain(`FFmpeg (libavcodec and libavutil), version ${pins.FFMPEG_VERSION}`);
    expect(notice).toContain(`/licenses/ffmpeg-${pins.FFMPEG_VERSION}.tar.xz`);
    expect(notice).toContain(pins.FFMPEG_SHA256);
    expect(notice).toContain(pins.FFMPEG_URL);
    expect(notice).toContain(pins.FFMPEG_SIGNER_FINGERPRINT);
    expect(notice).toContain(pins.EMSDK_IMAGE);
    expect(notice).toContain(recordedHash);
    expect(notice).toContain(`emconfigure ./configure ${configure.map((f) => `'${f}'`).join(" ")}\n`);
    expect(notice).toContain(`-I. ${link.map((f) => `'${f}'`).join(" ")} -o ffmpeg-aac-enc.mjs\n`);
    expect(notice).toContain(`Mediabunny, version ${mediabunny}`);
    expect(notice).toContain(`https://github.com/Vanilagy/mediabunny/tree/v${mediabunny}`);
    expect(notice).toContain(`Emscripten runtime, version ${pins.EMSDK_VERSION}`);
    for (const file of ["LGPL-2.1.txt", "MPL-2.0.txt", "Emscripten-LICENSE.txt", "musl-COPYRIGHT.txt"]) {
      expect(notice).toContain(`/licenses/${file}`);
    }
    // User-facing text: no em-dash.
    expect(notice).not.toContain("—");
  });

  it("the licenses page data agrees with the pins and the build", () => {
    const mediabunny = JSON.parse(text(path.join(WEB_ROOT, "package.json"))).dependencies.mediabunny as string;
    expect(licenses.FFMPEG_VERSION).toBe(pins.FFMPEG_VERSION);
    expect(licenses.FFMPEG_SHA256).toBe(pins.FFMPEG_SHA256);
    expect(licenses.EMSCRIPTEN_VERSION).toBe(pins.EMSDK_VERSION);
    expect(licenses.MEDIABUNNY_VERSION).toBe(mediabunny);
    expect(licenses.AAC_MODULE_SHA256).toBe(recordedHash);
    const mb = statSync(path.join(LICENSES, `ffmpeg-${pins.FFMPEG_VERSION}.tar.xz`)).size / 1e6;
    expect(licenses.FFMPEG_TARBALL_MB).toBe(`${mb.toFixed(1)} MB`);
  });

  it("every site link on the licenses page points at a file that exists", () => {
    const hrefs = [
      licenses.NOTICE_PATH,
      licenses.FFMPEG_TARBALL_PATH,
      licenses.AAC_MODULE_PATH,
      ...licenses.AAC_BUILD_FILES.map((f) => licenses.aacBuildFileHref(f.file)),
      ...licenses.THIRD_PARTY_COMPONENTS.flatMap((c) => [c.licenseText, ...c.source])
        .filter((l) => !l.external)
        .map((l) => l.href),
    ];
    for (const href of hrefs) {
      expect(href.startsWith("/"), href).toBe(true);
      expect(existsSync(path.join(PUBLIC, ...href.split("/").filter(Boolean))), href).toBe(true);
    }
  });
});

describe("the upstream encoder package", () => {
  it("is gone: nothing imports @mediabunny/aac-encoder and package.json does not list it", () => {
    const pkg = JSON.parse(text(path.join(WEB_ROOT, "package.json")));
    expect(pkg.dependencies["@mediabunny/aac-encoder"]).toBeUndefined();
    expect(pkg.devDependencies?.["@mediabunny/aac-encoder"]).toBeUndefined();
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !full.endsWith("aacWasmArtifact.node.test.ts")) {
          if (/from\s+["']@mediabunny\/aac-encoder["']|import\(\s*["']@mediabunny\/aac-encoder["']\s*\)/.test(text(full))) {
            offenders.push(path.relative(WEB_ROOT, full));
          }
        }
      }
    };
    walk(path.join(WEB_ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});
