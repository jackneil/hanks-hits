/**
 * Byte helpers for the lab's test hook. A driver (Playwright, or safaridriver
 * on an iPhone) reads the last clip in base64 chunks through
 * window.__clipsLab.readClipBase64, because the site's Content Security
 * Policy (connect-src) blocks fetch() of a blob: URL.
 */

/** The largest chunk that readClipBase64 gives (bytes). */
export const MAX_READ_CHUNK = 4 * 1024 * 1024;

/** Base64 of `bytes` (btoa of a binary string, built in slices to keep the call stack small). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const slice = 0x8000;
  for (let i = 0; i < bytes.length; i += slice) {
    binary += String.fromCharCode(...bytes.subarray(i, i + slice));
  }
  return btoa(binary);
}

/**
 * Base64 of bytes [offset, offset + length) of `blob`. The range is cut to
 * the blob and to MAX_READ_CHUNK. A range past the end gives "".
 */
export async function readBlobBase64(blob: Blob, offset: number, length: number): Promise<string> {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 0) {
    throw new RangeError("offset and length must be whole numbers, 0 or more");
  }
  const end = Math.min(blob.size, offset + Math.min(length, MAX_READ_CHUNK));
  if (offset >= end) return "";
  const buffer = await blob.slice(offset, end).arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}
