/**
 * Arkanoid on a phone (PR-G3): a square field that fits both ways up, a
 * ball that never tunnels through the paddle, three tries a run, a finger
 * that drags the paddle from anywhere and taps to launch, the result chip,
 * clips, and sound on the game-audio bus (it had a sound switch and no
 * sound).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
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
import { fingerDown, fingerMove, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { clipsEnabledFor } from "@/shared/clips";
import { getGameAudio, getGameAudioTapPoint, isGameSpeakerEnabled } from "@/shared/lib/audio";

import { ArkanoidGame, SOUND_LABELS, TAP_SLOP_PX } from "../Game";
import { ARENA, GAME, LIVES, PADDLE, PADDLE_LIMIT, PHYSICS, SPARKS_PER_TOUCH, START_BALLS } from "../lib/constants";
import { arkanoidLayout, HUD_COLUMN_PX, HUD_ROW_PX } from "../lib/layout";
import { containBall, FALL_OUT_Y, splitOnWall, stepBall, stepWorld } from "../lib/physics";
import { playSound, releaseSounds, type ArkanoidSound } from "../lib/sounds";
import { useArkanoidStore, type Ball } from "../lib/store";
import { runClipPhase } from "../lib/useArkanoidClips";
import { metadata } from "../metadata";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

const BOXES = {
  seUpright: { width: 375, height: 549 - 48 },
  bigUpright: { width: 390, height: 664 - 48 },
  seSideways: { width: 667, height: 311 - 44 },
  bigSideways: { width: 844, height: 340 - 44 },
};

const ball = (over: Partial<Ball> = {}): Ball => ({ id: "b", type: "blue", x: 0, y: 0, vx: 0, vy: 0, ...over });

describe("Arkanoid layout", () => {
  it("fits a square field in the play box on every iPhone screen, with room for the HUD", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const { sideways, field } = arkanoidLayout(box);
      expect(field.width, name).toBe(field.height);
      expect(field.height + (sideways ? 0 : HUD_ROW_PX), name).toBeLessThanOrEqual(box.height);
      expect(field.width + (sideways ? 2 * HUD_COLUMN_PX : 0), name).toBeLessThanOrEqual(box.width);
      // Held sideways it takes most of the height (the paddle used to be below the screen).
      if (sideways) expect(field.height / box.height, name).toBeGreaterThan(0.85);
    }
  });
});

describe("Arkanoid physics", () => {
  it("never lets a ball at the speed cap tunnel through the paddle", () => {
    const paddleTop = PADDLE.y + PADDLE.height / 2;
    const r = 0.03;
    // Just above the paddle, falling at the cap: one 50 ms step would carry it far past the paddle.
    const start = ball({ x: 0, y: paddleTop + r + 0.01, vx: 0, vy: -PHYSICS.maxVelocity });
    const { ball: after, hitPaddle } = stepBall(start, 0, 0.05);
    expect(hitPaddle).toBe(true);
    expect(after.vy).toBeGreaterThan(0);
    expect(after.y).toBeGreaterThanOrEqual(paddleTop);
  });

  it("lets a ball past the paddle's side fall by", () => {
    const paddleTop = PADDLE.y + PADDLE.height / 2;
    const start = ball({ x: 0.8, y: paddleTop + 0.05, vx: 0, vy: -2 });
    expect(stepBall(start, -0.5, 0.05).hitPaddle).toBe(false);
  });

  it("puts a new ball placed past the top wall back inside, moving down (it bounced on top of the frame for ever)", () => {
    const r = 0.036;
    const { ball: inside, moved } = containBall(ball({ type: "orange", x: 0.3, y: 0.99, vx: 0.5, vy: 1 }));
    expect(moved).toBe(true);
    expect(inside.y).toBeCloseTo(ARENA.top - r, 9);
    expect(inside.vy).toBeLessThan(0);
    expect(inside.vx).toBe(0.5);
    const { ball: left } = containBall(ball({ x: -0.99, y: 0, vx: -1, vy: 0 }));
    expect(left.x).toBeCloseTo(ARENA.left + 0.03, 9);
    expect(left.vx).toBeGreaterThan(0);
    const still = ball({ x: 0, y: 0, vx: 1, vy: 1 });
    expect(containBall(still)).toEqual({ ball: still, moved: false });
  });

  it("never carries a ball at the speed cap through the top or a side wall in one long frame", () => {
    const r = 0.03;
    const up = stepBall(ball({ x: 0.3, y: ARENA.top - r - 0.005, vx: 0, vy: PHYSICS.maxVelocity }), -0.8, 0.05);
    expect(up.hitWall).toBe(true);
    expect(up.ball.y).toBeLessThanOrEqual(ARENA.top - r);
    expect(up.ball.vy).toBeLessThan(0);
    const right = stepBall(ball({ x: ARENA.right - r - 0.005, y: -0.2, vx: PHYSICS.maxVelocity, vy: 0 }), -0.8, 0.05);
    expect(right.ball.x).toBeLessThanOrEqual(ARENA.right - r);
    expect(right.ball.vx).toBeLessThan(0);
  });

  it("keeps every ball inside the arena through 600 long frames (200 random balls)", () => {
    // A small seeded generator, so a failure is the same on every run.
    let seed = 20260930;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let escaped = 0;
    for (let n = 0; n < 200; n++) {
      const angle = rand() * Math.PI * 2;
      const speed = PHYSICS.maxVelocity * (0.2 + 0.8 * rand());
      let b = ball({
        type: rand() < 0.5 ? "blue" : "orange",
        x: (rand() * 2 - 1) * 0.85,
        y: rand() * 0.8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      });
      const paddleX = (rand() * 2 - 1) * PADDLE_LIMIT;
      for (let frame = 0; frame < 600 && b.y >= FALL_OUT_Y; frame++) {
        b = stepBall(b, paddleX, 0.05).ball;
        const radius = b.type === "orange" ? 0.036 : 0.03;
        if (b.x < ARENA.left + radius - 1e-9 || b.x > ARENA.right - radius + 1e-9 || b.y > ARENA.top - radius + 1e-9) {
          escaped++;
          break;
        }
      }
    }
    expect(escaped).toBe(0);
  });

  it("bounces off the top wall straight down, far from its middle (it used to count as a side hit)", () => {
    // The top wall is 2 wide and 0.05 thick at y 0.95. A ball near its right end, going up.
    const start = ball({ x: 0.6, y: 0.88, vx: 0.2, vy: 1.5 });
    const { ball: after, hitWall } = stepBall(start, 0, 0.03);
    expect(hitWall).toBe(true);
    expect(after.vy).toBeLessThan(0);
    expect(after.vx).toBeGreaterThan(0); // not flipped
    expect(after.x).toBeLessThan(0.7); // not thrown to the wall's end
  });
});

describe("Arkanoid splits come from the paddle", () => {
  it("a paddle bounce is never straight up, and gives the ball its sparks again", () => {
    const paddleTop = PADDLE.y + PADDLE.height / 2;
    const r = 0.03;
    // Dead centre of the paddle, falling straight down, no sparks left.
    const { ball: after, hitPaddle } = stepBall(ball({ x: 0, y: paddleTop + r + 0.005, vx: 0, vy: -1.5, sparks: 0 }), 0, 1 / 60);
    expect(hitPaddle).toBe(true);
    expect(Math.abs(after.vx)).toBeGreaterThanOrEqual(PHYSICS.minBounceVx);
    expect(after.sparks).toBe(SPARKS_PER_TOUCH);
  });

  it("splits only with a spark left; parent and child keep what is left", () => {
    const parent = ball({ type: "blue", x: 0.2, y: 0.5, vx: 1, vy: 1, sparks: 3 });
    expect(splitOnWall({ ...parent, sparks: 0 }, 0, 0, 0.5)).toBeNull();
    expect(splitOnWall({ ...parent, sparks: undefined }, 0, 0, 0.5)).toBeNull();
    // A roll at or over the type's chance: no split.
    expect(splitOnWall(parent, 0.15, 0, 0.5)).toBeNull();
    const split = splitOnWall(parent, 0.05, Math.PI / 2, 0.5)!;
    expect(split.parent.sparks).toBe(2);
    expect(split.child.sparks).toBe(2);
    expect(split.child.type).toBe("blue");
    // Placed three radii up, inside the arena.
    expect(split.child.y).toBeCloseTo(0.5 + 0.09, 9);
    // A split beside the top wall places the new ball inside, not past it.
    const high = splitOnWall({ ...parent, y: ARENA.top - 0.03 }, 0.05, Math.PI / 2, 0.5)!;
    expect(high.child.y).toBeLessThanOrEqual(ARENA.top - 0.03);
  });
});

describe("Arkanoid runs end, and play grows the field", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => act(() => useArkanoidStore.setState({ gameState: "menu" })));

  /**
   * One run by the real rules (the store's launch and lives, the game's
   * stepWorld), 60 steps a second, with a scripted paddle and seeded rolls.
   */
  function playRun(seed: number, paddle: (x: number, balls: Ball[]) => number, seconds: number) {
    let state = seed;
    const random = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const store = useArkanoidStore.getState();
    act(() => {
      store.startGame();
      useArkanoidStore.getState().launchBall();
    });
    let balls = useArkanoidStore.getState().balls;
    let x = 0;
    let peak = balls.length;
    let id = 0;
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      x = Math.max(-PADDLE_LIMIT, Math.min(PADDLE_LIMIT, paddle(x, balls)));
      const world = stepWorld(balls, x, dt, random, GAME.maxBalls);
      balls = [...world.balls, ...world.born.map((b) => ({ ...b, id: `sim-${id++}` }))];
      peak = Math.max(peak, balls.length);
      if (balls.length === 0) {
        act(() => {
          useArkanoidStore.setState({ paddleX: x });
          useArkanoidStore.getState().loseLife();
        });
        if (useArkanoidStore.getState().gameState !== "playing") return { endedAt: t, peak };
        act(() => useArkanoidStore.getState().launchBall());
        balls = useArkanoidStore.getState().balls;
      }
    }
    return { endedAt: null, peak };
  }

  const SEEDS = [11, 22, 33, 44, 55];

  it("ends a run with a still paddle, in the middle or at a wall (it never ended, and the score climbed on its own)", () => {
    for (const seed of SEEDS) {
      expect(playRun(seed, () => 0, 120).endedAt, `middle, seed ${seed}`).not.toBeNull();
      expect(playRun(seed, () => -PADDLE_LIMIT, 120).endedAt, `wall, seed ${seed}`).not.toBeNull();
    }
  });

  it("a paddle that follows the balls keeps the run going and grows the field to the 10x multiplier within a round", () => {
    // Under the lowest falling ball, at 3 field units a second.
    const follow = (x: number, balls: Ball[]) => {
      const next = balls.filter((b) => b.vy < 0).sort((a, b) => a.y - b.y)[0];
      if (!next) return x;
      const gap = next.x - x;
      return x + Math.sign(gap) * Math.min(Math.abs(gap), 3 / 60);
    };
    // Within one round (the design's 2 to 3 minutes): measured peaks at
    // 180 s are 59 to 99 over these seeds; at 120 s one seed has only 45.
    for (const seed of SEEDS) {
      const run = playRun(seed, follow, 180);
      expect(run.endedAt, `seed ${seed}`).toBeNull();
      expect(run.peak, `seed ${seed}`).toBeGreaterThanOrEqual(GAME.multipliers[10]);
    }
  });
});

describe("Arkanoid store", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => useArkanoidStore.getState().startGame());
  });

  it("gives three tries: a lost life puts new balls on the paddle, the last one ends the run", () => {
    const start = useArkanoidStore.getState();
    expect(start.lives).toBe(LIVES);
    act(() => useArkanoidStore.setState({ balls: [] }));
    act(() => useArkanoidStore.getState().loseLife());
    let s = useArkanoidStore.getState();
    expect(s.lives).toBe(LIVES - 1);
    expect(s.gameState).toBe("playing");
    expect(s.balls).toHaveLength(START_BALLS);
    expect(s.balls.every((b) => b.stuck)).toBe(true);
    act(() => useArkanoidStore.getState().loseLife());
    act(() => useArkanoidStore.getState().loseLife());
    s = useArkanoidStore.getState();
    expect(s.lives).toBe(0);
    expect(s.gameState).toBe("gameOver");
  });

  it("counts every start as a new run", () => {
    const before = useArkanoidStore.getState().runId;
    act(() => useArkanoidStore.getState().startGame());
    expect(useArkanoidStore.getState().runId).toBe(before + 1);
  });

  it("keeps the paddle between the side walls", () => {
    act(() => useArkanoidStore.getState().setPaddleX(5));
    expect(useArkanoidStore.getState().paddleX).toBe(PADDLE_LIMIT);
    act(() => useArkanoidStore.getState().setPaddleX(-5));
    expect(useArkanoidStore.getState().paddleX).toBe(-PADDLE_LIMIT);
  });
});

describe("Arkanoid finger", () => {
  beforeEach(() => {
    localStorage.clear();
    mockPointer(true);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    act(() => useArkanoidStore.getState().startGame());
  });

  afterEach(() => {
    liftAllFingers();
    resetPointerMock();
    vi.unstubAllGlobals();
    act(() => useArkanoidStore.setState({ gameState: "menu" }));
  });

  function renderWithField() {
    render(<ArkanoidGame />);
    const canvas = screen.getByTestId("arkanoid-canvas");
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return screen.getByTestId("arkanoid-root");
  }

  it("a drag anywhere moves the paddle by the finger's motion and never launches", () => {
    const root = renderWithField();
    const before = useArkanoidStore.getState().paddleX;
    fingerDown(root, { id: 1, x: 100, y: 500 });
    fingerMove(root, { id: 1, x: 130, y: 500 });
    fingerUp(root, { id: 1, x: 130, y: 500 });
    // 30 px of a 300 px field is a tenth of its width: 0.2 in -1..1 units.
    expect(useArkanoidStore.getState().paddleX).toBeCloseTo(before + 0.2, 5);
    expect(useArkanoidStore.getState().balls.every((b) => b.stuck)).toBe(true);
  });

  it("a tap launches the resting balls", () => {
    const root = renderWithField();
    fingerDown(root, { id: 1, x: 100, y: 500 });
    fingerUp(root, { id: 1, x: 100 + TAP_SLOP_PX - 1, y: 500 });
    expect(useArkanoidStore.getState().balls.every((b) => !b.stuck)).toBe(true);
  });
});

describe("Arkanoid clips", () => {
  it("turns clips on; balls fly, the pause holds, the rest has no run", () => {
    expect(metadata.clips).toBe(true);
    expect(clipsEnabledFor("arkanoid")).toBe(true);
    expect(runClipPhase("playing")).toBe("playing");
    expect(runClipPhase("paused")).toBe("hold");
    expect(runClipPhase("menu")).toBe("idle");
    expect(runClipPhase("gameOver")).toBe("idle");
  });
});

describe("Arkanoid sounds on the game-audio bus", () => {
  let mock: AudioMock;

  beforeEach(() => {
    mock = installAudioMock();
    localStorage.clear();
  });

  afterEach(() => {
    releaseSounds();
    removeAudioMock();
  });

  const SOUNDS: ArkanoidSound[] = ["launch", "paddle", "split", "lose-life", "game-over"];

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

  it("makes no AudioContext at page load, and the sound switch is this game's speaker", () => {
    removeAudioMock();
    mock = installAudioMock();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    act(() => useArkanoidStore.setState({ gameState: "menu", soundEnabled: true }));
    render(<ArkanoidGame />);
    expect(mock.contexts.length).toBe(0);
    expect(isGameSpeakerEnabled("arkanoid")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: SOUND_LABELS.on }));
    expect(isGameSpeakerEnabled("arkanoid")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: SOUND_LABELS.off }));
    expect(isGameSpeakerEnabled("arkanoid")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("does nothing, and throws nothing, with no Web Audio", () => {
    removeAudioMock();
    expect(() => playSound("launch")).not.toThrow();
    expect(getGameAudio()).toBeNull();
  });
});
