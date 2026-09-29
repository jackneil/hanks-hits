import { describe, expect, it } from "vitest";

import type { ClipReasonCode } from "../../service/contract";
import { LAB_COPY, LAB_REASON_TEXT, reasonText } from "../labCopy";

const ALL_STRINGS: Array<[string, string]> = [
  ...Object.entries(LAB_COPY).map(([key, value]) => [`LAB_COPY.${key}`, value] as [string, string]),
  ...Object.entries(LAB_REASON_TEXT).map(([key, value]) => [`LAB_REASON_TEXT.${key}`, value] as [string, string]),
];

/** Every ClipReasonCode of the contract. The Record type makes this list complete. */
const REASONS: Record<ClipReasonCode, true> = {
  warming: true,
  "flag-off": true,
  "no-tier": true,
  "other-tab": true,
  breaker: true,
  resting: true,
  "record-only": true,
  quota: true,
  "storage-unavailable": true,
  "encoder-error": true,
  "mux-failed": true,
  "source-lost": true,
  hidden: true,
};

describe("clips lab copy (plan 11.6)", () => {
  it.each(ALL_STRINGS)("%s has no em-dash and no en-dash", (_key, text) => {
    expect(text).not.toMatch(/[—–]/);
    expect(text).not.toContain("--");
  });

  it.each(ALL_STRINGS)("%s uses 'save' only in a 'Save to ...' phrase", (_key, text) => {
    const bare = text.replace(/\bSave to (Photos|phone|computer|Files)\b/g, "");
    expect(bare).not.toMatch(/\bsav(e|ed|ing)\b/i);
  });

  it.each(ALL_STRINGS)("%s uses none of the banned words", (_key, text) => {
    for (const banned of [
      /\bexport/i,
      /\bdownload/i,
      /\bupload/i,
      /\bscreenshot/i,
      /\bphoto\b/i,
      /\bURL\b/,
      /\bpost\b/i,
      /\bclapper/i,
      /\bcamera/i,
      /\brecord button/i,
      /\brecording file/i,
      /\bsign in\b/i,
      /\blog in\b/i,
    ]) {
      expect(text).not.toMatch(banned);
    }
  });

  it("names the actions with the allowed phrases", () => {
    expect(LAB_COPY.clip).toMatch(/^Clip it!/);
    expect(LAB_COPY.clipMade).toBe("Clip made!");
    expect(LAB_COPY.recordStart).toBe("Record a video");
    expect(LAB_COPY.videoMade).toBe("Video made!");
  });

  it("tells a rested clip button to use the control that wakes it (plan 11.3), never a control that stops the lab", () => {
    expect(LAB_COPY.wake).toBe("Turn the clip button back on");
    expect(LAB_REASON_TEXT.resting).toContain(`"${LAB_COPY.wake}"`);
    expect(LAB_REASON_TEXT.resting).not.toContain(LAB_COPY.start);
  });

  it("has words with a next step for every reason code of the contract", () => {
    for (const reason of Object.keys(REASONS) as ClipReasonCode[]) {
      const text = LAB_REASON_TEXT[reason];
      expect(text, reason).toBeTruthy();
      // A reason and a next step: at least two sentences, or an instruction.
      expect(text.split(/[.!]\s/).length, reason).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives the reason words, and a fallback for an unknown or missing reason", () => {
    expect(reasonText("quota")).toBe(LAB_REASON_TEXT.quota);
    expect(reasonText("busy")).toBe(LAB_REASON_TEXT.busy);
    expect(reasonText(null)).toBe(LAB_REASON_TEXT["mux-failed"]);
    expect(reasonText(undefined)).toBe(LAB_REASON_TEXT["mux-failed"]);
    expect(reasonText("nonsense" as ClipReasonCode)).toBe(LAB_REASON_TEXT["mux-failed"]);
  });

  it("keeps the tables frozen", () => {
    expect(Object.isFrozen(LAB_COPY)).toBe(true);
    expect(Object.isFrozen(LAB_REASON_TEXT)).toBe(true);
  });
});
