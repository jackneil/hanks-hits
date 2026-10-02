/**
 * Clip posters: a small JPEG data URL for library tiles and toasts (plan 8.1).
 *
 * One keyframe (posterKey.ts picks it: near the end, or at the featured
 * moment) is decoded with VideoDecoder (a picture is decoded with
 * createImageBitmap), drawn into an OffscreenCanvas at 320 px wide or less, and
 * encoded as JPEG. All APP1 to APP15 and COM segments are removed, so no EXIF or
 * other metadata can reach a poster (plan 10).
 *
 * The poster functions never throw. When a browser API is missing or a step fails,
 * they return PLACEHOLDER_POSTER, a neutral gray JPEG.
 */

import { BlobSource, type EncodedPacket, EncodedPacketSink, Input, type InputFormat, type InputVideoTrack, MP4, WEBM } from "mediabunny";

import { stripJpegMetadata } from "../../../lib/jpeg";
import { POSTER_END_GAP_SEC } from "./posterKey";

/** Widest poster, in pixels. */
export const POSTER_MAX_WIDTH = 320;
/** JPEG quality for posters. */
export const POSTER_QUALITY = 0.72;
/** The poster step stops waiting for the decoder after this time. */
export const POSTER_TIMEOUT_MS = 3000;

/** A 32x18 slate-gray JPEG (JFIF only, no metadata). Tiles scale it to fill. */
export const PLACEHOLDER_POSTER =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD/2wBDAAgICAkICQsLCwsLCw0MDQ0NDQ0NDQ0NDQ0ODg4REREODg4NDQ4OEBAR" +
  "ERITEhERERETExQUFBgYFxccHB0iIin/xABNAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAMEEAEAAAAAAAAAAAAAAAAA" +
  "AAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAEgAgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AkwGlEAAAAAB//9k=";

/** The H.264 decoder config of the clip's video track. */
export interface PosterVideoConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  description?: ArrayBuffer | Uint8Array;
}

/** Browser classes the poster step uses. Tests give fakes; production reads globalThis. */
export interface PosterDeps {
  VideoDecoder?: typeof VideoDecoder;
  EncodedVideoChunk?: typeof EncodedVideoChunk;
  OffscreenCanvas?: typeof OffscreenCanvas;
  createImageBitmap?: (image: Blob) => Promise<ImageBitmap>;
}

/** The file types a stored clip can have (protocol ClipRecord.mime). */
export type PosterMime = "video/mp4" | "video/webm" | "image/png";

export interface PosterOptions {
  maxWidth?: number;
  quality?: number;
  timeoutMs?: number;
  deps?: PosterDeps;
}

/** Poster size: the frame's aspect ratio, at most maxWidth wide, never wider than the frame. */
export function posterSize(width: number, height: number, maxWidth = POSTER_MAX_WIDTH): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: Math.max(1, Math.round(maxWidth)), height: Math.max(1, Math.round((maxWidth * 9) / 16)) };
  const scale = Math.min(1, maxWidth / width);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Removes APP1 to APP15 and COM segments from a JPEG (also between the scans
 * of a progressive JPEG) and keeps only SOI to EOI. APP0 (JFIF) stays.
 * Returns null when the bytes are not a complete JPEG. The same code cleans
 * the poster of a leaderboard clip on the server (src/lib/leaderboard-clips/poster.ts).
 */
export { stripJpegMetadata } from "../../../lib/jpeg";

/** Base64 without a data URL prefix. Works in windows, workers and Node. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  }
  return btoa(binary);
}

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/** Decodes one keyframe. Resolves with the first frame, or null. Never rejects. */
function decodeKeyframe(
  deps: Required<PosterDeps>,
  config: VideoDecoderConfig,
  data: Uint8Array,
  timeoutMs: number,
): Promise<VideoFrame | null> {
  return new Promise((resolve) => {
    let first: VideoFrame | null = null;
    let settled = false;
    let decoder: VideoDecoder | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      try {
        if (decoder && decoder.state !== "closed") decoder.close();
      } catch {
        // The decoder is already unusable. The frame (if any) is still valid.
      }
      resolve(first);
    };
    try {
      decoder = new deps.VideoDecoder({
        output: (frame) => {
          if (first || settled) frame.close();
          else first = frame;
        },
        error: () => finish(),
      });
      timer = setTimeout(finish, timeoutMs);
      decoder.configure(config);
      decoder.decode(new deps.EncodedVideoChunk({ type: "key", timestamp: 0, data }));
      decoder.flush().then(finish, finish);
    } catch {
      finish();
    }
  });
}

/**
 * Makes a poster from one keyframe of the clip (posterKey.ts). Never throws.
 * Without VideoDecoder, EncodedVideoChunk or OffscreenCanvas it returns the placeholder.
 */
export async function makePoster(
  keyframe: ArrayBuffer | Uint8Array,
  videoConfig: PosterVideoConfig,
  options: PosterOptions = {},
): Promise<string> {
  let frame: VideoFrame | null = null;
  try {
    const deps = {
      VideoDecoder: options.deps?.VideoDecoder ?? globalThis.VideoDecoder,
      EncodedVideoChunk: options.deps?.EncodedVideoChunk ?? globalThis.EncodedVideoChunk,
      OffscreenCanvas: options.deps?.OffscreenCanvas ?? globalThis.OffscreenCanvas,
    };
    if (typeof deps.VideoDecoder !== "function" || typeof deps.EncodedVideoChunk !== "function" || typeof deps.OffscreenCanvas !== "function") {
      return PLACEHOLDER_POSTER;
    }
    const config: VideoDecoderConfig = {
      codec: videoConfig.codec,
      codedWidth: videoConfig.codedWidth,
      codedHeight: videoConfig.codedHeight,
      optimizeForLatency: true,
      ...(videoConfig.description ? { description: toBytes(videoConfig.description) } : {}),
    };
    const support = await deps.VideoDecoder.isConfigSupported(config).catch(() => null);
    if (!support?.supported) return PLACEHOLDER_POSTER;

    frame = await decodeKeyframe(deps as Required<PosterDeps>, config, toBytes(keyframe), options.timeoutMs ?? POSTER_TIMEOUT_MS);
    if (!frame) return PLACEHOLDER_POSTER;

    const canvas = drawScaled(deps.OffscreenCanvas, frame, frame.displayWidth, frame.displayHeight, options);
    frame.close();
    frame = null;
    return canvas ? await canvasToPoster(canvas, options) : PLACEHOLDER_POSTER;
  } catch {
    return PLACEHOLDER_POSTER;
  } finally {
    frame?.close();
  }
}

/** Draws an image into a new canvas at poster size. Null when the canvas has no 2D context. */
function drawScaled(
  Canvas: typeof OffscreenCanvas,
  image: CanvasImageSource,
  width: number,
  height: number,
  options: PosterOptions,
): OffscreenCanvas | null {
  const size = posterSize(width, height, options.maxWidth ?? POSTER_MAX_WIDTH);
  const canvas = new Canvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, size.width, size.height);
  return canvas;
}

/** Encodes a canvas as a JPEG data URL with no metadata segments. */
async function canvasToPoster(canvas: OffscreenCanvas, options: PosterOptions): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: options.quality ?? POSTER_QUALITY });
  if (blob.type !== "image/jpeg") return PLACEHOLDER_POSTER;
  const clean = stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()));
  if (!clean) return PLACEHOLDER_POSTER;
  return `data:image/jpeg;base64,${bytesToBase64(clean)}`;
}

/** Makes a poster from a picture (PNG) with createImageBitmap. Never throws. */
export async function makePosterFromImage(file: Blob, options: PosterOptions = {}): Promise<string> {
  let bitmap: ImageBitmap | null = null;
  try {
    const decode = options.deps?.createImageBitmap ?? globalThis.createImageBitmap?.bind(globalThis);
    const Canvas = options.deps?.OffscreenCanvas ?? globalThis.OffscreenCanvas;
    if (typeof decode !== "function" || typeof Canvas !== "function") return PLACEHOLDER_POSTER;
    bitmap = await decode(file);
    const canvas = drawScaled(Canvas, bitmap, bitmap.width, bitmap.height, options);
    bitmap.close();
    bitmap = null;
    return canvas ? await canvasToPoster(canvas, options) : PLACEHOLDER_POSTER;
  } catch {
    return PLACEHOLDER_POSTER;
  } finally {
    bitmap?.close();
  }
}

function videoFormats(mime: PosterMime): InputFormat[] {
  return mime === "video/webm" ? [WEBM] : [MP4];
}

/**
 * The poster keyframe of a stored video file: the posterKey.ts rule with no
 * moments (a file found without a row has none). The last keyframe at least
 * POSTER_END_GAP_SEC before the end, else the last keyframe. Null when the
 * track has no keyframe.
 */
export async function posterPacketOf(track: InputVideoTrack): Promise<EncodedPacket | null> {
  const sink = new EncodedPacketSink(track);
  const endSec = await track.computeDuration();
  const nearEnd = Number.isFinite(endSec) ? await sink.getKeyPacket(endSec - POSTER_END_GAP_SEC) : null;
  const packet = nearEnd ?? (await sink.getKeyPacket(Number.POSITIVE_INFINITY)) ?? (await sink.getFirstPacket());
  return packet && packet.type === "key" ? packet : null;
}

/**
 * Makes a poster from a stored file (MP4, WebM or PNG), for clips that the library
 * finds without a row. Never throws.
 */
export async function makePosterFromFile(file: Blob, mime: PosterMime, options: PosterOptions = {}): Promise<string> {
  if (mime === "image/png") return makePosterFromImage(file, options);
  let input: Input | null = null;
  try {
    input = new Input({ formats: videoFormats(mime), source: new BlobSource(file) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return PLACEHOLDER_POSTER;
    const config = await track.getDecoderConfig();
    const packet = await posterPacketOf(track);
    if (!config || !packet) return PLACEHOLDER_POSTER;
    const raw = config.description;
    const description = !raw
      ? undefined
      : ArrayBuffer.isView(raw)
        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice()
        : new Uint8Array(raw).slice();
    return await makePoster(
      packet.data,
      { codec: config.codec, codedWidth: config.codedWidth ?? 0, codedHeight: config.codedHeight ?? 0, description },
      options,
    );
  } catch {
    return PLACEHOLDER_POSTER;
  } finally {
    input?.dispose();
  }
}
