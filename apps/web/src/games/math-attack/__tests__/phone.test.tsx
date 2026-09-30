/**
 * Math Attack on a phone (PR-G5): a number pad inside the game (no system
 * keyboard, which covered half the screen and scrolled the sky away), the
 * sky fitted to the play box both ways up, problems that fall by game time
 * and stop under the pause, the result as a card with the shared chip,
 * clips per run, and sound on the game-audio bus.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installAudioMock,
  isConnected,
  pathExists,
  removeAudioMock,
  type AudioMock,
  type FakeAudioNode,
  type FakeOscillatorNode,
} from "@/__tests__/audio-mock";
import { fingerTap, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";
import { clipsEnabledFor } from "@/shared/clips";
import { getGameAudio, getGameAudioTapPoint } from "@/shared/lib/audio";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { MathAttackGame, PAD_LABELS, gameOverText } from "../Game";
import { GAME } from "../lib/constants";
import { EDGE, GAP, HUD_ROW, MIN_KEY, mathAttackLayout } from "../lib/layout";
import { playSound, releaseSounds, type MathAttackSound } from "../lib/sounds";
import { useMathAttackStore } from "../lib/store";
import { runClipPhase } from "../lib/useMathAttackClips";
import { metadata } from "../metadata";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

const BOXES = {
  seUpright: { width: 375, height: 549 - 48 },
  bigUpright: { width: 390, height: 664 - 48 },
  seSideways: { width: 667, height: 311 - 44 },
  bigSideways: { width: 844, height: 340 - 44 },
};

describe("Math Attack layout", () => {
  it("fits the HUD, the sky and the pad in the play box on every iPhone screen, keys 44 px or more", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const layout = mathAttackLayout(box);
      expect(layout.key, name).toBeGreaterThanOrEqual(MIN_KEY);
      expect(layout.sky.width / layout.sky.height, name).toBeCloseTo(GAME.width / GAME.height, 1);
      if (layout.sideways) {
        expect(layout.sky.width + GAP + layout.padSize.width + 2 * EDGE, name).toBeLessThanOrEqual(box.width);
        expect(layout.sky.height + HUD_ROW + GAP + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
        expect(layout.padSize.height + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
        expect(layout.sky.height / box.height, name).toBeGreaterThan(0.7);
      } else {
        expect(layout.padSize.width + 2 * EDGE, name).toBeLessThanOrEqual(box.width);
        expect(layout.sky.height + HUD_ROW + GAP + layout.padSize.height + GAP + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
        // The two-row pad leaves the sky most of an upright phone.
        expect(layout.sky.height / box.height, name).toBeGreaterThan(0.55);
      }
    }
  });
});

describe("Math Attack on screen", () => {
  let raf: RafMock;
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    localStorage.clear();
    mockPointer(true);
    raf = installRafMock();
    act(() => useMathAttackStore.getState().reset());
  });

  afterEach(() => {
    liftAllFingers();
    uninstallRafMock();
    resetPointerMock();
    vi.restoreAllMocks();
    act(() => useMathAttackStore.getState().reset());
  });

  function start() {
    render(<MathAttackGame />);
    fireEvent.click(screen.getByRole("button", { name: /start game/i }));
  }

  it("has no text input, so no system keyboard ever opens", () => {
    const { container } = render(<MathAttackGame />);
    fireEvent.click(screen.getByRole("button", { name: /start game/i }));
    expect(container.querySelector("input")).toBeNull();
  });

  it("types an answer on the pad, deletes, and sends it", () => {
    start();
    fingerTap(screen.getByRole("button", { name: "1" }));
    fingerTap(screen.getByRole("button", { name: "2" }));
    expect(screen.getByTestId("math-attack-answer")).toHaveTextContent("12");
    fingerTap(screen.getByRole("button", { name: PAD_LABELS.delete }));
    expect(screen.getByTestId("math-attack-answer")).toHaveTextContent("1");
    fingerTap(screen.getByRole("button", { name: PAD_LABELS.send }));
    expect(screen.getByTestId("math-attack-answer")).toHaveTextContent("?");
  });

  it("holds the problems still under the pause: a long pause loses no life", () => {
    start();
    raf.runFor(1000, 60, act);
    expect(useMathAttackStore.getState().gameState).toBe("playing");
    act(() => useMathAttackStore.getState().pauseGame());
    const livesBefore = useMathAttackStore.getState().lives;
    // A long pause: no life is lost, the game stays paused.
    raf.runFor(60_000, 60, act);
    expect(useMathAttackStore.getState().lives).toBe(livesBefore);
    expect(useMathAttackStore.getState().gameState).toBe("paused");
  });

  it("loses the lives when problems land, and shows a card and the chip at game over", () => {
    start();
    // Long enough for problems to land and the lives to run out.
    raf.runFor(240_000, 60, act);
    expect(useMathAttackStore.getState().gameState).toBe("gameOver");
    expect(screen.getByTestId("math-attack-result-card")).toHaveTextContent("Game over!");
    const chip = screen.getByTestId("result-chip");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const runBefore = useMathAttackStore.getState().runId;
    fireEvent.click(within(chip).getByRole("button", { name: /play again/i }));
    expect(useMathAttackStore.getState().gameState).toBe("playing");
    expect(useMathAttackStore.getState().runId).toBe(runBefore + 1);
  });

  it("says the result in whole sentences", () => {
    expect(gameOverText({ score: 1, best: 9, newBest: false })).toBe("Game over! You got 1 point. Your best is 9.");
    expect(gameOverText({ score: 50, best: 50, newBest: true })).toBe("Game over! You got 50 points. That is a new best!");
  });
});

describe("Math Attack pause and runs", () => {
  beforeEach(() => act(() => useMathAttackStore.getState().reset()));

  it("pauses and resumes only a running game, and counts each start as a new run with its best to beat", () => {
    act(() => useMathAttackStore.getState().pauseGame());
    expect(useMathAttackStore.getState().gameState).toBe("ready");
    act(() => {
      useMathAttackStore.setState({ highScore: 30 });
      useMathAttackStore.getState().startGame(3);
    });
    expect(useMathAttackStore.getState().runStartBest).toBe(30);
    act(() => useMathAttackStore.getState().pauseGame());
    expect(useMathAttackStore.getState().gameState).toBe("paused");
    act(() => useMathAttackStore.getState().resumeGame());
    expect(useMathAttackStore.getState().gameState).toBe("playing");
    act(() => {
      useMathAttackStore.setState({ score: 45 });
      useMathAttackStore.getState().endGame();
    });
    expect(useMathAttackStore.getState().lastRunNewBest).toBe(true);
  });
});

describe("Math Attack clips", () => {
  it("turns clips on; problems fall, the pause holds the run, the rest has none", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("math-attack")).toBe(true);
    expect(runClipPhase("playing")).toBe("playing");
    expect(runClipPhase("paused")).toBe("hold");
    expect(runClipPhase("ready")).toBe("idle");
    expect(runClipPhase("gameOver")).toBe("idle");
  });
});

describe("Math Attack sounds on the game-audio bus", () => {
  let mock: AudioMock;

  beforeEach(() => {
    mock = installAudioMock();
  });

  afterEach(() => {
    releaseSounds();
    removeAudioMock();
  });

  const SOUNDS: MathAttackSound[] = ["pop", "wrong", "lose-life", "game-over"];

  it.each(SOUNDS)("%s reaches the clip tap point and the speakers, only through the game's channel", (sound) => {
    expect(getGameAudio()).not.toBeNull();
    playSound(sound);
    const ctx = mock.lastContext();
    const created = ctx.createOscillator.mock.results;
    const oscillator = created[created.length - 1].value as FakeOscillatorNode;
    expect(oscillator.started).toBe(true);
    expect(pathExists(oscillator, getGameAudioTapPoint() as unknown as FakeAudioNode)).toBe(true);
    expect(pathExists(oscillator, ctx.destination)).toBe(true);
    const made = [...ctx.createOscillator.mock.results, ...ctx.createGain.mock.results].map((r) => r.value as FakeAudioNode);
    for (const node of made) expect(isConnected(node, ctx.destination)).toBe(false);
  });

  it("does nothing, and throws nothing, with no Web Audio", () => {
    removeAudioMock();
    expect(() => playSound("pop")).not.toThrow();
    expect(getGameAudio()).toBeNull();
  });
});
