/**
 * Asteroids at game over (plan 11.4): the shared result chip sits under the
 * canvas card with Read it to me, Play again and the leaderboard, and says
 * the score, the wave and the best. The layout keeps its place, so the
 * canvas does not jump when the run ends, and a stray tap on the canvas at
 * the last death never restarts and wipes the card.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { AsteroidsGame } from "../Game";
import { gameOverText, NEXT_WAVE_LABEL, SOUND_LABELS, waveCompleteText } from "../lib/overlayCopy";
import { useAsteroidsStore } from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

let clock = 1_000_000;

beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  // Keep the game loop from ticking.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
  act(() => {
    useAsteroidsStore.setState({ status: "ready", score: 0, wave: 1 });
  });
});

afterEach(() => {
  removeSpeechMock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function endTheRun(score: number, best: number) {
  act(() => {
    useAsteroidsStore.getState().startGame();
    useAsteroidsStore.setState({
      score,
      wave: 3,
      progress: { ...useAsteroidsStore.getState().progress, highScore: best },
    });
  });
  clock += 20_000;
  act(() => {
    useAsteroidsStore.getState().gameOver();
  });
}

function passGrace() {
  clock += DEFAULT_RESTART_GRACE_MS;
}

describe("the Asteroids result chip (plan 11.4)", () => {
  it("shows at game over with Play again and the leaderboard, and says the score, the wave and the best", () => {
    const speech = installSpeechMock();
    render(<AsteroidsGame />);
    expect(screen.queryByTestId("result-chip")).toBeNull();
    endTheRun(1060, 900);
    const chip = screen.getByTestId("result-chip");
    expect(within(chip).getByRole("button", { name: /play again/i })).toBeInTheDocument();
    expect(within(chip).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
    passGrace();
    fireEvent.click(within(chip).getByTestId("read-aloud-button"));
    const expected = gameOverText({ score: 1060, wave: 3, best: 1060, newBest: true });
    expect(speech.lastUtterance().text.startsWith(expected)).toBe(true);
    expect(useAsteroidsStore.getState().lastRunNewBest).toBe(true);
  });

  it("says the old best when the run did not beat it", () => {
    const speech = installSpeechMock();
    render(<AsteroidsGame />);
    endTheRun(300, 2000);
    passGrace();
    fireEvent.click(within(screen.getByTestId("result-chip")).getByTestId("read-aloud-button"));
    expect(speech.lastUtterance().text).toContain("Your best is 2000.");
    expect(useAsteroidsStore.getState().lastRunNewBest).toBe(false);
  });

  it("Play again starts a new run and the chip goes away; a tap on the canvas at game over does not restart", () => {
    const { container } = render(<AsteroidsGame />);
    endTheRun(500, 900);
    // The kid was tapping fire when the last life went: the tap lands on the canvas.
    fireEvent.click(container.querySelector("canvas")!);
    expect(useAsteroidsStore.getState().status).toBe("gameOver");
    expect(useAsteroidsStore.getState().score).toBe(500);
    passGrace();
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(useAsteroidsStore.getState().status).toBe("playing");
    expect(screen.queryByTestId("result-chip")).toBeNull();
  });

  it("Space restarts only after the grace, and a held Space's repeats never do", () => {
    render(<AsteroidsGame />);
    endTheRun(500, 900);
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(useAsteroidsStore.getState().status).toBe("gameOver");
    passGrace();
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });
    expect(useAsteroidsStore.getState().status).toBe("gameOver");
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(useAsteroidsStore.getState().status).toBe("playing");
  });

  it("says a new best on the result card, and draws no words on the canvas", () => {
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
    // getContext has one overload per context type; the renderer asks for "2d".
    (vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      () => ctx,
    );
    render(<AsteroidsGame />);
    texts.length = 0;
    endTheRun(1060, 900);
    const card = screen.getByTestId("asteroids-result-card");
    expect(card).toHaveTextContent("Game over!");
    expect(card).toHaveTextContent("New best!");
    // The words live on the card, clear of the chip: none on the canvas.
    expect(texts.some((text) => /GAME OVER|NEW BEST|play again/i.test(text))).toBe(false);
  });
});

describe("the Asteroids layout keeps its place (the canvas never jumps at a run's end)", () => {
  it("keeps both pad groups on every screen, shown and tappable only while a round plays", () => {
    render(<AsteroidsGame />);
    const pads = () => [screen.getByTestId("asteroids-pad-turn"), screen.getByTestId("asteroids-pad-action")];
    const hiddenPads = () => {
      for (const pad of pads()) {
        expect(pad.className.split(/\s+/)).toContain("invisible");
        expect(pad.getAttribute("aria-hidden")).toBe("true");
        expect(pad.hasAttribute("inert")).toBe(true);
      }
    };
    hiddenPads(); // the start card
    act(() => useAsteroidsStore.getState().startGame());
    for (const pad of pads()) {
      expect(pad.className.split(/\s+/)).not.toContain("invisible");
      expect(pad.hasAttribute("aria-hidden")).toBe(false);
      expect(pad.hasAttribute("inert")).toBe(false);
      expect(within(pad).getAllByRole("button")).toHaveLength(2);
    }
    act(() => useAsteroidsStore.getState().pauseGame());
    hiddenPads();
    act(() => useAsteroidsStore.getState().resumeGame());
    act(() => useAsteroidsStore.getState().gameOver());
    hiddenPads();
  });

  it("keeps the sound switch in the stats line on every screen, so it is never under the result chip", () => {
    render(<AsteroidsGame />);
    const sound = screen.getByTestId("asteroids-sound");
    expect(sound).toHaveAccessibleName(SOUND_LABELS.on);
    act(() => useAsteroidsStore.getState().startGame());
    expect(screen.getByTestId("asteroids-sound")).toBe(sound);
    act(() => useAsteroidsStore.getState().gameOver());
    // The same button, at game over too, and the chip carries no second one.
    expect(screen.getByTestId("asteroids-sound")).toBe(sound);
    expect(within(screen.getByTestId("result-chip")).queryByTestId("result-chip-sound")).toBeNull();
    fireEvent.click(sound);
    expect(useAsteroidsStore.getState().progress.soundEnabled).toBe(false);
    expect(screen.getByTestId("asteroids-sound")).toHaveAccessibleName(SOUND_LABELS.off);
  });

  it("has no in-page pause button: the shell's header has the one pause", () => {
    render(<AsteroidsGame />);
    act(() => useAsteroidsStore.getState().startGame());
    expect(screen.queryByTestId("asteroids-pause")).toBeNull();
    expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
  });

  it("keeps the stats on one line at every width, so a bigger number never wraps it", () => {
    render(<AsteroidsGame />);
    const stats = screen.getByTestId("asteroids-stats");
    for (const token of ["whitespace-nowrap", "overflow-hidden", "max-w-full"]) expect(stats.className.split(/\s+/)).toContain(token);
  });
});

describe("the Asteroids wave-complete chip", () => {
  it("shows Read it to me and Next wave, says the wave and the score, and a canvas tap does not skip the card", () => {
    const speech = installSpeechMock();
    const { container } = render(<AsteroidsGame />);
    act(() => {
      useAsteroidsStore.getState().startGame();
      useAsteroidsStore.setState({ status: "waveComplete", wave: 2, score: 340 });
    });
    const chip = screen.getByTestId("result-chip");
    expect(within(chip).queryByRole("button", { name: /play again/i })).toBeNull();
    const next = within(chip).getByRole("button", { name: NEXT_WAVE_LABEL });
    expect(next.className).toMatch(/(^|\s)min-h-14(\s|$)/);
    // A tap on the canvas (the kid was still firing) leaves the card up.
    fireEvent.click(container.querySelector("canvas")!);
    expect(useAsteroidsStore.getState().status).toBe("waveComplete");
    passGrace();
    fireEvent.click(within(chip).getByTestId("read-aloud-button"));
    // One period between the sentences, never two.
    expect(speech.lastUtterance().text).toBe(`${waveCompleteText({ wave: 2, score: 340 })} ${NEXT_WAVE_LABEL}`);
    fireEvent.click(next);
    expect(useAsteroidsStore.getState().status).toBe("playing");
    expect(useAsteroidsStore.getState().wave).toBe(3);
    expect(screen.queryByTestId("result-chip")).toBeNull();
  });

  it("says the wave on the result card, and draws no words on the canvas", () => {
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
    render(<AsteroidsGame />);
    act(() => {
      useAsteroidsStore.getState().startGame();
      useAsteroidsStore.setState({ status: "waveComplete", wave: 2, score: 340 });
    });
    expect(screen.getByTestId("asteroids-result-card")).toHaveTextContent("Wave 2 complete!");
    expect(texts.some((text) => /COMPLETE|tap|space|next wave/i.test(text))).toBe(false);
  });
});
