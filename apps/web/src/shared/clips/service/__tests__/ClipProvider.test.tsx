import { act, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ value: { data: null as null | { user: { id: string } }, status: "unauthenticated" as string } }));
vi.mock("next-auth/react", () => ({ useSession: () => session.value }));

const verdict = vi.hoisted(() => ({ capture: false }));
vi.mock("../../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config")>();
  return { ...actual, loadClipsVerdict: vi.fn(async () => ({ mode: verdict.capture ? "on" : "off", capture: verdict.capture })) };
});

vi.mock("@/shared/lib/gameMetadata.generated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/gameMetadata.generated")>();
  return {
    ...actual,
    getGameMetadata: (appId: string) => ({ ...actual.getGameMetadata(appId), clips: appId === "clip-game" }),
  };
});

import type { ClipService } from "../ClipService";
import { ClipProvider, clipsEnabledFor, useClipSource } from "../ClipProvider";
import { useAttachedGame, useClipService, useClipSnapshot } from "../context";
import { HIDDEN_SNAPSHOT, type AttachedGame, type ClipSnapshot, type GameAttachment } from "../contract";

/** The parts of ClipService that ClipProvider uses, with a controllable store. */
function fakeService() {
  let snapshot: ClipSnapshot = { ...HIDDEN_SNAPSHOT, version: 1, button: "ready", engine: "buffering", appId: "clip-game" };
  const listeners = new Set<() => void>();
  const handles: Array<AttachedGame & { detach: ReturnType<typeof vi.fn>; registerCanvas: ReturnType<typeof vi.fn> }> = [];
  const registered: HTMLCanvasElement[] = [];
  const attachments: GameAttachment[] = [];
  const service = {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => HIDDEN_SNAPSHOT,
    attach: vi.fn((game: GameAttachment) => {
      attachments.push(game);
      const handle = {
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
      };
      handles.push(handle);
      return handle;
    }),
    setSessionUser: vi.fn(async () => undefined),
    refreshGame: vi.fn(),
  };
  const set = (next: Partial<ClipSnapshot>) => {
    snapshot = { ...snapshot, ...next, version: snapshot.version + 1 };
    listeners.forEach((l) => l());
  };
  return { service: service as unknown as ClipService & typeof service, handles, registered, attachments, set };
}

function game(extra: Partial<GameAttachment> = {}): GameAttachment {
  return { appId: "clip-game", gameName: "Clip Game", emoji: "🎮", canPause: true, ...extra };
}

function Probe() {
  const snap = useClipSnapshot();
  const service = useClipService();
  const attached = useAttachedGame();
  return (
    <p data-testid="probe">
      {snap.button}|{service ? "service" : "none"}|{attached ? "attached" : "detached"}
    </p>
  );
}

beforeEach(() => {
  session.value = { data: null, status: "unauthenticated" };
  verdict.capture = false;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("ClipProvider", () => {
  it("renders only its children on the server", () => {
    const load = vi.fn(async () => null);
    const html = renderToString(
      <ClipProvider game={game()} loadService={load}>
        <p>child</p>
      </ClipProvider>,
    );
    expect(html).toBe("<p>child</p>");
    expect(load).not.toHaveBeenCalled();
  });

  it("gives no service when clips are off", async () => {
    render(
      <ClipProvider game={game()}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    expect(screen.getByTestId("probe").textContent).toBe("hidden|none|detached");
  });

  it("loads the service, attaches the game, and provides both contexts", async () => {
    const f = fakeService();
    render(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    expect(screen.getByTestId("probe").textContent).toBe("ready|service|attached");
    expect(f.service.attach).toHaveBeenCalledTimes(1);
    expect(f.attachments[0]).toMatchObject({ appId: "clip-game", gameName: "Clip Game", emoji: "🎮", canPause: true });
    act(() => f.set({ button: "made" }));
    expect(screen.getByTestId("probe").textContent).toBe("made|service|attached");
  });

  it("never remounts the game when the service arrives", async () => {
    const f = fakeService();
    const mounts = vi.fn();
    function Game() {
      useEffect(() => {
        mounts();
      }, []);
      return <p>game</p>;
    }
    render(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <Game />
      </ClipProvider>,
    );
    await act(async () => undefined);
    expect(f.service.attach).toHaveBeenCalled();
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it("reads the newest props through the attachment, and re-attaches only for a new app", async () => {
    const f = fakeService();
    const pause = vi.fn();
    const view = render(
      <ClipProvider game={game({ canPause: false })} loadService={async () => f.service}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    view.rerender(
      <ClipProvider game={game({ canPause: true, pause, gameName: "Renamed", score: () => "42" })} loadService={async () => f.service}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    expect(f.service.attach).toHaveBeenCalledTimes(1);
    const attached = f.attachments[0];
    expect(attached.canPause).toBe(true);
    expect(attached.gameName).toBe("Renamed");
    expect(attached.score?.()).toBe("42");
    attached.pause?.();
    expect(pause).toHaveBeenCalled();
    expect(f.service.refreshGame).toHaveBeenCalled();
    view.rerender(
      <ClipProvider game={game({ appId: "other" })} loadService={async () => f.service}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    expect(f.handles[0].detach).toHaveBeenCalled();
    expect(f.service.attach).toHaveBeenCalledTimes(2);
  });

  it("detaches on unmount", async () => {
    const f = fakeService();
    const view = render(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    view.unmount();
    expect(f.handles[0].detach).toHaveBeenCalledTimes(1);
  });

  it("tells the service who is signed in, once the session is known", async () => {
    const f = fakeService();
    session.value = { data: null, status: "loading" };
    const view = render(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    expect(f.service.setSessionUser).not.toHaveBeenCalled();
    session.value = { data: { user: { id: "kid-1" } }, status: "authenticated" };
    view.rerender(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    expect(f.service.setSessionUser).toHaveBeenLastCalledWith("kid-1");
  });
});

describe("useClipSource", () => {
  function CanvasGame({ show, active = true, swap = 0 }: { show: boolean; active?: boolean; swap?: number }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useClipSource(ref, { active, targetFps: 60 });
    return show ? <canvas key={swap} ref={ref} data-testid="c" /> : null;
  }

  it("registers the canvas, follows a new canvas element, and lets go on unmount", async () => {
    const f = fakeService();
    const view = render(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <CanvasGame show />
      </ClipProvider>,
    );
    await act(async () => undefined);
    const first = screen.getByTestId("c");
    expect(f.registered).toEqual([first]);
    expect(f.handles[0].registerCanvas).toHaveBeenCalledWith(first, { targetFps: 60 });
    view.rerender(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <CanvasGame show swap={1} />
      </ClipProvider>,
    );
    const second = screen.getByTestId("c");
    expect(second).not.toBe(first);
    expect(f.registered).toEqual([second]);
    view.rerender(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <CanvasGame show active={false} />
      </ClipProvider>,
    );
    expect(f.registered).toEqual([]);
    view.rerender(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <CanvasGame show />
      </ClipProvider>,
    );
    expect(f.registered).toHaveLength(1);
    view.unmount();
    expect(f.registered).toEqual([]);
  });

  it("does nothing without a clip service", async () => {
    function Harness() {
      const [show] = useState(true);
      return <CanvasGame show={show} />;
    }
    render(<Harness />);
    await act(async () => undefined);
    expect(screen.getByTestId("c")).toBeTruthy();
  });
});

describe("clipsEnabledFor", () => {
  it("follows the metadata literal in the generated lookup", () => {
    expect(clipsEnabledFor("clip-game")).toBe(true);
    expect(clipsEnabledFor("breakout")).toBe(false);
    expect(clipsEnabledFor(undefined)).toBe(false);
    expect(clipsEnabledFor("")).toBe(false);
  });
});
