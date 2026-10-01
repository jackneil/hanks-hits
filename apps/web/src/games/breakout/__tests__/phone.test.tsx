/**
 * Breakout on a phone (PR-G3): the field fits the play box both ways up,
 * the result is a ResultCard with the shared chip (Next level waits out the
 * grace too), clips run per game, and sound goes through the game-audio bus.
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
import { clipsEnabledFor } from "@/shared/clips";
import { getGameAudio, getGameAudioTapPoint, isGameSpeakerEnabled } from "@/shared/lib/audio";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { BreakoutGame, SOUND_LABELS } from "../Game";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../lib/constants";
import { breakoutLayout, HUD_COLUMN_PX, HUD_ROW_PX } from "../lib/layout";
import { playSound, releaseSounds, type BreakoutSound } from "../lib/sounds";
import { useBreakoutStore } from "../lib/store";
import { runClipPhase } from "../lib/useBreakoutClips";
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

describe("Breakout layout", () => {
  it("fits the whole field in the play box on every iPhone screen, with the HUD beside it sideways", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const layout = breakoutLayout(box);
      expect(layout.sideways, name).toBe(box.width > box.height);
      expect(layout.canvas.height, name).toBeLessThanOrEqual(box.height - (layout.sideways ? 0 : HUD_ROW_PX));
      expect(layout.canvas.width + (layout.sideways ? 2 * HUD_COLUMN_PX : 0), name).toBeLessThanOrEqual(box.width);
      // The field keeps its shape.
      expect(layout.canvas.width / layout.canvas.height, name).toBeCloseTo(CANVAS_WIDTH / CANVAS_HEIGHT, 1);
    }
  });

  it("uses most of an upright phone (the old field put the paddle 400 px below a sideways screen)", () => {
    const upright = breakoutLayout(BOXES.seUpright);
    expect(upright.canvas.height / BOXES.seUpright.height).toBeGreaterThan(0.8);
    const sideways = breakoutLayout(BOXES.seSideways);
    expect(sideways.canvas.height / BOXES.seSideways.height).toBeGreaterThan(0.9);
  });
});

describe("Breakout result", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    localStorage.clear();
    act(() => useBreakoutStore.getState().startGame());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    act(() => useBreakoutStore.setState({ status: "idle" }));
  });

  it("shows the result as a card at the top of the field with the chip under it", () => {
    render(<BreakoutGame />);
    act(() => {
      useBreakoutStore.setState({ score: 320 });
      useBreakoutStore.getState().gameOver();
    });
    const card = screen.getByTestId("breakout-result-card");
    expect(card).toHaveTextContent("Game over!");
    expect(card).toHaveTextContent("Score 320");
    expect(card.className).toContain("top-0");
    expect(screen.getByTestId("result-chip")).toBeInTheDocument();
  });

  it("Next level waits out the grace, like Play again", () => {
    render(<BreakoutGame />);
    act(() => useBreakoutStore.setState({ status: "level-complete", level: 1 }));
    expect(screen.getByTestId("breakout-result-card")).toHaveTextContent("Level 1 done!");
    const next = within(screen.getByTestId("result-chip")).getByTestId("breakout-next-level");
    fireEvent.click(next);
    expect(useBreakoutStore.getState().status).toBe("level-complete");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.click(next);
    expect(useBreakoutStore.getState().level).toBe(2);
  });
});

describe("Breakout clips", () => {
  it("turns clips on; a round plays, the pause and the level card hold the run, the rest has none", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("breakout")).toBe(true);
    expect(runClipPhase("playing")).toBe("playing");
    expect(runClipPhase("paused")).toBe("hold");
    expect(runClipPhase("level-complete")).toBe("hold");
    expect(runClipPhase("idle")).toBe("idle");
    expect(runClipPhase("game-over")).toBe("idle");
  });
});

describe("Breakout sounds on the game-audio bus", () => {
  let mock: AudioMock;

  beforeEach(() => {
    mock = installAudioMock();
    localStorage.clear();
    useBreakoutStore.setState({ status: "idle" });
  });

  afterEach(() => {
    releaseSounds();
    removeAudioMock();
  });

  const SOUNDS: BreakoutSound[] = ["bounce", "break", "powerup", "lose-life", "level-complete", "game-over"];

  it.each(SOUNDS)("%s reaches the clip tap point and the speakers, only through the game's channel", (sound) => {
    expect(getGameAudio()).not.toBeNull();
    const ctx = mock.lastContext();
    const oscillatorsBefore = ctx.createOscillator.mock.results.length;
    const gainsBefore = ctx.createGain.mock.results.length;
    playSound(sound);
    const created = ctx.createOscillator.mock.results;
    const oscillator = created[created.length - 1].value as FakeOscillatorNode;
    expect(oscillator.started).toBe(true);
    const tap = getGameAudioTapPoint() as unknown as FakeAudioNode;
    expect(pathExists(oscillator, tap)).toBe(true);
    expect(pathExists(oscillator, ctx.destination)).toBe(true);
    const made = [
      ...ctx.createOscillator.mock.results.slice(oscillatorsBefore),
      ...ctx.createGain.mock.results.slice(gainsBefore),
    ].map((result) => result.value as FakeAudioNode);
    for (const node of made) expect(isConnected(node, ctx.destination)).toBe(false);
  });

  it("makes no AudioContext at page load", () => {
    removeAudioMock();
    mock = installAudioMock();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    render(<BreakoutGame />);
    expect(mock.contexts.length).toBe(0);
    vi.unstubAllGlobals();
  });

  it("does nothing, and throws nothing, with no Web Audio", () => {
    removeAudioMock();
    expect(() => playSound("bounce")).not.toThrow();
    expect(getGameAudio()).toBeNull();
  });

  it("the sound switch turns this game's speakers off and on", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    act(() => useBreakoutStore.getState().startGame());
    render(<BreakoutGame />);
    expect(isGameSpeakerEnabled("breakout")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: SOUND_LABELS.on }));
    expect(isGameSpeakerEnabled("breakout")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: SOUND_LABELS.off }));
    expect(isGameSpeakerEnabled("breakout")).toBe(true);
    vi.unstubAllGlobals();
  });
});
