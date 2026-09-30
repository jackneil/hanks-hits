/**
 * Hextris on a phone (PR-G4): the field fits the play box both ways up with
 * a spin button under each thumb, blocks move by game time (not by screen
 * frames), the result is a ResultCard with the shared chip, clips run per
 * round, and sound goes through the game-audio bus.
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
import { THUMB_GUTTER_WIDTH, THUMB_ROW_HEIGHT } from "@/shared/components/ThumbPadLayout";
import { clipsEnabledFor } from "@/shared/clips";
import { getGameAudio, getGameAudioTapPoint, isGameSpeakerEnabled } from "@/shared/lib/audio";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { HextrisGame, SOUND_LABELS, SPIN_LABELS, gameOverText } from "../Game";
import { CANVAS_HEIGHT, CANVAS_WIDTH, HEX_CENTER_X, HEX_CENTER_Y, SPAWN_INTERVAL } from "../lib/constants";
import { fitHextris } from "../lib/layout";
import { playSound, releaseSounds, type HextrisSound } from "../lib/sounds";
import { useHextrisStore } from "../lib/store";
import { runClipPhase } from "../lib/useHextrisClips";
import { metadata } from "../metadata";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

/** The play box on the real iPhone screens: Safari's inner size less the header. */
const BOXES = {
  seUpright: { width: 375, height: 549 - 48 },
  bigUpright: { width: 390, height: 664 - 48 },
  seSideways: { width: 667, height: 311 - 44 },
  bigSideways: { width: 844, height: 340 - 44 },
};

const STEP = 1000 / 60;

describe("Hextris layout", () => {
  it("fits the whole field in the play box on every iPhone screen, with room for the spin buttons", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const fit = fitHextris(box, true);
      const sideways = box.width > box.height;
      expect(fit.layout, name).toBe(sideways ? "sideways" : "upright");
      expect(fit.viewHeight + (sideways ? 0 : THUMB_ROW_HEIGHT), name).toBeLessThanOrEqual(box.height);
      expect(fit.viewWidth + (sideways ? 2 * THUMB_GUTTER_WIDTH : 0), name).toBeLessThanOrEqual(box.width);
      // The whole field shows (to the pixel), in its own shape.
      expect(fit.visibleWorld, name).toBeGreaterThan(CANVAS_WIDTH - 1);
      expect(fit.viewWidth / fit.viewHeight, name).toBeCloseTo(CANVAS_WIDTH / CANVAS_HEIGHT, 1);
      // Sideways it takes most of the height (the hexagon used to be below the screen).
      if (sideways) expect(fit.viewHeight / box.height, name).toBeGreaterThan(0.9);
    }
  });
});

describe("Hextris game time", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => useHextrisStore.getState().startGame());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    act(() => useHextrisStore.setState({ status: "idle" }));
  });

  function withBlock() {
    act(() => {
      useHextrisStore.setState({
        fallingBlock: { id: 1, color: "#ef4444", x: HEX_CENTER_X, y: HEX_CENTER_Y - 240, targetSide: 0, angle: 0, speed: 2 },
      });
    });
  }

  it("moves a block by game time: two half steps go as far as one whole step (a 120 Hz screen falls no faster)", () => {
    withBlock();
    act(() => useHextrisStore.getState().update(STEP));
    // The block starts above the hexagon and falls down toward it.
    const whole = useHextrisStore.getState().fallingBlock!.y - (HEX_CENTER_Y - 240);
    withBlock();
    act(() => {
      useHextrisStore.getState().update(STEP / 2);
      useHextrisStore.getState().update(STEP / 2);
    });
    const halves = useHextrisStore.getState().fallingBlock!.y - (HEX_CENTER_Y - 240);
    expect(whole).toBeGreaterThan(0);
    expect(halves).toBeCloseTo(whole, 6);
  });

  it("brings a block after game time, never because the wall clock jumped (a pause or a hidden tab)", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    act(() => useHextrisStore.getState().update(STEP));
    expect(useHextrisStore.getState().fallingBlock).toBeNull();
    // An hour on the wall clock, one step of game time: no block.
    now.mockReturnValue(1_000_000 + 3_600_000);
    act(() => useHextrisStore.getState().update(STEP));
    expect(useHextrisStore.getState().fallingBlock).toBeNull();
    // The spawn interval of game time: a block.
    act(() => {
      for (let t = 0; t <= SPAWN_INTERVAL; t += STEP) useHextrisStore.getState().update(STEP);
    });
    expect(useHextrisStore.getState().fallingBlock).not.toBeNull();
  });

  it("counts each start as a new run and remembers the best to beat", () => {
    act(() => useHextrisStore.setState({ progress: { ...useHextrisStore.getState().progress, highScore: 40 } }));
    const before = useHextrisStore.getState().runId;
    act(() => useHextrisStore.getState().startGame());
    expect(useHextrisStore.getState().runId).toBe(before + 1);
    expect(useHextrisStore.getState().runStartBest).toBe(40);
    act(() => {
      useHextrisStore.setState({ score: 55 });
      useHextrisStore.getState().gameOver();
    });
    expect(useHextrisStore.getState().lastRunNewBest).toBe(true);
    expect(useHextrisStore.getState().progress.highScore).toBe(55);
    act(() => useHextrisStore.getState().startGame());
    act(() => {
      useHextrisStore.setState({ score: 10 });
      useHextrisStore.getState().gameOver();
    });
    expect(useHextrisStore.getState().lastRunNewBest).toBe(false);
  });
});

describe("Hextris on screen", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    localStorage.clear();
    mockPointer(true);
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    act(() => useHextrisStore.getState().startGame());
  });

  afterEach(() => {
    liftAllFingers();
    resetPointerMock();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    act(() => useHextrisStore.setState({ status: "idle" }));
  });

  it("puts a spin button under each thumb; one tap is one step each way", () => {
    render(<HextrisGame />);
    fingerTap(screen.getByRole("button", { name: SPIN_LABELS.left }));
    expect(useHextrisStore.getState().targetRotation).toBeCloseTo(-Math.PI / 3, 6);
    fingerTap(screen.getByRole("button", { name: SPIN_LABELS.right }));
    fingerTap(screen.getByRole("button", { name: SPIN_LABELS.right }));
    expect(useHextrisStore.getState().targetRotation).toBeCloseTo(Math.PI / 3, 6);
  });

  it("shows the result as a card at the top of the field, with the chip and its sound switch", () => {
    render(<HextrisGame />);
    act(() => {
      useHextrisStore.setState({ score: 120 });
      useHextrisStore.getState().gameOver();
    });
    const card = screen.getByTestId("hextris-result-card");
    expect(card).toHaveTextContent("Game over!");
    expect(card).toHaveTextContent("Score 120");
    expect(card.className).toContain("top-0");
    const chip = screen.getByTestId("result-chip");
    // The spin buttons hide and take no taps between rounds.
    expect(screen.queryByRole("button", { name: SPIN_LABELS.left })).toBeNull();
    // A tap on the field at game over does not start a round (the chip does).
    fingerTap(screen.getByTestId("hextris-viewport").querySelector("canvas")!, { x: 10, y: 10 });
    expect(useHextrisStore.getState().status).toBe("game-over");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    const sound = within(chip).getByTestId("result-chip-sound");
    expect(sound).toHaveTextContent(SOUND_LABELS.on);
    fireEvent.click(sound);
    expect(isGameSpeakerEnabled("hextris")).toBe(false);
    expect(sound).toHaveTextContent(SOUND_LABELS.off);
    fireEvent.click(sound);
    expect(isGameSpeakerEnabled("hextris")).toBe(true);
    fireEvent.click(within(chip).getByRole("button", { name: /play again/i }));
    expect(useHextrisStore.getState().status).toBe("playing");
  });

  it("the result words say the score and the best", () => {
    expect(gameOverText({ score: 1, best: 9, newBest: false })).toBe("Game over! You got 1 point. Your best is 9.");
    expect(gameOverText({ score: 40, best: 40, newBest: true })).toBe("Game over! You got 40 points. That is a new best!");
  });
});

describe("Hextris clips", () => {
  it("turns clips on; a round plays, the pause holds it, the rest has no run", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("hextris")).toBe(true);
    expect(runClipPhase("playing")).toBe("playing");
    expect(runClipPhase("paused")).toBe("hold");
    expect(runClipPhase("idle")).toBe("idle");
    expect(runClipPhase("game-over")).toBe("idle");
  });
});

describe("Hextris sounds on the game-audio bus", () => {
  let mock: AudioMock;

  beforeEach(() => {
    mock = installAudioMock();
    localStorage.clear();
  });

  afterEach(() => {
    releaseSounds();
    removeAudioMock();
    act(() => useHextrisStore.setState({ status: "idle" }));
  });

  const SOUNDS: HextrisSound[] = ["rotate", "land", "match", "game-over"];

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

  it("the store's spin plays through the bus, whatever the sound switch says (the switch is the speaker)", () => {
    act(() => {
      useHextrisStore.getState().startGame();
      useHextrisStore.setState({ progress: { ...useHextrisStore.getState().progress, soundEnabled: false } });
      useHextrisStore.getState().rotateLeft();
    });
    const ctx = mock.lastContext();
    expect(ctx.createOscillator.mock.results.length).toBe(1);
  });

  it("does nothing, and throws nothing, with no Web Audio", () => {
    removeAudioMock();
    expect(() => playSound("land")).not.toThrow();
    expect(getGameAudio()).toBeNull();
  });
});
