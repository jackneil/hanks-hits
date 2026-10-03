/**
 * Limits on the work that this server process does at the same time.
 *
 * A rate limit counts how many requests START. It does not bound how many
 * requests are still reading a body, or how many bytes they hold. The upload gate bounds work in flight:
 * - InFlightGate: at most `limit` places in all, and at most `perKeyLimit`
 *   places for one key (a user id or a network address).
 *
 * It is per process (Railway runs one process). Keep one instance
 * on globalThis with processSingleton(), so that two server bundles that
 * load this module share the same limit.
 */

/** One value for each name in this process, also when two bundles load the module. */
export function processSingleton<T>(name: string, make: () => T): T {
  const key = Symbol.for(`hanks-hits:${name}`);
  const store = globalThis as unknown as Record<symbol, T | undefined>;
  return (store[key] ??= make());
}

/** A count of the requests that run at the same time, in all and for each key. */
export class InFlightGate {
  private running = 0;
  private readonly byKey = new Map<string, number>();

  constructor(
    readonly limit: number,
    readonly perKeyLimit: number = Number.POSITIVE_INFINITY
  ) {}

  /** Take a place, or false when every place (or every place of this key) is taken. */
  tryEnter(key?: string): boolean {
    if (this.running >= this.limit) return false;
    if (key !== undefined && (this.byKey.get(key) ?? 0) >= this.perKeyLimit) return false;
    this.running++;
    if (key !== undefined) this.byKey.set(key, (this.byKey.get(key) ?? 0) + 1);
    return true;
  }

  /** Give back a place that tryEnter gave (with the same key). */
  leave(key?: string): void {
    if (this.running > 0) this.running--;
    if (key === undefined) return;
    const held = this.byKey.get(key) ?? 0;
    // Remove the key at zero, so that the map holds only the keys in flight.
    if (held <= 1) this.byKey.delete(key);
    else this.byKey.set(key, held - 1);
  }

  /** The places in use. */
  get active(): number {
    return this.running;
  }

  /** The places in use by one key. */
  activeFor(key: string): number {
    return this.byKey.get(key) ?? 0;
  }

  /** The number of keys that hold a place. For tests (the map must not grow). */
  get keysInFlight(): number {
    return this.byKey.size;
  }
}
