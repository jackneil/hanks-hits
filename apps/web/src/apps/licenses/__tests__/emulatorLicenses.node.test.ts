// @vitest-environment node
/**
 * The Retro Arcade entries of the /licenses page and of /licenses/NOTICE.txt
 * agree with the EmulatorJS manifest (public/emulator/ejs/<version>/manifest.json).
 *
 * The site sends EmulatorJS and its cores to each browser, so it must also
 * give their license texts and their source code (GPL-3.0 section 6(d),
 * GPL-2.0 section 3, MPL-2.0 section 3.2). The manifest is the list of the
 * files that the site serves in that folder. These checks fail when:
 * - the page or the notice names a version or a release hash that is not
 *   the manifest's;
 * - a source code file of the manifest has no link on the page, or a link
 *   names a file that the manifest does not list;
 * - a size on a link or in the notice is not the size in the manifest;
 * - the license text of a core, or another license text, is not linked, or
 *   a license link names a file that the manifest does not list;
 * - a GitHub link is not the source URL that the manifest records.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EMULATORJS_DIR,
  EMULATORJS_MANIFEST_PATH,
  EMULATORJS_NOTICE_PATH,
  EMULATORJS_RELEASE_SHA256,
  EMULATORJS_SOURCE_DIR,
  EMULATORJS_VERSION,
  NOTICE_PATH,
  THIRD_PARTY_COMPONENTS,
  type LicenseLink,
  type ThirdPartyComponent,
} from "../lib/components";

const PUBLIC = path.resolve(__dirname, "../../../../public");
const publicFile = (href: string) => path.join(PUBLIC, ...href.split("/").filter(Boolean));

interface Manifest {
  version: string;
  release: { sha256: string };
  cores: Record<string, { licenseText: string; sources: string[] }>;
  components: { id: string; sourceUrl?: string; licenseTexts: string[] }[];
  sources: { id: string; path: string; bytes: number }[];
  licenses: { path: string }[];
}

const manifest = JSON.parse(readFileSync(publicFile(EMULATORJS_MANIFEST_PATH), "utf8")) as Manifest;
const siteNotice = readFileSync(publicFile(NOTICE_PATH), "utf8");
/** Parts 6 and 7 of the site notice: the Retro Arcade parts. */
const retroNotice = siteNotice.slice(Math.max(0, siteNotice.indexOf("\n6. EmulatorJS")));

/** The size words on a link and in the notice: MB with one decimal, and "less than 0.1 MB" below that. */
function sizeWords(bytes: number): string {
  const mb = (bytes / 1e6).toFixed(1);
  return mb === "0.0" ? "less than 0.1 MB" : `${mb} MB`;
}

function entry(id: string): ThirdPartyComponent {
  const found = THIRD_PARTY_COMPONENTS.find((c) => c.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

const retroEntries = [entry("emulatorjs"), entry("retro-arcade-cores")];
const retroLinks: LicenseLink[] = retroEntries.flatMap((c) => [c.licenseText, ...(c.moreLicenseTexts ?? []), ...c.source]);
const allLinks: LicenseLink[] = THIRD_PARTY_COMPONENTS.flatMap((c) => [c.licenseText, ...(c.moreLicenseTexts ?? []), ...c.source]);
/** A manifest path ("source/x.tar.gz") as a site path. */
const sitePath = (manifestPath: string) => `${EMULATORJS_DIR}/${manifestPath}`;

describe("the Retro Arcade entries on the licenses page", () => {
  it("name the manifest's EmulatorJS version and release hash", () => {
    expect(EMULATORJS_VERSION).toBe(manifest.version);
    expect(EMULATORJS_DIR).toBe(`/emulator/ejs/${manifest.version}`);
    expect(EMULATORJS_RELEASE_SHA256).toBe(manifest.release.sha256);
    expect(entry("emulatorjs").version).toBe(manifest.version);
  });

  it("link every source code file of the manifest once, and no other file in source/", () => {
    const linked = allLinks.filter((l) => l.href.startsWith(`${EMULATORJS_SOURCE_DIR}/`)).map((l) => l.href);
    expect(new Set(linked).size, "a source code file is linked twice").toBe(linked.length);
    expect([...linked].sort()).toEqual(manifest.sources.map((s) => sitePath(s.path)).sort());
  });

  it("give each source code file the size that the manifest records", () => {
    for (const source of manifest.sources) {
      const link = allLinks.find((l) => l.href === sitePath(source.path));
      expect(link?.label, source.path).toMatch(new RegExp(`\\(${sizeWords(source.bytes).replace(/\./g, "\\.")}\\)$`));
    }
  });

  it("link the license text of each core and each other license text of the manifest", () => {
    const licenseLinks = retroLinks.filter((l) => l.href.startsWith(`${EMULATORJS_DIR}/licenses/`)).map((l) => l.href);
    const known = new Set(manifest.licenses.map((l) => sitePath(l.path)));
    for (const href of licenseLinks) expect(known.has(href), `${href} is not a license entry of the manifest`).toBe(true);
    const cores = entry("retro-arcade-cores");
    const coreTexts = [cores.licenseText, ...(cores.moreLicenseTexts ?? [])].map((l) => l.href);
    for (const [core, info] of Object.entries(manifest.cores)) {
      expect(coreTexts, `${core} license text`).toContain(sitePath(info.licenseText));
    }
    // Every license text in the folder is on the page (git holds them, and the notice names each one).
    expect([...new Set(licenseLinks)].sort()).toEqual([...known].sort());
  });

  it("link the source of each core of the manifest from the cores entry", () => {
    const cores = entry("retro-arcade-cores").source.map((l) => l.href);
    const sourceById = new Map(manifest.sources.map((s) => [s.id, s]));
    for (const [core, info] of Object.entries(manifest.cores)) {
      for (const id of info.sources) {
        const source = sourceById.get(id);
        expect(source, `${core}: manifest source ${id}`).toBeDefined();
        expect(cores, `${core} needs ${id}`).toContain(sitePath(source!.path));
      }
    }
  });

  it("use the source URLs that the manifest records for the parts on GitHub", () => {
    const external = retroLinks.filter((l) => l.external).map((l) => l.href);
    const recorded = manifest.components.filter((c) => c.sourceUrl).map((c) => c.sourceUrl!);
    for (const href of external) expect(recorded, href).toContain(href);
  });

  it("link the full EmulatorJS notice from both entries", () => {
    for (const c of retroEntries) expect(c.source.map((l) => l.href), c.id).toContain(EMULATORJS_NOTICE_PATH);
  });

  it("use no em-dash in the words on the page", () => {
    for (const c of retroEntries) {
      const words = [c.name, c.version, c.purpose, c.license, c.copyright, ...c.notes, ...retroLinks.map((l) => l.label)];
      for (const w of words) expect(w, w).not.toContain("—");
    }
  });
});

describe("the Retro Arcade parts of /licenses/NOTICE.txt", () => {
  it("are there", () => {
    expect(retroNotice.startsWith(`\n6. EmulatorJS, version ${manifest.version}`)).toBe(true);
    expect(retroNotice).toContain("\n7. The Retro Arcade emulator cores");
  });

  it("name every source code file with the size that the manifest records", () => {
    for (const source of manifest.sources) {
      expect(retroNotice, source.path).toContain(`${sitePath(source.path)} (${sizeWords(source.bytes)})`);
    }
  });

  it("name the EmulatorJS notice, the manifest, the release hash and each license text", () => {
    expect(retroNotice).toContain(EMULATORJS_NOTICE_PATH);
    expect(retroNotice).toContain(EMULATORJS_MANIFEST_PATH);
    expect(retroNotice).toContain(manifest.release.sha256);
    for (const license of manifest.licenses) {
      // Part 7 names the files of /emulator/ejs/<version>/licenses/ without the folder.
      const file = license.path.replace(/^licenses\//, "");
      expect(retroNotice.includes(sitePath(license.path)) || new RegExp(`[\\s(]${file.replace(/\./g, "\\.")}\\b`).test(retroNotice), license.path).toBe(
        true,
      );
    }
    expect(siteNotice).not.toContain("—");
  });
});
