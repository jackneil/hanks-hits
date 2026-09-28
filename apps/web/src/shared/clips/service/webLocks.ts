/**
 * The part of the Web Locks API (navigator.locks) that the clip service uses.
 * A real LockManager fits it. Nothing here touches navigator at import time.
 */

export interface WebLockOptions {
  mode?: "exclusive" | "shared";
  /** Grant the lock only when it is free now; else call back with null. */
  ifAvailable?: boolean;
  /** Take the lock from its holder now. The holder's request rejects with AbortError. */
  steal?: boolean;
  signal?: AbortSignal;
}

export interface WebLockInfo {
  name?: string;
  mode?: string;
  clientId?: string;
}

export interface WebLocksLike {
  request<T>(name: string, options: WebLockOptions, callback: (lock: { name: string } | null) => Promise<T> | T): Promise<T>;
  query(): Promise<{ held?: WebLockInfo[]; pending?: WebLockInfo[] }>;
}

/** navigator.locks, or null where the browser has none. */
export function browserLocks(): WebLocksLike | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: WebLocksLike }).locks;
  return locks && typeof locks.request === "function" && typeof locks.query === "function" ? locks : null;
}

export type LockLoss = "released" | "stolen" | "failed" | "not-granted";

/** A lock that this page holds until it releases it (or loses it). */
export interface LockHold {
  /** True when the lock was granted; false when it was not (ifAvailable, abort, failure). */
  readonly granted: Promise<boolean>;
  /** Settles when the lock is no longer held, with the reason. */
  readonly lost: Promise<LockLoss>;
  /** Let go of the lock (or of the pending request). Safe to call more than once. */
  release(): void;
}

/**
 * Requests `name` and holds it until release(). A steal by another page ends
 * the hold with "stolen". Rules of the Web Locks spec: a signal is allowed only
 * without steal and ifAvailable, so a pending plain request is aborted with a
 * signal, and a steal or ifAvailable request is never pending.
 */
export function holdLock(locks: WebLocksLike, name: string, options: Omit<WebLockOptions, "signal"> = {}): LockHold {
  let grant: (value: boolean) => void = () => undefined;
  const granted = new Promise<boolean>((resolve) => {
    grant = resolve;
  });
  // A holder object: TypeScript does not see assignments made inside the callback.
  const hold: { letGo: (() => void) | null; releasing: boolean } = { letGo: null, releasing: false };
  const plain = !options.steal && !options.ifAvailable;
  const abort = plain && typeof AbortController === "function" ? new AbortController() : null;
  let lost: Promise<LockLoss>;
  try {
    lost = locks
      .request(name, abort ? { ...options, signal: abort.signal } : options, (lock) => {
        if (!lock) {
          grant(false);
          return "not-granted" as const;
        }
        grant(true);
        if (hold.releasing) return "released" as const;
        return new Promise<"released">((resolve) => {
          hold.letGo = () => resolve("released");
        });
      })
      .then(
        (result): LockLoss => result,
        (error: unknown): LockLoss => {
          if (hold.releasing) return "released";
          return (error as { name?: string } | null)?.name === "AbortError" ? "stolen" : "failed";
        },
      );
  } catch {
    lost = Promise.resolve("failed");
  }
  lost = lost.finally(() => grant(false));
  return {
    granted,
    lost,
    release() {
      if (hold.releasing) return;
      hold.releasing = true;
      if (hold.letGo) hold.letGo();
      else abort?.abort();
    },
  };
}

/** A random id for lock names and ids. crypto.randomUUID when it exists. */
export function randomId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "");
  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
