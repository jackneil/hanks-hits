/**
 * Free-space probe for browsers without navigator.storage.estimate() (Safari before
 * 17, plan 8.1). It grows a probe file with a 1-byte write at the end, then truncates
 * it to 0. The browser checks the quota for the new size, so no large data is written
 * (the file is sparse). The result is the largest size that fitted.
 */

import { isQuotaError } from "./errors";
import type { DirectoryHandleLike, SyncAccessHandleLike } from "./fsTypes";

export const PROBE_FILE_NAME = ".space-probe";
/** First probe size. */
export const PROBE_START_BYTES = 64 * 1024 * 1024;
/** The probe stops doubling here; more free space than this is "a lot". */
export const PROBE_LIMIT_BYTES = 2 ** 40;
/** Halving steps after the first failed size. Precision is (failed size / 2) / 2^steps. */
export const PROBE_REFINE_STEPS = 6;

const ONE_BYTE = new Uint8Array(1);

function fitsSize(access: SyncAccessHandleLike, size: number): boolean {
  try {
    access.write(ONE_BYTE, { at: size - 1 });
    access.truncate(0);
    return true;
  } catch (error) {
    try {
      access.truncate(0);
    } catch {
      // The handle is already at size 0 or closed. The finally block removes the file.
    }
    if (isQuotaError(error)) return false;
    throw error;
  }
}

/**
 * Measures the free space in the origin's storage, in bytes.
 * Returns null when the probe cannot run (no sync access handle in this context).
 */
export async function probeFreeBytes(dir: DirectoryHandleLike): Promise<number | null> {
  let access: SyncAccessHandleLike | null = null;
  try {
    const handle = await dir.getFileHandle(PROBE_FILE_NAME, { create: true });
    if (typeof handle.createSyncAccessHandle !== "function") return null;
    access = await handle.createSyncAccessHandle();
    let fits = 0;
    let fails: number | null = null;
    for (let size = PROBE_START_BYTES; size <= PROBE_LIMIT_BYTES; size *= 2) {
      if (fitsSize(access, size)) {
        fits = size;
      } else {
        fails = size;
        break;
      }
    }
    if (fails !== null) {
      let low = fits;
      let high = fails;
      for (let i = 0; i < PROBE_REFINE_STEPS; i++) {
        const middle = Math.floor((low + high) / 2);
        if (fitsSize(access, middle)) low = middle;
        else high = middle;
      }
      fits = low;
    }
    return fits;
  } catch {
    return null;
  } finally {
    try {
      access?.close();
    } catch {
      // Already closed.
    }
    await dir.removeEntry(PROBE_FILE_NAME).catch(() => undefined);
  }
}
