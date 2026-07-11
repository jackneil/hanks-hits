import { describe, it, expect } from "vitest";
import { safeRedirectTarget } from "../rom-redirect";

describe("safeRedirectTarget", () => {
  it("accepts a signed storage.railway.app https URL", () => {
    const signed =
      "https://storage.railway.app/neat-cage-cj2o8a33o4slu2y/snes/donkey_kong_1_country.smc?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc";
    expect(safeRedirectTarget(signed)).toBe(signed);
  });

  it("rejects http (downgrade)", () => {
    expect(
      safeRedirectTarget("http://storage.railway.app/bucket/rom.smc")
    ).toBeNull();
  });

  it("rejects other hosts", () => {
    expect(safeRedirectTarget("https://evil.example.com/rom.smc")).toBeNull();
    expect(
      safeRedirectTarget("https://storage.railway.app.evil.com/rom.smc")
    ).toBeNull();
  });

  it("rejects subdomain-prefix lookalikes", () => {
    expect(
      safeRedirectTarget("https://fake-storage.railway.app/rom.smc")
    ).toBeNull();
  });

  it("rejects relative and malformed locations", () => {
    expect(safeRedirectTarget("/roms/snes/x.smc")).toBeNull();
    expect(safeRedirectTarget("//storage.railway.app/rom.smc")).toBeNull();
    expect(safeRedirectTarget("not a url")).toBeNull();
    expect(safeRedirectTarget("")).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(safeRedirectTarget("javascript:alert(1)")).toBeNull();
    expect(safeRedirectTarget("file:///etc/passwd")).toBeNull();
    expect(safeRedirectTarget("ftp://storage.railway.app/rom.smc")).toBeNull();
  });

  it("rejects credentials-in-URL tricks aimed at the allowlisted host", () => {
    expect(
      safeRedirectTarget("https://storage.railway.app@evil.com/rom.smc")
    ).toBeNull();
  });
});
