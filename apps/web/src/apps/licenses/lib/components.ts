/**
 * The third-party software that the site ships (the clip maker and Retro
 * Arcade), for the /licenses page.
 *
 * Every value here must agree with the build pins in scripts/clips/aac-wasm,
 * with the EmulatorJS manifest (public/emulator/ejs/<version>/manifest.json)
 * and with apps/web/public/licenses/NOTICE.txt. Three test files compare them:
 * - src/shared/clips/engine/encode/__tests__/aacWasmArtifact.node.test.ts
 *   compares this data with the pins, the build and the files on the disk,
 *   and checks that every link on the page goes to a file that the site
 *   serves;
 * - src/apps/licenses/__tests__/emulatorLicenses.node.test.ts compares the
 *   Retro Arcade entries with the EmulatorJS manifest and NOTICE.txt;
 * - src/apps/licenses/__tests__/LicensesPage.test.tsx compares the page with
 *   this data.
 * When you rebuild the AAC module or change a version, update this file,
 * NOTICE.txt, notice.js and the pins together. When you change the EmulatorJS
 * version, update the Retro Arcade entries from the new manifest.json.
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
export const LICENSES_UPDATED = "2026-09-29";

/** The EmulatorJS release that Retro Arcade loads (public/emulator/ejs/<version>/). */
export const EMULATORJS_VERSION = "4.2.3";
/** The folder on the site with the EmulatorJS files, the cores, their license texts and their source code. */
export const EMULATORJS_DIR = `/emulator/ejs/${EMULATORJS_VERSION}`;
/** The full notice of the Retro Arcade emulator: each part, its license and its source code. */
export const EMULATORJS_NOTICE_PATH = `${EMULATORJS_DIR}/NOTICE.txt`;
/** The size and the SHA-256 of each file, source code file and license text in the folder. */
export const EMULATORJS_MANIFEST_PATH = `${EMULATORJS_DIR}/manifest.json`;
/** SHA-256 of the official EmulatorJS release file that all the files come from. */
export const EMULATORJS_RELEASE_SHA256 = "07d451bc06fa3ad04ab30d9b94eb63ac34ad0babee52d60357b002bde8f3850b";
/**
 * The folder with the source code files of EmulatorJS and the cores. Git
 * does not hold them. The Docker build downloads each file that
 * manifest.json lists, checks its SHA-256 and puts it here (stage
 * emulator-sources of the Dockerfile).
 */
export const EMULATORJS_SOURCE_DIR = `${EMULATORJS_DIR}/source`;

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
  /** The license texts of the other parts of this component, when it has more than one part. */
  moreLicenseTexts?: readonly LicenseLink[];
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

/** A license text in the EmulatorJS folder (git holds these files). */
const emulatorLicense = (label: string, file: string): LicenseLink => ({
  label,
  href: `${EMULATORJS_DIR}/licenses/${file}`,
});

/**
 * A source code file in EMULATORJS_SOURCE_DIR. The size is the "bytes" of
 * its manifest.json entry in MB, with one decimal ("less than 0.1 MB" below
 * 0.05 MB). The tests compute it from the manifest.
 */
const emulatorSource = (label: string, file: string, size: string): LicenseLink => ({
  label: `${label} (${size})`,
  href: `${EMULATORJS_SOURCE_DIR}/${file}`,
});

/** The link to the full notice of the Retro Arcade emulator. */
const EMULATORJS_NOTICE_LINK: LicenseLink = {
  label: "Retro Arcade emulator notice (NOTICE.txt): each part, its license and its source code",
  href: EMULATORJS_NOTICE_PATH,
};

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
  {
    id: "emulatorjs",
    name: "EmulatorJS",
    version: EMULATORJS_VERSION,
    purpose:
      "EmulatorJS is the game player of Retro Arcade. It loads the emulator cores, shows the game and reads the controls.",
    license: "GNU General Public License, version 3 (GPL-3.0)",
    licenseText: emulatorLicense("GPL 3.0 license text", "GPL-3.0.txt"),
    moreLicenseTexts: [
      emulatorLicense("nipplejs 0.10.2 license text (MIT)", "nipplejs-0.10.2-LICENSE.txt"),
      emulatorLicense("Socket.IO client 4.8.1 license text (MIT)", "socket.io-client-4.8.1-LICENSE.txt"),
      emulatorLicense("Font Awesome Free 6.5.1 license text", "FontAwesome-Free-6.5.1-LICENSE.txt"),
      emulatorLicense("CC BY 4.0 license text (Font Awesome icons)", "CC-BY-4.0.txt"),
      emulatorLicense("UnRAR 5.9.2 license text (libunrar)", "UnRAR-5.9.2-license.txt"),
    ],
    source: [
      emulatorSource(`EmulatorJS ${EMULATORJS_VERSION} source code`, "EmulatorJS-4.2.3-e150dc0491ae.tar.gz", "0.6 MB"),
      emulatorSource(
        `EmulatorJS ${EMULATORJS_VERSION} package-lock.json (the versions of the build tools)`,
        "EmulatorJS-4.2.3-package-lock.json",
        "0.1 MB",
      ),
      emulatorSource("libunrar-js source code, with UnRAR 5.9.2", "libunrar-js-294e36269104.tar.gz", "0.4 MB"),
      {
        label: "nipplejs 0.10.2 source code on GitHub",
        href: "https://github.com/yoannmoinet/nipplejs/tree/v0.10.2",
        external: true,
      },
      {
        label: "Socket.IO client 4.8.1 source code on GitHub",
        href: "https://github.com/socketio/socket.io/tree/socket.io-client%404.8.1/packages/socket.io-client",
        external: true,
      },
      EMULATORJS_NOTICE_LINK,
    ],
    copyright: "Copyright the EmulatorJS contributors. The file docs/contributors.md in the source code names them.",
    notes: [
      `Retro Arcade loads EmulatorJS only from this site, from the folder ${EMULATORJS_DIR}/. The site does not load it from the EmulatorJS servers.`,
      `We did not change the files. Each file is the same as the file in the official EmulatorJS ${EMULATORJS_VERSION} release. The file manifest.json in the folder gives the size and the SHA-256 of each file.`,
      "The file emulator.min.js also contains nipplejs 0.10.2 (the on-screen joystick, MIT License), the Socket.IO client 4.8.1 (MIT License) and icons from Font Awesome Free 6.5.1 (CC BY 4.0).",
      "The folder also has libunrar, which opens RAR game files. It has the UnRAR license.",
      "The Retro Arcade emulator notice tells how to make emulator.min.js from the source code. It also tells about two small helper files, extract7z.js and extractzip.js. EmulatorJS does not publish their source code.",
    ],
  },
  {
    id: "retro-arcade-cores",
    name: "Retro Arcade emulator cores, with RetroArch",
    version: `The cores of EmulatorJS ${EMULATORJS_VERSION}, built on 14 June 2025`,
    purpose:
      "The cores play the games of the old game consoles in Retro Arcade. Each core file holds RetroArch, one emulator core and the Emscripten runtime, compiled together.",
    license:
      "Each part has its own license. RetroArch: GPL-3.0-or-later. The core build scripts: GPL-3.0. FCEUmm and Nestopia UE: GPL-2.0-or-later. Mupen64Plus-Next, ParaLLEl N64 and Stella 2014: GPL-2.0. mGBA: MPL-2.0. Genesis Plus GX, PicoDrive and Snes9x: their own licenses, for non-commercial use only. The Emscripten runtime and musl: MIT.",
    licenseText: emulatorLicense("GPL 3.0 license text (RetroArch and the build scripts)", "GPL-3.0.txt"),
    moreLicenseTexts: [
      emulatorLicense("GPL 2.0 license text", "GPL-2.0.txt"),
      emulatorLicense("MPL 2.0 license text", "MPL-2.0.txt"),
      emulatorLicense("FCEUmm license text", "cores/fceumm.txt"),
      emulatorLicense("Genesis Plus GX license text", "cores/genesis_plus_gx.txt"),
      emulatorLicense("mGBA license text", "cores/mgba.txt"),
      emulatorLicense("Mupen64Plus-Next license text", "cores/mupen64plus_next.txt"),
      emulatorLicense("Nestopia UE license text", "cores/nestopia.txt"),
      emulatorLicense("ParaLLEl N64 license text", "cores/parallel_n64.txt"),
      emulatorLicense("PicoDrive license text", "cores/picodrive.txt"),
      emulatorLicense("Snes9x license text", "cores/snes9x.txt"),
      emulatorLicense("Stella 2014 license text", "cores/stella2014.txt"),
      emulatorLicense("LGPL 2.1 license text (parts of Genesis Plus GX)", "LGPL-2.1.txt"),
      emulatorLicense("Emscripten 4.0.8 license text", "Emscripten-4.0.8-LICENSE.txt"),
      emulatorLicense("musl license text", "musl-COPYRIGHT.txt"),
    ],
    source: [
      emulatorSource("RetroArch (the EmulatorJS fork) source code", "RetroArch-EmulatorJS-6dd4353937ef.tar.gz", "71.0 MB"),
      emulatorSource("Core build scripts source code", "EmulatorJS-build-b24e5b535034.tar.gz", "less than 0.1 MB"),
      emulatorSource("FCEUmm (NES) source code", "libretro-fceumm-d9d7e141274d.tar.gz", "0.8 MB"),
      emulatorSource("Genesis Plus GX (Sega Genesis) source code", "Genesis-Plus-GX-594cdf3a6665.tar.gz", "14.4 MB"),
      emulatorSource("mGBA (Game Boy and Game Boy Advance) source code", "mgba-1d9dbb1dc8d5.tar.gz", "15.1 MB"),
      emulatorSource("Mupen64Plus-Next (Nintendo 64) source code", "mupen64plus-libretro-nx-c35e55e87cba.tar.gz", "15.0 MB"),
      emulatorSource("Nestopia UE (NES) source code", "nestopia-6b08ec9148bd.tar.gz", "1.2 MB"),
      emulatorSource("ParaLLEl N64 (Nintendo 64) source code", "parallel-n64-56f4daf8ec9b.tar.gz", "5.1 MB"),
      emulatorSource("PicoDrive (Sega Genesis) source code", "picodrive-3cf1e2617958.tar.gz", "2.0 MB"),
      emulatorSource("PicoDrive part libpicofe source code", "picodrive-libpicofe-86a086ed64aa.tar.gz", "0.1 MB"),
      emulatorSource("PicoDrive part cyclone68000 source code", "picodrive-cyclone68000-3ac7cf1bdeec.tar.gz", "0.1 MB"),
      emulatorSource("PicoDrive part emu2413 source code", "picodrive-emu2413-a2dfc20ff507.tar.gz", "less than 0.1 MB"),
      emulatorSource("PicoDrive part libchdr source code", "picodrive-libchdr-e62ac5995b1c.tar.gz", "4.2 MB"),
      emulatorSource("PicoDrive part dr_libs source code", "picodrive-dr_libs-dd762b861eca.tar.gz", "0.5 MB"),
      emulatorSource("Snes9x (Super NES) source code", "snes9x-6ca2343e5f3b.tar.gz", "5.2 MB"),
      emulatorSource("Stella 2014 (Atari 2600) source code", "stella2014-libretro-1f578c36382b.tar.gz", "0.7 MB"),
      {
        label: "Emscripten 4.0.8 source code on GitHub (with musl)",
        href: "https://github.com/emscripten-core/emscripten/tree/4.0.8",
        external: true,
      },
      EMULATORJS_NOTICE_LINK,
    ],
    copyright:
      "RetroArch: Copyright (C) 2010-2014 Hans-Kristian Arntzen, Copyright (C) 2011-2021 Daniel De Matteis, and the other RetroArch contributors. Each core has its own authors. The Retro Arcade emulator notice names them.",
    notes: [
      "We did not change the core files. EmulatorJS built them with its build scripts and Emscripten 4.0.8.",
      "Each source code file is an unchanged copy of the archive that GitHub makes for one git commit. It is the commit that the core file names.",
      "PicoDrive uses parts from other projects (git submodules). A GitHub archive does not hold them, so each part has its own source code file.",
      "Genesis Plus GX, PicoDrive and Snes9x allow non-commercial use only. This site is free. It has no ads and no payments.",
      "The licenses of four cores do not agree with the GPL-3.0 of RetroArch: Stella 2014 (GPL-2.0 only), and Snes9x, Genesis Plus GX and PicoDrive (non-commercial use only). EmulatorJS made these core files. Part D of the Retro Arcade emulator notice tells more.",
      "The GPL and the MPL let you get the source code, change it and share it. Read the license texts for the conditions.",
    ],
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
  "This page is for grown-ups. It lists the free tools that make game clips and Retro Arcade work on this site, and the rules for using them.";
