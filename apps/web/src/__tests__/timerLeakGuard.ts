/**
 * Timer leak guard for the vitest setup.
 *
 * A component timer that is still pending when a test file ends fires after
 * vitest removes the jsdom window. React then throws "window is not defined"
 * from the timer, vitest reports an unhandled error, and the whole run fails,
 * although every test passed. RTL's cleanup unmounts components but does not
 * clear their timers. Machine load makes the race more likely, because the
 * teardown then overtakes short timers (seen with cookie-clicker's 100 ms
 * squish timeout at a load average of 65).
 *
 * In a browser, a state update after unmount does nothing, so the components
 * are correct. The defect is in the test environment only, and the guard
 * fixes it for every test file: it records each pending setTimeout and
 * setInterval and clears the ones that are still pending when the file ends.
 *
 * Timers made while vi.useFakeTimers() is active never reach the guard,
 * because the fakes replace the globals. vi.useRealTimers() puts the guard
 * back, because the guard is the global that the fakes saw.
 */

type TimerTarget = Pick<typeof globalThis, "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval">;

export interface TimerLeakGuard {
  /** Timers that were made and did not fire or get cleared yet. */
  pendingCount(): number;
  /** Clear every pending timer. Returns how many it cleared. */
  clearPending(): number;
  /** Put the original functions back. */
  uninstall(): void;
}

/** Keep the original's own properties (for example util.promisify.custom) on the wrapper. */
function withOwnProperties<T extends object>(wrapper: T, original: object): T {
  const descriptors = Object.getOwnPropertyDescriptors(original);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor.configurable && key in wrapper) continue;
    try {
      Object.defineProperty(wrapper, key, descriptor);
    } catch {
      // A property that the wrapper cannot take (length, name on some engines) is not needed.
    }
  }
  return wrapper;
}

export function installTimerLeakGuard(target: TimerTarget = globalThis): TimerLeakGuard {
  const native = {
    setTimeout: target.setTimeout,
    clearTimeout: target.clearTimeout,
    setInterval: target.setInterval,
    clearInterval: target.clearInterval,
  };
  const timeouts = new Set<unknown>();
  const intervals = new Set<unknown>();

  const setTimeoutGuarded = function (handler: unknown, delay?: number, ...args: unknown[]) {
    if (typeof handler !== "function") {
      return (native.setTimeout as (...a: unknown[]) => unknown)(handler, delay, ...args);
    }
    const id: unknown = (native.setTimeout as (...a: unknown[]) => unknown)(
      (...callArgs: unknown[]) => {
        timeouts.delete(id);
        (handler as (...a: unknown[]) => unknown)(...callArgs);
      },
      delay,
      ...args,
    );
    timeouts.add(id);
    return id;
  };
  const clearTimeoutGuarded = function (id?: unknown) {
    timeouts.delete(id);
    (native.clearTimeout as (i?: unknown) => void)(id);
  };
  const setIntervalGuarded = function (handler: unknown, delay?: number, ...args: unknown[]) {
    const id = (native.setInterval as (...a: unknown[]) => unknown)(handler, delay, ...args);
    intervals.add(id);
    return id;
  };
  const clearIntervalGuarded = function (id?: unknown) {
    intervals.delete(id);
    (native.clearInterval as (i?: unknown) => void)(id);
  };

  target.setTimeout = withOwnProperties(setTimeoutGuarded, native.setTimeout) as unknown as typeof setTimeout;
  target.clearTimeout = withOwnProperties(clearTimeoutGuarded, native.clearTimeout) as unknown as typeof clearTimeout;
  target.setInterval = withOwnProperties(setIntervalGuarded, native.setInterval) as unknown as typeof setInterval;
  target.clearInterval = withOwnProperties(clearIntervalGuarded, native.clearInterval) as unknown as typeof clearInterval;

  return {
    pendingCount: () => timeouts.size + intervals.size,
    clearPending: () => {
      const count = timeouts.size + intervals.size;
      for (const id of timeouts) (native.clearTimeout as (i?: unknown) => void)(id);
      for (const id of intervals) (native.clearInterval as (i?: unknown) => void)(id);
      timeouts.clear();
      intervals.clear();
      return count;
    },
    uninstall: () => {
      Object.assign(target, native);
    },
  };
}
