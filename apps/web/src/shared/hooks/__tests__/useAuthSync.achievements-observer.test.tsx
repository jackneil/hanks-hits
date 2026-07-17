import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// GUEST session on purpose: the observer must award trophies to kids who
// never sign in (the auto-save poll is auth-gated; this one is not).
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import { useAuthSync } from "../useAuthSync";
import { useAchievementsStore } from "@/shared/lib/achievements";

type TestProgress = { gamesPlayed: number; highScore: number; lastModified: number };

function resetAchievements() {
  useAchievementsStore.setState({
    progress: { unlocked: {}, lastModified: 0 },
    watermarks: { apps: {}, playedApps: [], bestIncreases: 0 },
    celebrationQueue: [],
  });
}

describe("useAuthSync achievements observer (guest mode)", () => {
  let state: TestProgress;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    resetAchievements();
    state = { gamesPlayed: 0, highScore: 0, lastModified: 100 };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountSnake() {
    return renderHook(() =>
      useAuthSync<TestProgress>({
        appId: "snake" as never,
        localStorageKey: "snake-game-state",
        getState: () => state,
        setState: (d) => {
          state = d;
        },
      })
    );
  }

  it("awards a guest's unlock from a state change, exactly once", async () => {
    mountSnake();

    // Default zero-state report: no evidence of play, nothing unlocks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(useAchievementsStore.getState().progress.unlocked).toEqual({});

    // The kid plays a round.
    state = { gamesPlayed: 1, highScore: 12, lastModified: 200 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    const unlocked = useAchievementsStore.getState().progress.unlocked;
    expect(unlocked["first-play:snake"]).toBeDefined();
    expect(useAchievementsStore.getState().celebrationQueue).toContain("first-play:snake");

    // Ticks with UNCHANGED state report nothing new — no re-awards, no
    // queue growth.
    const before = { ...unlocked };
    const queueBefore = [...useAchievementsStore.getState().celebrationQueue];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(useAchievementsStore.getState().progress.unlocked).toEqual(before);
    expect(useAchievementsStore.getState().celebrationQueue).toEqual(queueBefore);
  });

  it("persists unlocks (survives reload) but never persists the celebration queue", async () => {
    mountSnake();
    state = { gamesPlayed: 1, highScore: 12, lastModified: 200 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    const stored = JSON.parse(localStorage.getItem("achievements-progress") ?? "{}");
    expect(stored.state.progress.unlocked["first-play:snake"]).toBeDefined();
    expect(stored.state.watermarks).toBeDefined();
    // A reload must not re-celebrate: the queue is not part of the persisted shape.
    expect(stored.state.celebrationQueue).toBeUndefined();
  });

  it("never observes the achievements blob itself (no feedback loop)", async () => {
    renderHook(() =>
      useAuthSync<Record<string, unknown>>({
        appId: "achievements" as never,
        localStorageKey: "achievements-progress",
        getState: () => ({ unlocked: { "first-play:snake": 1 }, lastModified: 5 }),
        setState: () => {},
      })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(useAchievementsStore.getState().progress.unlocked).toEqual({});
  });
});
