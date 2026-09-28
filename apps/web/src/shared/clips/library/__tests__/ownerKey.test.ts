// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GUEST_OWNER_KEY, OWNER_KEY_SALT, isClipId, isOwnerKey, ownerKeyFor, sha256 } from "../ownerKey";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("sha256 (plain-script fallback)", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ])("matches the FIPS 180-4 test vector for %j", (message, digest) => {
    expect(hex(sha256(new TextEncoder().encode(message)))).toBe(digest);
  });

  it("matches Node's SHA-256 at every length around the block edges", () => {
    for (let length = 0; length <= 200; length++) {
      const message = new Uint8Array(length).map((_, i) => (i * 13 + length) & 0xff);
      expect(hex(sha256(message))).toBe(createHash("sha256").update(message).digest("hex"));
    }
  });

  it("matches Node's SHA-256 for a million bytes", () => {
    const message = new Uint8Array(1_000_000).fill(0x61);
    expect(hex(sha256(message))).toBe(createHash("sha256").update(message).digest("hex"));
  });
});

describe("ownerKeyFor", () => {
  it("gives 'guest' for no user", async () => {
    expect(await ownerKeyFor(null)).toBe(GUEST_OWNER_KEY);
    expect(await ownerKeyFor(undefined)).toBe(GUEST_OWNER_KEY);
    expect(await ownerKeyFor("")).toBe(GUEST_OWNER_KEY);
  });

  it("is u_ plus the first 20 hex characters of SHA-256('hh-clips:v1:' + id)", async () => {
    const expected = createHash("sha256").update(`${OWNER_KEY_SALT}user-42`).digest("hex").slice(0, 20);
    expect(await ownerKeyFor("user-42")).toBe(`u_${expected}`);
  });

  it("gives the same key with crypto.subtle and with the fallback", async () => {
    for (const id of ["1", "user-42", "clxyz0000abcd", "émoji-🙂"]) {
      const withSubtle = await ownerKeyFor(id);
      const withFallback = await ownerKeyFor(id, null);
      expect(withFallback).toBe(withSubtle);
      expect(isOwnerKey(withSubtle)).toBe(true);
    }
  });

  it("uses the fallback when crypto.subtle rejects", async () => {
    const failing = { digest: async () => Promise.reject(new Error("not allowed")) };
    expect(await ownerKeyFor("user-42", failing)).toBe(await ownerKeyFor("user-42", null));
  });

  it("never contains the raw user id", async () => {
    const key = await ownerKeyFor("hank");
    expect(key).not.toContain("hank");
  });

  it("gives different keys to different users", async () => {
    expect(await ownerKeyFor("a")).not.toBe(await ownerKeyFor("b"));
  });
});

describe("isOwnerKey and isClipId", () => {
  it("accepts only guest and u_ + 20 lowercase hex characters", () => {
    expect(isOwnerKey("guest")).toBe(true);
    expect(isOwnerKey("u_0123456789abcdef0123")).toBe(true);
    for (const bad of ["", "Guest", "u_0123456789ABCDEF0123", "u_0123", "u_0123456789abcdef01234", "../lib", "u_0123456789abcdef012/", 5, null]) {
      expect(isOwnerKey(bad)).toBe(false);
    }
  });

  it("accepts ids that are safe as file names", () => {
    expect(isClipId("a")).toBe(true);
    expect(isClipId("clip_2026-09-28_abcDEF")).toBe(true);
    expect(isClipId("x".repeat(64))).toBe(true);
    for (const bad of ["", "x".repeat(65), "../x", "a/b", "a.mp4", "a b", ".", undefined]) {
      expect(isClipId(bad)).toBe(false);
    }
  });
});
