/**
 * Memory Match on a phone (PR-G5): the cards sized from the play box (44 px
 * or more for every size of game, both ways up), the pickers on the start
 * card instead of over the board, the win as a card with the shared chip
 * (Play again is a new deal at once), the round's clock stopped under the
 * shell's hold, and sound on the game-audio bus (the switch was a
 * placeholder floating over a card).
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
import { getGameAudio, getGameAudioTapPoint } from "@/shared/lib/audio";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { MemoryMatchGame, winText } from "../Game";
import { DIFFICULTIES, type Difficulty } from "../lib/constants";
import { CARD_GAP, EDGE, GAP, STATS_COLUMN, STATS_ROW, memoryLayout } from "../lib/layout";
import { playSound, releaseSounds, type MemoryMatchSound } from "../lib/sounds";
import { useMemoryMatchStore } from "../lib/store";

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

describe("Memory Match layout", () => {
  it("fits every size of game in the play box on every iPhone screen, cards 44 px or more", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      for (const level of Object.keys(DIFFICULTIES) as Difficulty[]) {
        const { rows, cols } = DIFFICULTIES[level];
        const { sideways, card } = memoryLayout(box, { rows, cols });
        const where = `${name} ${level}`;
        expect(card, where).toBeGreaterThanOrEqual(44);
        const boardWidth = cols * card + (cols - 1) * CARD_GAP;
        const boardHeight = rows * card + (rows - 1) * CARD_GAP;
        if (sideways) {
          expect(STATS_COLUMN + GAP + boardWidth + 2 * EDGE, where).toBeLessThanOrEqual(box.width);
          expect(boardHeight + 2 * EDGE, where).toBeLessThanOrEqual(box.height);
        } else {
          expect(boardWidth + 2 * EDGE, where).toBeLessThanOrEqual(box.width);
          expect(STATS_ROW + GAP + boardHeight + 2 * EDGE, where).toBeLessThanOrEqual(box.height);
        }
      }
    }
  });
});

describe("Memory Match on screen", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    localStorage.clear();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    act(() => useMemoryMatchStore.getState().newGame("easy", "animals"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("puts the card count and the pictures on the start card, and nothing but stats and cards on the play screen", () => {
    render(<MemoryMatchGame />);
    const start = screen.getByTestId("game-start-overlay");
    expect(within(start).getByRole("button", { name: "Easy" })).toBeInTheDocument();
    expect(within(start).getByTestId("theme-picker")).toBeInTheDocument();
    fireEvent.click(within(start).getByRole("button", { name: /play/i }));
    expect(screen.queryByTestId("theme-picker")).toBeNull();
    expect(screen.queryByRole("button", { name: /new game/i })).toBeNull();
    // The placeholder sound switch that floated over a card is gone.
    expect(screen.queryByTitle(/sound/i)).toBeNull();
  });

  it("names how to unlock a locked set of pictures in words, not in a tooltip", () => {
    render(<MemoryMatchGame />);
    expect(screen.getByTestId("theme-picker")).toHaveTextContent(/Win \d+ more/);
  });

  it("a win shows a card and the chip; Play again deals a new game at once", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    render(<MemoryMatchGame />);
    fireEvent.click(within(screen.getByTestId("game-start-overlay")).getByRole("button", { name: /play/i }));
    // Match every pair through the store (the cards' order is random).
    const cards = useMemoryMatchStore.getState().cards;
    const pairs = new Map<string, number[]>();
    cards.forEach((c, i) => pairs.set(c.imageId, [...(pairs.get(c.imageId) ?? []), i]));
    for (const [a, b] of pairs.values()) {
      act(() => {
        useMemoryMatchStore.getState().flipCard(a);
        useMemoryMatchStore.getState().flipCard(b);
      });
      act(() => vi.advanceTimersByTime(2000));
    }
    expect(useMemoryMatchStore.getState().isWon).toBe(true);
    expect(screen.getByTestId("memory-result-card")).toHaveTextContent("You won!");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.click(within(screen.getByTestId("result-chip")).getByRole("button", { name: /play again/i }));
    expect(useMemoryMatchStore.getState().isWon).toBe(false);
    expect(useMemoryMatchStore.getState().moves).toBe(0);
  });

  it("keeps one clock interval through a round (it was re-made on every tick and flip)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearInterval", "Date"] });
    const made = vi.spyOn(globalThis, "setInterval");
    const keys = vi.spyOn(window, "addEventListener");
    render(<MemoryMatchGame />);
    fireEvent.click(within(screen.getByTestId("game-start-overlay")).getByRole("button", { name: /play/i }));
    const clocksAtStart = made.mock.calls.filter(([, ms]) => ms === 100).length;
    const keyHandlersAtStart = keys.mock.calls.filter(([type]) => type === "keydown").length;
    act(() => {
      useMemoryMatchStore.getState().flipCard(0);
    });
    act(() => vi.advanceTimersByTime(1_000));
    expect(useMemoryMatchStore.getState().currentTime).toBeGreaterThan(0);
    expect(made.mock.calls.filter(([, ms]) => ms === 100).length).toBe(clocksAtStart);
    expect(keys.mock.calls.filter(([type]) => type === "keydown").length).toBe(keyHandlersAtStart);
  });

  it("says the win in whole sentences", () => {
    expect(winText({ moves: 8, time: 30_000, stars: 3, newBest: true })).toMatch(/^You won! 8 moves in .+\. You got 3 stars\. That is a new best time!$/);
    expect(winText({ moves: 12, time: 45_000, stars: 1, newBest: false })).toMatch(/You got 1 star\.$/);
  });
});

describe("Memory Match sounds on the game-audio bus", () => {
  let mock: AudioMock;

  beforeEach(() => {
    mock = installAudioMock();
  });

  afterEach(() => {
    releaseSounds();
    removeAudioMock();
  });

  const SOUNDS: MemoryMatchSound[] = ["flip", "match", "miss", "win"];

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

  it("a card flip in the store plays through the bus", () => {
    act(() => useMemoryMatchStore.getState().newGame("easy", "animals"));
    act(() => useMemoryMatchStore.getState().flipCard(0));
    expect(mock.lastContext().createOscillator.mock.results.length).toBe(1);
  });
});
