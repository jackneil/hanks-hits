import { expect, test } from "playwright/test";
import { changedPixels, semanticBoardPicture, type GrayFrame } from "./lib/media";

// Known 640x720 semantic-source placement in each output orientation. These
// fixture coordinates are independent of the masking implementation.
for (const fixture of [
  { width: 720, height: 1280, header: [360, 377], board: [360, 650], footer: [360, 1083], cookie: [225, 608], counter: [225, 802] },
  { width: 1280, height: 720, header: [640, 69], board: [640, 360], footer: [640, 697], cookie: [520, 275], counter: [520, 447] },
]) {
  test(`semantic board motion excludes changing status and counters (${fixture.width}x${fixture.height})`, () => {
    const blank: GrayFrame = { width: fixture.width, height: fixture.height, pixels: Buffer.alloc(fixture.width * fixture.height) };
    const marked = ([x, y]: number[]): GrayFrame => {
      const pixels = Buffer.from(blank.pixels);
      for (let row = y; row < y + 10; row++) pixels.fill(255, row * fixture.width + x, row * fixture.width + x + 10);
      return { ...blank, pixels };
    };
    for (const id of ["2048", "chess", "checkers", "quoridor", "wordle", "memory-match"]) {
      expect(changedPixels(blank, semanticBoardPicture(marked(fixture.header), id), 64), `${id}: status must not count as gameplay`).toBe(0);
      expect(changedPixels(blank, semanticBoardPicture(marked(fixture.footer), id), 64), `${id}: timer/footer must not count as gameplay`).toBe(0);
      expect(changedPixels(blank, semanticBoardPicture(marked(fixture.board), id), 64), `${id}: real board motion must count`).toBe(100);
    }
    expect(changedPixels(blank, semanticBoardPicture(marked(fixture.counter), "cookie-clicker"), 64)).toBe(0);
    expect(changedPixels(blank, semanticBoardPicture(marked(fixture.cookie), "cookie-clicker"), 64)).toBe(100);
  });
}
