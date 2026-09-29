import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSpeechMock, removeSpeechMock, type SpeechMock } from "@/__tests__/speech-mock";
import LicensesRoute, { metadata } from "@/app/licenses/page";

import { LicensesPage } from "../components/LicensesPage";
import {
  AAC_BUILD_FILES,
  AAC_MODULE_SHA256,
  EMULATORJS_MANIFEST_PATH,
  EMULATORJS_NOTICE_PATH,
  EMULATORJS_RELEASE_SHA256,
  EMULATORJS_SOURCE_DIR,
  FFMPEG_SHA256,
  FFMPEG_TARBALL_PATH,
  KID_NOTE,
  LGPL_RIGHTS,
  NOTICE_PATH,
  THIRD_PARTY_COMPONENTS,
  aacBuildFileHref,
} from "../lib/components";

let speech: SpeechMock;

beforeEach(() => {
  speech = installSpeechMock();
});

afterEach(() => {
  removeSpeechMock();
});

function card(id: string): HTMLElement {
  const found = screen.getAllByTestId("license-component").find((el) => el.id === id);
  expect(found, id).toBeDefined();
  return found as HTMLElement;
}

/** The <dd> of one row in a component card. */
function row(cardEl: HTMLElement, label: string): HTMLElement {
  const dt = within(cardEl)
    .getAllByText(label)
    .find((el) => el.tagName === "DT");
  expect(dt, label).toBeDefined();
  return dt!.nextElementSibling as HTMLElement;
}

describe("LicensesPage", () => {
  it("has one card per shipped component, each with its version, license, license text and source", () => {
    render(<LicensesPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Licenses" })).toBeInTheDocument();
    expect(screen.getAllByTestId("license-component")).toHaveLength(THIRD_PARTY_COMPONENTS.length);
    for (const c of THIRD_PARTY_COMPONENTS) {
      const el = card(c.id);
      expect(within(el).getByRole("heading", { level: 3, name: c.name })).toBeInTheDocument();
      expect(el).toHaveTextContent(c.purpose);
      expect(row(el, "Version")).toHaveTextContent(c.version);
      expect(row(el, "License")).toHaveTextContent(c.license);
      expect(within(row(el, "License")).getByRole("link", { name: c.licenseText.label })).toHaveAttribute(
        "href",
        c.licenseText.href,
      );
      for (const text of c.moreLicenseTexts ?? []) {
        expect(within(row(el, "License")).getByRole("link", { name: text.label })).toHaveAttribute("href", text.href);
      }
      for (const s of c.source) {
        expect(within(row(el, "Source code")).getByRole("link", { name: new RegExp(`^${escape(s.label)}`) })).toHaveAttribute(
          "href",
          s.href,
        );
      }
      expect(row(el, "Copyright")).toHaveTextContent(c.copyright);
    }
  });

  it("names FFmpeg, Mediabunny and the bridge with the licenses that ask for this page", () => {
    render(<LicensesPage />);
    const ffmpeg = card("ffmpeg");
    expect(row(ffmpeg, "Version")).toHaveTextContent("8.1.3");
    expect(row(ffmpeg, "License")).toHaveTextContent("LGPL-2.1-or-later");
    // The exact source, from the same place as the module (LGPL-2.1 section 6(d)).
    expect(within(ffmpeg).getByRole("link", { name: /FFmpeg 8\.1\.3 source code/ })).toHaveAttribute(
      "href",
      "/licenses/ffmpeg-8.1.3.tar.xz",
    );
    expect(ffmpeg).toHaveTextContent("We did not change the FFmpeg source.");
    expect(row(card("mediabunny"), "License")).toHaveTextContent("MPL-2.0");
    expect(row(card("mediabunny"), "Version")).toHaveTextContent("1.60.0");
    expect(within(card("aac-bridge")).getByRole("link", { name: "bridge.c source code" })).toHaveAttribute(
      "href",
      "/licenses/aac-wasm/bridge.c",
    );
  });

  it("links every build file, shows both hashes, and states the LGPL rights", () => {
    render(<LicensesPage />);
    const build = screen.getByRole("region", { name: "How we build the AAC module" });
    for (const { file } of AAC_BUILD_FILES) {
      expect(within(build).getByRole("link", { name: file })).toHaveAttribute("href", aacBuildFileHref(file));
    }
    expect(build).toHaveTextContent(FFMPEG_SHA256);
    expect(build).toHaveTextContent(AAC_MODULE_SHA256);
    const rights = screen.getByRole("region", { name: "Your rights for the FFmpeg part" });
    for (const right of LGPL_RIGHTS) expect(rights).toHaveTextContent(right);
    expect(within(rights).getByRole("link", { name: FFMPEG_TARBALL_PATH })).toHaveAttribute("href", FFMPEG_TARBALL_PATH);
    expect(screen.getByRole("link", { name: "NOTICE.txt" })).toHaveAttribute("href", NOTICE_PATH);
  });

  it("names EmulatorJS and the Retro Arcade cores, and links their source code on this site", () => {
    render(<LicensesPage />);
    const ejs = card("emulatorjs");
    expect(row(ejs, "Version")).toHaveTextContent("4.2.3");
    expect(row(ejs, "License")).toHaveTextContent("GPL-3.0");
    expect(within(ejs).getByRole("link", { name: /^EmulatorJS 4\.2\.3 source code \(0\.6 MB\)$/ })).toHaveAttribute(
      "href",
      "/emulator/ejs/4.2.3/source/EmulatorJS-4.2.3-e150dc0491ae.tar.gz",
    );
    const cores = card("retro-arcade-cores");
    expect(within(cores).getByRole("link", { name: /^Snes9x \(Super NES\) source code/ })).toHaveAttribute(
      "href",
      "/emulator/ejs/4.2.3/source/snes9x-6ca2343e5f3b.tar.gz",
    );
    expect(within(row(cores, "License")).getByRole("link", { name: "Stella 2014 license text" })).toHaveAttribute(
      "href",
      "/emulator/ejs/4.2.3/licenses/cores/stella2014.txt",
    );
    expect(cores).toHaveTextContent("non-commercial use only");
    for (const el of [ejs, cores]) {
      expect(within(el).getAllByRole("link", { name: /^Retro Arcade emulator notice/ })[0]).toHaveAttribute(
        "href",
        EMULATORJS_NOTICE_PATH,
      );
    }
  });

  it("tells where the Retro Arcade source code is, with the notice, the manifest and the release hash", () => {
    render(<LicensesPage />);
    const section = screen.getByRole("region", { name: "The Retro Arcade source code" });
    expect(section).toHaveTextContent(`${EMULATORJS_SOURCE_DIR}/`);
    expect(within(section).getByRole("link", { name: EMULATORJS_NOTICE_PATH })).toHaveAttribute("href", EMULATORJS_NOTICE_PATH);
    expect(within(section).getByRole("link", { name: EMULATORJS_MANIFEST_PATH })).toHaveAttribute(
      "href",
      EMULATORJS_MANIFEST_PATH,
    );
    expect(section).toHaveTextContent(EMULATORJS_RELEASE_SHA256);
    // Grown-ups words: the page says what it covers.
    expect(screen.getByRole("heading", { level: 2, name: "For grown-ups: open-source software on this site" })).toBeInTheDocument();
  });

  it("opens other websites in a new tab, safely, and says so to screen readers", () => {
    render(<LicensesPage />);
    const external = THIRD_PARTY_COMPONENTS.flatMap((c) => c.source).filter((s) => s.external);
    expect(external.length).toBeGreaterThan(0);
    for (const s of external) {
      const link = screen.getByRole("link", { name: `${s.label} (opens in a new tab)` });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(s.href).toMatch(/^https:\/\/github\.com\//);
    }
    // Links on this site stay in the tab.
    expect(screen.getByRole("link", { name: "NOTICE.txt" })).not.toHaveAttribute("target");
  });

  it("gives every link a touch target of at least 44 px", () => {
    render(<LicensesPage />);
    const main = screen.getByRole("main");
    const links = within(main).getAllByRole("link");
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) expect(link.className, link.textContent ?? "").toMatch(/min-h-\[44px\]/);
  });

  it("has a note for kids that the read-aloud button speaks", () => {
    render(<LicensesPage />);
    const kids = screen.getByRole("region", { name: "For kids" });
    expect(kids).toHaveTextContent(KID_NOTE);
    fireEvent.click(within(kids).getByTestId("read-aloud-button"));
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.lastUtterance().text).toBe(KID_NOTE);
  });

  it("wraps the long key and hash strings, so a phone never scrolls sideways", () => {
    render(<LicensesPage />);
    // Measured at 390 px wide in Chromium: without break-words, the signing key made the page 472 px wide.
    expect(screen.getByTestId("grown-ups-notice").className).toMatch(/\bbreak-words\b/);
    for (const code of screen.getByTestId("grown-ups-notice").querySelectorAll("code")) {
      expect(code.className).toMatch(/\bbreak-all\b/);
    }
  });

  it("uses no em-dash and no all-caps heading", () => {
    const { container } = render(<LicensesPage />);
    expect(container.textContent).not.toContain("—");
    for (const h of container.querySelectorAll("h1, h2, h3")) {
      const t = h.textContent ?? "";
      expect(t === t.toUpperCase() && /[A-Z]{3}/.test(t), t).toBe(false);
      expect(h.className).not.toMatch(/\buppercase\b/);
    }
  });
});

describe("/licenses route", () => {
  it("renders the page with a title", () => {
    render(<LicensesRoute />);
    expect(screen.getByRole("heading", { level: 1, name: "Licenses" })).toBeInTheDocument();
    expect(metadata.title).toBe("Licenses");
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
