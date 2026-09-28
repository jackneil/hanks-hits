/**
 * Time limits for codec promises.
 *
 * A codec flush can stop without an end: a hung hardware encoder, or a page
 * that the system suspends during the flush. The encode worker handles its
 * messages in one serial queue, so an unbounded wait would stop every later
 * frame, clip and disarm. Each wait on a codec promise goes through here.
 */

/** Longest wait for a codec flush before the caller closes the codec. */
export const FLUSH_TIMEOUT_MS = 1500;

/**
 * Resolves true when the promise settles (resolved or rejected) within ms,
 * and false when the time limit comes first. It never rejects. The caller
 * must close the codec on false, which also ends the pending promise.
 */
export function settleWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(false);
    }, Math.max(0, ms));
    const settle = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(true);
    };
    promise.then(settle, settle);
  });
}
