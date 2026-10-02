/**
 * JPEG segment tools: remove metadata and read the frame size.
 *
 * Pure functions, no imports, no browser API. The clip posters (made in the
 * browser, src/shared/clips/engine/io/poster.ts) and the leaderboard clip
 * upload check (on the server, src/lib/leaderboard-clips/poster.ts) use the
 * same code.
 *
 * A JPEG is a list of marker segments. The entropy-coded data of a scan
 * follows each SOS segment; inside it, a 0xFF byte is followed by 0x00
 * (a stuffed byte) or by a restart marker (RST0 to RST7). Any other marker
 * ends the scan. A progressive JPEG has many scans, and segments (tables,
 * and also APPn or COM) can sit between them, so the reader walks every
 * scan to the EOI marker. Bytes after EOI are not part of the image and are
 * dropped.
 */

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;

function isRestart(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

/** APP1 to APP15 and COM. APP0 (JFIF) stays: it holds no personal data. */
function isMetadata(marker: number): boolean {
  return (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
}

/** The start of frame markers that hold the image size (SOF0 to SOF15, not DHT, JPG or DAC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

interface Segment {
  marker: number;
  /** The first byte of the marker (0xFF). */
  start: number;
  /** The byte after the segment (and after its scan data, for SOS). */
  end: number;
}

/**
 * Splits a JPEG into marker segments, from SOI to EOI. Returns null when the
 * bytes are not a complete JPEG that this reader understands.
 */
function segmentsOf(jpeg: Uint8Array): Segment[] | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== SOI) return null;
  const segments: Segment[] = [{ marker: SOI, start: 0, end: 2 }];
  let offset = 2;
  while (offset < jpeg.length) {
    if (jpeg[offset] !== 0xff) return null;
    // Fill bytes: a marker can have more than one 0xFF before it.
    while (offset + 1 < jpeg.length && jpeg[offset + 1] === 0xff) offset++;
    if (offset + 1 >= jpeg.length) return null;
    const start = offset;
    const marker = jpeg[offset + 1];
    if (marker === EOI) {
      segments.push({ marker, start, end: offset + 2 });
      return segments;
    }
    if (isRestart(marker) || marker === 0x01) {
      segments.push({ marker, start, end: offset + 2 });
      offset += 2;
      continue;
    }
    if (marker === SOI || marker === 0x00) return null;
    if (offset + 4 > jpeg.length) return null;
    const length = (jpeg[offset + 2] << 8) | jpeg[offset + 3];
    if (length < 2 || offset + 2 + length > jpeg.length) return null;
    let end = offset + 2 + length;
    if (marker === SOS) {
      // Entropy-coded data: up to the next marker that is not a stuffed byte or a restart.
      while (end < jpeg.length) {
        if (jpeg[end] !== 0xff) {
          end++;
          continue;
        }
        const next = end + 1 < jpeg.length ? jpeg[end + 1] : -1;
        if (next === 0x00 || isRestart(next)) {
          end += 2;
          continue;
        }
        if (next === 0xff) {
          end++; // a fill byte before the next marker
          continue;
        }
        break;
      }
      if (end >= jpeg.length) return null; // no EOI
    }
    segments.push({ marker, start, end });
    offset = end;
  }
  return null; // no EOI
}

/**
 * Removes APP1 to APP15 and COM segments from a JPEG, also between the scans
 * of a progressive JPEG, and drops any bytes after EOI. APP0 (JFIF) stays.
 * Returns null when the bytes are not a complete JPEG this reader understands
 * (no SOI, a cut segment, or no EOI).
 */
export function stripJpegMetadata(jpeg: Uint8Array): Uint8Array | null {
  const segments = segmentsOf(jpeg);
  if (!segments) return null;
  const kept = segments.filter((segment) => !isMetadata(segment.marker));
  const total = kept.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const segment of kept) {
    out.set(jpeg.subarray(segment.start, segment.end), cursor);
    cursor += segment.end - segment.start;
  }
  return out;
}

/** The width and height in the first start-of-frame segment, or null. */
export function jpegFrameSize(jpeg: Uint8Array): { width: number; height: number } | null {
  const segments = segmentsOf(jpeg);
  if (!segments) return null;
  const frame = segments.find((segment) => isStartOfFrame(segment.marker));
  if (!frame || frame.end - frame.start < 9) return null;
  const at = frame.start + 4; // after FF, marker, and the 2-byte length
  const height = (jpeg[at + 1] << 8) | jpeg[at + 2];
  const width = (jpeg[at + 3] << 8) | jpeg[at + 4];
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/** True when the JPEG has APP1 to APP15 or COM segments anywhere. Null when it is not a complete JPEG. */
export function jpegHasMetadata(jpeg: Uint8Array): boolean | null {
  const segments = segmentsOf(jpeg);
  if (!segments) return null;
  return segments.some((segment) => isMetadata(segment.marker));
}
