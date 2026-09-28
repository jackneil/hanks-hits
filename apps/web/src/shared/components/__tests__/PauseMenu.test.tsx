import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { useGameBreaks } from "../../lib/gameBreaks";
import { PauseMenu } from "../PauseMenu";

describe("PauseMenu restart", () => {
  it("shows restart and forwards a confirmed restart", async () => {
    const onRestart = vi.fn();
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} onRestart={onRestart} gameName="2048" />
    );

    fireEvent.click(screen.getByRole("button", { name: /restart game/i }));
    expect(await screen.findByRole("dialog", { name: /restart game/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm restart/i }));

    await waitFor(() => expect(onRestart).toHaveBeenCalledTimes(1));
  });
});


describe("PauseMenu read aloud", () => {
  afterEach(() => {
    removeSpeechMock();
    vi.restoreAllMocks();
  });

  it("reads the whole pause menu, restart included", async () => {
    const synth = installSpeechMock();
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} onRestart={vi.fn()} gameName="Snake" />
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe("Paused. Snake. Resume. Restart. Go Home");
  });

  it("names the extra buttons in the slot, in screen order", async () => {
    const synth = installSpeechMock();
    render(
      <PauseMenu
        isOpen
        onResume={vi.fn()}
        onHome={vi.fn()}
        onRestart={vi.fn()}
        gameName="Snake"
        spokenExtras={["Leaderboard"]}
      >
        <button type="button">🏆 Leaderboard</button>
      </PauseMenu>
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe(
      "Paused. Snake. Resume. Leaderboard. Restart. Go Home"
    );
  });

  it("leaves Restart out when the game has no restart action", async () => {
    const synth = installSpeechMock();
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe("Paused. Snake. Resume. Go Home");
  });

  it("shows no read-aloud button when the browser cannot speak", () => {
    removeSpeechMock();
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });
});

describe("PauseMenu heading", () => {
  it("says Paused in sentence case, with no endless pulse", () => {
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);

    const heading = screen.getByRole("heading", { name: "Paused" });
    expect(heading).toHaveTextContent(/^Paused$/);
    expect(heading.className).not.toMatch(/animate-pulse|uppercase/);
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });

  it("labels the Restart button with a word, not only the glyph", () => {
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} onRestart={vi.fn()} gameName="Snake" />
    );
    expect(screen.getByRole("button", { name: "Restart game" })).toHaveTextContent(/Restart/);
  });
});

describe("PauseMenu children are spoken", () => {
  afterEach(() => {
    removeSpeechMock();
  });

  it("reads the visible label of every child button without spokenExtras", async () => {
    const synth = installSpeechMock();
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} onRestart={vi.fn()} gameName="Snake">
        <button type="button">🏆 Leaderboard</button>
        <button type="button">
          <span aria-hidden="true">🎬</span> Clips
        </button>
        <a href="/garage">🔧 Garage</a>
      </PauseMenu>
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe(
      "Paused. Snake. Resume. Leaderboard. Clips. Garage. Restart. Go Home"
    );
  });

  it("uses the aria-label of an icon-only child", async () => {
    const synth = installSpeechMock();
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake">
        <button type="button" aria-label="Sound on">
          🔊
        </button>
      </PauseMenu>
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe("Paused. Snake. Resume. Sound on. Go Home");
  });

  it("keeps the children in the button column", () => {
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake">
        <button type="button">Clips</button>
      </PauseMenu>
    );
    const resume = screen.getByRole("button", { name: /Resume/ });
    const clips = screen.getByRole("button", { name: "Clips" });
    // The wrapper uses display: contents, so the child is a flex item of
    // the same column as Resume.
    expect(clips.parentElement).toHaveClass("contents");
    expect(clips.parentElement?.parentElement).toBe(resume.parentElement);
  });

  it("reads the notes in the break slot after the buttons", async () => {
    const synth = installSpeechMock();
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);

    const slot = screen.getByTestId("pause-menu-break-slot");
    const note = document.createElement("div");
    note.setAttribute("data-read-aloud", "Play full screen!");
    slot.appendChild(note);

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe("Paused. Snake. Resume. Go Home. Play full screen!");
  });
});

describe("PauseMenu ESC hint", () => {
  afterEach(() => {
    resetPointerMock();
  });

  it("shows the ESC hint on a mouse or trackpad", () => {
    mockPointer(false);
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    expect(screen.getByText("Press ESC to resume")).toBeInTheDocument();
  });

  it("hides the ESC hint on a touch screen, which has no ESC key", () => {
    mockPointer(true);
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    expect(screen.queryByText("Press ESC to resume")).not.toBeInTheDocument();
    // The menu itself still works by touch.
    expect(screen.getByRole("button", { name: /Resume/ })).toBeInTheDocument();
  });
});

describe("PauseMenu break slot", () => {
  it("registers its slot while open and removes it when closed", () => {
    const { rerender } = render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />
    );
    const slot = screen.getByTestId("pause-menu-break-slot");
    expect(useGameBreaks.getState().slots).toEqual([slot]);

    rerender(<PauseMenu isOpen={false} onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    expect(useGameBreaks.getState().slots).toEqual([]);
  });
});
