/**
 * ClipUiMount: a clip UI load that fails is tried again, and until the clip
 * UI runs there is no capture (no clip button, no capture).
 *
 * - The load is tried again after 2 s, 10 s and 60 s (UI_RETRY_DELAYS_MS),
 *   then each time the page becomes visible.
 * - Until the UI runs, the game under the mount gets no attached clip game,
 *   so useClipSource registers no canvas: the capture engine never arms. The
 *   canvas registers when the UI runs.
 */
import { act, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStartOverlayPresence } from "@/shared/lib/startOverlayPresence";
import type { ClipService } from "../../service/ClipService";
import { ClipProvider, useClipSource } from "../../service/ClipProvider";
import { HIDDEN_SNAPSHOT, type AttachedGame, type ClipSnapshot, type GameAttachment } from "../../service/contract";
import type { ClipUiController } from "../../ui/uiStore";
import { ClipUiMount, UI_RETRY_DELAYS_MS, useClipShellUi, type ClipShellParts } from "../ClipUiMount";

/** The parts of ClipService that ClipProvider uses, with the canvases it was given. */
function fakeService() {
  const snapshot: ClipSnapshot = { ...HIDDEN_SNAPSHOT, version: 1, button: "warming", engine: "warming", appId: "clip-game" };
  const registered: HTMLCanvasElement[] = [];
  const service = {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => HIDDEN_SNAPSHOT,
    attach: vi.fn(
      (): AttachedGame => ({
        registerCanvas: vi.fn((canvas: HTMLCanvasElement) => {
          registered.push(canvas);
          return () => {
            registered.splice(registered.indexOf(canvas), 1);
          };
        }),
        autoDiscover: vi.fn(() => () => undefined),
        runPhase: vi.fn(),
        markMoment: vi.fn(),
        setAtBreak: vi.fn(),
        detach: vi.fn(),
      }),
    ),
    refreshGame: vi.fn(),
  };
  return { service: service as unknown as ClipService, registered };
}

/** A clip UI module whose runtime hands over a controller at once (the UI runs). */
function fakeParts(): ClipShellParts {
  function ClipUiRuntime({ onController }: { onController: (c: ClipUiController | null) => void }) {
    useEffect(() => {
      onController({} as ClipUiController);
      return () => onController(null);
    }, [onController]);
    return null;
  }
  return { ClipUiRuntime } as unknown as ClipShellParts;
}

const game: GameAttachment = { appId: "clip-game", gameName: "Clip Game", emoji: "🎮", canPause: true };

/** A canvas game: one line, useClipSource. */
function CanvasGame() {
  const ref = useRef<HTMLCanvasElement>(null);
  useClipSource(ref);
  return <canvas ref={ref} />;
}

function UiProbe({ seen }: { seen: { ui: boolean } }) {
  const ui = useClipShellUi() !== null;
  useEffect(() => {
    Object.assign(seen, { ui });
  }, [seen, ui]);
  return null;
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  useStartOverlayPresence.setState({ count: 0 });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setVisibility("visible");
});

function mount(loadParts: () => Promise<ClipShellParts>) {
  const f = fakeService();
  const seen = { ui: false };
  render(
    <ClipProvider game={game} loadService={async () => f.service}>
      <ClipUiMount loadParts={loadParts}>
        <UiProbe seen={seen} />
        <CanvasGame />
      </ClipUiMount>
    </ClipProvider>,
  );
  return { f, seen };
}

describe("ClipUiMount", () => {
  it("tries a failed load again after 2 s, 10 s and 60 s, and registers the canvas only when the UI runs", async () => {
    const outcomes = [false, false, false, true];
    const loadParts = vi.fn(async () => {
      if (!outcomes.shift()) throw new TypeError("Failed to fetch dynamically imported module");
      return fakeParts();
    });
    const { f, seen } = mount(loadParts);
    await flush();
    expect(loadParts).toHaveBeenCalledTimes(1);
    // Parked: the service is attached, but no canvas and no UI.
    expect(f.service.attach).toHaveBeenCalledTimes(1);
    expect(f.registered).toHaveLength(0);
    expect(seen.ui).toBe(false);

    await wait(UI_RETRY_DELAYS_MS[0] - 1);
    expect(loadParts).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(loadParts).toHaveBeenCalledTimes(2);
    await wait(UI_RETRY_DELAYS_MS[1]);
    expect(loadParts).toHaveBeenCalledTimes(3);
    expect(f.registered).toHaveLength(0);
    await wait(UI_RETRY_DELAYS_MS[2]);
    expect(loadParts).toHaveBeenCalledTimes(4);
    // The fourth try loads: the UI runs and the canvas registers.
    expect(seen.ui).toBe(true);
    expect(f.registered).toHaveLength(1);
  });

  it("after the timed tries, tries again each time the page becomes visible", async () => {
    let succeed = false;
    const loadParts = vi.fn(async () => {
      if (!succeed) throw new TypeError("Failed to fetch dynamically imported module");
      return fakeParts();
    });
    const { f, seen } = mount(loadParts);
    await flush();
    for (const delay of UI_RETRY_DELAYS_MS) await wait(delay);
    expect(loadParts).toHaveBeenCalledTimes(1 + UI_RETRY_DELAYS_MS.length);
    // No more timers: only a return to the page tries again.
    await wait(10 * 60_000);
    expect(loadParts).toHaveBeenCalledTimes(1 + UI_RETRY_DELAYS_MS.length);
    setVisibility("hidden");
    await flush();
    expect(loadParts).toHaveBeenCalledTimes(1 + UI_RETRY_DELAYS_MS.length);
    setVisibility("visible");
    await flush();
    expect(loadParts).toHaveBeenCalledTimes(2 + UI_RETRY_DELAYS_MS.length);
    expect(f.registered).toHaveLength(0);
    succeed = true;
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(loadParts).toHaveBeenCalledTimes(3 + UI_RETRY_DELAYS_MS.length);
    expect(seen.ui).toBe(true);
    expect(f.registered).toHaveLength(1);
  });

  it("a first load that works registers the canvas with no wait", async () => {
    const loadParts = vi.fn(async () => fakeParts());
    const { f, seen } = mount(loadParts);
    await flush();
    expect(loadParts).toHaveBeenCalledTimes(1);
    expect(seen.ui).toBe(true);
    expect(f.registered).toHaveLength(1);
  });
});
