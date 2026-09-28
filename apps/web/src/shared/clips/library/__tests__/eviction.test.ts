// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ClipKind, ClipRecord } from "../../protocol";
import { LIBRARY_QUOTA_SHARE, budgetFromQuota, isEvictable, planEviction } from "../eviction";

let serial = 0;
function row(overrides: Partial<ClipRecord> = {}): ClipRecord {
  serial++;
  return {
    id: `c${serial}`,
    ownerKey: "guest",
    gameId: "snake",
    kind: "auto",
    createdAt: serial * 1000,
    durationMs: 10_000,
    width: 720,
    height: 1280,
    fps: 30,
    hasAudio: true,
    mime: "video/mp4",
    bytes: 100,
    kept: false,
    watched: true,
    storage: "opfs",
    posterDataUrl: "",
    moments: [],
    ...overrides,
  };
}

describe("budgetFromQuota", () => {
  it("is 25% of the quota, rounded down", () => {
    expect(LIBRARY_QUOTA_SHARE).toBe(0.25);
    expect(budgetFromQuota(38.7e9)).toBe(Math.floor(38.7e9 / 4));
    expect(budgetFromQuota(1001)).toBe(250);
  });

  it("is 0 for a missing or bad quota", () => {
    expect(budgetFromQuota(0)).toBe(0);
    expect(budgetFromQuota(-5)).toBe(0);
    expect(budgetFromQuota(Number.NaN)).toBe(0);
    expect(budgetFromQuota(Infinity)).toBe(0);
  });
});

describe("isEvictable", () => {
  const kinds: ClipKind[] = ["clip", "auto", "record", "picture"];
  it.each(
    kinds.flatMap((kind) =>
      [true, false].flatMap((kept) => [true, false].map((watched) => [kind, kept, watched] as const)),
    ),
  )("kind %s, kept %s, watched %s", (kind, kept, watched) => {
    expect(isEvictable(row({ kind, kept, watched }))).toBe(kind === "auto" && !kept && watched);
  });
});

describe("planEviction", () => {
  it("removes nothing when the new clip fits", () => {
    const rows = [row(), row()];
    const plan = planEviction(rows, 1000, 800);
    expect(plan).toMatchObject({ fits: true, usedBytes: 200, budgetBytes: 1000, neededBytes: 800, remove: [] });
    expect(plan.keep).toEqual(rows);
  });

  it("fits exactly at the budget", () => {
    expect(planEviction([row()], 300, 200)).toMatchObject({ fits: true, remove: [] });
  });

  it("removes the oldest watched unkept auto clips first, only as many as needed", () => {
    const newest = row({ createdAt: 9000 });
    const oldest = row({ createdAt: 1000 });
    const middle = row({ createdAt: 5000 });
    const plan = planEviction([newest, oldest, middle], 300, 150);
    // Used 300 + 150 needed > 300: two removals (100 each) make 100 + 150 <= 300.
    expect(plan.fits).toBe(true);
    expect(plan.remove.map((r) => r.id)).toEqual([oldest.id, middle.id]);
    expect(plan.keep).toEqual([newest]);
  });

  it("breaks equal times by id so the order is stable", () => {
    const b = row({ id: "b", createdAt: 1 });
    const a = row({ id: "a", createdAt: 1 });
    const plan = planEviction([b, a], 160, 60);
    expect(plan.remove.map((r) => r.id)).toEqual(["a"]);
  });

  it("never removes a NEW (unwatched), kept, kid-made, Record or picture clip", () => {
    const protectedRows = [
      row({ watched: false }),
      row({ kept: true }),
      row({ kind: "clip" }),
      row({ kind: "record" }),
      row({ kind: "picture" }),
    ];
    const evictable = row({ createdAt: 99_999 });
    const plan = planEviction([...protectedRows, evictable], 600, 100);
    expect(plan.fits).toBe(true);
    expect(plan.remove).toEqual([evictable]);
    expect(plan.keep).toEqual(protectedRows);
  });

  it("removes nothing when the clip cannot fit even after every allowed removal", () => {
    const rows = [row({ kind: "clip", bytes: 500 }), row({ bytes: 100 })];
    const plan = planEviction(rows, 600, 200);
    expect(plan.fits).toBe(false);
    expect(plan.remove).toEqual([]);
    expect(plan.keep).toEqual(rows);
  });

  it("does not fit a clip larger than the whole budget", () => {
    expect(planEviction([], 100, 101)).toMatchObject({ fits: false, remove: [] });
  });

  it("treats missing or negative sizes as 0", () => {
    const plan = planEviction([row({ bytes: -5 }), row({ bytes: Number.NaN })], 10, 10);
    expect(plan).toMatchObject({ fits: true, usedBytes: 0 });
  });

  it("removes every candidate when all are needed", () => {
    const rows = [row(), row(), row()];
    const plan = planEviction(rows, 100, 100);
    expect(plan.fits).toBe(true);
    expect(plan.remove.length).toBe(3);
    expect(plan.keep).toEqual([]);
  });
});
