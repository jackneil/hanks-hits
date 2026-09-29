/**
 * The third-party software that the clip maker ships, for the /licenses page.
 *
 * Every value here must agree with the build pins in scripts/clips/aac-wasm
 * and with apps/web/public/licenses/NOTICE.txt. Two test files compare them:
 * - src/shared/clips/engine/encode/__tests__/aacWasmArtifact.node.test.ts
 *   compares this data with the pins, the build and the files on the disk;
 * - src/apps/licenses/__tests__/LicensesPage.test.tsx compares the page with
 *   this data.
 * When you rebuild the AAC module or change a version, update this file,
 * NOTICE.txt, notice.js and the pins together.
 */

/** FFmpeg release in the AAC module (scripts/clips/aac-wasm/pins.sh). */
export const FFMPEG_VERSION = "8.1.3";
/** SHA-256 of the FFmpeg source tarball that the site serves. */
export const FFMPEG_SHA256 = "7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3";
/** Where the site serves the exact FFmpeg source (LGPL-2.1 section 6(d): from the same place). */
export const FFMPEG_TARBALL_PATH = `/licenses/ffmpeg-${FFMPEG_VERSION}.tar.xz`;
/** Size of the tarball, for the link label. */
export const FFMPEG_TARBALL_MB = "11.7 MB";
/** Emscripten release that built the module. */
export const EMSCRIPTEN_VERSION = "6.0.10";
/** Mediabunny release in the site bundle (apps/web/package.json). */
export const MEDIABUNNY_VERSION = "1.60.0";
/** The AAC module that the site serves, and its SHA-256 (scripts/clips/aac-wasm/ffmpeg-aac-enc.mjs.sha256). */
export const AAC_MODULE_PATH = "/clips/aac/ffmpeg-aac-enc.mjs";
export const AAC_MODULE_SHA256 = "e2ee0d697dabd45903649b0971d4335bebacf25e53d41b4c8894deffbd7b4c6b";
/** The notice file with the same information as the page. */
export const NOTICE_PATH = "/licenses/NOTICE.txt";
/** The date of the last change to this list. */
export const LICENSES_UPDATED = "2026-09-28";

export interface LicenseLink {
  label: string;
  href: string;
  /** True for a link to another website. */
  external?: boolean;
}

export interface ThirdPartyComponent {
  id: string;
  name: string;
  version: string;
  /** What the component does on this site, in one or two plain sentences. */
  purpose: string;
  /** The full license name. */
  license: string;
  licenseText: LicenseLink;
  /** Where to get the source code. */
  source: readonly LicenseLink[];
  copyright: string;
  /** More facts about this component, in plain sentences. */
  notes: readonly string[];
}

/**
 * The build files of the AAC module (the "work that uses the Library" of
 * LGPL-2.1 section 6). build.sh copies them to /licenses/aac-wasm/.
 */
export const AAC_BUILD_FILES: readonly { file: string; about: string }[] = [
  { file: "README.md", about: "How to build the module" },
  { file: "bridge.c", about: "The bridge source code" },
  { file: "notice.js", about: "The license notice at the top of the module" },
  { file: "pins.sh", about: "The pinned versions and hashes" },
  { file: "configure-flags.txt", about: "The FFmpeg configure options" },
  { file: "emcc-flags.txt", about: "The link options" },
  { file: "build.sh", about: "The build script" },
  { file: "container-build.sh", about: "The build steps in Docker" },
  { file: "verify.sh", about: "The reproducibility check" },
  { file: "BUILD-INFO.txt", about: "The exact commands, the input hashes and the result of the last build" },
  { file: "ffmpeg-aac-enc.mjs.sha256", about: "The SHA-256 of the module" },
];

export const aacBuildFileHref = (file: string) => `/licenses/aac-wasm/${file}`;

export const THIRD_PARTY_COMPONENTS: readonly ThirdPartyComponent[] = [
  {
    id: "ffmpeg",
    name: "FFmpeg (libavcodec and libavutil)",
    version: FFMPEG_VERSION,
    purpose:
      "FFmpeg encodes the game sound of a clip as AAC audio. The site uses it only on browsers that cannot encode AAC audio themselves.",
    license: "GNU Lesser General Public License, version 2.1 or later (LGPL-2.1-or-later)",
    licenseText: { label: "LGPL 2.1 license text", href: "/licenses/LGPL-2.1.txt" },
    source: [{ label: `FFmpeg ${FFMPEG_VERSION} source code (${FFMPEG_TARBALL_MB})`, href: FFMPEG_TARBALL_PATH }],
    copyright: "Copyright (c) 2000-2026 the FFmpeg developers",
    notes: [
      `The AAC module (${AAC_MODULE_PATH}) contains FFmpeg. The module links FFmpeg statically.`,
      "The first lines of the AAC module are a license notice. The notice names each part in the module, its license and this page.",
      `The source code file above is the unchanged FFmpeg ${FFMPEG_VERSION} release from ffmpeg.org. We did not change the FFmpeg source.`,
      "The FFmpeg release signing key (FCF986EA15E6E293A5644F10B4322F04D67658D8) signs the release.",
      "Some FFmpeg files have MIT, BSD or ISC style licenses. Their notices are in the source code file.",
      `We build the module in the Docker image of Emscripten ${EMSCRIPTEN_VERSION}, with no network access. The same inputs give the same file every time.`,
    ],
  },
  {
    id: "aac-bridge",
    name: "AAC bridge (bridge.c)",
    version: `From Mediabunny ${MEDIABUNNY_VERSION}, changed by us`,
    purpose: "The bridge connects the FFmpeg encoder to the clip maker. It is part of the AAC module.",
    license: "Mozilla Public License 2.0 (MPL-2.0)",
    licenseText: { label: "MPL 2.0 license text", href: "/licenses/MPL-2.0.txt" },
    source: [{ label: "bridge.c source code", href: aacBuildFileHref("bridge.c") }],
    copyright: "Copyright (c) 2026-present, Vanilagy and contributors",
    notes: ["The file header tells what we changed."],
  },
  {
    id: "mediabunny",
    name: "Mediabunny",
    version: MEDIABUNNY_VERSION,
    purpose: "Mediabunny puts the video and the sound of a clip into an MP4 file.",
    license: "Mozilla Public License 2.0 (MPL-2.0)",
    licenseText: { label: "MPL 2.0 license text", href: "/licenses/MPL-2.0.txt" },
    source: [
      {
        label: `Mediabunny ${MEDIABUNNY_VERSION} source code on GitHub`,
        href: `https://github.com/Vanilagy/mediabunny/tree/v${MEDIABUNNY_VERSION}`,
        external: true,
      },
    ],
    copyright: "Copyright (c) 2026-present, Vanilagy and contributors",
    notes: ["We did not change Mediabunny."],
  },
  {
    id: "emscripten",
    name: "Emscripten runtime",
    version: EMSCRIPTEN_VERSION,
    purpose:
      "The Emscripten compiler made the AAC module. Its runtime code in the module loads the encoder and connects it to the browser.",
    license: "MIT License (Emscripten also offers the University of Illinois/NCSA Open Source License)",
    licenseText: { label: "Emscripten license text", href: "/licenses/Emscripten-LICENSE.txt" },
    source: [
      {
        label: `Emscripten ${EMSCRIPTEN_VERSION} source code on GitHub`,
        href: `https://github.com/emscripten-core/emscripten/tree/${EMSCRIPTEN_VERSION}`,
        external: true,
      },
    ],
    copyright: "Copyright (c) 2010-2014 Emscripten authors",
    notes: [],
  },
  {
    id: "musl",
    name: "musl C library",
    version: `The copy in Emscripten ${EMSCRIPTEN_VERSION}`,
    purpose: "Parts of musl give the AAC module basic C functions, for example math and memory functions.",
    license: "MIT License",
    licenseText: { label: "musl license text", href: "/licenses/musl-COPYRIGHT.txt" },
    source: [
      {
        label: "musl source code in Emscripten on GitHub",
        href: `https://github.com/emscripten-core/emscripten/tree/${EMSCRIPTEN_VERSION}/system/lib/libc/musl`,
        external: true,
      },
    ],
    copyright: "Copyright (c) 2005-2020 Rich Felker, et al.",
    notes: [],
  },
];

/** What the LGPL lets a person do with the FFmpeg part, in plain words. */
export const LGPL_RIGHTS: readonly string[] = [
  "You can change the FFmpeg source code and build a new AAC module with the build files on this page.",
  "You can use your changed module in place of ours, for your own use.",
  "You can reverse engineer the module to find and fix problems in your changes.",
];

/** The short note for kids at the top of the page. */
export const KID_NOTE =
  "This page is for grown-ups. It lists the free tools that help make game clips on this site, and the rules for using them.";
