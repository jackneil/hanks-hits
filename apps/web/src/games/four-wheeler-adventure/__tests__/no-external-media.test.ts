import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Hank's original single-file game is served as a static asset. The site CSP
// (media-src 'self' blob:) blocks any cross-origin audio/video, so an external
// media URL in the game can never play - it only logs console errors and phones
// an outside site from a kids' game. This pins the invariant that all media
// stays same-origin. (2026-07-11 mobile audit: a Wikimedia engine .ogg was
// CSP-blocked on every prod session.)
describe("four-wheeler-adventure static game file", () => {
  const html = readFileSync(
    join(__dirname, "../../../../public/games/four-wheeler-adventure/index.html"),
    "utf8"
  );

  it("loads no cross-origin media", () => {
    expect(html).not.toMatch(/upload\.wikimedia\.org/);
    expect(html).not.toMatch(/new Audio\(\s*['"]https?:\/\//);
    expect(html).not.toMatch(/<(audio|video)[^>]+src=["']https?:\/\//i);
  });

  it("still has the touch controls Hank built", () => {
    for (const id of ["btnGas", "btnBrake", "btnLeft", "btnRight", "btnJump"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("bindTouch('btnGas','up')");
  });
});
