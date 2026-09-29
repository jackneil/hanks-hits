import { act, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { useStartOverlayPresence } from "@/shared/lib/startOverlayPresence";
import type { ClipService } from "../ClipService";
import { ClipProvider, ClipShellScope, clipsEnabledFor, useClipSource } from "../ClipProvider";
import { useAttachedGame, useClipService, useClipSnapshot } from "../context";
import { HIDDEN_SNAPSHOT, type AttachedGame, type ClipSnapshot, type GameAttachment } from "../contract";

/** The parts of ClipService that ClipProvider uses, with a controllable store. */
function fakeService() {
  let snapshot: ClipSnapshot = { ...HIDDEN_SNAPSHOT, version: 1, button: "ready", engine: "buffering", appId: "clip-game" };
  const listeners = new Set<() => void>();
  type Mocked = ReturnType<typeof vi.fn>;
  const handles: Array<AttachedGame & { detach: Mocked; registerCanvas: Mocked; setAtBreak: Mocked; runPhase: Mocked }> = [];
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
  verdict.capture = false;
  // No start card on screen (the store is shared by every test in this file).
  useStartOverlayPresence.setState({ count: 0 });
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

});

describe("breaks and runs (plan 11.1, 11.5)", () => {
  beforeEach(() => {
    useStartOverlayPresence.setState({ count: 0 });
  });

  function lastBreak(f: ReturnType<typeof fakeService>): boolean | undefined {
    return f.handles[0].setAtBreak.mock.calls.at(-1)?.[0] as boolean | undefined;
  }

  it("plays by default: a game with no break source captures", async () => {
    const f = fakeService();
    render(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    expect(lastBreak(f)).toBe(false);
  });

  it("joins the start card, the shell's pause menu and the game's own signal into one break", async () => {
    const f = fakeService();
    const grabbed: { game: AttachedGame | null } = { game: null };
    function Grab() {
      const attached = useAttachedGame();
      useEffect(() => {
        grabbed.game = attached;
      }, [attached]);
      return null;
    }
    const view = render(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <Grab />
      </ClipProvider>,
    );
    await act(async () => undefined);
    act(() => useStartOverlayPresence.getState().enter());
    expect(lastBreak(f)).toBe(true);
    act(() => useStartOverlayPresence.getState().leave());
    expect(lastBreak(f)).toBe(false);
    view.rerender(
      <ClipProvider game={game()} paused loadService={async () => f.service}>
        <Grab />
      </ClipProvider>,
    );
    expect(lastBreak(f)).toBe(true);
    // The game says it does not play: the shell's resume does not override it.
    act(() => grabbed.game!.setAtBreak(true));
    view.rerender(
      <ClipProvider game={game()} paused={false} loadService={async () => f.service}>
        <Grab />
      </ClipProvider>,
    );
    expect(lastBreak(f)).toBe(true);
    act(() => grabbed.game!.setAtBreak(false));
    expect(lastBreak(f)).toBe(false);
  });

  it("starts a run when the start card goes away, and ends it when the start card comes back", async () => {
    const f = fakeService();
    act(() => useStartOverlayPresence.getState().enter());
    render(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    expect(lastBreak(f)).toBe(true);
    expect(f.handles[0].runPhase).not.toHaveBeenCalled();
    act(() => useStartOverlayPresence.getState().leave());
    expect(f.handles[0].runPhase).toHaveBeenLastCalledWith("start");
    act(() => useStartOverlayPresence.getState().enter());
    expect(f.handles[0].runPhase).toHaveBeenLastCalledWith("end");
    expect(lastBreak(f)).toBe(true);
  });

  /** A service that loads only when the test lets it (the flag read and the dynamic import). */
  function lateService(f: ReturnType<typeof fakeService>) {
    let arrive: (service: ClipService) => void = () => undefined;
    const pending = new Promise<ClipService>((resolve) => {
      arrive = resolve;
    });
    return { load: () => pending, arrive: () => arrive(f.service) };
  }

  it("a Start tap before the service loads still starts the run at the attach", async () => {
    const f = fakeService();
    const late = lateService(f);
    act(() => useStartOverlayPresence.getState().enter());
    render(
      <ClipProvider game={game()} loadService={late.load}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    // The kid taps Start while the service still loads.
    act(() => useStartOverlayPresence.getState().leave());
    expect(f.handles).toHaveLength(0);
    await act(async () => late.arrive());
    expect(f.handles[0].runPhase.mock.calls).toEqual([["start"]]);
    expect(lastBreak(f)).toBe(false);
    // So the start card that comes back ends that run (the result post-roll, the whole-run button).
    act(() => useStartOverlayPresence.getState().enter());
    expect(f.handles[0].runPhase.mock.calls).toEqual([["start"], ["end"]]);
    expect(lastBreak(f)).toBe(true);
  });

  it("a Start tap and a pause before the service loads: the run starts at a break", async () => {
    const f = fakeService();
    const late = lateService(f);
    act(() => useStartOverlayPresence.getState().enter());
    const view = render(
      <ClipProvider game={game()} loadService={late.load}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    act(() => useStartOverlayPresence.getState().leave());
    view.rerender(
      <ClipProvider game={game()} paused loadService={late.load}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => late.arrive());
    expect(f.handles[0].runPhase.mock.calls).toEqual([["start"]]);
    expect(lastBreak(f)).toBe(true);
  });

  it("starts no run at the attach when the start card is still up, or came back before the service loaded", async () => {
    const f = fakeService();
    const late = lateService(f);
    act(() => useStartOverlayPresence.getState().enter());
    render(
      <ClipProvider game={game()} loadService={late.load}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    act(() => useStartOverlayPresence.getState().leave());
    act(() => useStartOverlayPresence.getState().enter());
    await act(async () => late.arrive());
    expect(f.handles[0].runPhase).not.toHaveBeenCalled();
    expect(lastBreak(f)).toBe(true);
    // The next Start tap starts the run as usual.
    act(() => useStartOverlayPresence.getState().leave());
    expect(f.handles[0].runPhase.mock.calls).toEqual([["start"]]);
  });

  it("ends no run when a start card appears with no run before it (it mounted after the game attached)", async () => {
    const f = fakeService();
    render(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <Probe />
      </ClipProvider>,
    );
    await act(async () => undefined);
    act(() => useStartOverlayPresence.getState().enter());
    expect(f.handles[0].runPhase).not.toHaveBeenCalled();
    expect(lastBreak(f)).toBe(true);
  });
});

describe("ClipShellScope (the GameShell mount)", () => {
  it("renders only the children for a module without clips: true, and never reads the flag", async () => {
    const { loadClipsVerdict } = await import("../../config");
    render(
      <ClipShellScope appId="breakout" gameName="Breakout" canPause paused={false} pause={() => undefined} resume={() => undefined}>
        <Probe />
      </ClipShellScope>,
    );
    await act(async () => undefined);
    expect(screen.getByTestId("probe").textContent).toBe("hidden|none|detached");
    expect(loadClipsVerdict).not.toHaveBeenCalled();
    render(
      <ClipShellScope gameName="No id" canPause paused={false} pause={() => undefined} resume={() => undefined}>
        <p>no id</p>
      </ClipShellScope>,
    );
    expect(loadClipsVerdict).not.toHaveBeenCalled();
  });

  it("mounts the clip provider for a clips: true module, with the shell's pause, resume and emoji", async () => {
    const { loadClipsVerdict } = await import("../../config");
    verdict.capture = false;
    render(
      <ClipShellScope appId="clip-game" gameName="Clip Game" canPause paused={false} pause={() => undefined} resume={() => undefined}>
        <Probe />
      </ClipShellScope>,
    );
    await act(async () => undefined);
    expect(loadClipsVerdict).toHaveBeenCalledTimes(1);
    // Clips are off here: no service, and the game renders as before.
    expect(screen.getByTestId("probe").textContent).toBe("hidden|none|detached");
  });
});

describe("useClipSource", () => {
  function CanvasGame({ show, active = true, swap = 0, isPlaying }: { show: boolean; active?: boolean; swap?: number; isPlaying?: boolean }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useClipSource(ref, { active, targetFps: 60, isPlaying });
    return show ? <canvas key={swap} ref={ref} data-testid="c" /> : null;
  }

  it("maps isPlaying (plan 6.1) to the break, and clears the game's break when the hook goes", async () => {
    const f = fakeService();
    const view = render(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <CanvasGame show isPlaying={false} />
      </ClipProvider>,
    );
    await act(async () => undefined);
    const breaks = () => f.handles[0].setAtBreak.mock.calls.map((c) => c[0]);
    expect(breaks().at(-1)).toBe(true);
    // A break keeps the canvas registered: the ring stays warm (no source lost).
    expect(f.registered).toHaveLength(1);
    view.rerender(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <CanvasGame show isPlaying />
      </ClipProvider>,
    );
    expect(breaks().at(-1)).toBe(false);
    view.rerender(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <CanvasGame show isPlaying={false} />
      </ClipProvider>,
    );
    expect(breaks().at(-1)).toBe(true);
    view.rerender(
      <ClipProvider game={game()} loadService={async () => f.service}>
        <p>game gone</p>
      </ClipProvider>,
    );
    expect(breaks().at(-1)).toBe(false);
  });

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
