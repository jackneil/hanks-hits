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
 * - The client reads the verdict once per tab session (sessionStorage).
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
/** The sessionStorage item that holds this tab's verdict. */
export const VERDICT_SESSION_ITEM = "hh-clips-verdict.v1";

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
// Client: the verdict, read once per tab session
// ---------------------------------------------------------------------------

let pending: Promise<ClipsVerdict> | null = null;

function isVerdict(value: unknown): value is ClipsVerdict {
  const v = value as { mode?: unknown; capture?: unknown } | null;
  return !!v && typeof v.capture === "boolean" && typeof v.mode === "string" && MODES.has(v.mode);
}

function sessionStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The verdict for this tab: from sessionStorage when this tab already read it,
 * else from the verdict route (no-store). A failed read gives VERDICT_OFF and is
 * not stored, so the next page load asks again. On the server it is VERDICT_OFF.
 */
export function loadClipsVerdict(fetchImpl?: typeof fetch): Promise<ClipsVerdict> {
  if (typeof window === "undefined") return Promise.resolve(VERDICT_OFF);
  if (pending) return pending;
  const store = sessionStore();
  try {
    const cached = store?.getItem(VERDICT_SESSION_ITEM);
    if (cached) {
      const parsed: unknown = JSON.parse(cached);
      if (isVerdict(parsed)) return (pending = Promise.resolve({ mode: parsed.mode, capture: parsed.capture }));
    }
  } catch {
    // A bad stored value: ask the server.
  }
  const doFetch = fetchImpl ?? fetch;
  pending = (async () => {
    try {
      const response = await doFetch(CLIPS_CONFIG_PATH, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body: unknown = await response.json();
      if (!isVerdict(body)) throw new Error("bad verdict");
      const verdict: ClipsVerdict = { mode: body.mode, capture: body.capture };
      try {
        store?.setItem(VERDICT_SESSION_ITEM, JSON.stringify(verdict));
      } catch {
        // Storage full or blocked: the verdict still holds for this page.
      }
      return verdict;
    } catch (error) {
      // Values-free: the error type only.
      console.warn(`[clips] could not read the clips flag (${(error as { name?: string } | null)?.name ?? "error"}); clips are off for now.`);
      pending = null;
      return VERDICT_OFF;
    }
  })();
  return pending;
}

/** Forget the memorized verdict (tests; also after the dogfood cookie changes). */
export function resetClipsVerdict(): void {
  pending = null;
  try {
    (sessionStore() as Storage | null)?.removeItem?.(VERDICT_SESSION_ITEM);
  } catch {
    // Nothing to remove.
  }
}
