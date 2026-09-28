import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startAccountRetentionSchedule } = vi.hoisted(() => ({
  startAccountRetentionSchedule: vi.fn(),
}));

vi.mock("@/lib/account-retention", () => ({
  startAccountRetentionSchedule,
}));

import { register } from "../instrumentation";

/**
 * The production server must start the daily delete of unused accounts
 * (the retention policy on /privacy). Nothing else may start it.
 */
describe("instrumentation register()", () => {
  beforeEach(() => {
    startAccountRetentionSchedule.mockClear();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/db");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts the retention schedule in the production Node server", async () => {
    await register();
    expect(startAccountRetentionSchedule).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the Edge runtime", "NEXT_RUNTIME", "edge"],
    ["next dev", "NODE_ENV", "development"],
    ["the build", "NEXT_PHASE", "phase-production-build"],
    ["a server with no database", "DATABASE_URL", ""],
  ])("does not start it in %s", async (_label, name, value) => {
    vi.stubEnv(name, value);
    await register();
    expect(startAccountRetentionSchedule).not.toHaveBeenCalled();
  });
});
