// @vitest-environment node
import { describe, expect, it } from "vitest";

import { HIDDEN_KEEP_DAYS, ORPHAN_GRACE_MS, UPLOAD_LEDGER_KEEP_MS, monthsBefore, retentionCutoffs } from "../retention";

describe("retentionCutoffs (section 8)", () => {
  it("keeps a hidden clip 30 days, a public clip 12 months, an orphan 1 hour, the ledger 2 days", () => {
    const now = new Date("2026-10-02T10:00:00.000Z");
    const cut = retentionCutoffs(now);
    expect(HIDDEN_KEEP_DAYS).toBe(30);
    expect(cut.hiddenBefore.toISOString()).toBe("2026-09-02T10:00:00.000Z");
    expect(cut.createdBefore.toISOString()).toBe("2025-10-02T10:00:00.000Z");
    expect(now.getTime() - cut.orphanBefore.getTime()).toBe(ORPHAN_GRACE_MS);
    expect(now.getTime() - cut.ledgerBefore.getTime()).toBe(UPLOAD_LEDGER_KEEP_MS);
  });

  it("counts 12 calendar months in UTC; on a leap day the cutoff is Feb 28, never Mar 1", () => {
    // Mar 1 would delete a clip made on 2027-03-01 before its 12 months end (2028-03-01).
    expect(retentionCutoffs(new Date("2028-02-29T10:00:00.000Z")).createdBefore.toISOString()).toBe(
      "2027-02-28T10:00:00.000Z"
    );
    expect(retentionCutoffs(new Date("2027-01-31T23:59:59.999Z")).createdBefore.toISOString()).toBe(
      "2026-01-31T23:59:59.999Z"
    );
  });

  it("uses the last day of a shorter month, and carries into the year before", () => {
    expect(monthsBefore(new Date("2026-03-31T08:00:00.000Z"), 1).toISOString()).toBe("2026-02-28T08:00:00.000Z");
    expect(monthsBefore(new Date("2028-03-31T08:00:00.000Z"), 1).toISOString()).toBe("2028-02-29T08:00:00.000Z");
    expect(monthsBefore(new Date("2026-01-15T08:00:00.000Z"), 1).toISOString()).toBe("2025-12-15T08:00:00.000Z");
    expect(monthsBefore(new Date("2026-05-31T08:00:00.000Z"), 3).toISOString()).toBe("2026-02-28T08:00:00.000Z");
  });

  it("never deletes a public clip younger than 12 months, on any day of three years", () => {
    const DAY = 24 * 60 * 60 * 1000;
    for (let t = Date.UTC(2027, 0, 1, 13); t < Date.UTC(2030, 0, 1); t += DAY) {
      const now = new Date(t);
      const cutoff = retentionCutoffs(now).createdBefore;
      // 12 calendar months back: the same month number one year earlier, at least 365 days ago.
      expect(cutoff.getUTCMonth(), now.toISOString()).toBe(now.getUTCMonth());
      expect(cutoff.getUTCFullYear(), now.toISOString()).toBe(now.getUTCFullYear() - 1);
      expect(now.getTime() - cutoff.getTime(), now.toISOString()).toBeGreaterThanOrEqual(365 * DAY);
    }
  });
});
