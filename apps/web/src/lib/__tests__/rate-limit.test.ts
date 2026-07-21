import { describe, expect, it } from "vitest";
import {
  checkProgressDeleteRateLimit,
  checkProgressRateLimit,
  checkRomProxyRateLimit,
} from "../rate-limit";

describe("progress rate limiters", () => {
  it("limits progress deletes to 10 requests per minute", () => {
    const userId = `delete-test-${Date.now()}`;

    for (let i = 0; i < 10; i++) {
      expect(checkProgressDeleteRateLimit(userId).success).toBe(true);
    }

    expect(checkProgressDeleteRateLimit(userId).success).toBe(false);
  });

  it("keeps save and delete buckets separate", () => {
    const userId = `bucket-test-${Date.now()}`;

    for (let i = 0; i < 10; i++) {
      checkProgressDeleteRateLimit(userId);
    }

    expect(checkProgressDeleteRateLimit(userId).success).toBe(false);
    expect(checkProgressRateLimit(userId).success).toBe(true);
  });
});

describe("ROM proxy rate limiter", () => {
  it("allows 120 requests per minute per IP, then blocks", () => {
    const ip = `rom-test-${Date.now()}`;

    for (let i = 0; i < 120; i++) {
      expect(checkRomProxyRateLimit(ip).success).toBe(true);
    }

    const blocked = checkRomProxyRateLimit(ip);
    expect(blocked.success).toBe(false);
    expect(blocked.resetIn).toBeGreaterThan(0);
  });

  it("keys per IP — one client hitting the limit doesn't block another", () => {
    const busy = `rom-busy-${Date.now()}`;
    const other = `rom-other-${Date.now()}`;

    for (let i = 0; i < 120; i++) checkRomProxyRateLimit(busy);

    expect(checkRomProxyRateLimit(busy).success).toBe(false);
    expect(checkRomProxyRateLimit(other).success).toBe(true);
  });
});
