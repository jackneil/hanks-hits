import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  allCopyStrings,
  SHARING_COPY,
  BUTTON_NAMES,
  buttonTooltip,
  CLIP_REASON_CODES,
  deferredMenuText,
  isClipReasonCode,
  memoryNote,
  REASON_COPY,
  reasonText,
  RESULT_ACTION_COPY,
  RESULT_COPY,
  SAVE_BUTTON_LABELS,
  SAVE_LABELS,
  SETTINGS_COPY,
  shareReply,
  saveReply,
  lengthInWords,
  actionWithLength,
  TOAST_COPY,
  watchRunLabel,
  wholeRunLabel,
  type SaveButton,
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

const strings = [...allCopyStrings(), ...Object.values(SHARING_COPY)];

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

  it("local capture and device sharing never require sign-in", () => {
    for (const text of allCopyStrings()) {
      expect(text, text).not.toMatch(SIGN_IN);
    }
  });

  it("public publishing explicitly asks a guest to sign in and never publishes automatically", () => {
    expect(SHARING_COPY.signInToPublishThisVideo).toBe("Sign in to publish this video");
    expect(SHARING_COPY.prepareAGameplayVideoWatchItThen).toContain("Nothing is published automatically");
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

  const SAVE_BUTTONS: SaveButton[] = ["photos", "phone", "computer", "files"];

  it("maps every ShareOutcome to the plan 12 reply, naming the button that is on screen", () => {
    expect(SAVE_BUTTON_LABELS).toEqual({ ...SAVE_LABELS, files: "Save to Files" });
    for (const save of SAVE_BUTTONS) {
      const label = SAVE_BUTTON_LABELS[save];
      expect(shareReply("shared", save)).toBe("Shared!");
      expect(shareReply("cancelled", save)).toBe("No problem. Your clip is safe in My Clips.");
      expect(shareReply("retry", save)).toBe("Tap Share one more time.");
      expect(shareReply("ignored", save)).toBeNull();
      expect(shareReply("blocked", save)).toMatch(/grown-up/);
      // The fallback replies name exactly the button that is shown, never another platform's.
      expect(shareReply("fallback-save", save)).toBe(`This clip cannot be shared here. Tap ${label}.`);
      expect(shareReply("unsupported", save)).toBe(`This browser cannot share clips. Tap ${label}.`);
      expect(saveReply({ kind: "failed", reason: "unknown" }, save)).toBe(`That did not work. Tap ${label} again.`);
      for (const other of SAVE_BUTTONS.filter((button) => button !== save)) {
        expect(shareReply("fallback-save", save), `${save} vs ${other}`).not.toContain(SAVE_BUTTON_LABELS[other]);
        expect(shareReply("unsupported", save), `${save} vs ${other}`).not.toContain(SAVE_BUTTON_LABELS[other]);
      }
    }
    // The iPhone fallback is a copy to the Files app.
    expect(shareReply("fallback-save", "files")).toContain("Save to Files");
  });

  it("says video or picture when the thing is not a clip", () => {
    expect(shareReply("cancelled", "phone", "record")).toBe("No problem. Your video is safe in My Clips.");
    expect(shareReply("cancelled", "phone", "picture")).toBe("No problem. Your picture is safe in My Clips.");
    expect(shareReply("fallback-save", "files", "record")).toBe("This video cannot be shared here. Tap Save to Files.");
  });

  it("never claims a copy is finished: it says where to look", () => {
    expect(saveReply({ kind: "saved" }, "computer")).toBe("Look for your clip on your computer!");
    expect(saveReply({ kind: "saved" }, "phone", "picture")).toBe("Look for your picture on your phone!");
    expect(saveReply({ kind: "saved" }, "files", "record")).toBe("Look for your video in the Files app!");
    for (const save of SAVE_BUTTONS) expect(saveReply({ kind: "saved" }, save)).not.toMatch(/\bis on\b|\bnow\b/);
  });

  it("names the real buttons in the private-window note", () => {
    for (const save of SAVE_BUTTONS) {
      expect(memoryNote(save, true)).toContain(SAVE_BUTTON_LABELS[save]);
      expect(memoryNote(save, true)).toContain("Share it");
      // No Share button on screen: the note does not name one.
      expect(memoryNote(save, false)).toContain(SAVE_BUTTON_LABELS[save]);
      expect(memoryNote(save, false)).not.toMatch(/share/i);
    }
  });

  it("names the key a Mac or an iPhone keyboard has", () => {
    expect(buttonTooltip(true)).toContain("Option+C");
    expect(buttonTooltip(false)).toContain("Alt+C");
  });

  it("describes what a tap does in the record-only state (it opens the menu)", () => {
    expect(BUTTON_NAMES["record-only"]).toBe("Clip button. Tap for Record a video and Take a picture.");
  });

  it("tells controller players about both kinds of controller", () => {
    expect(SETTINGS_COPY.padTip).toMatch(/share button/);
    expect(SETTINGS_COPY.padTip).toMatch(/hold the back button/);
  });

  it("does not tell a paused kid that clips stop (the pause menu still clips)", () => {
    expect(reasonText("hidden")).not.toMatch(/clip/i);
  });

  it("says the Capture menu waits for the end of a run, with the reason first", () => {
    expect(deferredMenuText(null)).toBe(TOAST_COPY.menuAtRunEnd);
    expect(deferredMenuText("resting")).toBe(`${REASON_COPY.resting.say} ${TOAST_COPY.menuAtRunEnd}`);
  });

  it("knows which codes are reasons, and gives any other code general words", () => {
    for (const code of CLIP_REASON_CODES) expect(isClipReasonCode(code)).toBe(true);
    expect(isClipReasonCode("busy")).toBe(false);
    expect(isClipReasonCode("cancelled")).toBe(false);
    // A newer service may send a code this table does not know: no crash, general words.
    expect(reasonText("cancelled" as never)).toBe(reasonText("encoder-error"));
  });

  it("gives every visible clip button state an accessible name", () => {
    for (const [state, name] of Object.entries(BUTTON_NAMES)) {
      expect(name.trim(), state).not.toBe("");
    }
  });
});

describe("result chip clip words (decision D1)", () => {
  it("names the run's clips, and no Record or picture action", () => {
    expect(RESULT_ACTION_COPY).toEqual({
      watchRun: "Watch the whole run",
      watchEnd: "Watch the end",
      wholeRun: "Make the whole run a video",
    });
    expect(watchRunLabel("0:16")).toBe("Watch the whole run (0:16)");
    expect(wholeRunLabel("1:42")).toBe("Make the whole run a video (1:42)");
  });

  it("says a length in words for the voice", () => {
    expect(lengthInWords(16.9)).toBe("16 seconds");
    expect(lengthInWords(1)).toBe("1 second");
    expect(lengthInWords(60)).toBe("1 minute");
    expect(lengthInWords(61)).toBe("1 minute and 1 second");
    expect(lengthInWords(102)).toBe("1 minute and 42 seconds");
    expect(lengthInWords(180)).toBe("3 minutes");
    expect(lengthInWords(Number.NaN)).toBe("0 seconds");
    expect(actionWithLength(RESULT_ACTION_COPY.watchRun, 16)).toBe("Watch the whole run, 16 seconds");
  });
});

describe("clip UI source files", () => {
  // A kid-facing string written inline in a component would skip the copy
  // test. The components may only hold strings that are not copy
  // (class names, test ids, data values). This scan catches a JSX text
  // node with a letter in it.
  const dir = join(__dirname, "..");
  const components = readdirSync(dir).filter((name) => name.endsWith(".tsx"));

  /** Comments are for developers. */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  it("keep kid-facing attribute text in copy.ts (aria-label, alt, title, placeholder)", () => {
    for (const name of components) {
      const source = stripComments(readFileSync(join(dir, name), "utf8"));
      const literal = Array.from(
        source.matchAll(/\b(aria-label|aria-description|alt|title|placeholder)=(["'])([^"']*[A-Za-z][^"']*)\2/g),
      ).map((match) => `${match[1]}="${match[3]}"`);
      expect(literal, name).toEqual([]);
    }
  });

  it("keep kid-facing sentences out of the .ts logic files", () => {
    const logic = readdirSync(dir).filter((file) => file.endsWith(".ts") && file !== "copy.ts");
    expect(logic.length).toBeGreaterThan(5);
    for (const name of logic) {
      const source = stripComments(readFileSync(join(dir, name), "utf8"));
      // A string that reads like a sentence: a capital, words with spaces, an end mark.
      const sentences = Array.from(source.matchAll(/(["'`])([A-Z][a-z']+(?: [A-Za-z',]+)+[.!?])\1/g)).map((match) => match[2]);
      expect(sentences, name).toEqual([]);
    }
  });

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
