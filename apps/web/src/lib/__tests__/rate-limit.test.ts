import { describe, expect, it, vi } from "vitest";
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

describe("the cleanup of old counters", () => {
  it("keeps a 15-minute sign-in counter when a 1-minute limiter runs the cleanup", async () => {
    // The limiters share one store. The cleanup used the window of the call
    // that ran it, so a progress save (1 minute) deleted the sign-in
    // counters (15 minutes) after 2 minutes, and a locked-out email could
    // guess passwords again.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
      vi.resetModules();
      const limits = await import("../rate-limit");
      const email = "kid@example.com";
      for (let i = 0; i < 10; i++) limits.checkLoginRateLimit(email);
      expect(limits.checkLoginRateLimit(email).success).toBe(false);
      vi.setSystemTime(new Date("2026-10-02T12:06:00.000Z"));
      limits.checkProgressRateLimit("someone-saving"); // runs the cleanup
      expect(limits.checkLoginRateLimit(email).success).toBe(false);
      // An ended window is removed by the cleanup, and the limit starts again.
      vi.setSystemTime(new Date("2026-10-02T12:22:00.000Z"));
      limits.checkProgressRateLimit("someone-saving");
      expect(limits.checkLoginRateLimit(email).success).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.resetModules();
    }
  });

  it("removes only the counters whose own window ended", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
      vi.resetModules();
      const limits = await import("../rate-limit");
      limits.checkLoginRateLimit("kid@example.com"); // 15-minute window
      limits.checkProgressRateLimit("saver"); // 1-minute window
      expect(limits.rateLimitEntryCount()).toBe(2);
      vi.setSystemTime(new Date("2026-10-02T12:06:00.000Z"));
      limits.checkProgressDeleteRateLimit("other"); // runs the cleanup
      // The save counter ended (1 minute), the sign-in counter did not (15 minutes).
      expect(limits.rateLimitEntryCount()).toBe(2); // login + progress-delete
      vi.setSystemTime(new Date("2026-10-02T12:16:00.000Z"));
      limits.checkProgressDeleteRateLimit("third"); // runs the cleanup again
      expect(limits.rateLimitEntryCount()).toBe(1); // only the new counter
    } finally {
      vi.useRealTimers();
      vi.resetModules();
    }
  });
});
