import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkLoginRateLimit,
  checkNameChangeRateLimit,
  checkProgressRateLimit,
  rateLimitEntryCount,
} from "../rate-limit";

/**
 * The limiters share one in-memory store but use different windows. The
 * cleanup must remove an entry only when that entry's own window has ended.
 * Before this fix, a cleanup that a 1-minute limiter started removed every
 * entry older than 2 minutes, so a blocked sign-in email got 10 new tries
 * long before its 15 minutes ended.
 */

const MINUTE = 60 * 1000;
// The module records its last cleanup at import time (real time). Start the
// fake clock one day later, so the 5-minute cleanup schedule really runs.
const START = Date.now() + 24 * 60 * MINUTE;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rate limiter cleanup", () => {
  it("keeps a blocked sign-in email blocked for its full 15 minutes", () => {
    const email = "cleanup-login@example.com";
    for (let i = 0; i < 10; i++) {
      expect(checkLoginRateLimit(email).success).toBe(true);
    }
    expect(checkLoginRateLimit(email).success).toBe(false);

    // 6 minutes later, a progress save starts the periodic cleanup.
    vi.setSystemTime(START + 6 * MINUTE);
    checkProgressRateLimit("cleanup-progress-user");
    expect(checkLoginRateLimit(email).success).toBe(false);

    // After the 15-minute window, the email can try again.
    vi.setSystemTime(START + 16 * MINUTE);
    expect(checkLoginRateLimit(email).success).toBe(true);
  });

  it("removes every entry whose own window has ended", () => {
    checkNameChangeRateLimit("cleanup-name-user");
    checkProgressRateLimit("cleanup-progress-user-2");
    expect(rateLimitEntryCount()).toBeGreaterThan(0);

    // Two hours later, every window above (1 hour at most) has ended.
    vi.setSystemTime(START + 120 * MINUTE);
    checkProgressRateLimit("cleanup-trigger");

    expect(rateLimitEntryCount()).toBe(1);
  });
});

describe("name change rate limiter", () => {
  it("allows 5 name changes per hour per user, then blocks", () => {
    const userId = "name-change-user";
    for (let i = 0; i < 5; i++) {
      expect(checkNameChangeRateLimit(userId).success).toBe(true);
    }
    expect(checkNameChangeRateLimit(userId).success).toBe(false);
    // A different user has a separate counter.
    expect(checkNameChangeRateLimit("name-change-other").success).toBe(true);

    vi.setSystemTime(START + 61 * MINUTE);
    expect(checkNameChangeRateLimit(userId).success).toBe(true);
  });
});
