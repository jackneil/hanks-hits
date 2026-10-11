// @vitest-environment node
import { describe, expect, it } from "vitest";
import { issueLiveTicket, verifyLiveTicket } from "../ticket";
import { isNewerRelease } from "../release";
describe("live tickets", () => {
  it("binds a short-lived authenticated or guest identity", () => {
    expect(verifyLiveTicket(issueLiveTicket("owner-a", "secret", 1000), "secret", 1001)?.userId).toBe("owner-a");
    expect(verifyLiveTicket(issueLiveTicket(null, "secret", 1000), "secret", 1001)?.userId).toBeNull();
  });
  it("refuses tampering, other secrets, expired and oversized credentials", () => {
    const token = issueLiveTicket("owner-a", "secret", 1000);
    expect(verifyLiveTicket(token.replace(token[0], token[0] === "a" ? "b" : "a"), "secret", 1001)).toBeNull();
    expect(verifyLiveTicket(token, "other", 1001)).toBeNull();
    expect(verifyLiveTicket(token, "secret", 61_000)).toBeNull();
    expect(verifyLiveTicket("a".repeat(2049), "secret")).toBeNull();
    expect(verifyLiveTicket(token, "", 1001)).toBeNull();
  });
  it("does not prompt a downgrade during overlapping deployments", () => {
    const current = { id: "b", builtAt: 200 };
    expect(isNewerRelease({ id: "a", builtAt: 100 }, current)).toBe(false);
    expect(isNewerRelease({ id: "c", builtAt: 300 }, current)).toBe(true);
    expect(isNewerRelease({ id: "b", builtAt: 300 }, current)).toBe(false);
    expect(isNewerRelease({ id: "c", builtAt: "300" }, current)).toBe(false);
  });
});
