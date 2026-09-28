/**
 * Worker compositor (path D, plan 3 and 6.1).
 *
 * The compositor paints each captured game frame into the fixed coded frame
 * of the session (PRESETS). It letterboxes the picture into a content
 * rectangle and adds a small band:
 * - tall (9:16): a top band with the game emoji, the game name and the score.
 * - wide (16:9): a small corner chip with the same values.
 * Both shapes add the deployment host, small, at the bottom.
 *
 * Privacy (plan section 10): the painter reads only HudState (gameName, emoji,
 * score) and brandHost. HudState has no name field, and the painter reads the
 * three fields by name, so a player name can never reach a frame.
 */

import type { FrameIn, HudState, Orientation, OutputPreset } from "../../protocol";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompositorLayout {
  width: number;
  height: number;
  orientation: Orientation;
  /** Top band (tall only). */
  band: Rect | null;
  /** The area the picture can use. */
  contentArea: Rect;
  /** The letterboxed picture inside contentArea. */
  content: Rect;
  /** Corner chip box (wide only). The chip is as wide as its text, up to maxW. */
  chip: { x: number; y: number; maxW: number; h: number } | null;
  /** The host label. "bar" puts plain text in the bottom letterbox bar; "overlay" puts a pill over the picture. */
  brand: { mode: "bar" | "overlay"; x: number; y: number; w: number; h: number; px: number };
}

/** Frame background and letterbox bars. A neutral near-black, not a default palette. */
export const COMPOSITOR_COLORS = {
  frame: "#0B0C0E",
  band: "#16181C",
  name: "#FFFFFF",
  score: "#FFC247",
  chip: "rgba(12, 13, 16, 0.72)",
  brandText: "rgba(255, 255, 255, 0.72)",
  brandPill: "rgba(12, 13, 16, 0.55)",
} as const;

const TEXT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const EMOJI_FAMILY = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** Longest strings the painter accepts. Longer input is cut, never wrapped. */
export const HUD_LIMITS = { gameName: 48, emoji: 16, score: 24, brandHost: 64 } as const;

const even = (n: number) => Math.round(n / 2) * 2;

/** Computes where everything goes for one source size. Pure, so tests can cover it fully. */
export function computeLayout(preset: OutputPreset, sourceWidth: number, sourceHeight: number): CompositorLayout {
  const W = preset.width;
  const H = preset.height;
  const short = Math.min(W, H);
  const brandPx = Math.round(short * 0.03);
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);

  if (preset.orientation === "tall") {
    const bandH = even(H * 0.1);
    const contentArea = { x: 0, y: bandH, w: W, h: H - bandH };
    const content = fit(contentArea, sw, sh);
    const barH = contentArea.y + contentArea.h - (content.y + content.h);
    const brand = brandBox(W, H, brandPx, barH >= brandPx * 2 ? "bar" : "overlay", barH);
    return { width: W, height: H, orientation: "tall", band: { x: 0, y: 0, w: W, h: bandH }, contentArea, content, chip: null, brand };
  }

  const contentArea = { x: 0, y: 0, w: W, h: H };
  const content = fit(contentArea, sw, sh);
  const margin = Math.round(short * 0.025);
  const chip = { x: margin, y: margin, maxW: Math.round(W * 0.45), h: Math.round(short * 0.06) };
  const barH = H - (content.y + content.h);
  const brand = brandBox(W, H, brandPx, barH >= brandPx * 2 ? "bar" : "overlay", barH);
  return { width: W, height: H, orientation: "wide", band: null, contentArea, content, chip, brand };
}

function fit(area: Rect, sw: number, sh: number): Rect {
  const s = Math.min(area.w / sw, area.h / sh);
  const w = Math.max(1, Math.min(area.w, Math.round(sw * s)));
  const h = Math.max(1, Math.min(area.h, Math.round(sh * s)));
  return { x: area.x + Math.floor((area.w - w) / 2), y: area.y + Math.floor((area.h - h) / 2), w, h };
}

function brandBox(W: number, H: number, px: number, mode: "bar" | "overlay", barH: number): CompositorLayout["brand"] {
  const h = Math.round(px * 1.6);
  if (mode === "bar") return { mode, x: 0, y: H - barH + Math.floor((barH - h) / 2), w: W, h, px };
  const margin = Math.round(Math.min(W, H) * 0.02);
  const w = Math.round(W * 0.5);
  return { mode, x: W - margin - w, y: H - margin - h, w, h, px };
}

/** Removes control characters and cuts the string to max code points. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let out = "";
  let count = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) continue;
    out += ch;
    if (++count >= max) break;
  }
  return out.trim();
}

/** The only HUD values the painter uses. Extra fields on the input object are ignored. */
export function paintableHud(hud: HudState | null | undefined): HudState {
  return {
    gameName: cleanText(hud?.gameName, HUD_LIMITS.gameName),
    emoji: cleanText(hud?.emoji, HUD_LIMITS.emoji),
    score: cleanText(hud?.score, HUD_LIMITS.score) || undefined,
  };
}

type Ctx2D = OffscreenCanvasRenderingContext2D;

interface Surface {
  canvas: OffscreenCanvas;
  ctx: Ctx2D;
}

/** Makes a canvas. Tests can pass a factory; the default uses OffscreenCanvas. */
export type SurfaceFactory = (width: number, height: number, alpha: boolean) => Surface;

const defaultSurface: SurfaceFactory = (width, height, alpha) => {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha }) as Ctx2D | null;
  if (!ctx) throw new Error("OffscreenCanvas 2D context is not available");
  return { canvas, ctx };
};

/** Raised when an input frame cannot be used. The caller drops the frame. */
export class CompositorInputError extends Error {}

export class Compositor {
  readonly preset: OutputPreset;
  private readonly brandHost: string;
  private readonly makeSurface: SurfaceFactory;
  private readonly main: Surface;
  private layoutCache: { sw: number; sh: number; layout: CompositorLayout } | null = null;
  private hudSurface: Surface | null = null;
  private hudKey = "";
  private hudWidth = 0;
  private brandSurface: Surface | null = null;
  private brandKey = "";
  private closed = false;

  constructor(preset: OutputPreset, brandHost: string, makeSurface: SurfaceFactory = defaultSurface) {
    this.preset = preset;
    this.brandHost = cleanText(brandHost, HUD_LIMITS.brandHost);
    this.makeSurface = makeSurface;
    this.main = makeSurface(preset.width, preset.height, false);
    this.main.ctx.imageSmoothingEnabled = true;
    this.main.ctx.imageSmoothingQuality = "medium";
  }

  /** The layout for the most recent source size, or null before the first frame. */
  get layout(): CompositorLayout | null {
    return this.layoutCache?.layout ?? null;
  }

  /**
   * Paints one input into the coded frame and returns a new VideoFrame for the
   * encoder. The input frame (or the frame built from the pixels) is always
   * closed, also when this throws.
   */
  compose(input: FrameIn): VideoFrame {
    let source: VideoFrame | null = input.t === "frame" ? input.frame : null;
    try {
      if (this.closed) throw new CompositorInputError("compositor is closed");
      if (input.t === "pixels") source = frameFromPixels(input);
      const sw = source!.displayWidth;
      const sh = source!.displayHeight;
      if (!(sw > 0) || !(sh > 0)) throw new CompositorInputError("source frame has no pixels");
      const layout = this.layoutFor(sw, sh);
      const { ctx, canvas } = this.main;

      ctx.fillStyle = COMPOSITOR_COLORS.frame;
      ctx.fillRect(0, 0, layout.width, layout.height);
      ctx.drawImage(source!, layout.content.x, layout.content.y, layout.content.w, layout.content.h);

      const hud = this.hudCanvas(layout, paintableHud(input.hud));
      if (hud) {
        const at = layout.band ?? { x: layout.chip!.x, y: layout.chip!.y };
        ctx.drawImage(hud.canvas, at.x, at.y);
      }
      const brand = this.brandCanvas(layout);
      if (brand) ctx.drawImage(brand.canvas, layout.brand.x, layout.brand.y);

      return new VideoFrame(canvas, { timestamp: input.tsUs, duration: input.durUs, alpha: "discard" });
    } finally {
      source?.close();
    }
  }

  close(): void {
    this.closed = true;
    this.hudSurface = null;
    this.brandSurface = null;
  }

  private layoutFor(sw: number, sh: number): CompositorLayout {
    const c = this.layoutCache;
    if (c && c.sw === sw && c.sh === sh) return c.layout;
    const layout = computeLayout(this.preset, sw, sh);
    this.layoutCache = { sw, sh, layout };
    this.brandKey = "";
    return layout;
  }

  /** Returns the band (tall) or chip (wide) canvas, painted again only when the HUD text changes. */
  private hudCanvas(layout: CompositorLayout, hud: HudState): Surface | null {
    if (!hud.gameName && !hud.emoji && !hud.score) return null;
    const key = `${layout.orientation}\u0001${hud.emoji}\u0001${hud.gameName}\u0001${hud.score ?? ""}`;
    if (this.hudSurface && key === this.hudKey) return this.hudSurface;
    if (layout.band) {
      this.hudSurface ??= this.makeSurface(layout.band.w, layout.band.h, false);
      paintBand(this.hudSurface.ctx, layout.band, hud);
    } else {
      const chip = layout.chip!;
      this.hudSurface ??= this.makeSurface(chip.maxW, chip.h, true);
      this.hudWidth = paintChip(this.hudSurface.ctx, chip, hud);
    }
    this.hudKey = key;
    return this.hudSurface;
  }

  private brandCanvas(layout: CompositorLayout): Surface | null {
    if (!this.brandHost) return null;
    const b = layout.brand;
    const key = `${b.mode}\u0001${b.w}\u0001${b.h}`;
    if (this.brandSurface && key === this.brandKey) return this.brandSurface;
    this.brandSurface = this.makeSurface(b.w, b.h, true);
    paintBrand(this.brandSurface.ctx, b, this.brandHost);
    this.brandKey = key;
    return this.brandSurface;
  }

  /** Width of the chip that the last paint used (for tests). */
  get chipWidth(): number {
    return this.hudWidth;
  }
}

function frameFromPixels(input: Extract<FrameIn, { t: "pixels" }>): VideoFrame {
  const { width, height, data } = input;
  if (!(width > 0) || !(height > 0) || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new CompositorInputError(`bad pixel size ${width}x${height}`);
  }
  if (!data || data.byteLength !== width * height * 4) {
    throw new CompositorInputError(`pixel buffer is ${data?.byteLength ?? 0} bytes, expected ${width * height * 4}`);
  }
  return new VideoFrame(new Uint8Array(data), {
    format: "RGBA",
    codedWidth: width,
    codedHeight: height,
    timestamp: input.tsUs,
    duration: input.durUs,
  });
}

/** Sets the largest font from maxPx down to minPx that fits, then cuts the text with an ellipsis if needed. */
function fitText(ctx: Ctx2D, text: string, weight: number, maxPx: number, minPx: number, maxWidth: number): { text: string; px: number } {
  let px = maxPx;
  const font = (p: number) => `${weight} ${p}px ${TEXT_FAMILY}`;
  ctx.font = font(px);
  while (px > minPx && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = font(px);
  }
  if (ctx.measureText(text).width <= maxWidth) return { text, px };
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(`${chars.join("")}…`).width > maxWidth) chars.pop();
  return { text: `${chars.join("").trimEnd()}…`, px };
}

function paintBand(ctx: Ctx2D, band: Rect, hud: HudState): void {
  const pad = Math.round(band.w * 0.04);
  const mid = band.h / 2;
  ctx.fillStyle = COMPOSITOR_COLORS.band;
  ctx.fillRect(0, 0, band.w, band.h);
  ctx.textBaseline = "middle";

  let x = pad;
  if (hud.emoji) {
    const px = Math.round(band.h * 0.42);
    ctx.font = `${px}px ${EMOJI_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillStyle = COMPOSITOR_COLORS.name;
    ctx.fillText(hud.emoji, x, mid);
    x += ctx.measureText(hud.emoji).width + Math.round(pad * 0.5);
  }

  let right = band.w - pad;
  if (hud.score) {
    const s = fitText(ctx, hud.score, 800, Math.round(band.h * 0.36), Math.round(band.h * 0.22), Math.round(band.w * 0.4));
    ctx.textAlign = "right";
    ctx.fillStyle = COMPOSITOR_COLORS.score;
    ctx.fillText(s.text, right, mid);
    right -= ctx.measureText(s.text).width + Math.round(pad * 0.6);
  }

  if (hud.gameName) {
    const n = fitText(ctx, hud.gameName, 700, Math.round(band.h * 0.3), Math.round(band.h * 0.18), Math.max(0, right - x));
    ctx.textAlign = "left";
    ctx.fillStyle = COMPOSITOR_COLORS.name;
    ctx.fillText(n.text, x, mid);
  }
}

/** Paints the corner chip and returns its width. */
function paintChip(ctx: Ctx2D, chip: { maxW: number; h: number }, hud: HudState): number {
  const padX = Math.round(chip.h * 0.3);
  const textPx = Math.round(chip.h * 0.5);
  const gap = Math.round(textPx * 0.4);
  ctx.clearRect(0, 0, chip.maxW, chip.h);
  ctx.textBaseline = "middle";

  ctx.font = `${textPx}px ${EMOJI_FAMILY}`;
  const emojiW = hud.emoji ? ctx.measureText(hud.emoji).width + gap : 0;
  ctx.font = `800 ${textPx}px ${TEXT_FAMILY}`;
  const scoreText = hud.score ?? "";
  const scoreW = scoreText ? ctx.measureText(scoreText).width + gap : 0;
  const nameRoom = Math.max(0, chip.maxW - padX * 2 - emojiW - scoreW);
  const name = hud.gameName ? fitText(ctx, hud.gameName, 700, textPx, Math.round(textPx * 0.7), nameRoom) : { text: "", px: textPx };
  const nameW = name.text ? ctx.measureText(name.text).width : 0;
  const width = Math.min(chip.maxW, Math.ceil(padX * 2 + emojiW + nameW + scoreW));

  ctx.fillStyle = COMPOSITOR_COLORS.chip;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(0, 0, width, chip.h, Math.round(chip.h / 2));
  else ctx.rect(0, 0, width, chip.h);
  ctx.fill();

  let x = padX;
  const mid = chip.h / 2;
  ctx.textAlign = "left";
  if (hud.emoji) {
    ctx.font = `${textPx}px ${EMOJI_FAMILY}`;
    ctx.fillStyle = COMPOSITOR_COLORS.name;
    ctx.fillText(hud.emoji, x, mid);
    x += emojiW;
  }
  if (name.text) {
    ctx.font = `700 ${name.px}px ${TEXT_FAMILY}`;
    ctx.fillStyle = COMPOSITOR_COLORS.name;
    ctx.fillText(name.text, x, mid);
    x += nameW + (scoreText ? gap : 0);
  }
  if (scoreText) {
    ctx.font = `800 ${textPx}px ${TEXT_FAMILY}`;
    ctx.fillStyle = COMPOSITOR_COLORS.score;
    ctx.fillText(scoreText, x, mid);
  }
  return width;
}

function paintBrand(ctx: Ctx2D, box: CompositorLayout["brand"], host: string): void {
  ctx.clearRect(0, 0, box.w, box.h);
  ctx.textBaseline = "middle";
  const fitted = fitText(ctx, host, 600, box.px, Math.round(box.px * 0.7), box.w - box.h);
  if (box.mode === "bar") {
    ctx.textAlign = "center";
    ctx.fillStyle = COMPOSITOR_COLORS.brandText;
    ctx.fillText(fitted.text, box.w / 2, box.h / 2);
    return;
  }
  const textW = ctx.measureText(fitted.text).width;
  const pillW = Math.min(box.w, Math.ceil(textW + box.h));
  ctx.fillStyle = COMPOSITOR_COLORS.brandPill;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(box.w - pillW, 0, pillW, box.h, Math.round(box.h / 2));
  else ctx.rect(box.w - pillW, 0, pillW, box.h);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = COMPOSITOR_COLORS.brandText;
  ctx.fillText(fitted.text, box.w - pillW / 2, box.h / 2);
}
