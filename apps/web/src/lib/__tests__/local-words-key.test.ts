import { afterEach, describe, expect, it } from "vitest";

import { GUEST_OWNER_KEY, ownerKeyFor } from "@/shared/clips/library/ownerKey";
import { LOCAL_WORDS_PREFIX, forgetLocalWords, localWordsKey } from "../local-words-key";

/**
 * The key of a player's local word store (design/LOCAL_WORDS.html), and
 * the delete that "Delete this account" runs on this device.
 */

afterEach(() => {
  localStorage.clear();
});

describe("localWordsKey", () => {
  it("is hh-words:v1: and the owner key, so the raw user id never reaches storage", async () => {
    const key = localWordsKey(await ownerKeyFor("4b0e3c8e-6a52-4f39-9a51-0d1c2f3e4a5b"));
    expect(key).toMatch(/^hh-words:v1:u_[0-9a-f]{20}$/);
    expect(key).not.toContain("4b0e3c8e");
    expect(localWordsKey(GUEST_OWNER_KEY)).toBe(`${LOCAL_WORDS_PREFIX}guest`);
  });
});

describe("forgetLocalWords", () => {
  it("deletes only this account's word store", async () => {
    const mine = localWordsKey(await ownerKeyFor("user-1"));
    const other = localWordsKey(await ownerKeyFor("user-2"));
    const guest = localWordsKey(GUEST_OWNER_KEY);
    for (const key of [mine, other, guest]) localStorage.setItem(key, "{}");

    await forgetLocalWords("user-1");

    expect(localStorage.getItem(mine)).toBeNull();
    expect(localStorage.getItem(other)).toBe("{}");
    expect(localStorage.getItem(guest)).toBe("{}");
  });

  it("is fine when the account has no word store on this device", async () => {
    await expect(forgetLocalWords("user-1")).resolves.toBeUndefined();
  });

  it("never deletes the guest's words for an empty user id", async () => {
    const guest = localWordsKey(GUEST_OWNER_KEY);
    localStorage.setItem(guest, "{}");
    await forgetLocalWords("");
    expect(localStorage.getItem(guest)).toBe("{}");
  });
});
