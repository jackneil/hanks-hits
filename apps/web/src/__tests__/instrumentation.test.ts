// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * instrumentation.ts starts the daily leaderboard clip sweep
 * (design/LEADERBOARD_CLIPS.html, section 8) in the production server only:
 * never in `next dev`, in the build, in the Edge runtime, or with no
 * database.
 */
const schedule = vi.hoisted(() => ({ start: vi.fn(), run: vi.fn(async () => {}) }));

vi.mock("@/lib/leaderboard-clips/sweeper", () => ({
  startLeaderboardClipSweepSchedule: schedule.start,
  runLeaderboardClipSweep: schedule.run,
}));
vi.mock("@/lib/leaderboard-clips/runtime", () => ({ defaultSweepDeps: () => ({ fake: true }) }));

async function register(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value as string);
  const { register } = await import("../instrumentation");
  await register();
}

const PRODUCTION = { NEXT_RUNTIME: "nodejs", NODE_ENV: "production", NEXT_PHASE: "", DATABASE_URL: "postgres://db/x" };

afterEach(() => {
  vi.unstubAllEnvs();
  schedule.start.mockClear();
  schedule.run.mockClear();
});

describe("register()", () => {
  it("starts the sweep schedule in the production Node server", async () => {
    await register(PRODUCTION);
    expect(schedule.start).toHaveBeenCalledTimes(1);
    // The scheduled job runs the sweep with the production deps.
    await schedule.start.mock.calls[0][0]();
    expect(schedule.run).toHaveBeenCalledWith({ fake: true });
  });

  it.each([
    ["the Edge runtime", { NEXT_RUNTIME: "edge" }],
    ["next dev", { NODE_ENV: "development" }],
    ["the build", { NEXT_PHASE: "phase-production-build" }],
    ["no database", { DATABASE_URL: "" }],
  ])("does nothing in %s", async (_name, change) => {
    await register({ ...PRODUCTION, ...change });
    expect(schedule.start).not.toHaveBeenCalled();
  });
});
