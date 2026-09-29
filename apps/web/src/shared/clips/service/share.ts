/**
 * Share and save helpers (plan 12).
 *
 * - Share calls navigator.share({ files: [file] }) with the file only, and
 *   SYNCHRONOUSLY in the caller's tap handler: an await before the call would
 *   use up the tap's user activation. canShare({ files }) is checked first.
 * - Outcomes (contract ShareOutcome):
 *     resolved            -> "shared"
 *     AbortError          -> "cancelled"  (the kid closed the sheet)
 *     NotAllowedError     -> "retry"      (no activation: "Tap Share one more time.")
 *     the same clip gets NotAllowedError again within REFUSAL_MEMORY_MS
 *                         -> "blocked"    (Screen Time, Family Link or a policy:
 *                            a kid-word reason, never silence). "The same clip"
 *                            is its file name, size, type and lastModified, not
 *                            the File object: the library makes a new File each time.
 *     InvalidStateError   -> "ignored"    (a double tap: a share is open)
 *     canShare false, TypeError, DataError -> "fallback-save"
 *     no navigator.share  -> "unsupported"
 * - Save uses an <a download> (desktop and Android). The object URL is
 *   released after the download has had time to start.
 * - A failure logs a values-free reason: the error type only, never a file
 *   name, a clip id or any player data.
 * - File names are <host-slug>-<game>-<yyyymmdd-hhmm>.<ext>, from the
 *   deployment's own host, never from the site name (which can hold an
 *   owner's first name, plan 10).
 */

import type { ClipRecord } from "../protocol";
import { extensionFor } from "../library/shared";
import type { SaveOutcome, ShareOutcome } from "./contract";

/** The browser objects the helpers use. Tests pass fakes. */
export interface ShareEnv {
  navigator?: {
    share?: (data: ShareData) => Promise<void>;
    canShare?: (data: ShareData) => boolean;
  };
  document?: Pick<Document, "createElement"> & { body: { appendChild(node: Node): unknown } | null };
  URL?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  /** Wall-clock milliseconds, for the refusal memory. Default Date.now. */
  now?: () => number;
  log?: (message: string) => void;
}

/** How long an object URL of a download stays alive. The download starts well before. */
export const SAVE_URL_LIFETIME_MS = 60_000;

function defaultEnv(): ShareEnv {
  const g = globalThis as unknown as {
    navigator?: ShareEnv["navigator"];
    document?: ShareEnv["document"];
    URL?: ShareEnv["URL"];
  };
  return {
    navigator: g.navigator,
    document: g.document,
    URL: g.URL,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    log: (message) => console.warn(message),
  };
}

function errorName(error: unknown): string {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return typeof name === "string" && /^[A-Za-z]{1,64}$/.test(name) ? name : "Error";
}

/** How long a first refusal is remembered. A second refusal of the same clip in this time means a block. */
export const REFUSAL_MEMORY_MS = 5 * 60 * 1000;

/**
 * Clips that got NotAllowedError once, by stable facts of the file (name,
 * size, type, lastModified), with the time. The library makes a new File
 * object at each file() call (the same bytes under the plan 12 name), so the
 * key must never be the File object itself.
 */
const refusedOnce = new Map<string, number>();

function refusalKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.type}\u0000${file.lastModified}`;
}

function refusedRecently(file: File, nowMs: number): boolean {
  for (const [key, at] of refusedOnce) if (nowMs - at >= REFUSAL_MEMORY_MS || nowMs < at) refusedOnce.delete(key);
  return refusedOnce.has(refusalKey(file));
}

/** Forgets every refusal (tests). */
export function resetShareRefusalsForTests(): void {
  refusedOnce.clear();
}

/**
 * Opens the share sheet for one file. Call it synchronously inside the tap:
 * navigator.share runs before this function returns.
 */
export function shareFile(file: File, env: ShareEnv = defaultEnv()): Promise<ShareOutcome> {
  const nav = env.navigator;
  const log = env.log ?? (() => undefined);
  if (!nav || typeof nav.share !== "function") {
    log("[clips] share: the browser has no share sheet");
    return Promise.resolve({ kind: "unsupported" });
  }
  const data: ShareData = { files: [file] };
  try {
    if (typeof nav.canShare === "function" && !nav.canShare(data)) {
      log("[clips] share: the browser cannot share this file type");
      return Promise.resolve({ kind: "fallback-save" });
    }
  } catch (error) {
    log(`[clips] share: canShare failed (${errorName(error)})`);
    return Promise.resolve({ kind: "fallback-save" });
  }
  const now = env.now ?? (() => Date.now());
  let started: Promise<void>;
  try {
    started = nav.share(data);
  } catch (error) {
    return Promise.resolve(outcomeFor(file, error, log, now));
  }
  return Promise.resolve(started).then(
    (): ShareOutcome => {
      refusedOnce.delete(refusalKey(file));
      return { kind: "shared" };
    },
    (error: unknown) => outcomeFor(file, error, log, now),
  );
}

function outcomeFor(file: File, error: unknown, log: (message: string) => void, now: () => number): ShareOutcome {
  const name = errorName(error);
  switch (name) {
    case "AbortError":
      return { kind: "cancelled" };
    case "InvalidStateError":
      return { kind: "ignored" };
    case "NotAllowedError": {
      const at = now();
      if (refusedRecently(file, at)) {
        log("[clips] share: refused twice (a block or a policy)");
        return { kind: "blocked" };
      }
      refusedOnce.set(refusalKey(file), at);
      log("[clips] share: refused (no user activation)");
      return { kind: "retry" };
    }
    default:
      log(`[clips] share: failed (${name})`);
      return { kind: "fallback-save" };
  }
}

/** Saves one file with an <a download> (Save to phone, Save to computer). */
export function saveFile(file: File, env: ShareEnv = defaultEnv()): Promise<SaveOutcome> {
  const log = env.log ?? (() => undefined);
  const doc = env.document;
  const urls = env.URL;
  if (!doc?.body || !urls) {
    log("[clips] save: no document");
    return Promise.resolve({ kind: "failed", reason: "unknown" });
  }
  let url: string | null = null;
  try {
    url = urls.createObjectURL(file);
    const link = doc.createElement("a");
    link.href = url;
    link.download = file.name;
    link.rel = "noopener";
    link.style.display = "none";
    doc.body.appendChild(link);
    link.click();
    link.remove();
    const made = url;
    (env.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)))(() => urls.revokeObjectURL(made), SAVE_URL_LIFETIME_MS);
    return Promise.resolve({ kind: "saved" });
  } catch (error) {
    if (url) {
      try {
        urls.revokeObjectURL(url);
      } catch {
        // Already gone.
      }
    }
    const name = errorName(error);
    log(`[clips] save: failed (${name})`);
    return Promise.resolve({ kind: "failed", reason: name === "SecurityError" || name === "NotAllowedError" ? "blocked" : "unknown" });
  }
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** <host-slug>-<game>-<yyyymmdd-hhmm>.<ext>, in local time. */
export function fileNameFor(record: Pick<ClipRecord, "gameId" | "createdAt" | "mime">, host: string): string {
  const hostSlug = slug(host.replace(/^www\./i, "")) || "clip";
  const game = slug(record.gameId) || "game";
  const date = new Date(record.createdAt);
  const stamp = Number.isNaN(date.getTime())
    ? "clip"
    : `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${hostSlug}-${game}-${stamp}.${extensionFor(record.mime)}`;
}

/** The same file under the plan 12 name (no copy: a File wraps the same bytes). */
export function renameFile(file: File, record: Pick<ClipRecord, "gameId" | "createdAt" | "mime">, host: string): File {
  return new File([file], fileNameFor(record, host), { type: file.type || record.mime, lastModified: record.createdAt });
}
