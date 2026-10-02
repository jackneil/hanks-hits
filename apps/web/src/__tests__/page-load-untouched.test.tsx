/**
 * A page load is not a player action.
 *
 * Each synced game or app is drawn as its page draws it, with the store
 * untouched (time 0), and runs for a few seconds without a tap. Its
 * progress time must stay 0: a page that stamps the time on load makes the
 * untouched defaults newer than the account, and the sign-in sync then
 * replaces the account's progress with them (review wave 3 of #26i: the
 * first joke of the joke generator, the time update of the virtual pet,
 * the rider save of Four-Wheeler 3D on pagehide).
 *
 * A store with real progress must also keep its time while useAuthSync is
 * not ready (the sync with the account still runs): a change on load must
 * wait for the account's progress.
 */
import { vi } from "vitest";

const sync = vi.hoisted(() => ({ ready: true }));

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: async () => {},
    ready: sync.ready,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/FullscreenButton", () => ({ FullscreenButton: () => null }));

vi.mock("@react-three/fiber", () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
  useFrame: vi.fn(),
  useLoader: vi.fn(),
  useThree: (selector?: (state: unknown) => unknown) => {
    const state = { camera: { position: { copy: vi.fn(), set: vi.fn() }, lookAt: vi.fn(), updateProjectionMatrix: vi.fn() }, gl: {} };
    return selector ? selector(state) : state;
  },
}));
vi.mock("@react-three/rapier", () => ({
  Physics: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RigidBody: () => null,
  CuboidCollider: () => null,
  CylinderCollider: () => null,
  BallCollider: () => null,
  HeightfieldCollider: () => null,
  ConvexHullCollider: () => null,
  useBeforePhysicsStep: vi.fn(),
  useAfterPhysicsStep: vi.fn(),
  useRapier: () => ({ world: { castRay: () => null } }),
}));
vi.mock("@react-three/drei", () => ({ Sky: () => null, Cloud: () => null, Html: () => null, Text: () => null }));

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import type { AppProgressData } from "@hank-neil/db/schema";
import { extractTimestamp } from "@/lib/progress-merge";
import { installAudioMock } from "@/__tests__/audio-mock";
import { installNoop2dContext } from "@/__tests__/noop-2d-context";
import { SYNCED_STORES, type SyncedStoreEntry } from "@/__tests__/synced-stores";

type Page = { appId: string; load: () => Promise<{ default: ComponentType }> };

const PAGES: Page[] = [
  { appId: "2048", load: () => import("@/games/2048/GameShell") },
  { appId: "arkanoid", load: () => import("@/games/arkanoid/ArkanoidGameShell") },
  { appId: "asteroids", load: () => import("@/games/asteroids/AsteroidsGameShell") },
  { appId: "blitz-bomber", load: () => import("@/games/blitz-bomber/BlitzBomberGameShell") },
  { appId: "bomberman", load: () => import("@/games/bomberman/BombermanGameShell") },
  { appId: "breakout", load: () => import("@/games/breakout/BreakoutGameShell") },
  { appId: "checkers", load: () => import("@/games/checkers/GameShell") },
  { appId: "chess", load: () => import("@/games/chess/GameShell") },
  { appId: "cookie-clicker", load: () => import("@/games/cookie-clicker") },
  { appId: "dino-runner", load: () => import("@/games/dino-runner/GameShell") },
  { appId: "endless-runner", load: () => import("@/games/endless-runner/GameShell") },
  { appId: "flappy-bird", load: () => import("@/games/flappy-bird/GameShell") },
  { appId: "four-wheeler-3d", load: () => import("@/games/four-wheeler-3d/GameShell") },
  { appId: "hextris", load: () => import("@/games/hextris/HextrisGameShell") },
  { appId: "hill-climb", load: () => import("@/games/hill-climb/GameShell") },
  { appId: "math-attack", load: () => import("@/games/math-attack/GameShell") },
  { appId: "memory-match", load: () => import("@/games/memory-match/MemoryMatchGameShell") },
  { appId: "monster-truck", load: () => import("@/games/monster-truck/GameShell") },
  { appId: "oregon-trail", load: () => import("@/games/oregon-trail/OregonTrailGameShell") },
  { appId: "platformer", load: () => import("@/games/platformer/PlatformerGameShell") },
  { appId: "quoridor", load: () => import("@/games/quoridor/GameShell") },
  { appId: "retro-arcade", load: () => import("@/games/retro-arcade") },
  { appId: "snake", load: () => import("@/games/snake/SnakeGameShell") },
  { appId: "space-invaders", load: () => import("@/games/space-invaders/SpaceInvadersGameShell") },
  { appId: "wordle", load: () => import("@/games/wordle/GameShell") },
  { appId: "drawing-app", load: () => import("@/apps/drawing-app") },
  { appId: "drum-machine", load: () => import("@/apps/drum-machine") },
  { appId: "joke-generator", load: () => import("@/apps/joke-generator") },
  { appId: "toy-finder", load: () => import("@/apps/toy-finder") },
  { appId: "trivia", load: () => import("@/apps/trivia") },
  { appId: "virtual-pet", load: () => import("@/apps/virtual-pet") },
  { appId: "weather", load: () => import("@/apps/weather") },
];

const timeOf = (entry: SyncedStoreEntry) =>
  extractTimestamp(entry.store.getState().getProgress() as AppProgressData);

/** Draw the page and let it run `ms` with no tap. */
async function loadPage(page: Page, ms: number) {
  const { default: Component } = await page.load();
  render(<Component />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  // Leaving the page (unmount effects, pagehide) is not a player action either.
  window.dispatchEvent(new Event("pagehide"));
  cleanup();
}

let restoreCanvas: () => void = () => {};

beforeEach(() => {
  restoreCanvas = installNoop2dContext();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-02T13:00:00Z"));
  installAudioMock();
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // The weather page loads the weather of the saved place: no network here.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
});

afterEach(() => {
  cleanup();
  restoreCanvas();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sync.ready = true;
});

describe("every synced page has a page in this test", () => {
  it("lists the same apps as SYNCED_STORES", () => {
    expect(PAGES.map((page) => page.appId).sort()).toEqual(
      SYNCED_STORES.filter((entry) => entry.appId !== "achievements")
        .map((entry) => entry.appId)
        .sort()
    );
  });
});

describe.each(PAGES)("$appId", (page) => {
  const entry = () => SYNCED_STORES.find((candidate) => candidate.appId === page.appId)!;

  it("a page load keeps an untouched store untouched (time 0)", async () => {
    entry().reset();
    expect(timeOf(entry())).toBe(0);
    await loadPage(page, 3_000);
    expect(timeOf(entry())).toBe(0);
  });

  it("a page load keeps the time of real progress while the sync is not ready", async () => {
    entry().reset();
    entry().store.getState().setProgress({
      ...(entry().store.getState().getProgress() as Record<string, unknown>),
      [entry().timeKey]: 1_000,
    } as never);
    sync.ready = false;
    await loadPage(page, 3_000);
    expect(timeOf(entry())).toBe(1_000);
  });
});
