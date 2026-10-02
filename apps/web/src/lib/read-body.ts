/**
 * Read a request body with a byte limit. Use readJson() or readBody() in
 * place of request.json(), request.text(), request.formData(),
 * request.arrayBuffer(), request.blob() and request.bytes() in every route
 * handler, and before a library gets the request (the Auth.js route reads
 * the body here, then gives Auth.js a new request with the bytes). The
 * ESLint rule `hanks-hits/bounded-request-body`
 * (src/lib/boundedBodyRule.mjs) and the route inventory test
 * (src/app/api/__tests__/body-inventory.test.ts) enforce this.
 *
 * Why: a Next.js route handler has no body limit of its own (this app has
 * no middleware), and the Railway service domain answers with no Cloudflare
 * in front of it. request.json() holds the whole body in memory before any
 * check, also a chunked body with no Content-Length. One request with a
 * large body can use all the memory of the server.
 *
 * How the limit holds:
 * - A declared Content-Length over the limit is refused at once (413), and
 *   no byte of the body is read.
 * - The reader never trusts Content-Length otherwise. It counts the bytes
 *   while they arrive, so the limit holds for a chunked body and for a
 *   Content-Length that is wrong.
 * - The read stops at the first chunk that goes over the limit, and it
 *   cancels the stream. So the server holds at most the limit plus one
 *   chunk.
 * - readJson() can also count the JSON values while the bytes arrive
 *   (maxJsonValues). JSON.parse makes one object for each value, so a body
 *   of many small values ([{},{},...]) uses much more memory than its
 *   bytes. The count stops such a body before the parse.
 *
 * The time limit is a choice that each caller writes down. `timeoutMs` is
 * required: a number of milliseconds, or null for no time limit. Only null
 * turns the timer off. A missing or undefined value is a programmer error
 * and throws (no default can turn a limit on or off by accident). The same
 * is true of `maxJsonValues` for readJson().
 *
 * A route answers a failed read with refuseBody(). It writes one log line
 * with no value from the body in it, so a refused body is never silent.
 * See design/ARCHITECTURE.md, section "Request bodies".
 */

import { MAX_UPLOAD_REQUEST_BYTES } from "./leaderboard-clips/contract";

export interface BodyLimits {
  /** The largest body, in bytes. A positive whole number. */
  readonly maxBytes: number;
  /**
   * The time for the whole body to arrive, in milliseconds, or null for no
   * time limit. With null, Node's own requestTimeout (300 s) still ends a
   * request that does not finish.
   */
  readonly timeoutMs: number | null;
  /** Optional moving-window upload rate floor. Progress saves never set it. */
  readonly minBytesPerSec?: number;
  readonly graceMs?: number;
}

export interface JsonLimits extends BodyLimits {
  /**
   * The most JSON values (and object keys) in the body, or null for no
   * count. The reader counts the marks { [ , : outside strings while the
   * bytes arrive. Each value or key, other than the first value, comes just
   * after one of these marks, so a body with N marks holds at most N + 1
   * values and keys. A body with more than maxJsonValues marks is refused
   * (413) before the parse.
   */
  readonly maxJsonValues: number | null;
}

export type BodyFailure =
  /** The body is larger than maxBytes (declared, or counted while it arrived). */
  | "too_big"
  /** The whole body did not arrive in timeoutMs. */
  | "timeout"
  /** An explicitly configured upload rate floor was not met. */
  | "too_slow"
  /** The stream failed (the client went away), or the body was already read. */
  | "broken";

/**
 * A JSON read can also fail because the body holds more JSON values than
 * maxJsonValues ("too_many_values"), or because it is empty or is not JSON
 * ("bad_json").
 */
export type JsonFailure = BodyFailure | "too_many_values" | "bad_json";

/**
 * A failed read. It holds counts only, never the body text, so a caller
 * cannot log part of a password by mistake.
 */
export interface BodyFailureInfo<Why extends JsonFailure = JsonFailure> {
  ok: false;
  why: Why;
  /** The bytes of the body that arrived before the read stopped. */
  receivedBytes: number;
}

export type BodyRead = { ok: true; bytes: Uint8Array } | BodyFailureInfo<BodyFailure>;

export type JsonRead = { ok: true; value: unknown } | BodyFailureInfo<JsonFailure>;

/**
 * The limits of a small JSON route that a player can reach with no sign-in
 * (sign-up, and the Auth.js routes for sign-in and sign-out). 64 KiB is more
 * than 100 times the largest real form. The 30 s time limit ends a request
 * that holds a connection open with no account behind it. A 64 KiB body
 * holds too few values to need a count.
 */
export const SMALL_JSON_BODY: JsonLimits = Object.freeze({
  maxBytes: 64 * 1024,
  timeoutMs: 30_000,
  maxJsonValues: null,
});

/**
 * The limits of a small save of a signed-in player (the display name, the
 * leaderboard switch). 64 KiB, as for SMALL_JSON_BODY, but no time limit:
 * a save is not refused because a phone line paused (see
 * PROGRESS_SAVE_BODY). Node's requestTimeout (300 s) still ends a request
 * that does not finish, and the route reads no body before the sign-in
 * check.
 */
export const SMALL_SAVE_BODY: JsonLimits = Object.freeze({
  maxBytes: 64 * 1024,
  timeoutMs: null,
  maxJsonValues: null,
});

/**
 * The limits of a progress save (POST /api/progress/[appId]).
 *
 * 100 MiB is over the largest save that the schemas accept. The largest is
 * a Drawing App gallery: 20 drawings, each with a data URL and a thumbnail
 * of up to 1,500,000 characters (60,000,000 characters of image data).
 *
 * 2,000,000 JSON values is more than 3 times the most values in a valid
 * save (the Drum Machine's largest save has 661,328 marks). Without the
 * count, one body of 100 MiB of empty objects made JSON.parse use about
 * 3.7 GB.
 *
 * The test "the largest valid save of every game" (route.test.ts) builds
 * the largest save of every schema, checks both limits against it, and
 * sends it through the route.
 *
 * There is no time limit here. A kid on a slow phone line can take minutes
 * to send a large gallery. A first design of this change put gates on the
 * save path (a time limit, a speed floor, a limit on saves in flight, a
 * memory budget), and review found that each one refused or lost real
 * saves. Node's requestTimeout (300 s) still ends a request that does not
 * finish. See design/ARCHITECTURE.md, section "Request bodies".
 */
export const PROGRESS_SAVE_BODY: JsonLimits = Object.freeze({
  maxBytes: 100 * 1024 * 1024,
  timeoutMs: null,
  maxJsonValues: 2_000_000,
});

/** Clip uploads alone have a moving speed floor and a five-minute deadline. */
export const CLIP_UPLOAD_BODY: BodyLimits = Object.freeze({
  maxBytes: MAX_UPLOAD_REQUEST_BYTES,
  timeoutMs: 5 * 60 * 1000,
  minBytesPerSec: 8 * 1024,
  graceMs: 15_000,
});

/** Owner/admin delete accepts only a tiny optional JSON object. */
export const CLIP_DELETE_BODY: BodyLimits = Object.freeze({ maxBytes: 1024, timeoutMs: 10_000 });

/** Throw on limits that a caller wrote wrong. A route must not run with a limit it did not choose. */
function assertLimits(limits: BodyLimits): void {
  if (!limits || typeof limits !== "object") {
    throw new TypeError("read-body: give the limits as { maxBytes, timeoutMs }.");
  }
  const { maxBytes, timeoutMs } = limits;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("read-body: maxBytes must be a positive whole number of bytes.");
  }
  if (timeoutMs !== null && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new TypeError(
      "read-body: timeoutMs must be a positive number of milliseconds, or null for no time limit."
    );
  }
  const floor = limits.minBytesPerSec ?? 0;
  if (!Number.isFinite(floor) || floor < 0) throw new TypeError("read-body: invalid upload rate floor.");
  if (floor > 0 && (!Number.isFinite(limits.graceMs) || (limits.graceMs ?? 0) <= 0)) {
    throw new TypeError("read-body: an upload rate floor needs a positive graceMs window.");
  }
}

/** Throw on JSON limits that a caller wrote wrong (also a missing maxJsonValues). */
function assertJsonLimits(limits: JsonLimits): void {
  assertLimits(limits);
  const { maxJsonValues } = limits;
  if (maxJsonValues === null) return;
  if (!Number.isSafeInteger(maxJsonValues) || maxJsonValues <= 0) {
    throw new TypeError(
      "read-body: maxJsonValues must be a positive whole number, or null for no count."
    );
  }
}

/**
 * The Content-Length header as a number, or null when it is absent or is
 * not a whole number. A value over the safe range stays a large number (it
 * is over every limit).
 */
function declaredLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null || !/^\s*\d+\s*$/.test(value)) return null;
  return Number(value);
}

const QUOTE = 0x22; // "
const BACKSLASH = 0x5c; // \

/**
 * Counts the JSON marks { [ , : that are outside strings, chunk by chunk.
 * A chunk can end in a string or just after a backslash, so the counter
 * keeps that state between chunks. The marks, the quote and the backslash
 * are ASCII bytes, and every byte of a multi-byte UTF-8 character is 0x80
 * or more, so the count works on the bytes.
 */
export class JsonValueCounter {
  /** The marks so far. */
  count = 0;
  private inString = false;
  private escaped = false;

  add(chunk: Uint8Array): void {
    const length = chunk.length;
    // The next quote and backslash in a string, found with indexOf (fast on
    // a long string such as a data URL), and kept until the scan passes them.
    let nextQuote = -2;
    let nextBackslash = -2;
    let i = 0;
    while (i < length) {
      if (this.escaped) {
        this.escaped = false;
        i++;
        continue;
      }
      if (this.inString) {
        if (nextQuote !== -1 && nextQuote < i) nextQuote = chunk.indexOf(QUOTE, i);
        if (nextBackslash !== -1 && nextBackslash < i) nextBackslash = chunk.indexOf(BACKSLASH, i);
        if (nextBackslash !== -1 && (nextQuote === -1 || nextBackslash < nextQuote)) {
          this.escaped = true;
          i = nextBackslash + 1;
        } else if (nextQuote !== -1) {
          this.inString = false;
          i = nextQuote + 1;
        } else {
          return; // The rest of the chunk is in the string.
        }
        continue;
      }
      const byte = chunk[i++];
      if (byte === QUOTE) this.inString = true;
      else if (byte === 0x7b || byte === 0x5b || byte === 0x2c || byte === 0x3a) this.count++; // { [ , :
    }
  }
}

type StreamResult = { ok: true; bytes: Uint8Array } | { ok: false; why: BodyFailure | "too_many_values" };

/**
 * Read the whole body within the limits, and give each chunk to `inspect`
 * (it answers false to stop the read). Never throws for a bad body.
 * `progress.received` counts the bytes that arrived, also on a failure.
 */
async function readStream(
  request: Request,
  limits: BodyLimits,
  progress: { received: number },
  inspect: ((chunk: Uint8Array) => boolean) | null
): Promise<StreamResult> {
  const { maxBytes, timeoutMs } = limits;

  const declared = declaredLength(request);
  if (declared !== null && declared > maxBytes) return { ok: false, why: "too_big" };

  // The one place in the app that takes the body stream. Every other read
  // goes through this function.
  // eslint-disable-next-line hanks-hits/bounded-request-body -- the bounded reader itself
  const stream = request.body;
  if (stream === null) return { ok: true, bytes: new Uint8Array(0) };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch {
    return { ok: false, why: "broken" }; // The body was already read or locked.
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const floor = limits.minBytesPerSec ?? 0;
  const late = timeoutMs === null && floor === 0 ? null : new Promise<StreamResult>((resolve) => {
    if (timeoutMs !== null) timer = setTimeout(() => resolve({ ok: false, why: "timeout" }), timeoutMs);
    if (floor > 0) {
      const windowMs = limits.graceMs!;
      const started = Date.now();
      const samples = [{ at: started, total: 0 }];
      ticker = setInterval(() => {
        const now = Date.now();
        samples.push({ at: now, total: progress.received });
        if (now - started < windowMs) return;
        let base = 0;
        while (base + 1 < samples.length && samples[base + 1].at <= now - windowMs) base++;
        samples.splice(0, base);
        const from = samples[0];
        if (progress.received - from.total < floor * (now - from.at) / 1000) {
          resolve({ ok: false, why: "too_slow" });
        }
      }, Math.max(1, Math.min(1000, windowMs)));
    }
  });

  /** Set when the result is known, so a read that is still waiting does not keep the chunks. */
  let settled = false;
  let ended = false;
  const read = (async (): Promise<StreamResult> => {
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (settled) return { ok: false, why: "broken" };
      if (done) break;
      progress.received += value.byteLength;
      if (progress.received > maxBytes) return { ok: false, why: "too_big" };
      if (inspect && !inspect(value)) return { ok: false, why: "too_many_values" };
      chunks.push(value);
    }
    ended = true;
    if (chunks.length === 1) return { ok: true, bytes: chunks[0] };
    const bytes = new Uint8Array(progress.received);
    let at = 0;
    for (let i = 0; i < chunks.length; i++) {
      bytes.set(chunks[i], at);
      at += chunks[i].byteLength;
      // Let the garbage collector free each chunk once it is copied, so the
      // body is not held twice until the copy ends.
      chunks[i] = EMPTY;
    }
    return { ok: true, bytes };
  })().catch((): StreamResult => ({ ok: false, why: "broken" }));

  try {
    return await (late ? Promise.race([read, late]) : read);
  } finally {
    settled = true;
    clearTimeout(timer);
    clearInterval(ticker);
    // Over a limit, late, or broken: stop the stream, so no more bytes
    // come in. A body that ended needs no cancel.
    if (!ended) reader.cancel().catch(() => undefined);
  }
}

const EMPTY = new Uint8Array(0);

/**
 * Read the whole body within the limits. Never throws for a bad body (only
 * for bad limits, which is a programmer error).
 */
export async function readBody(request: Request, limits: BodyLimits): Promise<BodyRead> {
  assertLimits(limits);
  const progress = { received: 0 };
  const result = await readStream(request, limits, progress, null);
  if (result.ok) return result;
  // With no inspect function, readStream never answers too_many_values.
  return { ok: false, why: result.why as BodyFailure, receivedBytes: progress.received };
}

/**
 * Read a JSON body within the limits, with the same decoding as
 * request.json() (UTF-8; a byte order mark is dropped). An empty body or
 * text that is not JSON is "bad_json". With maxJsonValues, a body with more
 * JSON marks than that is "too_many_values", found while the bytes arrive.
 */
export async function readJson(request: Request, limits: JsonLimits): Promise<JsonRead> {
  assertJsonLimits(limits);
  const progress = { received: 0 };
  const { maxJsonValues } = limits;
  let inspect: ((chunk: Uint8Array) => boolean) | null = null;
  if (maxJsonValues !== null) {
    const counter = new JsonValueCounter();
    inspect = (chunk) => {
      counter.add(chunk);
      return counter.count <= maxJsonValues;
    };
  }
  const raw = await readStream(request, limits, progress, inspect);
  if (!raw.ok) return { ok: false, why: raw.why, receivedBytes: progress.received };
  const text = new TextDecoder().decode(raw.bytes);
  // Drop the bytes before the parse: the parse then holds the text and the
  // value, not the bytes as well.
  (raw as { bytes: Uint8Array | null }).bytes = null;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // The SyntaxError quotes the text near the bad token (it can be part of
    // a password), so it is never kept or logged.
    return { ok: false, why: "bad_json", receivedBytes: progress.received };
  }
}

/** The HTTP status for a failed read: 413 for too big, 408 for late, 400 for the rest. */
export function bodyFailureStatus(why: JsonFailure): 400 | 408 | 413 {
  if (why === "too_big" || why === "too_many_values") return 413;
  if (why === "timeout" || why === "too_slow") return 408;
  return 400;
}

/** A short message for a failed read. It never quotes the body. */
export function bodyFailureMessage(why: JsonFailure): string {
  if (why === "too_big" || why === "too_many_values") return "The request is too big.";
  if (why === "timeout" || why === "too_slow") return "The request took too long to arrive.";
  return "The request is not valid.";
}

/**
 * Answer a failed read, and write one log line about it.
 *
 * The log line holds the route, the reason and two counts (the declared
 * Content-Length and the bytes that arrived). It never holds a value from
 * the body or a user id. `route` is a fixed text of the caller. The only
 * value from the request that it may hold is one that the route checked
 * first (the app id of a progress save).
 *
 * The answer is JSON, and it is never cached.
 */
export function refuseBody(route: string, failure: BodyFailureInfo, request: Request): Response {
  const declared = declaredLength(request);
  console.warn(
    `[read-body] ${route}: refused a request body (${failure.why}; ` +
      `declared ${declared === null ? "no" : declared} bytes, received ${failure.receivedBytes} bytes)`
  );
  return Response.json(
    { error: bodyFailureMessage(failure.why) },
    { status: bodyFailureStatus(failure.why), headers: { "Cache-Control": "no-store" } }
  );
}
