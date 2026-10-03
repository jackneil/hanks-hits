import { disc, frame, rect, text } from "@/shared/clips/replay/draw";
import { BUILDINGS, formatNumber } from "./constants";
import type { CookieClickerState } from "./store";
export type CookieClipState = Pick<CookieClickerState, "cookies" | "totalClicks" | "cookiesPerSecond" | "cookiesPerClick" | "buildings" | "goldenCookie" | "frenzyMultiplier" | "clickFrenzyMultiplier"> & { pressed?: boolean };
export function paintCookies(c: CanvasRenderingContext2D, s: CookieClipState): void {
  frame(c, "Cookie Clicker", `${formatNumber(s.cookies)} cookies · ${formatNumber(s.cookiesPerSecond)} / second`, "#713f12");
  // Match CookieButton's actual scale-95 press, including every chocolate
  // chip. This state is the live input feedback, not total-click parity.
  c.save();
  c.translate(200, 275);
  c.scale(s.pressed ? 0.95 : 1, s.pressed ? 0.95 : 1);
  c.translate(-200, -275);
  disc(c, 200, 285, 142, "#92400e");
  disc(c, 200, 275, 139, "#d69a52");
  disc(c, 200, 275, 130, "#eab775");
  for (const [x, y] of [[155, 195], [240, 210], [130, 285], [215, 295], [270, 330], [170, 365], [260, 260]]) disc(c, x, y, 13, "#633414");
  c.restore();
  text(c, `${formatNumber(s.totalClicks)} taps`, 200, 447, 25);
  text(c, `+${formatNumber(s.cookiesPerClick)} per tap`, 200, 483, 20);
  if (s.goldenCookie) {
    disc(c, 50 + s.goldenCookie.x * 2.5, 130 + s.goldenCookie.y * 2.5, 26, "#facc15");
    text(c, "Golden cookie!", 200, 535, 22, "#fde68a");
  }
  if (s.frenzyMultiplier > 1 || s.clickFrenzyMultiplier > 1) text(c, "Frenzy!", 200, 580, 28, "#fde68a");
  BUILDINGS.forEach((building, i) => {
    const y = 120 + i * 54;
    rect(c, 363, y - 20, 257, 46, "#422006");
    text(c, `${building.emoji} ${building.name}: ${s.buildings[building.id]}`, 490, y, 17);
  });
}
