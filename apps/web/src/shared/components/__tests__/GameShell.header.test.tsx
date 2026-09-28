import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { GAME_METADATA } from "../../lib/gameMetadata.generated";
import { GameShell } from "../GameShell";

vi.mock("../../hooks/useFullscreen", () => ({
  useFullscreen: () => ({
    isSupported: true,
    isFullscreen: false,
    isIPhone: false,
    isIPad: false,
    isPWA: false,
    toggle: vi.fn(),
    enter: vi.fn(),
    exit: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const DEFAULT_WIDTH = window.innerWidth;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

function header() {
  return screen.getByTestId("game-shell-header");
}

function controls() {
  return screen.getByTestId("game-shell-controls");
}

/** A pausable game with every header control, like snake. */
function renderFullGame(props: Partial<React.ComponentProps<typeof GameShell>> = {}) {
  return render(
    <GameShell gameName="Snake" appId="snake" onRestart={vi.fn()} {...props}>
      <div>game</div>
    </GameShell>
  );
}

afterEach(() => {
  act(() => setViewportWidth(DEFAULT_WIDTH));
  removeSpeechMock();
});

describe("GameShell header: surface", () => {
  it("uses a solid background, not a backdrop blur", () => {
    renderFullGame();
    expect(header().className).toContain("bg-slate-950");
    expect(header().className).not.toMatch(/backdrop-blur/);
    expect(header().className).not.toMatch(/bg-black\/\d+/);
  });

  it("gives the restart glyph its own white color on the dark header", () => {
    renderFullGame();
    const restart = within(header()).getByRole("button", { name: "Restart game" });
    expect(restart).toHaveClass("text-white");
    expect(restart).toHaveClass("min-w-[44px]", "min-h-[44px]");
  });
});

describe("GameShell header: title", () => {
  it("shows the full name as text at 480 px and wider", () => {
    setViewportWidth(480);
    renderFullGame();
    expect(within(header()).getByText("Snake")).toBeInTheDocument();
    expect(within(header()).queryByRole("img", { name: "Snake" })).toBeNull();
    expect(controls()).toHaveClass("gap-1");
  });

  it("shows the metadata emoji below 480 px, with the full name as its accessible name", () => {
    setViewportWidth(390);
    renderFullGame();
    const title = within(header()).getByRole("img", { name: "Snake" });
    expect(title).toHaveTextContent(GAME_METADATA.snake.icon);
    expect(title).toHaveAttribute("title", "Snake");
    expect(controls()).toHaveClass("gap-0");
  });

  it("uses the emoji prop over the metadata icon", () => {
    setViewportWidth(390);
    renderFullGame({ emoji: "🐉" });
    expect(within(header()).getByRole("img", { name: "Snake" })).toHaveTextContent("🐉");
  });

  it("switches to the emoji title when the phone turns (resize)", () => {
    renderFullGame();
    expect(within(header()).getByText("Snake")).toBeInTheDocument();

    act(() => setViewportWidth(375));

    expect(within(header()).getByRole("img", { name: "Snake" })).toBeInTheDocument();
  });

  it("finds the emoji of a route with no appId from its folder name", () => {
    setViewportWidth(390);
    window.history.pushState({}, "", "/apps/weather");
    try {
      render(
        <GameShell gameName="Weather Buddy" canPause={false}>
          <div>page</div>
        </GameShell>
      );
      expect(within(header()).getByRole("img", { name: "Weather Buddy" })).toHaveTextContent(
        GAME_METADATA.weather.icon
      );
    } finally {
      window.history.pushState({}, "", "/");
    }
  });

  it("keeps the text title for a route whose emoji is unknown", () => {
    setViewportWidth(390);
    render(
      <GameShell gameName="Mystery Page" canPause={false}>
        <div>page</div>
      </GameShell>
    );
    expect(within(header()).getByText("Mystery Page")).toBeInTheDocument();
  });
});

describe("GameShell header: clip slot", () => {
  it("renders no slot when the prop is absent", () => {
    renderFullGame();
    expect(screen.queryByTestId("header-clip-slot")).toBeNull();
  });

  it("renders an empty, sized 44 px slot for clipSlot={true}", () => {
    renderFullGame({ clipSlot: true });
    const slot = screen.getByTestId("header-clip-slot");
    expect(slot).toBeEmptyDOMElement();
    expect(slot).toHaveClass("w-11", "h-11", "shrink-0");
    expect(controls()).toContainElement(slot);
  });

  it("holds the clip button in the same slot", () => {
    renderFullGame({ clipSlot: <button type="button">🎬</button> });
    const slot = screen.getByTestId("header-clip-slot");
    expect(within(slot).getByRole("button", { name: "🎬" })).toBeInTheDocument();
  });
});

describe("GameShell header: width budget", () => {
  it("keeps Leaderboard and Restart in the header below 400 px until the game has the result chip", () => {
    setViewportWidth(375);
    renderFullGame();
    expect(within(header()).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: "Restart game" })).toBeInTheDocument();
  });

  it("moves Leaderboard and Restart to the pause menu below 400 px once resultChipReady is set", () => {
    setViewportWidth(375);
    renderFullGame({ resultChipReady: true });
    expect(within(header()).queryByRole("button", { name: /leaderboard/i })).toBeNull();
    expect(within(header()).queryByRole("button", { name: "Restart game" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    const menu = screen.getByTestId("pause-menu");
    expect(within(menu).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Restart game" })).toBeInTheDocument();
  });

  it("moves Fullscreen into the pause menu below 340 px for a pausable game, and reads it out", async () => {
    const synth = installSpeechMock();
    setViewportWidth(320);
    renderFullGame({ resultChipReady: true });
    expect(within(header()).queryByRole("button", { name: /fullscreen/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    const menu = screen.getByTestId("pause-menu");
    expect(within(menu).getByRole("button", { name: "Full Screen" })).toBeInTheDocument();

    fireEvent.click(await within(menu).findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe(
      "Paused. Snake. Resume. Leaderboard. Full Screen. Restart. Go Home"
    );
  });

  it("keeps Fullscreen in the header below 340 px for a game that cannot pause", () => {
    setViewportWidth(320);
    render(
      <GameShell gameName="Flappy Bird" appId="flappy-bird" canPause={false} onRestart={vi.fn()}>
        <div>game</div>
      </GameShell>
    );
    expect(within(header()).getByRole("button", { name: "Enter fullscreen" })).toBeInTheDocument();
  });

  it("drops the Sign In label when the header is over budget", () => {
    setViewportWidth(412);
    renderFullGame({ clipSlot: true });
    const signIn = within(header()).getByRole("link", { name: /sign in/i });
    expect(signIn.querySelector("span")).toHaveClass("hidden");
  });

  it("keeps the Sign In label when there is room", () => {
    setViewportWidth(412);
    render(
      <GameShell gameName="Snake" appId="snake">
        <div>game</div>
      </GameShell>
    );
    const signIn = within(header()).getByRole("link", { name: /sign in/i });
    expect(signIn.querySelector("span")).not.toHaveClass("hidden");
  });

  it("reserves the pause slot between runs so the controls do not jump", () => {
    const onPause = vi.fn();
    const { rerender } = render(
      <GameShell gameName="Snake" appId="snake" canPause={false} onPause={onPause} clipSlot>
        <div>game</div>
      </GameShell>
    );
    const beforeRun = Array.from(controls().children);
    const placeholder = screen.getByTestId("header-pause-placeholder");
    expect(placeholder).toHaveClass("w-11", "h-11");

    rerender(
      <GameShell gameName="Snake" appId="snake" canPause onPause={onPause} clipSlot>
        <div>game</div>
      </GameShell>
    );
    const duringRun = Array.from(controls().children);
    const pause = screen.getByRole("button", { name: "Pause game" });

    expect(duringRun).toHaveLength(beforeRun.length);
    expect(duringRun.indexOf(pause)).toBe(beforeRun.indexOf(placeholder));
    expect(duringRun.indexOf(screen.getByTestId("header-clip-slot"))).toBe(
      beforeRun.indexOf(screen.getByTestId("header-clip-slot"))
    );
  });

  it("has no pause slot for a game that can never pause", () => {
    render(
      <GameShell gameName="Flappy Bird" appId="flappy-bird" canPause={false}>
        <div>game</div>
      </GameShell>
    );
    expect(screen.queryByTestId("header-pause-placeholder")).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause game" })).toBeNull();
  });
});

describe("GameShell pause menu read-aloud", () => {
  it("speaks the buttons that a game passes in pauseMenuChildren", async () => {
    const synth = installSpeechMock();
    renderFullGame({
      pauseMenuChildren: (
        <button type="button">
          <span aria-hidden="true">🎬</span> Clips
        </button>
      ),
    });

    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    fireEvent.click(await screen.findByTestId("read-aloud-button"));

    expect(synth.lastUtterance().text).toBe(
      "Paused. Snake. Resume. Leaderboard. Clips. Restart. Go Home"
    );
  });
});
