// @vitest-environment node
/**
 * PATCH /api/gaming-profile reads its JSON body with the small limits
 * (64 KiB and no time limit: SMALL_SAVE_BODY in src/lib/read-body.ts):
 * request.json() held a body of any size. A save of a signed-in player is
 * not refused because a phone line paused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "user-1" as string | null }));
const store = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null),
}));
vi.mock("@hank-neil/db", () => ({
  db: {
    query: { gamingProfiles: { findFirst: async () => ({ id: "profile-1", handle: "SpeedyTruck42" }) } },
    update: () => ({ set: (values: unknown) => (store.set(values), { where: async () => undefined }) }),
  },
  eq: vi.fn(),
}));
vi.mock("@hank-neil/db/schema", () => ({ gamingProfiles: { id: "id", userId: "userId" } }));

import { PATCH } from "../route";

function patch(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/gaming-profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit);
}

function endless() {
  const seen = { pulled: 0 };
  const chunk = new Uint8Array(16 * 1024).fill(0x20);
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 }
  );
  return { body, seen };
}

/** A body that sends its first half, pauses for pauseMs (a phone in a tunnel), then sends the rest. */
function pausing(text: string, pauseMs: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const half = Math.floor(bytes.length / 2);
  let step = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        step++;
        if (step === 1) controller.enqueue(bytes.slice(0, half));
        else if (step === 2) {
          await new Promise((resolve) => setTimeout(resolve, pauseMs));
          controller.enqueue(bytes.slice(half));
        } else controller.close();
      },
    },
    { highWaterMark: 0 }
  );
}

beforeEach(() => {
  session.userId = "user-1";
  store.set.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("PATCH /api/gaming-profile body limit", () => {
  it("saves the leaderboard switch", async () => {
    const res = await PATCH(patch(JSON.stringify({ showOnLeaderboards: false })));
    expect(res.status).toBe(200);
    expect(store.set).toHaveBeenCalledWith(expect.objectContaining({ showOnLeaderboards: false }));
  });

  it("reads a chunked body only up to 64 KiB plus one chunk, then 413", async () => {
    const { body, seen } = endless();
    const res = await PATCH(patch(body));
    expect(res.status).toBe(413);
    expect(seen.pulled).toBe(64 * 1024 + 16 * 1024);
    expect(store.set).not.toHaveBeenCalled();
  });

  it("refuses a declared Content-Length over 64 KiB at once (413)", async () => {
    const { body, seen } = endless();
    const res = await PATCH(patch(body, { "Content-Length": String(64 * 1024 + 1) }));
    expect(res.status).toBe(413);
    expect(seen.pulled).toBe(0);
  });

  it("reads no body for a player who is not signed in (401)", async () => {
    session.userId = null;
    const { body, seen } = endless();
    const res = await PATCH(patch(body));
    expect(res.status).toBe(401);
    expect(seen.pulled).toBe(0);
  });

  it.each([["not json"], [""], ["null"], ["[true]"], ["true"]])("answers the body %j with 400", async (text) => {
    const res = await PATCH(patch(text));
    expect(res.status).toBe(400);
    expect(store.set).not.toHaveBeenCalled();
  });
  it("saves a body that pauses for 35 s in the middle (no time limit on a signed-in save)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = PATCH(patch(pausing(JSON.stringify({ showOnLeaderboards: true }), 35_000)));
      await vi.advanceTimersByTimeAsync(35_000);
      const res = await pending;
      expect(res.status).toBe(200);
      expect(store.set).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes one log line for a refused body: the route, the reason and the counts, no body text and no user id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tooBig = await PATCH(patch(endless().body));
    expect(tooBig.status).toBe(413);
    const bad = await PATCH(patch('{"secret-name":hunter22}'));
    expect(bad.status).toBe(400);
    const lines = warn.mock.calls.map((args) => args.join(" "));
    expect(lines).toEqual([
      "[read-body] PATCH /api/gaming-profile: refused a request body (too_big; declared no bytes, received 81920 bytes)",
      "[read-body] PATCH /api/gaming-profile: refused a request body (bad_json; declared no bytes, received 24 bytes)",
    ]);
    expect(lines.join("\n")).not.toContain("hunter22");
    expect(lines.join("\n")).not.toContain(session.userId!);
  });
});
