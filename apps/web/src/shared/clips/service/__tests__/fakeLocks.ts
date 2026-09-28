/**
 * A Web Locks double for the clip service tests: one origin-wide lock manager,
 * seen by several "tabs" (clients).
 *
 * It follows the spec where the service depends on it:
 * - exclusive locks, granted in request order;
 * - ifAvailable calls back with null when the lock is held;
 * - steal takes the lock at once, and the old holder's request rejects with
 *   AbortError (its callback promise is not waited for);
 * - an aborted signal on a pending request rejects it with AbortError;
 * - the lock is released when the callback's promise settles;
 * - query() lists held and pending locks with their client ids;
 * - crash(clientId) drops every lock of a client, the way the browser does
 *   when a tab dies (no callback settles).
 */
import type { WebLockOptions, WebLocksLike } from "../webLocks";

interface Holder {
  clientId: string;
  reject: (error: unknown) => void;
  id: number;
}

interface Waiter {
  clientId: string;
  run: () => void;
  reject: (error: unknown) => void;
  id: number;
}

function abortError(): Error {
  return new DOMException("The lock request was aborted.", "AbortError");
}

export class FakeLockManager {
  private readonly held = new Map<string, Holder>();
  private readonly queues = new Map<string, Waiter[]>();
  private nextId = 1;

  /** The navigator.locks of one tab. */
  client(clientId: string): WebLocksLike {
    return {
      request: <T>(name: string, options: WebLockOptions, callback: (lock: { name: string } | null) => Promise<T> | T) =>
        this.request(clientId, name, options, callback),
      query: async () => ({
        held: [...this.held.entries()].map(([name, h]) => ({ name, clientId: h.clientId, mode: "exclusive" })),
        pending: [...this.queues.entries()].flatMap(([name, q]) => q.map((w) => ({ name, clientId: w.clientId, mode: "exclusive" }))),
      }),
    };
  }

  holderOf(name: string): string | null {
    return this.held.get(name)?.clientId ?? null;
  }

  /** A tab died: its locks go away, and nothing of it runs again. */
  crash(clientId: string): void {
    for (const [name, holder] of [...this.held.entries()]) {
      if (holder.clientId === clientId) {
        this.held.delete(name);
        this.grantNext(name);
      }
    }
    for (const [name, queue] of this.queues) {
      this.queues.set(
        name,
        queue.filter((w) => w.clientId !== clientId),
      );
    }
  }

  private request<T>(
    clientId: string,
    name: string,
    options: WebLockOptions,
    callback: (lock: { name: string } | null) => Promise<T> | T,
  ): Promise<T> {
    if ((options.signal && (options.steal || options.ifAvailable)) || (options.steal && options.ifAvailable)) {
      return Promise.reject(new DOMException("bad options", "NotSupportedError"));
    }
    if (options.signal?.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const grant = () => {
        let settled = false;
        this.held.set(name, {
          clientId,
          id,
          reject: (error) => {
            if (settled) return;
            settled = true;
            reject(error);
          },
        });
        Promise.resolve()
          .then(() => callback({ name }))
          .then(
            (value) => {
              if (this.held.get(name)?.id === id) {
                this.held.delete(name);
                this.grantNext(name);
              }
              if (!settled) {
                settled = true;
                resolve(value);
              }
            },
            (error) => {
              if (this.held.get(name)?.id === id) {
                this.held.delete(name);
                this.grantNext(name);
              }
              if (!settled) {
                settled = true;
                reject(error);
              }
            },
          );
      };
      const current = this.held.get(name);
      if (!current) {
        grant();
        return;
      }
      if (options.steal) {
        this.held.delete(name);
        current.reject(abortError());
        grant();
        return;
      }
      if (options.ifAvailable) {
        Promise.resolve()
          .then(() => callback(null))
          .then(resolve, reject);
        return;
      }
      const waiter: Waiter = { clientId, id, run: grant, reject };
      const queue = this.queues.get(name) ?? [];
      queue.push(waiter);
      this.queues.set(name, queue);
      options.signal?.addEventListener("abort", () => {
        const q = this.queues.get(name) ?? [];
        const index = q.indexOf(waiter);
        if (index >= 0) {
          q.splice(index, 1);
          reject(abortError());
        }
      });
    });
  }

  private grantNext(name: string): void {
    const queue = this.queues.get(name);
    const next = queue?.shift();
    if (next) next.run();
  }
}

/** Lets pending lock callbacks and their promise chains run. */
export async function settleLocks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
