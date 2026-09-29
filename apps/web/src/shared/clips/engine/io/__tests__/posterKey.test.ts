// @vitest-environment node
/**
 * The poster keyframe rule (posterKey.ts): never the first keyframe when a
 * better one exists. A featured moment wins; else the last keyframe at least
 * 1 s before the end; else the last keyframe.
 */
import { describe, expect, it } from "vitest";

import type { MomentMark } from "../../../protocol";
import { POSTER_END_GAP_SEC, featuredMomentSec, pickPosterKey, type TimedKey } from "../posterKey";

/** Keyframes every `gop` seconds over `seconds`, keyed by their time. */
function keys(seconds: number, gop = 1): TimedKey<number>[] {
  const list: TimedKey<number>[] = [];
  for (let at = 0; at < seconds; at += gop) list.push({ atSec: at, key: at });
  return list;
}

function moment(offsetSec: number, priority: MomentMark["priority"] = "featured"): MomentMark {
  return { kind: "new-best", label: "New best!", emoji: "🏆", priority, offsetSec };
}

describe("pickPosterKey", () => {
  it("takes the last keyframe at least 1 s before the end of a 30 s clip, not the first", () => {
    expect(POSTER_END_GAP_SEC).toBe(1);
    expect(pickPosterKey(keys(30), 30, null)).toBe(29);
    // The end falls just after a keyframe: that keyframe is too close to the end.
    expect(pickPosterKey(keys(30), 29.5, null)).toBe(28);
  });

  it("takes the last keyframe when none is 1 s before the end (a short file), and null with no keyframe", () => {
    expect(pickPosterKey([{ atSec: 0, key: "a" }, { atSec: 0.4, key: "b" }], 0.8, null)).toBe("b");
    expect(pickPosterKey([], 30, null)).toBeNull();
  });

  it("takes the keyframe nearest a featured moment, the later one on a tie", () => {
    expect(pickPosterKey(keys(30), 30, 12.4)).toBe(12);
    expect(pickPosterKey(keys(30), 30, 12.6)).toBe(13);
    expect(pickPosterKey(keys(30, 2), 30, 13)).toBe(14);
  });
});

describe("featuredMomentSec", () => {
  it("is the newest featured moment inside the file, and ignores standard ones and moments outside it", () => {
    expect(featuredMomentSec([moment(5), moment(20), moment(25, "standard")], 30)).toBe(20);
    expect(featuredMomentSec([moment(-1), moment(31)], 30)).toBeNull();
    expect(featuredMomentSec([moment(Number.NaN)], 30)).toBeNull();
    expect(featuredMomentSec(undefined, 30)).toBeNull();
  });
});
