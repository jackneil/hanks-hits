/**
 * The clips flag (plan 4.1): CLIPS_MODE = off | dogfood | on.
 *
 * - The server reads CLIPS_MODE at request time in /api/clips-config (a
 *   dynamic, no-store route), never at build time, so a redeploy is not
 *   needed to flip it.
 * - Default when CLIPS_MODE is not set: "on" in development (kid clones and
 *   local dev), "off" in production. A value that is set but unknown is
 *   "off" (fail closed).
 * - "dogfood": capture is on only for a browser with a valid signed dogfood
 *   cookie. POST /api/clips-config/dogfood sets that cookie, and only for a
 *   signed-in user whose id is in CLIPS_DOGFOOD_USER_IDS. The cookie is an
 *   HMAC-SHA-256 signature made with AUTH_SECRET over the user id and an
 *   expiry. The verdict route checks the signature, the expiry and that the
 *   id is still in the list, so removing an id from the list turns clips off
 *   for that browser at its next page load.
 * - The client asks the verdict route once per page load (the answer is kept
 *   in memory for that document only), so CLIPS_MODE=off and a removed
 *   dogfood id take effect at the next page load, also in a tab that the
 *   browser restored. joinClipsDogfood() and leaveClipsDogfood() forget the
 *   answer at once, so the tab asks again.
 * - Offline (plan 4.1: the last verdict is kept for 7 days): each good answer
 *   is also stored in localStorage with its time. Only a failed request uses
 *   that copy, and only while it is less than VERDICT_CACHE_TTL_MS old.
 *   Otherwise a failed request means off.
 * - The kill switch stops capture only. It never hides the kid's library:
 *   My Clips uses the library client, which does not read this flag.
 *
 * SSR-safe: nothing reads window, document or navigator at import time.
 */

export type ClipsMode = "off" | "dogfood" | "on";

/** What the client needs to know: may this browser capture now? */
export interface ClipsVerdict {
  mode: ClipsMode;
  capture: boolean;
}

export const CLIPS_CONFIG_PATH = "/api/clips-config";
export const CLIPS_DOGFOOD_PATH = "/api/clips-config/dogfood";
export const DOGFOOD_COOKIE = "hh_clips_dogfood";
/** 30 days, the same as the sign-in session. */
export const DOGFOOD_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;
/** The localStorage item that holds the last good verdict and its time, for offline use only. */
export const VERDICT_CACHE_ITEM = "hh-clips-verdict.v2";
/** How long the offline copy of the verdict is good for (plan 4.1: 7 days). */
export const VERDICT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const VERDICT_OFF: ClipsVerdict = Object.freeze({ mode: "off", capture: false }) as ClipsVerdict;

const MODES: ReadonlySet<string> = new Set(["off", "dogfood", "on"]);

/** The mode for a CLIPS_MODE value and a NODE_ENV value (see the file comment). */
export function resolveClipsMode(raw: string | undefined, nodeEnv: string | undefined): ClipsMode {
  if (raw === undefined || raw.trim() === "") return nodeEnv === "production" ? "off" : "on";
  const value = raw.trim().toLowerCase();
  return MODES.has(value) ? (value as ClipsMode) : "off";
}

/** True when CLIPS_MODE is set to a value that is not a mode (the route logs it). */
export function isUnknownClipsMode(raw: string | undefined): boolean {
  return raw !== undefined && raw.trim() !== "" && !MODES.has(raw.trim().toLowerCase());
}

/** The user ids in CLIPS_DOGFOOD_USER_IDS (separated by commas or spaces). */
export function parseDogfoodIds(raw: string | undefined): Set<string> {
  const ids = new Set<string>();
  for (const part of (raw ?? "").split(/[\s,]+/)) if (part) ids.add(part);
  return ids;
}

// ---------------------------------------------------------------------------
// Signed dogfood cookie: v1.<base64url(user id)>.<expiry seconds>.<base64url(HMAC)>
// ---------------------------------------------------------------------------

const COOKIE_VERSION = "v1";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is not available");
  return subtle;
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return subtleCrypto().importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** Makes the cookie value for a user id, valid until expiresAtSec (seconds since the epoch). */
export async function signDogfoodCookie(userId: string, secret: string, expiresAtSec: number): Promise<string> {
  const body = `${COOKIE_VERSION}.${base64url(new TextEncoder().encode(userId))}.${Math.floor(expiresAtSec)}`;
  const signature = await subtleCrypto().sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

/**
 * True when the cookie has a valid signature, has not expired, and names a user
 * who is still in the dogfood list. The signature check is constant-time
 * (SubtleCrypto.verify). Any malformed value is false.
 */
export async function verifyDogfoodCookie(
  value: string | undefined,
  secret: string | undefined,
  allowedIds: ReadonlySet<string>,
  nowSec: number,
): Promise<boolean> {
  if (!value || !secret || allowedIds.size === 0) return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== COOKIE_VERSION) return false;
  const [, idPart, expPart, sigPart] = parts;
  if (!/^\d{1,12}$/.test(expPart) || Number(expPart) <= nowSec) return false;
  const idBytes = fromBase64url(idPart);
  const signature = fromBase64url(sigPart);
  if (!idBytes || !signature || signature.length !== 32) return false;
  let userId: string;
  try {
    userId = new TextDecoder("utf-8", { fatal: true }).decode(idBytes);
  } catch {
    return false;
  }
  if (!allowedIds.has(userId)) return false;
  try {
    const body = new TextEncoder().encode(`${COOKIE_VERSION}.${idPart}.${expPart}`);
    return await subtleCrypto().verify("HMAC", await hmacKey(secret, "verify"), signature as Uint8Array<ArrayBuffer>, body);
  } catch {
    return false;
  }
}

/** The server verdict for one request. */
export async function clipsVerdictFor(input: {
  clipsMode: string | undefined;
  nodeEnv: string | undefined;
  cookie: string | undefined;
  secret: string | undefined;
  dogfoodIds: string | undefined;
  nowSec: number;
}): Promise<ClipsVerdict> {
  const mode = resolveClipsMode(input.clipsMode, input.nodeEnv);
  if (mode === "on") return { mode, capture: true };
  if (mode === "off") return { mode, capture: false };
  const capture = await verifyDogfoodCookie(input.cookie, input.secret, parseDogfoodIds(input.dogfoodIds), input.nowSec);
  return { mode, capture };
}

// ---------------------------------------------------------------------------
// Client: the verdict, asked once per page load
// ---------------------------------------------------------------------------

/** The answer of this document (a page load). Never kept across page loads. */
let pending: Promise<ClipsVerdict> | null = null;
/** Counts the requests, so an old failed request never clears a newer one. */
let asked = 0;

function isVerdict(value: unknown): value is ClipsVerdict {
  const v = value as { mode?: unknown; capture?: unknown } | null;
  return !!v && typeof v.capture === "boolean" && typeof v.mode === "string" && MODES.has(v.mode);
}

function localStore(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The offline copy, when it is younger than VERDICT_CACHE_TTL_MS; else null. */
function offlineCopy(nowMs: number): ClipsVerdict | null {
  try {
    const raw = localStore()?.getItem(VERDICT_CACHE_ITEM);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { verdict?: unknown; atMs?: unknown } | null;
    const atMs = parsed?.atMs;
    if (!parsed || !isVerdict(parsed.verdict) || typeof atMs !== "number" || !Number.isFinite(atMs)) return null;
    const age = nowMs - atMs;
    if (age < 0 || age >= VERDICT_CACHE_TTL_MS) return null;
    return { mode: parsed.verdict.mode, capture: parsed.verdict.capture };
  } catch {
    return null;
  }
}

/**
 * The verdict for this page load: the verdict route (no-store), asked once
 * per document. When the request fails, the offline copy (at most
 * VERDICT_CACHE_TTL_MS old) or VERDICT_OFF; a failed request is not kept, so
 * the next call asks again. On the server it is VERDICT_OFF.
 */
export function loadClipsVerdict(fetchImpl?: typeof fetch, now: () => number = () => Date.now()): Promise<ClipsVerdict> {
  if (typeof window === "undefined") return Promise.resolve(VERDICT_OFF);
  if (pending) return pending;
  const doFetch = fetchImpl ?? fetch;
  const ask = ++asked;
  const request = (async () => {
    try {
      const response = await doFetch(CLIPS_CONFIG_PATH, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body: unknown = await response.json();
      if (!isVerdict(body)) throw new Error("bad verdict");
      const verdict: ClipsVerdict = { mode: body.mode, capture: body.capture };
      try {
        localStore()?.setItem(VERDICT_CACHE_ITEM, JSON.stringify({ verdict, atMs: now() }));
      } catch {
        // Storage full or blocked: only the offline copy is lost.
      }
      return verdict;
    } catch (error) {
      const copy = offlineCopy(now());
      // Values-free: the error type only.
      console.warn(
        `[clips] could not read the clips flag (${(error as { name?: string } | null)?.name ?? "error"}); ${copy ? "using the last answer" : "clips are off for now"}.`,
      );
      // Not kept: the next call asks again (unless a newer request took over).
      if (ask === asked) pending = null;
      return copy ?? VERDICT_OFF;
    }
  })();
  pending = request;
  return request;
}

/** Forget this page's verdict, so the next call asks the route again (tests, and after a dogfood change). */
export function resetClipsVerdict(): void {
  pending = null;
  asked++;
}

async function changeDogfood(method: "POST" | "DELETE", fetchImpl?: typeof fetch): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const response = await (fetchImpl ?? fetch)(CLIPS_DOGFOOD_PATH, { method, cache: "no-store", credentials: "same-origin" });
    if (!response.ok) {
      // Values-free: the status only.
      console.warn(`[clips] the dogfood change was refused (status ${response.status})`);
      return false;
    }
    // The cookie changed: this tab asks for its verdict again.
    resetClipsVerdict();
    return true;
  } catch (error) {
    console.warn(`[clips] the dogfood change failed (${(error as { name?: string } | null)?.name ?? "error"})`);
    return false;
  }
}

/** Turns clips on for this browser in dogfood mode (a listed, signed-in user). True when the cookie was set. */
export function joinClipsDogfood(fetchImpl?: typeof fetch): Promise<boolean> {
  return changeDogfood("POST", fetchImpl);
}

/** Turns dogfood clips off again for this browser. True when the cookie was cleared. */
export function leaveClipsDogfood(fetchImpl?: typeof fetch): Promise<boolean> {
  return changeDogfood("DELETE", fetchImpl);
}
