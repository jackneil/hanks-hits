import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";

const mock = vi.hoisted(() => ({
  snapshot: { status: "ready", ownerKey: "guest", generation: 1 },
  listeners: new Set<() => void>(),
  whenHydrated: vi.fn(), isHydrated: vi.fn(), reload: vi.fn(),
}));
vi.mock("@/lib/owner-bound-progress", () => ({
  PROGRESS_STORAGE_KEYS: { snake: "snake-game-state", weather: "weather-storage" },
  ownerBoundProgress: {
    getSnapshot: () => mock.snapshot,
    subscribe: (listener: () => void) => { mock.listeners.add(listener); return () => mock.listeners.delete(listener); },
    whenHydrated: mock.whenHydrated, isHydrated: mock.isHydrated,
  },
}));
vi.mock("@/lib/auth-client", () => ({ reloadProgressPage: mock.reload }));
import { ProgressHydrationBoundary } from "../ProgressHydrationBoundary";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { vi.clearAllMocks(); mock.snapshot = { status: "ready", ownerKey: "guest", generation: 1 }; mock.isHydrated.mockReturnValue(false); });
afterEach(cleanup);

describe("progress route hydration", () => {
  it("starts the import outside blocked children and waits for actual persist completion", async () => {
    const routeModule = deferred(), hydration = deferred(), mounted = vi.fn();
    const load = vi.fn(() => routeModule.promise);
    mock.whenHydrated.mockReturnValue(hydration.promise);
    function Game() { useEffect(mounted, []); return <button>Play</button>; }
    render(<ProgressHydrationBoundary appId="snake" loadModule={load}><Game /></ProgressHydrationBoundary>);
    expect(load).toHaveBeenCalledOnce();
    expect(mock.whenHydrated).not.toHaveBeenCalled();
    expect(mounted).not.toHaveBeenCalled();
    await act(async () => routeModule.resolve());
    expect(mock.whenHydrated).toHaveBeenCalledWith("snake-game-state");
    expect(screen.queryByText("Play")).toBeNull();
    mock.isHydrated.mockReturnValue(true);
    await act(async () => hydration.resolve());
    expect(screen.getByRole("button", { name: "Play" })).toBeVisible();
    expect(mounted).toHaveBeenCalledOnce();
  });

  it("mounts gameplay after progress hydration without waiting for word storage", async () => {
    mock.isHydrated.mockReturnValue(true); mock.whenHydrated.mockResolvedValue(undefined);
    render(<ProgressHydrationBoundary appId="weather" loadModule={async () => undefined}><button>Play weather</button></ProgressHydrationBoundary>);
    expect(await screen.findByRole("button", { name: "Play weather" })).toBeVisible();
  });

  it("never mounts stale game effects when owner revocation races hydration", async () => {
    const hydration = deferred(); mock.whenHydrated.mockReturnValue(hydration.promise);
    const load = vi.fn(async () => undefined);
    render(<ProgressHydrationBoundary appId="snake" loadModule={load}><button>Play</button></ProgressHydrationBoundary>);
    await act(async () => { mock.snapshot = { status: "revoked", ownerKey: "guest", generation: 2 }; mock.listeners.forEach(listener => listener()); });
    mock.isHydrated.mockReturnValue(true);
    await act(async () => hydration.resolve());
    expect(screen.queryByText("Play")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toHaveClass("min-h-11");
  });

  it("offers explicit reload after a failed module load without exposing input", async () => {
    render(<ProgressHydrationBoundary appId="snake" loadModule={async () => { throw new Error("offline"); }}><button>Play</button></ProgressHydrationBoundary>);
    expect(await screen.findByRole("button", { name: "Reload" })).toBeVisible();
    expect(screen.queryByText("Play")).toBeNull();
  });
});
