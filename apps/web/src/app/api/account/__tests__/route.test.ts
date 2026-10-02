// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DELETE /api/account: a grown-up deletes the account (COPPA 312.6(a)(2),
 * design/ACCOUNTS_COPPA.md). The request must carry the gamer name, typed
 * by the grown-up, or nothing is deleted. The cascade itself is checked on
 * a real database in coppa-purge-migration.test.ts.
 */

const authMock = vi.hoisted(() => vi.fn());
const deletion = vi.hoisted(() => ({ deleteAccount: vi.fn() }));
const profile = vi.hoisted(() => ({ sessionGamerName: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@hank-neil/db", () => ({ db: { marker: "db" } }));
vi.mock("@/lib/account-deletion", () => deletion);
vi.mock("@/lib/gaming-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gaming-profile")>()),
  sessionGamerName: profile.sessionGamerName,
}));

import { DELETE } from "../route";

const request = (body?: unknown) =>
  new Request("http://localhost/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1", handle: "TurboFox42" }, expires: "x" });
  deletion.deleteAccount.mockReset().mockResolvedValue(true);
  profile.sessionGamerName.mockReset().mockResolvedValue("TurboFox42");
});

describe("DELETE /api/account", () => {
  it("deletes the signed-in account when the gamer name is typed", async () => {
    const res = await DELETE(request({ confirm: "TurboFox42" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(deletion.deleteAccount).toHaveBeenCalledWith({ marker: "db" }, "u1");
  });

  it("ends the session cookie in the same answer, so the delete does not depend on the browser's sign-out", async () => {
    const req = new Request("http://localhost/api/account", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        cookie: "__Secure-authjs.session-token.0=a; __Secure-authjs.session-token.1=b; theme=dark",
      },
      body: JSON.stringify({ confirm: "TurboFox42" }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie();
    for (const name of [
      "authjs.session-token",
      "__Secure-authjs.session-token",
      "__Secure-authjs.session-token.0",
      "__Secure-authjs.session-token.1",
    ]) {
      const line = setCookies.find((c) => c.startsWith(`${name}=;`));
      expect(line, name).toBeDefined();
      expect(line).toMatch(/Max-Age=0/i);
      expect(line).toMatch(/Path=\//i);
      if (name.startsWith("__Secure-")) expect(line).toMatch(/Secure/i);
    }
    expect(setCookies.some((c) => c.startsWith("theme="))).toBe(false);
  });

  it("does not end the session when nothing was deleted", async () => {
    const res = await DELETE(request({ confirm: "wrong" }));
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("accepts the name with other capital letters and spaces at the ends", async () => {
    expect((await DELETE(request({ confirm: "  turbofox42 " }))).status).toBe(200);
  });

  it("deletes nothing without the correct gamer name", async () => {
    for (const body of [undefined, {}, { confirm: "" }, { confirm: "TurboFox4" }, { confirm: 42 }]) {
      const res = await DELETE(request(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(deletion.deleteAccount).not.toHaveBeenCalled();
  });

  it("needs a signed-in player", async () => {
    authMock.mockResolvedValue(null);
    expect((await DELETE(request({ confirm: "TurboFox42" }))).status).toBe(401);
    expect(deletion.deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes only the account of the session, never one named in the request", async () => {
    await DELETE(request({ confirm: "TurboFox42", userId: "someone-else" }));
    expect(deletion.deleteAccount).toHaveBeenCalledWith(expect.anything(), "u1");
  });

  it("answers 500 with no values in the log when the database fails", async () => {
    deletion.deleteAccount.mockRejectedValue(Object.assign(new Error("Failed query ... params: u1"), { cause: { code: "57P01" } }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await DELETE(request({ confirm: "TurboFox42" }));
    expect(res.status).toBe(500);
    expect(errors).toHaveBeenCalledWith("DELETE /api/account failed", { code: "57P01" });
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/u1/);
    errors.mockRestore();
  });
});
