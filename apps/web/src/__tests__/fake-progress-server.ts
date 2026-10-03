/**
 * A fake /api/progress for sync tests: one row per user and app, with the
 * REAL validateProgress and resolveMergedSave of the route
 * (app/api/progress/[appId]/route.ts). Install it with
 * vi.stubGlobal("fetch", server.fetch).
 */
import { createHash } from "node:crypto";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { validateProgress } from "@/lib/progress-schemas";
import { resolveMergedSave } from "@/lib/progress-merge";

type Session = { current: { data: null | { user: { id: string } } } };

export type FakeProgressServer = ReturnType<typeof createProgressServer>;

export function createProgressServer(session: Session) {
  const rows = new Map<string, { data: AppProgressData; updatedAt: Date }>();
  const rejected: string[] = [];
  const posts: Array<{ appId: string; merge: boolean; data: AppProgressData }> = [];
  let gets = 0;
  const revision = (key: string) => {
    const row = rows.get(key);
    return row ? createHash("sha256").update(JSON.stringify([key, row.updatedAt.toISOString(), row.data])).digest("hex") : null;
  };
  /** Delays and failures of the network. */
  const net = { getDelayMs: 0, failGets: 0, postStatus: 0, postDelayMs: 0, losePostResponses: 0 };

  const respond = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, json: () => Promise.resolve(body) }) as Response;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetch(url: string, init?: RequestInit): Promise<Response> {
    const appId = url.split("/").pop() as ValidAppId;
    const userId = session.current.data?.user.id;
    if (!userId) return respond({ error: "Unauthorized" }, 401);
    const key = `${userId}:${appId}`;
    if (!init?.method || init.method === "GET") {
      gets += 1;
      if (net.getDelayMs) await sleep(net.getDelayMs);
      if (net.failGets > 0) {
        net.failGets -= 1;
        return respond({ error: "down" }, 500);
      }
      const row = rows.get(key);
      return respond(
        row
          ? { data: JSON.parse(JSON.stringify(row.data)), lastSyncedAt: row.updatedAt.toISOString(), protocol: 1, revision: revision(key) }
          : { data: null, lastSyncedAt: null, protocol: 1, revision: null }
      );
    }
    const body = JSON.parse(init.body as string) as { data: AppProgressData; merge?: boolean; baseRevision?: string | null; expectedOwnerId?: string };
    const { data, merge } = body;
    const conditional = Object.hasOwn(body, "baseRevision");
    posts.push({ appId, merge: !!merge, data });
    if (net.postStatus) return respond({ error: "down" }, net.postStatus);
    const valid = validateProgress(appId, data);
    if (!valid.success) {
      rejected.push(`${appId}: ${valid.error}`);
      return respond({ error: valid.error }, 400);
    }
    if (net.postDelayMs) await sleep(net.postDelayMs);
    if (conditional && body.expectedOwnerId !== userId) return respond({ error: "Account changed", code: "owner_changed" }, 409);
    if (conditional && body.baseRevision !== revision(key)) {
      return respond({ code: "revision_conflict", protocol: 1, data: rows.get(key)?.data ?? null, revision: revision(key) }, 409);
    }
    let final = valid.data as AppProgressData;
    const existing = rows.get(key);
    if ((merge || conditional) && existing) {
      const merged = resolveMergedSave(final, existing, appId, (value) => validateProgress(appId, value), { continuation: conditional });
      if (merged.kind === "keepExisting") return respond({ error: merged.error, kept: "existing" }, 409);
      final = merged.data;
    }
    const now = new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1));
    rows.set(key, { data: JSON.parse(JSON.stringify(final)), updatedAt: now });
    if (net.losePostResponses > 0) { net.losePostResponses -= 1; throw new Error("Response lost after commit"); }
    return respond({ success: true, updatedAt: now.toISOString(),
      ...(conditional ? { protocol: 1, data: final, revision: revision(key) } : {}) });
  }

  /**
   * The beacon of the unload and unmount flush, into the same rows. jsdom's
   * Blob cannot be read back, so install() swaps in one that keeps its text.
   */
  function beacon(url: string, body: Blob) {
    const text = (body as Blob & { __text?: string }).__text;
    if (typeof text === "string") void fetch(url, { method: "POST", body: text });
    return true;
  }

  /** Stubs fetch, Blob and navigator.sendBeacon (call vi.unstubAllGlobals() after). */
  function install(stub: (name: string, value: unknown) => void) {
    const RealBlob = globalThis.Blob;
    class TextBlob extends RealBlob {
      readonly __text: string;
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        this.__text = parts.map(String).join("");
      }
    }
    stub("Blob", TextBlob);
    stub("fetch", fetch);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });
  }

  return {
    rows,
    rejected,
    posts,
    net,
    get gets() {
      return gets;
    },
    fetch,
    beacon,
    install,
    row: (appId: string, user = "user-1") => rows.get(`${user}:${appId}`)?.data,
    reset() {
      rows.clear();
      rejected.length = 0;
      posts.length = 0;
      gets = 0;
      net.getDelayMs = 0;
      net.failGets = 0;
      net.postStatus = 0;
      net.postDelayMs = 0;
      net.losePostResponses = 0;
    },
  };
}
