import type { ValidAppId } from "@hank-neil/db/schema";

export type ProgressWrite<T> = { data: T; merge: true; baseRevision: string | null; expectedOwnerId: string; resolution?: true };
export type ProgressResponse = { status: number; body: unknown };
export type ProgressTransport<T> = {
  read: () => Promise<ProgressResponse>;
  write: (body: ProgressWrite<T>) => Promise<ProgressResponse>;
  beacon?: (payload: string) => boolean;
};

/** Parsing failure keeps the HTTP status, but can never become an acknowledgement. */
async function response(result: Response): Promise<ProgressResponse> {
  let body: unknown = null;
  try { body = await result.json(); } catch { /* The runtime retains an uncertain operation. */ }
  return { status: result.status, body };
}

export function progressSyncTransport<T>(appId: ValidAppId, ownerId: string): ProgressTransport<T> {
  const url = `/api/progress/${appId}`;
  return {
    read: async () => response(await fetch(url, { cache: "no-store", headers: { "x-hh-expected-owner": ownerId } })),
    write: async body => response(await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) })),
    ...(typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
      ? { beacon: (payload: string) => navigator.sendBeacon(url, new Blob([payload], { type: "application/json" })) } : {}),
  };
}
