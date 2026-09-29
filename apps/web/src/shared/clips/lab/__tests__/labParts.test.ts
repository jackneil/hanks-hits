// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { ClipRecord } from "../../protocol";
import type { ClipActionResult } from "../../service/contract";
import { declaredFailedParts, declaredParts, recordParts } from "../labParts";
import { clipRecord } from "./fakeLabService";

const FIRST = clipRecord({ id: "r1", kind: "record", createdAt: 1_000_000 });

/** A result as the service of PR 2.4 gives it: the base contract has no `parts` field, so the test adds it. */
function withParts(parts: ClipRecord[] | undefined, failedParts?: number): ClipActionResult {
  return { ok: true, action: "record", record: FIRST, atMs: 5, parts, failedParts } as unknown as ClipActionResult;
}

describe("declaredParts and declaredFailedParts", () => {
  it("read the parts and the failed count that the service gives", () => {
    const second = clipRecord({ id: "r1-p2", kind: "record", createdAt: 1_060_000 });
    expect(declaredParts(withParts([FIRST, second], 1))).toEqual([FIRST, second]);
    expect(declaredFailedParts(withParts([FIRST, second], 1))).toBe(1);
  });

  it("give null and 0 for a result without them, an empty list, a bad count or a failure", () => {
    const plain: ClipActionResult = { ok: true, action: "record", record: FIRST, atMs: 5 };
    expect(declaredParts(plain)).toBeNull();
    expect(declaredFailedParts(plain)).toBe(0);
    expect(declaredParts(withParts([]))).toBeNull();
    expect(declaredParts(withParts(undefined))).toBeNull();
    expect(declaredFailedParts(withParts([FIRST], Number.NaN))).toBe(0);
    expect(declaredFailedParts(withParts([FIRST], -2))).toBe(0);
    const failed: ClipActionResult = { ok: false, action: "record", reason: "quota", atMs: 5 };
    expect(declaredParts(failed)).toBeNull();
    expect(declaredFailedParts(failed)).toBe(0);
  });
});

describe("recordParts", () => {
  const later = clipRecord({ id: "r1-p3", kind: "record", createdAt: 1_120_000 });
  const second = clipRecord({ id: "r1-p2", kind: "record", createdAt: 1_060_000 });

  it("uses the service's list when it gives one, in its order, with the first part first", () => {
    expect(recordParts(FIRST, [FIRST, second, later], [])).toEqual([FIRST, second, later]);
    // A list without the first part still starts with it.
    expect(recordParts(FIRST, [second], [])).toEqual([FIRST, second]);
  });

  it("else finds the parts in the library: this game, this owner, kind record, from the first part's createdAt on, oldest first", () => {
    const listed: ClipRecord[] = [
      later,
      clipRecord({ id: "old-rec", kind: "record", createdAt: 900_000 }), // an older recording
      clipRecord({ id: "a-clip", kind: "clip", createdAt: 1_070_000 }), // a clip made during the recording
      clipRecord({ id: "other-game", kind: "record", gameId: "hextris", createdAt: 1_080_000 }),
      clipRecord({ id: "other-owner", kind: "record", ownerKey: "u_abc", createdAt: 1_090_000 }),
      FIRST,
      second,
    ];
    expect(recordParts(FIRST, null, listed).map((r) => r.id)).toEqual(["r1", "r1-p2", "r1-p3"]);
  });

  it("orders parts with the same createdAt by id, and never lists a part two times", () => {
    const a = clipRecord({ id: "r1-p2", kind: "record", createdAt: 1_000_000 });
    expect(recordParts(FIRST, null, [a, FIRST, a]).map((r) => r.id)).toEqual(["r1", "r1-p2"]);
  });

  it("gives the first part alone when there is nothing else", () => {
    expect(recordParts(FIRST, null, [])).toEqual([FIRST]);
  });
});
