/**
 * Byte helpers for the encode worker.
 *
 * Every packet that leaves the worker is a fresh ArrayBuffer. A transfer then
 * detaches only the copy, never the ring storage or the encoder memory.
 */

/** Any buffer source that WebCodecs can give us. */
export type ByteSource = ArrayBuffer | ArrayBufferView | SharedArrayBuffer;

/** Returns a Uint8Array view of the source. The view shares memory with the source. */
export function viewBytes(src: ByteSource): Uint8Array {
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  return new Uint8Array(src);
}

/** Copies the source into a new ArrayBuffer that nothing else refers to. */
export function copyToArrayBuffer(src: ByteSource): ArrayBuffer {
  const view = viewBytes(src);
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

/** Compares two byte sources for identical length and content. */
export function bytesEqual(a: ByteSource | null | undefined, b: ByteSource | null | undefined): boolean {
  if (!a || !b) return a === b;
  const x = viewBytes(a);
  const y = viewBytes(b);
  if (x.byteLength !== y.byteLength) return false;
  for (let i = 0; i < x.byteLength; i++) if (x[i] !== y[i]) return false;
  return true;
}
