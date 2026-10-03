// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nextProgressTime, progressRevision } from "../progress-revision";

describe("progress revisions", () => {
  const row = { id: "incarnation-a", userId: "owner-a", appId: "cookie-clicker", updatedAt: new Date(1000) };
  it("is stable and scoped to owner, app, row incarnation and committed time", () => {
    const revision = progressRevision(row);
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(progressRevision({ ...row })).toBe(revision);
    for (const change of [{ userId: "owner-b" }, { appId: "snake" }, { id: "incarnation-b" }, { updatedAt: new Date(1001) }]) {
      expect(progressRevision({ ...row, ...change })).not.toBe(revision);
    }
  });
  it("advances in the same millisecond and when the wall clock goes backwards", () => {
    expect(nextProgressTime(new Date(1000), 1000).getTime()).toBe(1001);
    expect(nextProgressTime(new Date(1000), 900).getTime()).toBe(1001);
    expect(nextProgressTime(new Date(1000), 2000).getTime()).toBe(2000);
    expect(nextProgressTime(undefined, 2000).getTime()).toBe(2000);
  });
});
