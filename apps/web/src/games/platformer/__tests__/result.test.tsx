/**
 * Hank's Hopper at the end of a level (PR-G2): legible DOM text over the
 * picture and the shared result chip. Try again replays the level, Next
 * level goes on (Pick a level after the last one), a tap on the level never
 * skips the result, and clips mark the level clear.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { PlatformerGame, levelResultText } from "../Game";
import { usePlatformerStore } from "../lib/store";
import { LEVELS } from "../lib/constants";
import { metadata } from "../metadata";
import { runClipPhase } from "../lib/usePlatformerClips";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

let clock = 1_000_000;

beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
  act(() => usePlatformerStore.getState().reset());
});

afterEach(() => {
  removeSpeechMock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const passGrace = () => {
  clock += DEFAULT_RESTART_GRACE_MS + 50;
};

function finishLevel(index: number, state: "gameOver" | "levelComplete") {
  act(() => {
    usePlatformerStore.getState().startGame(index);
    usePlatformerStore.setState({ gameState: state, score: 120, coinsThisRun: 4, starsThisRun: 2 });
  });
}

describe("Hank's Hopper result", () => {
  it("says Oops with the points at a fall, and Try again replays the same level", () => {
    const speech = installSpeechMock();
    render(<PlatformerGame />);
    finishLevel(1, "gameOver");
    expect(screen.getByTestId("platformer-result-card")).toHaveTextContent("Oops!");
    const chip = screen.getByTestId("result-chip");
    expect(within(chip).queryByTestId("platformer-next")).toBeNull();
    passGrace();
    fireEvent.click(within(chip).getByTestId("read-aloud-button"));
    expect(speech.lastUtterance().text).toContain("Oops! You got 120 points, 4 coins and 2 stars. Try again!");
    fireEvent.click(within(chip).getByRole("button", { name: /play again/i }));
    expect(usePlatformerStore.getState().gameState).toBe("playing");
    expect(usePlatformerStore.getState().currentLevelIndex).toBe(1);
  });

  it("goes to the next level from Next level, after the grace", () => {
    render(<PlatformerGame />);
    finishLevel(0, "levelComplete");
    expect(screen.getByTestId("platformer-result-card")).toHaveTextContent("Level complete!");
    const next = screen.getByTestId("platformer-next");
    expect(next).toHaveTextContent("Next level");
    fireEvent.click(next);
    expect(usePlatformerStore.getState().gameState).toBe("levelComplete");
    passGrace();
    fireEvent.click(next);
    expect(usePlatformerStore.getState().gameState).toBe("playing");
    expect(usePlatformerStore.getState().currentLevelIndex).toBe(1);
  });

  it("offers Pick a level after the last level, back to the level picker", () => {
    render(<PlatformerGame />);
    finishLevel(LEVELS.length - 1, "levelComplete");
    const next = screen.getByTestId("platformer-next");
    expect(next).toHaveTextContent("Pick a level");
    passGrace();
    fireEvent.click(next);
    expect(usePlatformerStore.getState().gameState).toBe("ready");
  });

  it("never skips the result from a JUMP still pressed at the finish", () => {
    render(<PlatformerGame />);
    finishLevel(0, "levelComplete");
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(usePlatformerStore.getState().gameState).toBe("levelComplete");
  });

  it("puts the level result in kid words", () => {
    expect(
      levelResultText({ cleared: true, levelName: "Sky Climb", score: 300, stars: 3, coins: 1, newBestTime: true, lastLevel: true }),
    ).toBe("Level complete: Sky Climb! You got 300 points, 1 coin and 3 stars. That is your best time! You beat every level!");
  });
});

describe("Hank's Hopper clips", () => {
  it("turns clips on; a level plays, the shell's pause holds, the rest has no run", () => {
    expect(metadata.clips).toBe(true);
    expect(runClipPhase("playing")).toBe("playing");
    expect(runClipPhase("paused")).toBe("hold");
    expect(runClipPhase("ready")).toBe("idle");
    expect(runClipPhase("gameOver")).toBe("idle");
    expect(runClipPhase("levelComplete")).toBe("idle");
  });
});
