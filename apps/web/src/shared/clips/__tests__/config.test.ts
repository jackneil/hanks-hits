import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLIPS_CONFIG_PATH,
  VERDICT_OFF,
  VERDICT_SESSION_ITEM,
  clipsVerdictFor,
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
    sessionStorage.clear();
  });
  afterEach(() => {
    resetClipsVerdict();
  });

  function okFetch(body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  }

  it("asks the route once, no-store, and keeps the answer for the tab session", async () => {
    const fetchImpl = okFetch({ mode: "on", capture: true });
    expect(await loadClipsVerdict(fetchImpl as unknown as typeof fetch)).toEqual({ mode: "on", capture: true });
    expect(await loadClipsVerdict(fetchImpl as unknown as typeof fetch)).toEqual({ mode: "on", capture: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(CLIPS_CONFIG_PATH, expect.objectContaining({ cache: "no-store" }));
    expect(JSON.parse(sessionStorage.getItem(VERDICT_SESSION_ITEM)!)).toEqual({ mode: "on", capture: true });
  });

  it("reads a verdict this tab stored before, with no request", async () => {
    sessionStorage.setItem(VERDICT_SESSION_ITEM, JSON.stringify({ mode: "dogfood", capture: true }));
    const fetchImpl = okFetch({ mode: "off", capture: false });
    expect(await loadClipsVerdict(fetchImpl as unknown as typeof fetch)).toEqual({ mode: "dogfood", capture: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is off after a failed read, stores nothing, and asks again next time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    expect(await loadClipsVerdict(failing as unknown as typeof fetch)).toEqual(VERDICT_OFF);
    expect(sessionStorage.getItem(VERDICT_SESSION_ITEM)).toBeNull();
    const fetchImpl = okFetch({ mode: "on", capture: true });
    expect(await loadClipsVerdict(fetchImpl as unknown as typeof fetch)).toEqual({ mode: "on", capture: true });
    warn.mockRestore();
  });

  it("refuses a malformed answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = okFetch({ mode: "sure", capture: "yes" });
    expect(await loadClipsVerdict(fetchImpl as unknown as typeof fetch)).toEqual(VERDICT_OFF);
    warn.mockRestore();
  });
});
