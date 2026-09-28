/**
 * Clip posters: a small JPEG data URL for library tiles and toasts (plan 8.1).
 *
 * The first keyframe is decoded with VideoDecoder, drawn into an OffscreenCanvas at
 * 320 px wide or less, and encoded as JPEG. All APP1 to APP15 and COM segments are
 * removed, so no EXIF or other metadata can reach a poster (plan 10).
 *
 * makePoster never throws. When a browser API is missing or a step fails, it
 * returns PLACEHOLDER_POSTER, a neutral gray JPEG.
 */

import { BlobSource, EncodedPacketSink, Input, MP4 } from "mediabunny";

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
}

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
 * Removes APP1 to APP15 and COM segments from a JPEG. APP0 (JFIF) stays.
 * Returns null when the bytes are not a JPEG this reader understands.
 */
export function stripJpegMetadata(jpeg: Uint8Array): Uint8Array | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [jpeg.subarray(0, 2)];
  let offset = 2;
  while (offset < jpeg.length) {
    if (jpeg[offset] !== 0xff) return null;
    // Fill bytes: a marker can have more than one 0xFF before it.
    while (offset + 1 < jpeg.length && jpeg[offset + 1] === 0xff) offset++;
    if (offset + 1 >= jpeg.length) return null;
    const marker = jpeg[offset + 1];
    if (marker === 0xd9) {
      parts.push(jpeg.subarray(offset, offset + 2));
      break;
    }
    if (marker === 0xda) {
      // Start of scan: the rest is image data and the markers in it.
      parts.push(jpeg.subarray(offset));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(jpeg.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 4 > jpeg.length) return null;
    const length = (jpeg[offset + 2] << 8) | jpeg[offset + 3];
    if (length < 2 || offset + 2 + length > jpeg.length) return null;
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(jpeg.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

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
 * Makes a poster from the clip's first keyframe. Never throws.
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

    const size = posterSize(frame.displayWidth, frame.displayHeight, options.maxWidth ?? POSTER_MAX_WIDTH);
    const canvas = new deps.OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) return PLACEHOLDER_POSTER;
    context.drawImage(frame, 0, 0, size.width, size.height);
    frame.close();
    frame = null;

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: options.quality ?? POSTER_QUALITY });
    if (blob.type !== "image/jpeg") return PLACEHOLDER_POSTER;
    const clean = stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()));
    if (!clean) return PLACEHOLDER_POSTER;
    return `data:image/jpeg;base64,${bytesToBase64(clean)}`;
  } catch {
    return PLACEHOLDER_POSTER;
  } finally {
    frame?.close();
  }
}

/**
 * Makes a poster from an MP4 file, for clips that the library finds without a row.
 * Never throws.
 */
export async function makePosterFromMp4(file: Blob, options: PosterOptions = {}): Promise<string> {
  const input = new Input({ formats: [MP4], source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return PLACEHOLDER_POSTER;
    const config = await track.getDecoderConfig();
    const packet = await new EncodedPacketSink(track).getFirstPacket();
    if (!config || !packet || packet.type !== "key") return PLACEHOLDER_POSTER;
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
    input.dispose();
  }
}
