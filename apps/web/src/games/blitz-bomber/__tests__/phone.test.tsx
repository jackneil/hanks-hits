/**
 * Blitz Bomber on a phone (PR-G4): the whole sky fits the play box both
 * ways up, a tap anywhere drops a bomb (and never skips a result), the
 * result is a ResultCard with the shared chip (Next level after a landing),
 * clips run per run, and the game has sound on the game-audio bus.
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
import { clipsEnabledFor } from "@/shared/clips";
import { getGameAudio, getGameAudioTapPoint, isGameSpeakerEnabled } from "@/shared/lib/audio";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { BlitzBomberGame, NEXT_LEVEL_LABEL, SOUND_LABELS, resultText } from "../Game";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../lib/constants";
import { blitzLayout, EDGE_PX, spriteBoost } from "../lib/layout";
import { playSound, releaseSounds, type BlitzBomberSound } from "../lib/sounds";
import { useBlitzBomberStore } from "../lib/store";
import { runClipPhase } from "../lib/useBlitzBomberClips";
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

describe("Blitz Bomber layout", () => {
  it("fits the whole 800 x 600 sky in the play box on every iPhone screen", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const fit = blitzLayout(box);
      expect(fit.width + 2 * EDGE_PX, name).toBeLessThanOrEqual(box.width);
      expect(fit.height + 2 * EDGE_PX, name).toBeLessThanOrEqual(box.height);
      expect(fit.width / fit.height, name).toBeCloseTo(CANVAS_WIDTH / CANVAS_HEIGHT, 1);
      // Held sideways the field is as tall as the box (it used to run below the screen).
      if (box.width > box.height) expect(fit.height / box.height, name).toBeGreaterThan(0.9);
      // Upright it spans the width.
      else expect(fit.width, name).toBeGreaterThanOrEqual(box.width - 2 * EDGE_PX - 1);
    }
  });

  it("draws the plane and bombs bigger on a small field, never smaller, at most 1.4x", () => {
    expect(spriteBoost(1)).toBe(1);
    expect(spriteBoost(0.6)).toBe(1);
    expect(spriteBoost(blitzLayout(BOXES.seUpright).scale)).toBeGreaterThan(1.1);
    expect(spriteBoost(0.2)).toBe(1.4);
    expect(spriteBoost(0)).toBe(1);
  });
});

describe("Blitz Bomber on screen", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    localStorage.clear();
    mockPointer(true);
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    act(() => useBlitzBomberStore.getState().startGame());
  });

  afterEach(() => {
    liftAllFingers();
    resetPointerMock();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    act(() => useBlitzBomberStore.getState().reset());
  });

  it("a tap on the sky around the field drops a bomb too", () => {
    render(<BlitzBomberGame />);
    fingerTap(screen.getByTestId("blitz-bomber-root"), { x: 5, y: 5 });
    expect(useBlitzBomberStore.getState().bombs).toHaveLength(1);
  });

  it("a crash shows a card at the top of the field and the chip; a tap on the field does not restart", () => {
    render(<BlitzBomberGame />);
    act(() => {
      useBlitzBomberStore.setState({ score: 70 });
      useBlitzBomberStore.getState().crash();
    });
    const card = screen.getByTestId("blitz-bomber-result-card");
    expect(card).toHaveTextContent("Crashed!");
    expect(card).toHaveTextContent("Score 70");
    expect(card.className).toContain("top-0");
    fingerTap(screen.getByTestId("blitz-bomber-root"), { x: 100, y: 100 });
    expect(useBlitzBomberStore.getState().gameState).toBe("crashed");
    const chip = screen.getByTestId("result-chip");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    const sound = within(chip).getByTestId("result-chip-sound");
    fireEvent.click(sound);
    expect(isGameSpeakerEnabled("blitz-bomber")).toBe(false);
    expect(sound).toHaveTextContent(SOUND_LABELS.off);
    fireEvent.click(sound);
    const runBefore = useBlitzBomberStore.getState().runId;
    fireEvent.click(within(chip).getByRole("button", { name: /play again/i }));
    // Play again is a new run at once, at the same difficulty (no start card).
    expect(useBlitzBomberStore.getState().gameState).toBe("playing");
    expect(useBlitzBomberStore.getState().runId).toBe(runBefore + 1);
  });

  it("a landing offers Next level (not Play again), which goes on with the same run", () => {
    render(<BlitzBomberGame />);
    act(() => {
      useBlitzBomberStore.setState({ buildings: [] });
      useBlitzBomberStore.getState().land();
    });
    expect(screen.getByTestId("blitz-bomber-result-card")).toHaveTextContent("Landed!");
    const chip = screen.getByTestId("result-chip");
    expect(within(chip).queryByRole("button", { name: /play again/i })).toBeNull();
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    const runBefore = useBlitzBomberStore.getState().runId;
    fireEvent.click(within(chip).getByRole("button", { name: NEXT_LEVEL_LABEL }));
    expect(useBlitzBomberStore.getState().gameState).toBe("playing");
    expect(useBlitzBomberStore.getState().level).toBe(2);
    expect(useBlitzBomberStore.getState().runId).toBe(runBefore);
  });

  it("says the result out loud in whole sentences", () => {
    expect(resultText({ landed: false, score: 1, level: 1, newBest: false })).toBe("Crashed! You got 1 point on level 1.");
    expect(resultText({ landed: true, score: 900, level: 2, newBest: true })).toBe(
      "You landed! Level 2 done. You have 900 points. That is a new best!"
    );
  });
});

describe("Blitz Bomber clips", () => {
  it("turns clips on; the plane flies, the pause and a landing hold the run, the rest has none", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("blitz-bomber")).toBe(true);
    expect(runClipPhase("playing")).toBe("playing");
    expect(runClipPhase("paused")).toBe("hold");
    expect(runClipPhase("landed")).toBe("hold");
    expect(runClipPhase("crashed")).toBe("idle");
    expect(runClipPhase("ready")).toBe("idle");
  });
});

describe("Blitz Bomber sounds on the game-audio bus", () => {
  let mock: AudioMock;

  beforeEach(() => {
    mock = installAudioMock();
    localStorage.clear();
  });

  afterEach(() => {
    releaseSounds();
    removeAudioMock();
    act(() => useBlitzBomberStore.getState().reset());
  });

  const SOUNDS: BlitzBomberSound[] = ["drop", "hit", "crash", "land"];

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

  it("the store's bomb plays through the bus (the game had a sound setting and no sound)", () => {
    act(() => {
      useBlitzBomberStore.getState().startGame();
      useBlitzBomberStore.getState().dropBomb();
    });
    expect(mock.lastContext().createOscillator.mock.results.length).toBe(1);
  });

  it("does nothing, and throws nothing, with no Web Audio", () => {
    removeAudioMock();
    expect(() => playSound("hit")).not.toThrow();
    expect(getGameAudio()).toBeNull();
  });
});
