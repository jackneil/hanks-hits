import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { useShellHold } from "../../hooks/useShellHold";
import { useShellOverlays } from "../../lib/shellOverlays";
import { useStartOverlayPresence } from "../../lib/startOverlayPresence";
import { GameShell } from "../GameShell";
import { ORIENTATION_TIP_COPY, ORIENTATION_TIP_KEEP_PLAYING, orientationTipKey } from "../OrientationWarning";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  // No router in a test: the install tip's placement reads window.location.
  usePathname: () => null,
}));

vi.mock("../Leaderboard", () => ({
  Leaderboard: () => <div>Leaderboard content</div>,
}));

const iPhone = vi.hoisted(() => ({ value: false }));
vi.mock("../../hooks/useFullscreen", () => ({
  useFullscreen: () => ({
    isSupported: !iPhone.value,
    isFullscreen: false,
    isIPhone: iPhone.value,
    isIPad: false,
    isPWA: false,
    toggle: vi.fn(),
    enter: vi.fn(),
    exit: vi.fn(),
  }),
}));

/**
 * GameShell pauses the game before any shell overlay and resumes after
 * (phone UX audit 2026-09-29, S8): Hill Climb kept driving under
 * "Restart game?", Asteroids kept moving behind the leaderboard and the
 * install steps. And the orientation tip (S7, main-loop decision 2) is
 * one shell overlay of its own.
 */

const DEFAULT_WIDTH = window.innerWidth;
const DEFAULT_HEIGHT = window.innerHeight;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
  window.dispatchEvent(new Event("resize"));
}

function header() {
  return screen.getByTestId("game-shell-header");
}

beforeEach(() => {
  useShellOverlays.setState({ count: 0 });
  useStartOverlayPresence.setState({ count: 0 });
  sessionStorage.clear();
  iPhone.value = false;
});

afterEach(() => {
  act(() => setViewport(DEFAULT_WIDTH, DEFAULT_HEIGHT));
  resetPointerMock();
});

describe("GameShell holds the game under shell overlays", () => {
  it("pauses the game before the restart question and resumes it on Cancel, with no pause menu", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    render(
      <GameShell gameName="Hill Climb" onRestart={vi.fn()} onPause={onPause} onResume={onResume}>
        <div>game</div>
      </GameShell>
    );
    fireEvent.click(within(header()).getByRole("button", { name: "Restart game" }));
    expect(screen.getByRole("dialog", { name: /restart game/i })).toBeInTheDocument();
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("pause-menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /keep playing/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("lets the old run go before a restart from the pause menu's question too, never after", async () => {
    // The menu's question used to restart first and resume after: the
    // resume reached the new run through the dialog's hold (the header
    // path already had the right order).
    const order: string[] = [];
    const onRestart = vi.fn(() => order.push("restart"));
    const onPause = vi.fn(() => order.push("pause"));
    const onResume = vi.fn(() => order.push("resume"));
    render(
      <GameShell gameName="Snake" onRestart={onRestart} onPause={onPause} onResume={onResume}>
        <div>game</div>
      </GameShell>
    );
    fireEvent.click(within(header()).getByRole("button", { name: "Pause game" }));
    expect(order).toEqual(["pause"]);
    const menu = screen.getByTestId("pause-menu");
    fireEvent.click(within(menu).getByRole("button", { name: "Restart game" }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm restart/i }));
    expect(order).toEqual(["pause", "resume", "restart"]);
    expect(screen.queryByTestId("pause-menu")).toBeNull();
  });

  it("gives the hold to the game tree as ShellHoldContext, for a game that runs its own loop", () => {
    const seen: boolean[] = [];
    function OwnLoopGame() {
      const held = useShellHold();
      seen.push(held);
      return <div data-testid="own-loop">{held ? "held" : "free"}</div>;
    }
    render(
      <GameShell gameName="Flappy Bird" appId="flappy-bird" canPause={false} onRestart={vi.fn()}>
        <OwnLoopGame />
      </GameShell>
    );
    expect(screen.getByTestId("own-loop")).toHaveTextContent("free");

    fireEvent.click(within(header()).getByRole("button", { name: "Restart game" }));
    expect(screen.getByTestId("own-loop")).toHaveTextContent("held");
    fireEvent.click(screen.getByRole("button", { name: /keep playing/i }));
    expect(screen.getByTestId("own-loop")).toHaveTextContent("free");

    // A hidden tab holds it too.
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByTestId("own-loop")).toHaveTextContent("held");
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByTestId("own-loop")).toHaveTextContent("free");
    expect(seen).toContain(true);
  });

  it("lets the old run go before the restart, so no resume reaches the new run", () => {
    const order: string[] = [];
    const onRestart = vi.fn(() => order.push("restart"));
    const onPause = vi.fn(() => order.push("pause"));
    const onResume = vi.fn(() => order.push("resume"));
    render(
      <GameShell gameName="Hill Climb" onRestart={onRestart} onPause={onPause} onResume={onResume}>
        <div>game</div>
      </GameShell>
    );
    fireEvent.click(within(header()).getByRole("button", { name: "Restart game" }));
    fireEvent.click(screen.getByRole("button", { name: /confirm restart/i }));
    expect(order).toEqual(["pause", "resume", "restart"]);
  });

  it("pauses the game behind the leaderboard and resumes when it closes", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    render(
      <GameShell gameName="Snake" appId="snake" onPause={onPause} onResume={onResume}>
        <div>game</div>
      </GameShell>
    );
    fireEvent.click(within(header()).getByRole("button", { name: /leaderboard/i }));
    expect(screen.getByRole("dialog", { name: /leaderboard/i })).toBeInTheDocument();
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("pause-menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /keep playing/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("pauses the game behind the install steps that the 📲 button opens on an iPhone", () => {
    iPhone.value = true;
    const onPause = vi.fn();
    const onResume = vi.fn();
    render(
      <GameShell gameName="Snake" appId="snake" onPause={onPause} onResume={onResume}>
        <div>game</div>
      </GameShell>
    );
    fireEvent.click(within(header()).getByRole("button", { name: /install app for fullscreen/i }));
    expect(screen.getByTestId("ios-install-sheet")).toHaveAttribute("data-layer", "requested");
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("tells a game that cannot pause (its own loop) about the overlay instead", () => {
    const onShellOverlayOpen = vi.fn();
    const onShellOverlayClose = vi.fn();
    const onPause = vi.fn();
    render(
      <GameShell
        gameName="Flappy Bird"
        appId="flappy-bird"
        canPause={false}
        onRestart={vi.fn()}
        onPause={onPause}
        onShellOverlayOpen={onShellOverlayOpen}
        onShellOverlayClose={onShellOverlayClose}
      >
        <div>game</div>
      </GameShell>
    );
    fireEvent.click(within(header()).getByRole("button", { name: /leaderboard/i }));
    expect(onShellOverlayOpen).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /keep playing/i }));
    expect(onShellOverlayClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the game paused when the leaderboard opens from the pause menu and closes again", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    render(
      <GameShell gameName="Snake" appId="snake" onPause={onPause} onResume={onResume}>
        <div>game</div>
      </GameShell>
    );
    fireEvent.click(within(header()).getByRole("button", { name: "Pause game" }));
    const menu = screen.getByTestId("pause-menu");
    fireEvent.click(within(menu).getByRole("button", { name: /leaderboard/i }));
    fireEvent.click(screen.getByRole("button", { name: /keep playing/i }));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
    fireEvent.click(within(menu).getByRole("button", { name: /resume/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe("GameShell orientation tip", () => {
  function renderLandscapeGame(props: Partial<React.ComponentProps<typeof GameShell>> = {}) {
    return render(
      <GameShell gameName="Platformer" appId="platformer" onRestart={vi.fn()} {...props}>
        <div>game</div>
      </GameShell>
    );
  }

  it("shows once for a landscape game on a phone held upright, after the start card, and holds the game", () => {
    mockPointer(true);
    setViewport(375, 549);
    const onPause = vi.fn();
    const onResume = vi.fn();
    useStartOverlayPresence.getState().enter();
    renderLandscapeGame({ onPause, onResume });
    // Never over the start card.
    expect(screen.queryByTestId("orientation-tip")).toBeNull();

    act(() => useStartOverlayPresence.getState().leave());
    const tip = screen.getByTestId("orientation-tip");
    expect(tip.parentElement).toBe(document.body);
    expect(tip.className).toContain("z-[100]");
    expect(within(tip).getByRole("heading", { name: ORIENTATION_TIP_COPY.landscape.title })).toBeInTheDocument();
    expect(within(tip).getByText(ORIENTATION_TIP_COPY.landscape.body)).toBeInTheDocument();
    // The game is held, with no pause menu.
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("pause-menu")).toBeNull();
    // The header stays free: the tip starts under it.
    expect(tip.className).toMatch(/(^|\s)top-12(\s|$)/);
    expect(tip.className).toMatch(/(^|\s)short:top-10(\s|$)/);
    // The kid can read it aloud, or keep playing.
    const keep = within(tip).getByRole("button", { name: new RegExp(ORIENTATION_TIP_KEEP_PLAYING) });
    expect(keep.className).toContain("min-h-[44px]");
    fireEvent.click(keep);
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(orientationTipKey("platformer"))).not.toBeNull();
  });

  it("shows at most once per session for a game, also after a restart that remounts the game", () => {
    mockPointer(true);
    setViewport(375, 549);
    const { rerender } = render(
      <GameShell gameName="Platformer" appId="platformer" onRestart={vi.fn()}>
        <div key={0}>run 0</div>
      </GameShell>
    );
    fireEvent.click(within(screen.getByTestId("orientation-tip")).getByRole("button", { name: /keep playing/i }));

    rerender(
      <GameShell gameName="Platformer" appId="platformer" onRestart={vi.fn()}>
        <div key={1}>run 1</div>
      </GameShell>
    );
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
  });

  it("does not come back on a new visit in the same session", () => {
    mockPointer(true);
    setViewport(375, 549);
    sessionStorage.setItem(orientationTipKey("platformer"), "1");
    renderLandscapeGame();
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
  });

  it("goes away when the kid turns the phone, and frees the game", () => {
    mockPointer(true);
    setViewport(375, 549);
    const onPause = vi.fn();
    const onResume = vi.fn();
    renderLandscapeGame({ onPause, onResume });
    expect(screen.getByTestId("orientation-tip")).toBeInTheDocument();
    act(() => setViewport(667, 311));
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("asks a portrait game to turn upright when the phone is sideways", () => {
    mockPointer(true);
    setViewport(667, 311);
    render(
      <GameShell gameName="Flappy Bird" appId="flappy-bird" canPause={false} onRestart={vi.fn()}>
        <div>game</div>
      </GameShell>
    );
    const tip = screen.getByTestId("orientation-tip");
    expect(within(tip).getByRole("heading", { name: ORIENTATION_TIP_COPY.portrait.title })).toBeInTheDocument();
  });

  it("never shows for a game that plays both ways (no preferredOrientation)", () => {
    mockPointer(true);
    setViewport(375, 549);
    for (const [gameName, appId] of [
      ["Hill Climb", "hill-climb"],
      ["Monster Truck", "monster-truck"],
      ["Four-Wheeler Adventure 3D", "four-wheeler-3d"],
      ["Snake", "snake"],
    ]) {
      const { unmount } = render(
        <GameShell gameName={gameName} appId={appId} canPause={false} onRestart={vi.fn()}>
          <div>game</div>
        </GameShell>
      );
      expect(screen.queryByTestId("orientation-tip"), appId).toBeNull();
      unmount();
    }
  });

  it("never shows when the phone is already the right way, on a mouse, or on a tablet", () => {
    mockPointer(true);
    setViewport(667, 311);
    const right = renderLandscapeGame();
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
    right.unmount();

    mockPointer(false);
    setViewport(375, 549);
    const mouse = renderLandscapeGame();
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
    mouse.unmount();

    mockPointer(true);
    setViewport(768, 1024);
    renderLandscapeGame();
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
  });

  it("uses no decoration tells: a solid card, no gradient, no edge stripe", () => {
    mockPointer(true);
    setViewport(375, 549);
    renderLandscapeGame();
    const tip = screen.getByTestId("orientation-tip");
    const classes = [tip, ...Array.from(tip.querySelectorAll("*"))].map((el) => el.className).join(" ");
    expect(classes).not.toMatch(/gradient|backdrop-blur|border-l-|border-t-|purple|violet/);
    expect(classes).toContain("bg-base-100");
  });
});
