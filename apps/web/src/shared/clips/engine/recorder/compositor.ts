/**
 * The main-thread compositor of the MediaRecorder engine (tiers M and V,
 * plan 5, 6.1).
 *
 * It paints each captured game frame into one canvas of the session's fixed
 * size, with the same rules as the worker compositor (engine/encode/
 * compositor.ts): the same layout (computeLayout), the same band or corner
 * chip with the game's emoji, name and score, and the deployment host,
 * small, at the bottom. It uses the worker compositor's own painters, so the
 * two tiers can never drift apart.
 *
 * Privacy (plan 10): the painter reads only the HudState fields gameName,
 * emoji and score (paintableHud), and the brand host. HudState has no name
 * field, so a player name can never reach a frame.
 *
 * canvas.captureStream(fps) gives the video track that the recorders take.
 * The canvas is in the page (WebKit bug 240380: a canvas outside the
 * document can give no frames), 1 CSS pixel in size, not visible, not
 * reachable by touch or a screen reader, and marked data-clips-ignore, so
 * auto-discovery never takes it for a game.
 */

import type { HudState, OutputPreset } from "../../protocol";
import {
  COMPOSITOR_COLORS,
  HUD_LIMITS,
  cleanText,
  computeLayout,
  paintBand,
  paintBrand,
  paintChip,
  paintableHud,
  type CompositorLayout,
  type PaintContext2D,
} from "../encode/compositor";

/** Widest fallback poster (the same size as the io worker's posters). */
export const PAGE_POSTER_MAX_WIDTH = 320;
export const PAGE_POSTER_QUALITY = 0.72;

/** A canvas and its 2D context. */
export interface PageSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export type PageSurfaceFactory = (width: number, height: number, alpha: boolean) => PageSurface;

/** Anything the compositor can draw from: the game canvas. */
export type FrameSource = CanvasImageSource & { width: number; height: number };

export interface PageCompositorDeps {
  document: Document;
  /** Makes the band, chip and brand canvases. Default: canvases of `document`. */
  makeSurface?: PageSurfaceFactory;
}

function documentSurface(doc: Document): PageSurfaceFactory {
  return (width, height, alpha) => {
    const canvas = doc.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha }) as CanvasRenderingContext2D | null;
    if (!ctx) throw new Error("a 2D canvas context is not available");
    return { canvas, ctx };
  };
}

/** Styles that keep the capture canvas in the page but out of sight and out of reach. */
export const HIDDEN_CANVAS_STYLE: Readonly<Record<string, string>> = {
  position: "fixed",
  left: "0",
  top: "0",
  width: "1px",
  height: "1px",
  opacity: "0",
  "pointer-events": "none",
};

export class PageCompositor {
  readonly preset: OutputPreset;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly brandHost: string;
  private readonly makeSurface: PageSurfaceFactory;
  private layoutCache: { sw: number; sh: number; layout: CompositorLayout } | null = null;
  private hud: PageSurface | null = null;
  private hudKey = "";
  private brand: PageSurface | null = null;
  private brandKey = "";
  private disposed = false;

  constructor(preset: OutputPreset, brandHost: string, deps: PageCompositorDeps) {
    this.preset = preset;
    this.brandHost = cleanText(brandHost, HUD_LIMITS.brandHost);
    this.makeSurface = deps.makeSurface ?? documentSurface(deps.document);
    const canvas = deps.document.createElement("canvas");
    canvas.width = preset.width;
    canvas.height = preset.height;
    canvas.setAttribute("data-clips-ignore", "");
    canvas.setAttribute("aria-hidden", "true");
    for (const [name, value] of Object.entries(HIDDEN_CANVAS_STYLE)) canvas.style.setProperty(name, value);
    const ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D | null;
    if (!ctx) throw new Error("a 2D canvas context is not available");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.fillStyle = COMPOSITOR_COLORS.frame;
    ctx.fillRect(0, 0, preset.width, preset.height);
    deps.document.body?.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** The layout for the most recent source size, or null before the first frame. */
  get layout(): CompositorLayout | null {
    return this.layoutCache?.layout ?? null;
  }

  /**
   * Paints one frame: the game picture, letterboxed, scaled by `scale` inside
   * its box (a governor content step), then the band or chip and the brand.
   * Throws what drawImage throws (a tainted canvas: SecurityError).
   */
  paint(source: FrameSource, hud: HudState, scale = 1): void {
    if (this.disposed) return;
    const sw = source.width;
    const sh = source.height;
    if (!(sw > 0) || !(sh > 0)) return;
    const layout = this.layoutFor(sw, sh);
    const ctx = this.ctx;
    ctx.fillStyle = COMPOSITOR_COLORS.frame;
    ctx.fillRect(0, 0, layout.width, layout.height);
    const s = Math.min(1, Math.max(0.1, scale));
    const w = Math.max(1, Math.round(layout.content.w * s));
    const h = Math.max(1, Math.round(layout.content.h * s));
    const x = layout.content.x + Math.floor((layout.content.w - w) / 2);
    const y = layout.content.y + Math.floor((layout.content.h - h) / 2);
    ctx.drawImage(source, x, y, w, h);
    const band = this.hudCanvas(layout, paintableHud(hud));
    if (band) {
      const at = layout.band ?? { x: layout.chip!.x, y: layout.chip!.y };
      ctx.drawImage(band.canvas, at.x, at.y);
    }
    const brand = this.brandCanvas(layout);
    if (brand) ctx.drawImage(brand.canvas, layout.brand.x, layout.brand.y);
  }

  /**
   * Paints the canvas again with the same pixels (it draws itself onto
   * itself), so canvas capture gives the recorders one more frame of the
   * last picture.
   */
  touch(): void {
    if (this.disposed) return;
    this.ctx.drawImage(this.canvas, 0, 0);
  }

  /** Paints the empty frame: no picture from before a purge can reach a later frame. */
  clear(): void {
    if (this.disposed) return;
    this.ctx.fillStyle = COMPOSITOR_COLORS.frame;
    this.ctx.fillRect(0, 0, this.preset.width, this.preset.height);
  }

  /** The video track of the canvas at `fps`. Null when this browser has no canvas capture. */
  captureTrack(fps: number): MediaStreamTrack | null {
    const capture = (this.canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream;
    if (typeof capture !== "function") return null;
    const stream = capture.call(this.canvas, fps);
    return stream.getVideoTracks()[0] ?? null;
  }

  /**
   * A small JPEG of the newest frame, for a clip's poster when the io worker
   * has no video decoder. Null when the canvas cannot make one.
   */
  posterJpeg(): Promise<Blob | null> {
    if (this.disposed) return Promise.resolve(null);
    try {
      const scale = Math.min(1, PAGE_POSTER_MAX_WIDTH / this.preset.width);
      const surface = this.makeSurface(Math.max(1, Math.round(this.preset.width * scale)), Math.max(1, Math.round(this.preset.height * scale)), false);
      surface.ctx.drawImage(this.canvas, 0, 0, surface.canvas.width, surface.canvas.height);
      return new Promise((resolve) => {
        try {
          surface.canvas.toBlob((blob) => resolve(blob && blob.type === "image/jpeg" ? blob : null), "image/jpeg", PAGE_POSTER_QUALITY);
        } catch {
          resolve(null);
        }
      });
    } catch {
      return Promise.resolve(null);
    }
  }

  /** Takes the canvas out of the page. Stop every track of captureTrack() first. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.remove();
    this.hud = null;
    this.brand = null;
  }

  private layoutFor(sw: number, sh: number): CompositorLayout {
    const c = this.layoutCache;
    if (c && c.sw === sw && c.sh === sh) return c.layout;
    const layout = computeLayout(this.preset, sw, sh);
    this.layoutCache = { sw, sh, layout };
    this.brandKey = "";
    return layout;
  }

  /** The band (tall) or chip (wide) canvas, painted again only when the HUD text changes. */
  private hudCanvas(layout: CompositorLayout, hud: HudState): PageSurface | null {
    if (!hud.gameName && !hud.emoji && !hud.score) return null;
    const key = `${layout.orientation}\u0001${hud.emoji}\u0001${hud.gameName}\u0001${hud.score ?? ""}`;
    if (this.hud && key === this.hudKey) return this.hud;
    if (layout.band) {
      this.hud ??= this.makeSurface(layout.band.w, layout.band.h, false);
      paintBand(this.hud.ctx as PaintContext2D, layout.band, hud);
    } else {
      const chip = layout.chip!;
      this.hud ??= this.makeSurface(chip.maxW, chip.h, true);
      paintChip(this.hud.ctx as PaintContext2D, chip, hud);
    }
    this.hudKey = key;
    return this.hud;
  }

  private brandCanvas(layout: CompositorLayout): PageSurface | null {
    if (!this.brandHost) return null;
    const b = layout.brand;
    const key = `${b.mode}\u0001${b.w}\u0001${b.h}`;
    if (this.brand && key === this.brandKey) return this.brand;
    this.brand = this.makeSurface(b.w, b.h, true);
    paintBrand(this.brand.ctx as PaintContext2D, b, this.brandHost);
    this.brandKey = key;
    return this.brand;
  }
}
