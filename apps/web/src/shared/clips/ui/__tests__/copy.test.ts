import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  allCopyStrings,
  BUTTON_NAMES,
  CLIP_REASON_CODES,
  MEMORY_NOTE,
  REASON_COPY,
  RESULT_COPY,
  SAVE_LABELS,
  shareReply,
  saveReply,
  type SavePlatform,
} from "../copy";

/** The only phrases allowed to contain "save" (plan 11.6). */
const SAVE_PHRASES = /Save to (Photos|phone|computer|Files)/g;

/** Plan 11.6 "Never" column, as patterns. "photo" is checked after the Save to Photos phrase is removed. */
const NEVER: Array<[string, RegExp]> = [
  ["clapper", /clapper/i],
  ["camera", /camera/i],
  ["clip camera", /clip camera/i],
  ["record button", /record button/i],
  ["Clip saved", /clip saved/i],
  ["export", /export/i],
  ["Video saved", /video saved/i],
  ["recording file", /recording file/i],
  ["photo", /photo/i],
  ["screenshot", /screen\s?shot/i],
  ["Download", /download/i],
  ["post", /\bpost(s|ed|ing)?\b/i],
  ["URL", /\burls?\b/i],
  ["upload", /upload/i],
];

const SIGN_IN = /sign[\s-]?in|log[\s-]?in|sign[\s-]?up|account|password/i;

const strings = allCopyStrings();

describe("clip copy table (plan 11.6)", () => {
  it("reads a real, non-trivial table", () => {
    expect(strings.length).toBeGreaterThan(80);
    for (const text of strings) {
      expect(typeof text).toBe("string");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it('uses "save" only inside the "Save to ..." phrases', () => {
    for (const text of strings) {
      const rest = text.replace(SAVE_PHRASES, "");
      expect(rest, text).not.toMatch(/sav(e|ed|es|ing)\b/i);
    }
  });

  it('never uses a word from the "Never" column', () => {
    for (const text of strings) {
      const rest = text.replace(SAVE_PHRASES, "");
      for (const [word, pattern] of NEVER) {
        expect(rest, `"${text}" uses "${word}"`).not.toMatch(pattern);
      }
    }
  });

  it("has no em-dash, en-dash or double hyphen", () => {
    for (const text of strings) {
      expect(text, text).not.toMatch(/[—–]|--/);
    }
  });

  it("has no sign-in prompt on any clip surface", () => {
    for (const text of strings) {
      expect(text, text).not.toMatch(SIGN_IN);
    }
  });

  it("gives every ClipReasonCode kid words and a separate next step", () => {
    expect(new Set(CLIP_REASON_CODES).size).toBe(CLIP_REASON_CODES.length);
    expect(Object.keys(REASON_COPY).sort()).toEqual([...CLIP_REASON_CODES].sort());
    for (const code of CLIP_REASON_CODES) {
      const { say, next } = REASON_COPY[code];
      expect(say.trim(), code).not.toBe("");
      expect(next.trim(), code).not.toBe("");
      expect(say, code).toMatch(/[.!?]$/);
      expect(next, code).toMatch(/[.!?]$/);
      expect(next, code).not.toBe(say);
    }
  });

  it("uses the plan's own words for the plan 11.3 replies", () => {
    expect(`${REASON_COPY.warming.say} ${REASON_COPY.warming.next}`).toBe(
      "Play a little first! Then tap the clip button again.",
    );
    expect(`${REASON_COPY["record-only"].say} ${REASON_COPY["record-only"].next}`).toBe(
      "This game is too big for instant clips on this phone. You can still record!",
    );
    expect(`${REASON_COPY.breaker.say} ${REASON_COPY.breaker.next}`).toBe(
      "Clips are off for this game on this device: it crashed while recording. They come back after a few good games.",
    );
  });

  it("uses the allowed phrases for results and copies that leave the site", () => {
    expect(RESULT_COPY).toEqual({
      clip: "Clip made!",
      extend: "Clip made! (longer)",
      record: "Video made!",
      picture: "Picture made!",
    });
    expect(SAVE_LABELS).toEqual({ photos: "Save to Photos", phone: "Save to phone", computer: "Save to computer" });
  });

  it("maps every ShareOutcome to the plan 12 reply", () => {
    const platforms: SavePlatform[] = ["photos", "phone", "computer"];
    for (const platform of platforms) {
      expect(shareReply("shared", platform)).toBe("Shared!");
      expect(shareReply("cancelled", platform)).toBe("No problem. Your clip is safe in My Clips.");
      expect(shareReply("retry", platform)).toBe("Tap Share one more time.");
      expect(shareReply("ignored", platform)).toBeNull();
      expect(shareReply("blocked", platform)).toMatch(/grown-up/);
    }
    expect(shareReply("fallback-save", "computer")).toContain("Save to computer");
    expect(shareReply("fallback-save", "phone")).toContain("Save to phone");
    expect(shareReply("unsupported", "computer")).toContain("Save to computer");
    expect(saveReply({ kind: "failed", reason: "unknown" }, "phone")).toContain("Save to phone");
  });

  it("names the real button in the private-window note on each platform", () => {
    expect(MEMORY_NOTE.photos).toContain("Save to Photos");
    expect(MEMORY_NOTE.phone).toContain("Save to phone");
    expect(MEMORY_NOTE.computer).toContain("Save to computer");
    for (const note of Object.values(MEMORY_NOTE)) expect(note).toMatch(/^.*Share it/);
  });

  it("gives every visible clip button state an accessible name", () => {
    for (const [state, name] of Object.entries(BUTTON_NAMES)) {
      expect(name.trim(), state).not.toBe("");
    }
  });
});

describe("clip UI source files", () => {
  // A kid-facing string written inline in a component would skip the copy
  // test. The components may only hold strings that are not copy
  // (class names, test ids, data values). This scan catches a JSX text
  // node with a letter in it.
  const dir = join(__dirname, "..");
  const components = readdirSync(dir).filter((name) => name.endsWith(".tsx"));

  it("keep kid-facing text in copy.ts (no inline JSX text with words)", () => {
    expect(components.length).toBeGreaterThan(8);
    for (const name of components) {
      const source = readFileSync(join(dir, name), "utf8")
        // Comments are for developers.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // Text after a ">" and before a "<" or a "{" that has a letter, and
      // is not a JS expression.
      // "=>" is an arrow, not a tag end.
      const inline = Array.from(source.matchAll(/(?<![=-])>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*?)\s*[<{]/g))
        .map((match) => match[1].trim())
        .filter((text) => text.length > 0 && !/[;=(`$]|&&|\|\|/.test(text));
      expect(inline, name).toEqual([]);
    }
  });

  it("use no em-dash in any clip UI source", () => {
    for (const name of readdirSync(dir).filter((file) => /\.(ts|tsx)$/.test(file))) {
      expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/—/);
    }
  });
});
