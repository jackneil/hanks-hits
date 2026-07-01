import { describe, expect, it } from "vitest";
import { checkProgressDeleteRateLimit, checkProgressRateLimit } from "../rate-limit";

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
