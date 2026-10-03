import { describe, expect, it } from "vitest";
import { paint2048 } from "@/games/2048/lib/clipRenderer";
import { use2048Store } from "@/games/2048/lib/store";
import { paintSnake } from "@/games/snake/lib/clipRenderer";
import { useSnakeStore } from "@/games/snake/lib/store";
import { paintChess } from "@/games/chess/lib/clipRenderer";
import { useChessStore } from "@/games/chess/lib/store";
import { paintCheckers } from "@/games/checkers/lib/clipRenderer";
import { useCheckersStore } from "@/games/checkers/lib/store";
import { paintQuoridor } from "@/games/quoridor/lib/clipRenderer";
import { useQuoridorStore } from "@/games/quoridor/lib/store";
import { paintWordle } from "@/games/wordle/lib/clipRenderer";
import { useWordleStore } from "@/games/wordle/lib/store";
import { paintMemory } from "@/games/memory-match/lib/clipRenderer";
import { useMemoryMatchStore } from "@/games/memory-match/lib/store";
import { paintCookies } from "@/games/cookie-clicker/lib/clipRenderer";
import { useCookieClickerStore } from "@/games/cookie-clicker/lib/store";
import { oregonClipState, paintOregon } from "@/games/oregon-trail/lib/clipRenderer";
import { useOregonTrailStore } from "@/games/oregon-trail/lib/store";

type Command = [string, ...unknown[]];
function capture<T>(paint: (context: CanvasRenderingContext2D, state: T) => void, state: T): Command[] {
  const commands: Command[] = [];
  const context = new Proxy({}, {
    get: (_, property) => (...args: unknown[]) => commands.push([String(property), ...args]),
    set: (_, property, value) => { commands.push([String(property), value]); return true; },
  }) as CanvasRenderingContext2D;
  paint(context, state);
  return commands;
}

// These fixtures exercise the board contents, not just the headline score.
describe("semantic game recordings", () => {
  it("captures actual hunt-result totals instead of substituting the journey board", () => {
    const result = { food: 62, ammo: 7, score: 150, outOfBullets: false };
    const state = { ...useOregonTrailStore.getState(), gamePhase: "hunting" as const, leaderName: "PRIVATE LEADER" };
    const commands = capture(paintOregon, oregonClipState(state, result));
    const labels = commands.filter(command => command[0] === "fillText").map(command => command[1]);
    expect(labels).toEqual(expect.arrayContaining(["Hunt complete!", "62 lbs of meat", "7 bullets used", "Score: 150"]));
    expect(labels).not.toContain("PRIVATE LEADER");
    expect(labels.some(label => typeof label === "string" && label.includes("/ 2000 miles"))).toBe(false);
    const empty = capture(paintOregon, oregonClipState(state, { food: 0, ammo: 20, score: 0, outOfBullets: true }));
    expect(empty).toContainEqual(["fillText", "Out of bullets!", 320, 69]);
    expect(empty).not.toEqual(commands);
    const travel = capture(paintOregon, oregonClipState({ ...state, gamePhase: "travel" }, result));
    expect(travel.some(command => command[0] === "fillText" && command[1] === "Hunt complete!")).toBe(false);
  });
  it("records 2048 tile positions and new merged values", () => {
    const state = use2048Store.getState();
    const a = capture(paint2048, { ...state, grid: [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] });
    const b = capture(paint2048, { ...state, grid: [[4, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] });
    expect(b).not.toEqual(a);
    expect(b).toContainEqual(["fillText", "4", 107, 171]);
  });
  it("records the snake body and food at their real cells", () => {
    const s = useSnakeStore.getState();
    const a = capture(paintSnake, { ...s, snake: [{ x: 1, y: 2 }], food: { x: 10, y: 10 } });
    const b = capture(paintSnake, { ...s, snake: [{ x: 2, y: 2 }], food: { x: 10, y: 10 } });
    expect(a).not.toEqual(b);
    expect(a).toContainEqual(["fillRect", 61.8, 154.6, 26.8, 26.8]);
  });
  it("keeps chess orientation and all pieces for either chosen side", () => {
    const s = { ...useChessStore.getState(), gameMode: "ai" as const };
    const white = capture(paintChess, { ...s, playerColor: "white" as const });
    const black = capture(paintChess, { ...s, playerColor: "black" as const });
    expect(white.filter(c => c[0] === "strokeText")).toHaveLength(32);
    expect(white).toContainEqual(["fillText", "♔", 356, 637]);
    expect(black).toContainEqual(["fillText", "♔", 284, 133]);
  });
  it("shows checkers kings, captures, and final draw without inventing a winner", () => {
    const s = useCheckersStore.getState();
    const board = s.board.map(row => [...row]);
    board[0][1] = "red-king";
    const result = capture(paintCheckers, { ...s, board, status: "draw" as const });
    expect(result.some(c => c[0] === "fillText" && c[1] === "♛")).toBe(true);
    expect(result).toContainEqual(["fillText", "Draw", 320, 69]);
    expect(result).not.toEqual(capture(paintCheckers, s));
  });
  it("keeps Quoridor blue at the bottom and records exact placed wall geometry", () => {
    const s = useQuoridorStore.getState();
    const result = capture(paintQuoridor, { ...s, walls: [{ row: 1, col: 0, orientation: "horizontal" as const }] });
    expect(result).toContainEqual(["arc", 320, 644, 19, 0, Math.PI * 2]);
    expect(result).toContainEqual(["arc", 320, 124, 19, 0, Math.PI * 2]);
    expect(result).toContainEqual(["fillRect", 32, 607, 121, 9]);
  });
  it("does not render Wordle's answer, only visible tiles and feedback", () => {
    const s = { ...useWordleStore.getState(), targetWord: "SECRET", currentGuess: "CAT", gameState: "playing" as const };
    const result = capture(paintWordle, s);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result.some(c => c[0] === "fillText" && c[1] === "C")).toBe(false);
    expect(result.some(c => c[0] === "fillText" && c[1] === "•")).toBe(true);
    const privateInput = capture(paintWordle, { ...s, currentGuess: "ALICE" });
    for (const letter of "ALICE") expect(privateInput.some(c => c[0] === "fillText" && c[1] === letter)).toBe(false);
    const guessed = capture(paintWordle, { ...s, guesses: ["CAT"], results: [["correct", "present", "absent"]], currentRow: 1, currentGuess: "" });
    expect(guessed).toContainEqual(["fillStyle", "#22c55e"]);
    expect(guessed).toContainEqual(["fillStyle", "#eab308"]);
    expect(guessed.some(c => c[0] === "fillText" && c[1] === "C")).toBe(true);
  });
  it("never exposes the hidden faces in Memory Match", () => {
    const s = useMemoryMatchStore.getState();
    const cards = [{ id: 1, imageId: "🦊", isFlipped: false, isMatched: false }];
    expect(JSON.stringify(capture(paintMemory, { ...s, cards }))).not.toContain("🦊");
    expect(JSON.stringify(capture(paintMemory, { ...s, cards: [{ ...cards[0], isFlipped: true }] }))).toContain("🦊");
    expect(capture(paintMemory, { ...s, currentTime: 2300 })).toContainEqual(["fillText", "2 seconds", 320, 697]);
  });
  it("scales the whole recorded cookie and its chocolate chips only during a real press", () => {
    const s = useCookieClickerStore.getState();
    const idle = capture(paintCookies, { ...s, pressed: false });
    const pressed = capture(paintCookies, { ...s, pressed: true });
    expect(idle).toContainEqual(["scale", 1, 1]);
    const scale = pressed.findIndex(command => command[0] === "scale");
    const restored = pressed.findIndex(command => command[0] === "restore");
    expect(pressed[scale]).toEqual(["scale", 0.95, 0.95]);
    expect(pressed.slice(scale, restored).filter(command => command[0] === "arc" && command[3] === 13)).toHaveLength(7);
    const oddCount = capture(paintCookies, { ...s, totalClicks: s.totalClicks + 1, pressed: false });
    expect(oddCount.filter(command => command[0] !== "fillText")).toEqual(idle.filter(command => command[0] !== "fillText"));
  });
  it("shows Cookie Clicker purchases and real tap feedback", () => {
    const s = useCookieClickerStore.getState();
    const initial = capture(paintCookies, s);
    const updated = capture(paintCookies, { ...s, totalClicks: s.totalClicks + 1, buildings: { ...s.buildings, grandma: 3 } });
    expect(updated).not.toEqual(initial);
    expect(updated.some(c => c[0] === "fillText" && String(c[1]).includes("Grandma: 3"))).toBe(true);
  });
  it("cannot read Oregon names, event messages, or custom river names", () => {
    const forbidden = () => { throw new Error("private field read"); };
    const source = { ...useOregonTrailStore.getState(), party: [{ id: "p1", health: "good" as const, isSick: false, sickDays: 0, leftBehind: false, get name(): string { return forbidden(); } }], get leaderName(): string { return forbidden(); }, currentEvent: { id: "broken-wheel", get title(): string { return forbidden(); }, get message(): string { return forbidden(); }, category: "severe" as const, probability: 0, effect: {} }, currentRiver: { depth: 5, get name(): string { return forbidden(); } } };
    const snapshot = oregonClipState(source);
    expect(snapshot.members).toEqual([{ health: "good", sick: false, left: false }]);
    const initial = capture(paintOregon, snapshot);
    const moved = capture(paintOregon, { ...snapshot, miles: 110, day: 5, phase: "river" as const });
    expect(moved).not.toEqual(initial);
    expect(JSON.stringify(snapshot)).not.toMatch(/name|message/i);
    expect(capture(paintOregon, { ...snapshot, phase: "event" })).toContainEqual(["fillText", `Day ${snapshot.day} · Broken Wheel!`, 320, 69]);
  });
});

describe("recording restart boundaries", () => {
  it.each([
    ["2048", () => use2048Store.getState()],
    ["chess", () => useChessStore.getState()],
    ["checkers", () => useCheckersStore.getState()],
    ["quoridor", () => useQuoridorStore.getState()],
    ["memory-match", () => useMemoryMatchStore.getState()],
  ] as const)("%s increments on every restart even before another move", (_, getState) => {
    const previous = getState().clipRunId;
    getState().newGame();
    getState().newGame();
    expect(getState().clipRunId).toBe(previous + 2);
    expect(getState().getProgress()).not.toHaveProperty("clipRunId");
  });
  it("starts independent Snake and Wordle attempts", () => {
    for (const getState of [useSnakeStore.getState, useWordleStore.getState]) {
      const previous = getState().clipRunId;
      getState().startGame();
      getState().startGame();
      expect(getState().clipRunId).toBe(previous + 2);
      expect(getState().getProgress()).not.toHaveProperty("clipRunId");
    }
  });
});
