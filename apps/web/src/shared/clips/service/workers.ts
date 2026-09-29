/**
 * The only place that starts the clip workers. Load this module with a
 * dynamic import(), so no page gets a worker chunk (or mediabunny, or WASM)
 * until it needs one: the io worker when the library is used, the encode
 * worker when capture arms.
 *
 * new Worker(new URL(...), { type: "module" }) needs Next 16.3 or later
 * (vercel/next.js #94015).
 */

export function createIoWorker(): Worker {
  return new Worker(new URL("../engine/io/io.worker.ts", import.meta.url), { type: "module" });
}

export function createEncodeWorker(): Worker {
  return new Worker(new URL("../engine/encode/encode.worker.ts", import.meta.url), { type: "module" });
}
