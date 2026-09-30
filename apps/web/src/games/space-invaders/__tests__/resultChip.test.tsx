/**
 * Space Invaders between rounds: the shared result chip at game over (read
 * it to me, Play again, the leaderboard) and at wave complete (Next wave),
 * a DOM HUD that is readable at any canvas size, and no in-page pause,
 * settings panel or stats panel on the play page (the header has the
 * pause; the profile has the stats).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { gameOverText, NEXT_WAVE_LABEL, SpaceInvadersGame, waveCompleteText } from "../Game";
import { useSpaceInvadersStore } from "../lib/store";

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
  act(() => {
    useSpaceInvadersStore.setState({ gameState: "ready", score: 0, wave: 1 });
  });
});

afterEach(() => {
  removeSpeechMock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => {
    useSpaceInvadersStore.setState({ gameState: "ready" });
  });
});

function endTheRun(score: number, bestBefore: number) {
  act(() => {
    useSpaceInvadersStore.setState({ progress: { ...useSpaceInvadersStore.getState().progress, highScore: bestBefore } });
    useSpaceInvadersStore.getState().startGame();
    useSpaceInvadersStore.setState({
      gameState: "gameOver",
      score,
      wave: 3,
      progress: { ...useSpaceInvadersStore.getState().progress, highScore: Math.max(bestBefore, score) },
    });
  });
}

const passGrace = () => {
  clock += DEFAULT_RESTART_GRACE_MS;
};

describe("the Space Invaders result chip", () => {
  it("shows at game over with Play again and the leaderboard, and says the score, the wave and the new best", () => {
    const speech = installSpeechMock();
    render(<SpaceInvadersGame />);
    expect(screen.queryByTestId("result-chip")).toBeNull();
    endTheRun(1060, 900);
    const chip = screen.getByTestId("result-chip");
    expect(within(chip).getByRole("button", { name: /play again/i })).toBeInTheDocument();
    expect(within(chip).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
    passGrace();
    fireEvent.click(within(chip).getByTestId("read-aloud-button"));
    expect(speech.lastUtterance().text.startsWith(gameOverText({ score: 1060, wave: 3, best: 1060, newBest: true }))).toBe(true);
  });

  it("says the old best when the run did not beat it", () => {
    const speech = installSpeechMock();
    render(<SpaceInvadersGame />);
    endTheRun(300, 2000);
    passGrace();
    fireEvent.click(within(screen.getByTestId("result-chip")).getByTestId("read-aloud-button"));
    expect(speech.lastUtterance().text).toContain("Your best is 2000.");
  });

  it("Play again starts a new run at once (no age picker), and a tap on the canvas at game over does nothing", () => {
    const { container } = render(<SpaceInvadersGame />);
    endTheRun(500, 900);
    fireEvent.click(container.querySelector("canvas")!);
    expect(useSpaceInvadersStore.getState().gameState).toBe("gameOver");
    passGrace();
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(useSpaceInvadersStore.getState().gameState).toBe("playing");
    expect(useSpaceInvadersStore.getState().score).toBe(0);
    expect(screen.queryByTestId("result-chip")).toBeNull();
  });

  it("Space restarts only after the grace, and a held Space's repeats never do", () => {
    render(<SpaceInvadersGame />);
    endTheRun(500, 900);
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(useSpaceInvadersStore.getState().gameState).toBe("gameOver");
    passGrace();
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });
    expect(useSpaceInvadersStore.getState().gameState).toBe("gameOver");
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(useSpaceInvadersStore.getState().gameState).toBe("playing");
  });

  it("wave complete shows Next wave, says the wave and the score, and a canvas tap does not skip the card", () => {
    const speech = installSpeechMock();
    const { container } = render(<SpaceInvadersGame />);
    act(() => {
      useSpaceInvadersStore.getState().startGame();
      useSpaceInvadersStore.setState({ gameState: "waveComplete", wave: 2, score: 340 });
    });
    const chip = screen.getByTestId("result-chip");
    expect(within(chip).queryByRole("button", { name: /play again/i })).toBeNull();
    const next = within(chip).getByRole("button", { name: NEXT_WAVE_LABEL });
    fireEvent.click(container.querySelector("canvas")!);
    expect(useSpaceInvadersStore.getState().gameState).toBe("waveComplete");
    passGrace();
    fireEvent.click(within(chip).getByTestId("read-aloud-button"));
    expect(speech.lastUtterance().text).toBe(`${waveCompleteText({ wave: 2, score: 340 })} ${NEXT_WAVE_LABEL}`);
    fireEvent.click(next);
    expect(useSpaceInvadersStore.getState().gameState).toBe("playing");
    expect(useSpaceInvadersStore.getState().wave).toBe(3);
    expect(screen.queryByTestId("result-chip")).toBeNull();
  });

  it("says the result in a DOM card over the field, and draws no words on the canvas", () => {
    const texts: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "fillText") return (text: string) => texts.push(text);
          if (key === "canvas") return null;
          return () => undefined;
        },
        set: () => true,
      },
    );
    (vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      () => ctx,
    );
    render(<SpaceInvadersGame />);
    texts.length = 0;
    endTheRun(1060, 900);
    const card = screen.getByTestId("space-invaders-result-card");
    expect(card).toHaveTextContent("Game over!");
    expect(card).toHaveTextContent("Score 1060");
    expect(card).toHaveTextContent("New best!");
    act(() => {
      useSpaceInvadersStore.setState({ gameState: "waveComplete", wave: 2, score: 340 });
    });
    expect(screen.getByTestId("space-invaders-result-card")).toHaveTextContent("Wave 2 done!");
    expect(texts.some((text) => /GAME OVER|DONE|NEW BEST|tap|space|play again|next wave/i.test(text))).toBe(false);
  });
});

describe("Space Invaders next wave", () => {
  it("Next wave waits out the grace, like Play again", () => {
    render(<SpaceInvadersGame />);
    act(() => {
      useSpaceInvadersStore.getState().startGame();
      useSpaceInvadersStore.setState({ gameState: "waveComplete", wave: 1, score: 200 });
    });
    const next = screen.getByTestId("space-invaders-next-wave");
    fireEvent.click(next);
    expect(useSpaceInvadersStore.getState().gameState).toBe("waveComplete");
    passGrace();
    fireEvent.click(next);
    expect(useSpaceInvadersStore.getState().gameState).toBe("playing");
    expect(useSpaceInvadersStore.getState().wave).toBe(2);
  });
});

describe("the Space Invaders play page", () => {
  it("has a DOM HUD with the score, the best, the lives and the wave", () => {
    render(<SpaceInvadersGame />);
    act(() => {
      useSpaceInvadersStore.getState().startGame();
      useSpaceInvadersStore.setState({ score: 120, wave: 2, lives: 2, progress: { ...useSpaceInvadersStore.getState().progress, highScore: 900 } });
    });
    const hud = screen.getByTestId("space-invaders-hud");
    expect(hud).toHaveTextContent("SCORE 120");
    expect(hud).toHaveTextContent("BEST 900");
    expect(hud).toHaveTextContent("WAVE 2");
    expect(within(hud).getByLabelText("2 lives")).toBeInTheDocument();
    for (const token of ["whitespace-nowrap", "overflow-hidden", "max-w-full"]) expect(hud.className.split(/\s+/)).toContain(token);
  });

  it("has no in-page pause, settings panel or stats panel: the header pauses, the HUD has the sound switch", () => {
    render(<SpaceInvadersGame />);
    act(() => useSpaceInvadersStore.getState().startGame());
    expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText("Your Stats")).toBeNull();
    expect(screen.getByTestId("space-invaders-sound")).toBeInTheDocument();
  });

  it("plays the wave-clear fanfare when the wave is done, not when Next wave is tapped", async () => {
    const sounds = await import("../lib/sounds");
    const spy = vi.spyOn(sounds, "playSound");
    render(<SpaceInvadersGame />);
    act(() => {
      useSpaceInvadersStore.getState().startGame();
      useSpaceInvadersStore.setState({ gameState: "waveComplete", wave: 1, score: 10 });
    });
    expect(spy).toHaveBeenCalledWith("waveClear");
  });
});
