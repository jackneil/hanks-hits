/**
 * Flappy Bird at the crash (PR-G2): the shared result chip says the pipes,
 * the medal and the best, and Play again starts the next flight at once.
 * A thumb still tapping the board at the crash never restarts or wipes the
 * result (a death used to flip to the start card, where a mashing thumb
 * pressed Play).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { FlappyBirdGame, flappyResultText } from "../Game";
import { useFlappyStore } from "../lib/store";
import { metadata } from "../metadata";
import { runClipPhase } from "../lib/useFlappyClips";
import { clipsEnabledFor } from "@/shared/clips";

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
  act(() => useFlappyStore.getState().reset());
});

afterEach(() => {
  removeSpeechMock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Fly through `pipes`, with the saved best at `best`, then crash. */
function crash(pipes: number, best: number) {
  act(() => {
    const s = useFlappyStore.getState();
    useFlappyStore.setState({ progress: { ...s.progress, highScore: best } });
    useFlappyStore.getState().startGame();
    useFlappyStore.setState({ score: pipes });
    useFlappyStore.getState().endGame();
  });
}

function passGrace() {
  clock += DEFAULT_RESTART_GRACE_MS + 50;
}

describe("Flappy Bird result", () => {
  it("shows the chip at the crash and reads the pipes, the medal and the new best", () => {
    const speech = installSpeechMock();
    render(<FlappyBirdGame />);
    expect(screen.queryByTestId("result-chip")).toBeNull();
    crash(12, 8);
    const chip = screen.getByTestId("result-chip");
    expect(within(chip).getByRole("button", { name: /play again/i })).toBeInTheDocument();
    passGrace();
    fireEvent.click(within(chip).getByTestId("read-aloud-button"));
    expect(speech.lastUtterance().text.startsWith(flappyResultText({ score: 12, best: 12, newBest: true }))).toBe(true);
  });

  it("says one pipe, no medal and the old best in kid words", () => {
    expect(flappyResultText({ score: 1, best: 20, newBest: false })).toBe(
      "Game over! You flew through 1 pipe. Your best is 20.",
    );
  });

  it("a tap on the board at the crash does nothing; Play again flies again at once", () => {
    render(<FlappyBirdGame />);
    crash(3, 10);
    fireEvent.pointerDown(screen.getByTestId("flappy-canvas"), { pointerId: 1, pointerType: "touch", button: 0 });
    expect(useFlappyStore.getState().gameState).toBe("gameOver");
    passGrace();
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(useFlappyStore.getState().gameState).toBe("playing");
    expect(useFlappyStore.getState().score).toBe(0);
    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
  });

  it("Space restarts only after the grace, and a held Space's repeats never do", () => {
    render(<FlappyBirdGame />);
    crash(3, 10);
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(useFlappyStore.getState().gameState).toBe("gameOver");
    passGrace();
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });
    expect(useFlappyStore.getState().gameState).toBe("gameOver");
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(useFlappyStore.getState().gameState).toBe("playing");
  });
});

describe("Flappy Bird clips", () => {
  it("turns clips on with the metadata literal", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("flappy-bird")).toBe(true);
  });

  it("captures only while the bird flies", () => {
    expect(runClipPhase("playing")).toBe("playing");
    expect(runClipPhase("ready")).toBe("idle");
    expect(runClipPhase("gameOver")).toBe("idle");
  });
});
