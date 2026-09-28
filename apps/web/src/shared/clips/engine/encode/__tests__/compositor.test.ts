import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeVideoFrame,
  installWebCodecsMock,
  rgbaPixels,
  type CanvasOp,
  type FakeOffscreenCanvas,
  type WebCodecsMock,
} from "@/__tests__/webcodecs-mock";
import { PRESETS, type FrameIn, type HudState, type OutputPreset } from "../../../protocol";
import { COMPOSITOR_COLORS, Compositor, CompositorInputError, HUD_LIMITS, cleanText, computeLayout, paintableHud } from "../compositor";

const TALL: OutputPreset = { ...PRESETS.tall, targetFps: 30, orientation: "tall" };
const WIDE: OutputPreset = { ...PRESETS.wide, targetFps: 60, orientation: "wide" };
const HUD: HudState = { gameName: "Breakout", emoji: "🧱", score: "12,400" };

let mock: WebCodecsMock;
beforeEach(() => {
  mock = installWebCodecsMock();
});
afterEach(() => {
  expect(mock.openFrames()).toBe(0);
  mock.uninstall();
});

function frameIn(w: number, h: number, hud: HudState = HUD, tsUs = 1000): FrameIn {
  const frame = new FakeVideoFrame(rgbaPixels(w, h), { format: "RGBA", codedWidth: w, codedHeight: h, timestamp: tsUs }) as unknown as VideoFrame;
  return { t: "frame", frame, tsUs, durUs: 33_333, hud };
}

function mainCanvas(): FakeOffscreenCanvas {
  return mock.canvases[0];
}

function texts(ops: CanvasOp[]): string[] {
  return ops.flatMap((o) => (o.op === "fillText" ? [o.text] : []));
}

/** Every text drawn on any canvas the compositor made. */
function allTexts(): string[] {
  return mock.canvases.flatMap((c) => texts(c.context.ops));
}

describe("computeLayout", () => {
  it("puts a top band on tall and letterboxes a portrait game below it", () => {
    const l = computeLayout(TALL, 480, 640);
    expect(l.band).toEqual({ x: 0, y: 0, w: 720, h: 128 });
    expect(l.chip).toBeNull();
    expect(l.contentArea).toEqual({ x: 0, y: 128, w: 720, h: 1152 });
    // 3:4 at full width: 720 x 960, centered in the 1152 px area.
    expect(l.content).toEqual({ x: 0, y: 128 + 96, w: 720, h: 960 });
    // 96 px bottom bar is room for the host text.
    expect(l.brand.mode).toBe("bar");
    expect(l.brand.y + l.brand.h).toBeLessThanOrEqual(1280);
    expect(l.brand.y).toBeGreaterThanOrEqual(l.content.y + l.content.h);
  });

  it("fills the tall area with a 9:16 game and overlays the host", () => {
    const l = computeLayout(TALL, 1080, 1920);
    expect(l.content.h).toBe(1152);
    expect(l.content.w).toBe(648);
    expect(l.content.y).toBe(128);
    expect(l.brand.mode).toBe("overlay");
    expect(l.brand.x + l.brand.w).toBeLessThanOrEqual(720);
  });

  it("letterboxes a wide source into a tall frame", () => {
    const l = computeLayout(TALL, 1334, 526);
    expect(l.content.w).toBe(720);
    expect(l.content.h).toBe(Math.round(526 * (720 / 1334)));
    expect(l.content.y - 128).toBe(Math.floor((1152 - l.content.h) / 2));
    expect(l.brand.mode).toBe("bar");
  });

  it("uses the whole wide frame with a corner chip", () => {
    const l = computeLayout(WIDE, 1920, 1080);
    expect(l.band).toBeNull();
    expect(l.content).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(l.chip).toEqual({ x: 18, y: 18, maxW: 576, h: 43 });
    expect(l.brand.mode).toBe("overlay");
  });

  it("pillarboxes a 4:3 game into wide", () => {
    const l = computeLayout(WIDE, 640, 480);
    expect(l.content).toEqual({ x: 160, y: 0, w: 960, h: 720 });
  });

  it("keeps the content inside the frame for any source shape", () => {
    for (const preset of [TALL, WIDE]) {
      for (const [w, h] of [[1, 1], [1, 5000], [5000, 1], [333, 777], [2400, 1728], [0, 0]]) {
        const l = computeLayout(preset, w, h);
        expect(l.content.x).toBeGreaterThanOrEqual(0);
        expect(l.content.y).toBeGreaterThanOrEqual(l.contentArea.y);
        expect(l.content.x + l.content.w).toBeLessThanOrEqual(preset.width);
        expect(l.content.y + l.content.h).toBeLessThanOrEqual(preset.height);
        expect(l.content.w).toBeGreaterThan(0);
        expect(l.content.h).toBeGreaterThan(0);
      }
    }
  });
});

describe("HUD text rules", () => {
  it("strips control characters and cuts long text", () => {
    expect(cleanText("Snake\u0000\u0007 Game\u009f", 40)).toBe("Snake Game");
    expect(cleanText("x".repeat(100), HUD_LIMITS.gameName)).toHaveLength(HUD_LIMITS.gameName);
    expect(cleanText(42 as unknown, 10)).toBe("");
    expect(cleanText("🚚🚚🚚", 2)).toBe("🚚🚚");
  });

  it("keeps only gameName, emoji and score, whatever else the object holds", () => {
    const sneaky = { ...HUD, playerName: "Hank Neil", handle: "TurboRacer42", siteName: "Hank's Hits" } as unknown as HudState;
    expect(paintableHud(sneaky)).toEqual({ gameName: "Breakout", emoji: "🧱", score: "12,400" });
    expect(paintableHud(null)).toEqual({ gameName: "", emoji: "", score: undefined });
  });
});

describe("Compositor", () => {
  it("paints the frame letterboxed, closes the input and returns a frame with the same time", () => {
    const c = new Compositor(TALL, "hankshits.com");
    const input = frameIn(480, 640, HUD, 5_000_000);
    const out = c.compose(input) as unknown as FakeVideoFrame;
    expect((input as unknown as { frame: FakeVideoFrame }).frame.__closed).toBe(true);
    expect(out.codedWidth).toBe(720);
    expect(out.codedHeight).toBe(1280);
    expect(out.timestamp).toBe(5_000_000);
    expect(out.duration).toBe(33_333);
    expect(out.format).toBe("RGBX");
    const ops = mainCanvas().context.ops;
    expect(ops[0]).toMatchObject({ op: "fillRect", x: 0, y: 0, w: 720, h: 1280, fillStyle: COMPOSITOR_COLORS.frame });
    const draw = ops.find((o) => o.op === "drawImage" && o.source.kind === "videoframe");
    expect(draw).toMatchObject({ dx: 0, dy: 224, dw: 720, dh: 960 });
    out.close();
  });

  it("paints the band with emoji, game name and score, and the host", () => {
    const c = new Compositor(TALL, "hankshits.com");
    c.compose(frameIn(480, 640)).close();
    const drawn = allTexts();
    expect(drawn).toEqual(expect.arrayContaining(["🧱", "Breakout", "12,400", "hankshits.com"]));
    const band = mock.canvases[1].context.ops;
    expect(band[0]).toMatchObject({ op: "fillRect", fillStyle: COMPOSITOR_COLORS.band, w: 720, h: 128 });
    const score = band.find((o) => o.op === "fillText" && o.text === "12,400");
    expect(score).toMatchObject({ fillStyle: COMPOSITOR_COLORS.score, align: "right" });
  });

  it("never paints a player name, a handle or the site name (plan section 10)", () => {
    const c = new Compositor(TALL, "hankshits.com");
    const sneaky = { ...HUD, playerName: "Hank Neil", handle: "TurboRacer42", siteName: "Hank's Hits" } as unknown as HudState;
    c.compose(frameIn(480, 640, sneaky)).close();
    const w = new Compositor(WIDE, "hankshits.com");
    w.compose(frameIn(1920, 1080, sneaky)).close();
    const drawn = allTexts().join("|");
    expect(drawn).not.toMatch(/Hank Neil|TurboRacer42|Hank's Hits/);
    const allowed = new Set(["🧱", "Breakout", "12,400", "hankshits.com"]);
    for (const t of allTexts()) expect(allowed.has(t)).toBe(true);
  });

  it("paints a corner chip on wide instead of a band", () => {
    const c = new Compositor(WIDE, "hankshits.com");
    c.compose(frameIn(1920, 1080)).close();
    const chipCanvas = mock.canvases[1];
    expect(chipCanvas.width).toBe(576);
    expect(chipCanvas.height).toBe(43);
    expect(texts(chipCanvas.context.ops)).toEqual(["🧱", "Breakout", "12,400"]);
    expect(c.chipWidth).toBeGreaterThan(0);
    expect(c.chipWidth).toBeLessThanOrEqual(576);
    const place = mainCanvas().context.ops.find((o) => o.op === "drawImage" && o.source.kind === "canvas" && o.source.canvasId === chipCanvas.id);
    expect(place).toMatchObject({ dx: 18, dy: 18 });
  });

  it("shortens a long game name with an ellipsis instead of overflowing", () => {
    const c = new Compositor(TALL, "hankshits.com");
    c.compose(frameIn(480, 640, { gameName: "Super Mega Ultra Monster Truck Adventure Deluxe", emoji: "🚚", score: "999,999,999" })).close();
    const name = texts(mock.canvases[1].context.ops).find((t) => t.startsWith("Super"))!;
    expect(name.endsWith("…")).toBe(true);
  });

  it("repaints the band only when the HUD text changes", () => {
    const c = new Compositor(TALL, "hankshits.com");
    c.compose(frameIn(480, 640)).close();
    const bandOps = () => mock.canvases[1].context.ops.length;
    const first = bandOps();
    c.compose(frameIn(480, 640)).close();
    expect(bandOps()).toBe(first);
    c.compose(frameIn(480, 640, { ...HUD, score: "12,500" })).close();
    expect(bandOps()).toBeGreaterThan(first);
    expect(mock.canvases).toHaveLength(3); // main, band, brand: no canvas per frame
  });

  it("skips the band when the game gives no HUD text, and the host when there is none", () => {
    const c = new Compositor(TALL, "");
    c.compose(frameIn(480, 640, { gameName: "", emoji: "" })).close();
    expect(mock.canvases).toHaveLength(1);
    expect(allTexts()).toEqual([]);
  });

  it("builds a VideoFrame from RGBA pixels and closes it", () => {
    const c = new Compositor(WIDE, "hankshits.com");
    const out = c.compose({ t: "pixels", data: rgbaPixels(640, 360), width: 640, height: 360, tsUs: 42, durUs: 16_667, hud: HUD }) as unknown as FakeVideoFrame;
    expect(out.timestamp).toBe(42);
    const draw = mainCanvas().context.ops.find((o) => o.op === "drawImage" && o.source.kind === "videoframe");
    expect(draw && draw.op === "drawImage" && draw.source.kind === "videoframe" && draw.source.source.kind).toBe("buffer");
    expect(draw).toMatchObject({ dx: 0, dy: 0, dw: 1280, dh: 720 });
    out.close();
    expect(mock.openFrames()).toBe(0);
  });

  it("rejects a pixel buffer of the wrong size", () => {
    const c = new Compositor(WIDE, "hankshits.com");
    expect(() => c.compose({ t: "pixels", data: new ArrayBuffer(10), width: 640, height: 360, tsUs: 0, durUs: 1, hud: HUD })).toThrow(CompositorInputError);
    expect(() => c.compose({ t: "pixels", data: rgbaPixels(2, 2), width: 2.5, height: 2, tsUs: 0, durUs: 1, hud: HUD })).toThrow(CompositorInputError);
  });

  it("closes the input frame when painting fails", () => {
    const c = new Compositor(TALL, "hankshits.com");
    c.close();
    const input = frameIn(100, 100);
    expect(() => c.compose(input)).toThrow(CompositorInputError);
    expect((input as unknown as { frame: FakeVideoFrame }).frame.__closed).toBe(true);
  });

  it("recomputes the layout when the source size changes (rotation)", () => {
    const c = new Compositor(WIDE, "hankshits.com");
    c.compose(frameIn(1920, 1080)).close();
    expect(c.layout!.content.w).toBe(1280);
    c.compose(frameIn(1080, 1920)).close();
    expect(c.layout!.content.h).toBe(720);
    expect(c.layout!.content.w).toBe(405);
  });
});
