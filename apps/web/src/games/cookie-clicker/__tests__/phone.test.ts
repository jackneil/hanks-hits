/**
 * Cookie Clicker on a phone (PR-G7): the cookie and the shop share the
 * play box (upright the shop is under the cookie, sideways beside it), so
 * a kid never swipes 650 px between tapping and buying, and the words say
 * "tap" to a finger.
 */
import { describe, expect, it } from "vitest";

import { COOKIE_WORDS, COUNT_BAR, EDGE, bakeryLayout, touchWords } from "../lib/layout";

const BOXES = {
  seUpright: { width: 375, height: 549 - 48 },
  bigUpright: { width: 390, height: 664 - 48 },
  seSideways: { width: 667, height: 311 - 44 },
  bigSideways: { width: 844, height: 340 - 44 },
  laptop: { width: 1280, height: 800 - 48 },
};

describe("Cookie Clicker layout", () => {
  it("fits the whole cookie, and leaves the shop at least a third of the room, on every screen", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const layout = bakeryLayout(box);
      const main = box.height - COUNT_BAR;
      if (layout.sideways) {
        expect(layout.cookie + COOKIE_WORDS + 2 * EDGE, name).toBeLessThanOrEqual(main);
        expect(layout.cookie + layout.shopWidth + 3 * EDGE, name).toBeLessThanOrEqual(box.width);
        expect(layout.shopWidth / box.width, name).toBeGreaterThan(0.29);
      } else {
        expect(layout.cookie, name).toBeLessThanOrEqual(box.width - 2 * EDGE);
        expect(main - layout.cookieArea, name).toBeGreaterThan(main / 3);
      }
      // A cookie a thumb cannot miss.
      expect(layout.cookie, name).toBeGreaterThanOrEqual(120);
    }
  });

  it("says tap to a finger", () => {
    expect(touchWords("+1 cookie per click", true)).toBe("+1 cookie per tap");
    expect(touchWords("Autoclicks once every 10 seconds", true)).toBe("Taps by itself once every 10 seconds");
    expect(touchWords("Click 100 times", true)).toBe("Tap 100 times");
    expect(touchWords("+1 cookie per click", false)).toBe("+1 cookie per click");
  });
});
