/**
 * Test helpers for the real AAC WASM module (apps/web/public/clips/aac).
 *
 * Tests load the committed module from the disk with the same code path as
 * the worker (instantiateAacWasm), only with a file URL in place of the
 * site URL.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AAC_WASM_MODULE_PATH, instantiateAacWasm, type AacWasmModule } from "../audio/aacBackends";

/** apps/web, from this directory. (import.meta.url is not a file URL in the jsdom environment.) */
export const WEB_ROOT = path.resolve(__dirname, "../../../../../..");

/** The repo root. */
export const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

/** The committed module file that the site serves at AAC_WASM_MODULE_PATH. */
export const AAC_WASM_FILE = path.join(WEB_ROOT, "public", ...AAC_WASM_MODULE_PATH.split("/").filter(Boolean));

/** Starts a new instance of the committed module. */
export function loadAacWasmFromDisk(): Promise<AacWasmModule> {
  return instantiateAacWasm(pathToFileURL(AAC_WASM_FILE).href);
}

/** An ADTS header for one raw AAC-LC access unit at 48 kHz stereo (ISO 14496-3, 1.A.2). */
export function adtsHeader(payloadBytes: number): Uint8Array {
  const length = payloadBytes + 7;
  const profile = 1; // AAC LC (object type 2) minus 1
  const rateIndex = 3; // 48000 Hz
  const channels = 2;
  return new Uint8Array([
    0xff,
    0xf1, // sync word, MPEG-4, layer 0, no CRC
    (profile << 6) | (rateIndex << 2) | (channels >> 2),
    ((channels & 3) << 6) | (length >> 11),
    (length >> 3) & 0xff,
    ((length & 7) << 5) | 0x1f,
    0xfc, // buffer fullness 0x7ff (variable rate), one raw data block
  ]);
}

/** Joins raw AAC access units into one ADTS stream. */
export function toAdts(packets: readonly ArrayBuffer[]): Uint8Array {
  const total = packets.reduce((n, p) => n + p.byteLength + 7, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of packets) {
    out.set(adtsHeader(p.byteLength), at);
    out.set(new Uint8Array(p), at + 7);
    at += p.byteLength + 7;
  }
  return out;
}
