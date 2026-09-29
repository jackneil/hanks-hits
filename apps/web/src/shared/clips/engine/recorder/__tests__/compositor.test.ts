// @vitest-environment node
/**
 * The page compositor of tiers M and V paints exactly what the worker
 * compositor of tiers W and W+ paints: the same layout, band or chip, and
 * host text, and never a player name (plan 6.1, 10). The canvases are the
 * shared recording 2D double (webcodecs-mock), so every draw is visible.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeOffscreenCanvas,
  FakeVideoFrame,
  installWebCodecsMock,
  rgbaPixels,
  type CanvasOp,
  type WebCodecsMock,
} from "../../../../../__tests__/webcodecs-mock";
import { PRESETS, type HudState, type OutputPreset } from "../../../protocol";
import { Compositor } from "../../encode/compositor";
import { HIDDEN_CANVAS_STYLE, PAGE_POSTER_MAX_WIDTH, PageCompositor, type PageSurface } from "../compositor";

const TALL: OutputPreset = { ...PRESETS.tall, targetFps: 30, orientation: "tall" };
const WIDE: OutputPreset = { ...PRESETS.wide, targetFps: 30, orientation: "wide" };
const HUD: HudState = { gameName: "Breakout", emoji: "🧱", score: "12,400" };

/** A page canvas: the recording 2D canvas, plus the element parts the compositor uses. */
class FakePageCanvas extends FakeOffscreenCanvas {
  readonly attributes = new Map<string, string>();
  readonly styles = new Map<string, string>();
  removed = false;
  captureFps: number | null = null;
  readonly style = { setProperty: (name: string, value: string) => void this.styles.set(name, value) };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  remove(): void {
    this.removed = true;
  }
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void {
    callback(new Blob([`${this.width}x${this.height}@${quality}`], { type: type ?? "image/png" }));
  }
  captureStream(fps: number): { getVideoTracks(): unknown[] } {
    this.captureFps = fps;
    return { getVideoTracks: () => [{ kind: "video" }] };
  }
}

let mock: WebCodecsMock;
beforeEach(() => {
  mock = installWebCodecsMock();
});
afterEach(() => {
  mock.uninstall();
});

function fakeDocument() {
  const appended: FakePageCanvas[] = [];
  const doc = {
    createElement: () => new FakePageCanvas(1, 1),
    body: { appendChild: (node: FakePageCanvas) => appended.push(node) },
  };
  return { doc: doc as unknown as Document, appended };
}

function surfaceFactory(made: FakePageCanvas[]) {
  return (width: number, height: number): PageSurface => {
    const canvas = new FakePageCanvas(width, height);
    made.push(canvas);
    return { canvas: canvas as unknown as HTMLCanvasElement, ctx: canvas.getContext("2d") as unknown as CanvasRenderingContext2D };
  };
}

type DrawOp = Extract<CanvasOp, { op: "drawImage" }>;

function isDraw(op: CanvasOp): op is DrawOp {
  return op.op === "drawImage";
}

function textOps(ops: CanvasOp[]) {
  return ops.flatMap((o) => (o.op === "fillText" ? [{ text: o.text, x: o.x, y: o.y, font: o.font, fillStyle: o.fillStyle }] : []));
}

/** What the worker compositor draws for one frame: the text ops of each surface, and the picture's box. */
function workerPaint(preset: OutputPreset, hud: HudState, width: number, height: number) {
  const before = mock.canvases.length;
  const compositor = new Compositor(preset, "hankshits.com");
  const frame = new FakeVideoFrame(rgbaPixels(width, height), { format: "RGBA", codedWidth: width, codedHeight: height, timestamp: 0 }) as unknown as VideoFrame;
  compositor.compose({ t: "frame", frame, tsUs: 0, durUs: 33_333, hud }).close();
  const canvases = mock.canvases.slice(before);
  const main = canvases[0];
  const picture = main.context.ops.filter(isDraw).find((o) => o.source.kind === "videoframe");
  return { texts: canvases.slice(1).map((c) => textOps(c.context.ops)), picture };
}

function pagePaint(preset: OutputPreset, hud: HudState, width: number, height: number, scale = 1) {
  const { doc, appended } = fakeDocument();
  const surfaces: FakePageCanvas[] = [];
  const compositor = new PageCompositor(preset, "hankshits.com", { document: doc, makeSurface: surfaceFactory(surfaces) });
  const game = new FakeOffscreenCanvas(width, height);
  compositor.paint(game as unknown as HTMLCanvasElement, hud, scale);
  const main = appended[0];
  const picture = main.context.ops.filter(isDraw).find((o) => o.source.kind === "canvas" && o.source.canvasId === game.id);
  return { compositor, main, surfaces, texts: surfaces.map((c) => textOps(c.context.ops)), picture };
}

describe("PageCompositor", () => {
  it("tall: the same band, host text and picture box as the worker compositor", () => {
    const worker = workerPaint(TALL, HUD, 480, 640);
    const page = pagePaint(TALL, HUD, 480, 640);
    expect(page.texts).toEqual(worker.texts);
    expect(page.texts.flat().map((t) => t.text)).toEqual(expect.arrayContaining(["🧱", "12,400", "Breakout", "hankshits.com"]));
    expect(page.picture).toMatchObject({ dx: worker.picture!.dx, dy: worker.picture!.dy, dw: worker.picture!.dw, dh: worker.picture!.dh });
  });

  it("wide: the same corner chip and host pill as the worker compositor", () => {
    const worker = workerPaint(WIDE, HUD, 800, 450);
    const page = pagePaint(WIDE, HUD, 800, 450);
    expect(page.texts).toEqual(worker.texts);
    expect(page.picture).toMatchObject({ dx: worker.picture!.dx, dy: worker.picture!.dy, dw: worker.picture!.dw, dh: worker.picture!.dh });
  });

  it("never paints a player name, even when the HUD object carries one", () => {
    const withName = { ...HUD, playerName: "Hank Neil", name: "Hank" } as unknown as HudState;
    const page = pagePaint(TALL, withName, 480, 640);
    const drawn = page.texts.flat().map((t) => t.text).join(" ");
    expect(drawn).not.toMatch(/Hank/);
  });

  it("paints the band again only when the HUD text changes", () => {
    const page = pagePaint(TALL, HUD, 480, 640);
    const band = page.surfaces[0];
    const count = () => band.context.ops.filter((o) => o.op === "fillText").length;
    const first = count();
    const game = new FakeOffscreenCanvas(480, 640);
    page.compositor.paint(game as unknown as HTMLCanvasElement, HUD, 1);
    expect(count()).toBe(first);
    page.compositor.paint(game as unknown as HTMLCanvasElement, { ...HUD, score: "12,500" }, 1);
    expect(count()).toBeGreaterThan(first);
  });

  it("a governor content step scales the picture inside its box, centered", () => {
    const full = pagePaint(TALL, HUD, 480, 640, 1).picture!;
    const half = pagePaint(TALL, HUD, 480, 640, 0.5).picture!;
    expect(half.dw).toBe(Math.round(full.dw / 2));
    expect(half.dh).toBe(Math.round(full.dh / 2));
    expect(half.dx + half.dw / 2).toBeCloseTo(full.dx + full.dw / 2, 0);
    expect(half.dy + half.dh / 2).toBeCloseTo(full.dy + full.dh / 2, 0);
  });

  it("puts its canvas in the page, hidden, ignored by auto-discovery, and takes it out at dispose", () => {
    const page = pagePaint(TALL, HUD, 480, 640);
    expect(page.main.width).toBe(720);
    expect(page.main.height).toBe(1280);
    expect(page.main.attributes.get("data-clips-ignore")).toBe("");
    expect(page.main.attributes.get("aria-hidden")).toBe("true");
    expect(Object.fromEntries(page.main.styles)).toEqual(HIDDEN_CANVAS_STYLE);
    page.compositor.dispose();
    expect(page.main.removed).toBe(true);
  });

  it("captureTrack gives the canvas's video track at the asked rate, and null without captureStream", () => {
    const page = pagePaint(TALL, HUD, 480, 640);
    expect(page.compositor.captureTrack(30)).toEqual({ kind: "video" });
    expect(page.main.captureFps).toBe(30);
    (page.main as unknown as { captureStream: unknown }).captureStream = undefined;
    expect(page.compositor.captureTrack(30)).toBeNull();
  });

  it("touch() paints the same pixels again (the canvas onto itself); clear() paints the empty frame", () => {
    const page = pagePaint(TALL, HUD, 480, 640);
    const ops = page.main.context.ops;
    const before = ops.length;
    page.compositor.touch();
    const touch = ops.slice(before).filter(isDraw);
    expect(touch).toHaveLength(1);
    expect(touch[0]).toMatchObject({ dx: 0, dy: 0 });
    expect(touch[0].source).toMatchObject({ kind: "canvas", canvasId: page.main.id });
    const cleared = ops.length;
    page.compositor.clear();
    const fills = ops.slice(cleared).filter((o) => o.op === "fillRect");
    expect(fills).toEqual([expect.objectContaining({ x: 0, y: 0, w: 720, h: 1280 })]);
    // After dispose, neither paints.
    page.compositor.dispose();
    const done = ops.length;
    page.compositor.touch();
    page.compositor.clear();
    expect(ops.length).toBe(done);
  });

  it("posterJpeg gives a small JPEG of the newest frame", async () => {
    const page = pagePaint(WIDE, HUD, 800, 450);
    const poster = (await page.compositor.posterJpeg())!;
    expect(poster.type).toBe("image/jpeg");
    expect(await poster.text()).toBe(`${PAGE_POSTER_MAX_WIDTH}x180@0.72`);
    page.compositor.dispose();
    expect(await page.compositor.posterJpeg()).toBeNull();
  });
});
