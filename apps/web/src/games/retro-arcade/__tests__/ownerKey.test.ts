import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { GUEST_OWNER, isOwnerKey, OWNER_SALT, ownerKeyFor, sha256 } from "../lib/ownerKey";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("save owner key", () => {
  it.each([null, undefined, ""])("is guest for the user id %j", async (id) => {
    expect(await ownerKeyFor(id)).toBe(GUEST_OWNER);
  });

  it("is u_ plus the first 20 hex characters of SHA-256(salt + user id)", async () => {
    const expected = createHash("sha256").update(OWNER_SALT + "user-42").digest("hex").slice(0, 20);
    expect(await ownerKeyFor("user-42")).toBe(`u_${expected}`);
  });

  it("gives two users two different keys and one user the same key each time", async () => {
    const a = await ownerKeyFor("11111111-1111-1111-1111-111111111111");
    const b = await ownerKeyFor("22222222-2222-2222-2222-222222222222");
    expect(a).not.toBe(b);
    expect(await ownerKeyFor("11111111-1111-1111-1111-111111111111")).toBe(a);
  });

  it("never contains the user id", async () => {
    const key = await ownerKeyFor("hank");
    expect(key).not.toContain("hank");
    expect(isOwnerKey(key)).toBe(true);
  });

  it("gives the same key without crypto.subtle (a phone on plain http)", async () => {
    const withSubtle = await ownerKeyFor("user-42");
    expect(await ownerKeyFor("user-42", null)).toBe(withSubtle);
    const broken = { digest: () => Promise.reject(new Error("not allowed")) };
    expect(await ownerKeyFor("user-42", broken)).toBe(withSubtle);
  });

  it.each(["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "é🎮".repeat(40)])(
    "plain-script SHA-256 matches node crypto for %j",
    (text) => {
      const data = new TextEncoder().encode(text);
      expect(hex(sha256(data))).toBe(createHash("sha256").update(data).digest("hex"));
    }
  );

  it("accepts only guest and u_ + 20 lowercase hex characters", () => {
    expect(isOwnerKey("guest")).toBe(true);
    expect(isOwnerKey("u_0123456789abcdef0123")).toBe(true);
    for (const bad of ["", "Guest", "u_0123456789ABCDEF0123", "u_0123", "u_0123456789abcdef01234", "../x", 5, null]) {
      expect(isOwnerKey(bad)).toBe(false);
    }
  });
});
