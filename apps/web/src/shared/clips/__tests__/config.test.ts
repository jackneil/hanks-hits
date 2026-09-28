import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLIPS_CONFIG_PATH,
  CLIPS_DOGFOOD_PATH,
  VERDICT_CACHE_ITEM,
  VERDICT_CACHE_TTL_MS,
  VERDICT_OFF,
  clipsVerdictFor,
  joinClipsDogfood,
  leaveClipsDogfood,
  loadClipsVerdict,
  parseDogfoodIds,
  resetClipsVerdict,
  resolveClipsMode,
  signDogfoodCookie,
  verifyDogfoodCookie,
} from "../config";

const SECRET = "config-test-secret";

describe("resolveClipsMode", () => {
  it("defaults to on outside production and off in production", () => {
    expect(resolveClipsMode(undefined, "development")).toBe("on");
    expect(resolveClipsMode("", "test")).toBe("on");
    expect(resolveClipsMode("  ", undefined)).toBe("on");
    expect(resolveClipsMode(undefined, "production")).toBe("off");
  });

  it("takes a set mode in any case and fails closed on anything else", () => {
    expect(resolveClipsMode("ON", "production")).toBe("on");
    expect(resolveClipsMode(" dogfood ", "production")).toBe("dogfood");
    expect(resolveClipsMode("off", "development")).toBe("off");
    expect(resolveClipsMode("yes", "development")).toBe("off");
    expect(resolveClipsMode("1", "production")).toBe("off");
  });
});

describe("parseDogfoodIds", () => {
  it("splits on commas and white space and drops empty parts", () => {
    expect([...parseDogfoodIds(" a,b  c,,\nd ")]).toEqual(["a", "b", "c", "d"]);
    expect(parseDogfoodIds(undefined).size).toBe(0);
  });
});

describe("signed dogfood cookie", () => {
  const ids = new Set(["user-1", "ünïcode-id"]);

  it("round-trips for a listed user before its expiry", async () => {
    const cookie = await signDogfoodCookie("user-1", SECRET, 2000);
    expect(await verifyDogfoodCookie(cookie, SECRET, ids, 1999)).toBe(true);
    const unicode = await signDogfoodCookie("ünïcode-id", SECRET, 2000);
    expect(await verifyDogfoodCookie(unicode, SECRET, ids, 1000)).toBe(true);
  });

  it("rejects an expired cookie, another secret, an unlisted user and an empty list", async () => {
    const cookie = await signDogfoodCookie("user-1", SECRET, 2000);
    expect(await verifyDogfoodCookie(cookie, SECRET, ids, 2000)).toBe(false);
    expect(await verifyDogfoodCookie(cookie, "other", ids, 1000)).toBe(false);
    expect(await verifyDogfoodCookie(cookie, SECRET, new Set(["user-2"]), 1000)).toBe(false);
    expect(await verifyDogfoodCookie(cookie, SECRET, new Set(), 1000)).toBe(false);
    expect(await verifyDogfoodCookie(cookie, undefined, ids, 1000)).toBe(false);
  });

  it("rejects a cookie whose user id or expiry was changed after signing", async () => {
    const cookie = await signDogfoodCookie("user-1", SECRET, 2000);
    const [v, , exp, sig] = cookie.split(".");
    // A listed id, so only the signature can refuse it.
    const withUser2 = new Set([...ids, "user-2"]);
    const otherId = btoa("user-2").replace(/=+$/, "");
    expect(await verifyDogfoodCookie([v, otherId, exp, sig].join("."), SECRET, withUser2, 1000)).toBe(false);
    expect(await verifyDogfoodCookie(await signDogfoodCookie("user-2", SECRET, 2000), SECRET, withUser2, 1000)).toBe(true);
    const [, id] = cookie.split(".");
    expect(await verifyDogfoodCookie([v, id, "9999999999", sig].join("."), SECRET, ids, 1000)).toBe(false);
  });

  it("rejects malformed values without throwing", async () => {
    for (const bad of ["", "v1", "v1.a.b", "v2.dXNlci0x.2000.AAAA", "v1.dXNlci0x.abc.AAAA", "v1.***.2000.AAAA", "v1.dXNlci0x.2000.AAAA"]) {
      expect(await verifyDogfoodCookie(bad, SECRET, ids, 1000)).toBe(false);
    }
  });

  it("gives the verdict for each mode", async () => {
    const base = { nodeEnv: "production", secret: SECRET, dogfoodIds: "user-1", nowSec: 1000, cookie: undefined };
    expect(await clipsVerdictFor({ ...base, clipsMode: "on" })).toEqual({ mode: "on", capture: true });
    expect(await clipsVerdictFor({ ...base, clipsMode: undefined })).toEqual({ mode: "off", capture: false });
    expect(await clipsVerdictFor({ ...base, clipsMode: "dogfood" })).toEqual({ mode: "dogfood", capture: false });
    const cookie = await signDogfoodCookie("user-1", SECRET, 2000);
    expect(await clipsVerdictFor({ ...base, clipsMode: "dogfood", cookie })).toEqual({ mode: "dogfood", capture: true });
  });
});

describe("loadClipsVerdict", () => {
  beforeEach(() => {
    resetClipsVerdict();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    resetClipsVerdict();
    vi.restoreAllMocks();
  });

  function okFetch(body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  }

  function failingFetch() {
    return vi.fn(async (): Promise<Response> => {
      throw new TypeError("offline");
    });
  }

  /** A new page load: the module (and its memory) starts again; localStorage and sessionStorage stay. */
  async function freshModule() {
    vi.resetModules();
    return import("../config");
  }

  it("asks the route once per page load, no-store, and keeps the answer in memory for that page", async () => {
    const fetchImpl = okFetch({ mode: "on", capture: true });
    expect(await loadClipsVerdict(fetchImpl as unknown as typeof fetch)).toEqual({ mode: "on", capture: true });
    expect(await loadClipsVerdict(fetchImpl as unknown as typeof fetch)).toEqual({ mode: "on", capture: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(CLIPS_CONFIG_PATH, expect.objectContaining({ cache: "no-store" }));
    // Nothing in sessionStorage: a restored tab never reuses an old answer.
    expect(sessionStorage.length).toBe(0);
  });

  it("asks the server again at the next page load, so the kill switch reaches a tab that stays open", async () => {
    const first = await freshModule();
    const on = okFetch({ mode: "on", capture: true });
    expect(await first.loadClipsVerdict(on as unknown as typeof fetch)).toEqual({ mode: "on", capture: true });
    // CLIPS_MODE=off on the server, then a reload (the same localStorage and sessionStorage).
    const second = await freshModule();
    const off = okFetch({ mode: "off", capture: false });
    expect(await second.loadClipsVerdict(off as unknown as typeof fetch)).toEqual({ mode: "off", capture: false });
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("uses the last answer offline for 7 days, and off after that", async () => {
    const t0 = Date.UTC(2026, 8, 1);
    const ok = okFetch({ mode: "dogfood", capture: true });
    expect(await loadClipsVerdict(ok as unknown as typeof fetch, () => t0)).toEqual({ mode: "dogfood", capture: true });
    expect(JSON.parse(localStorage.getItem(VERDICT_CACHE_ITEM)!)).toEqual({ verdict: { mode: "dogfood", capture: true }, atMs: t0 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const offline = await freshModule();
    const failing = failingFetch();
    const f = failing as unknown as typeof fetch;
    expect(await offline.loadClipsVerdict(f, () => t0 + VERDICT_CACHE_TTL_MS - 1)).toEqual({ mode: "dogfood", capture: true });
    // A failed request is not kept: the next call asks again.
    expect(await offline.loadClipsVerdict(f, () => t0 + VERDICT_CACHE_TTL_MS)).toEqual(VERDICT_OFF);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("is off after a failed read with no copy, logs no values, and asks again next time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async () => new Response("secret-body", { status: 500 }));
    expect(await loadClipsVerdict(failing as unknown as typeof fetch)).toEqual(VERDICT_OFF);
    expect(localStorage.getItem(VERDICT_CACHE_ITEM)).toBeNull();
    const fetchImpl = okFetch({ mode: "on", capture: true });
    expect(await loadClipsVerdict(fetchImpl as unknown as typeof fetch)).toEqual({ mode: "on", capture: true });
    for (const call of warn.mock.calls) expect(String(call[0])).not.toContain("secret-body");
  });

  it("refuses a malformed answer, and a malformed or future offline copy", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadClipsVerdict(okFetch({ mode: "sure", capture: "yes" }) as unknown as typeof fetch)).toEqual(VERDICT_OFF);
    const bad = ["{", JSON.stringify({ verdict: { mode: "on", capture: true } }), JSON.stringify({ verdict: { mode: "on", capture: true }, atMs: Date.now() + 60_000 })];
    for (const value of bad) {
      localStorage.setItem(VERDICT_CACHE_ITEM, value);
      resetClipsVerdict();
      expect(await loadClipsVerdict(failingFetch() as unknown as typeof fetch)).toEqual(VERDICT_OFF);
    }
  });
});

describe("dogfood join and leave (client)", () => {
  beforeEach(() => {
    resetClipsVerdict();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins with a same-origin POST, then asks for the verdict again (no stale capture:false)", async () => {
    const verdicts = [
      { mode: "dogfood", capture: false },
      { mode: "dogfood", capture: true },
    ];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === CLIPS_DOGFOOD_PATH) return new Response(JSON.stringify({ dogfood: init?.method === "POST" }), { status: 200 });
      return new Response(JSON.stringify(verdicts.shift()), { status: 200 });
    });
    const f = fetchImpl as unknown as typeof fetch;
    expect(await loadClipsVerdict(f)).toEqual({ mode: "dogfood", capture: false });
    expect(await joinClipsDogfood(f)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(CLIPS_DOGFOOD_PATH, expect.objectContaining({ method: "POST", credentials: "same-origin" }));
    expect(await loadClipsVerdict(f)).toEqual({ mode: "dogfood", capture: true });
  });

  it("keeps the verdict when the route refuses, and leaves with DELETE", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === CLIPS_DOGFOOD_PATH) return new Response("{}", { status: init?.method === "POST" ? 403 : 200 });
      return new Response(JSON.stringify({ mode: "dogfood", capture: false }), { status: 200 });
    });
    const f = fetchImpl as unknown as typeof fetch;
    const verdictCalls = () => fetchImpl.mock.calls.filter(([url]) => url === CLIPS_CONFIG_PATH).length;
    await loadClipsVerdict(f);
    expect(await joinClipsDogfood(f)).toBe(false);
    await loadClipsVerdict(f);
    expect(verdictCalls()).toBe(1);
    expect(await leaveClipsDogfood(f)).toBe(true);
    expect(fetchImpl).toHaveBeenLastCalledWith(CLIPS_DOGFOOD_PATH, expect.objectContaining({ method: "DELETE" }));
    await loadClipsVerdict(f);
    expect(verdictCalls()).toBe(2);
  });
});

