import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { ALL_NOTES, useGameBreaks } from "../../lib/gameBreaks";
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

describe("PauseMenu layout", () => {
  it("centers its column with auto margins, so a tall column scrolls from its top", () => {
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    const overlay = screen.getByTestId("pause-menu");
    const content = screen.getByTestId("pause-menu-content");

    // justify-center on a scroll container clips the top of a column that
    // is taller than the screen ("Paused" included), where no scroll can
    // reach it. Auto margins center it only when it fits.
    expect(overlay).toHaveClass("fixed", "inset-0", "flex", "overflow-y-auto");
    expect(overlay.className).not.toMatch(/justify-center|items-center/);
    expect(content.parentElement).toBe(overlay);
    expect(content).toHaveClass("m-auto");
    expect(content).toContainElement(screen.getByRole("heading", { name: "Paused" }));
    expect(content).toContainElement(screen.getByTestId("pause-menu-break-slot"));
  });
});

/** matchMedia where (max-height: 480px) matches `short` and (pointer: coarse) matches `coarse`. */
function mockScreen({ short, coarse = true }: { short: boolean; coarse?: boolean }) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("max-height: 480px") ? short : query.includes("pointer: coarse") ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("PauseMenu on a short screen (a phone held sideways)", () => {
  afterEach(() => {
    resetPointerMock();
  });

  it("lays the buttons out as a 2 x 2 grid of 44 px targets, so Resume, Restart and Go Home fit with no scroll", () => {
    // One 580 px column on a 311 px screen put Go Home at y 312 to 368,
    // with no scroll cue (phone UX audit 2026-09-29, S3).
    mockScreen({ short: true });
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} onRestart={vi.fn()} gameName="Snake">
        <button type="button" className="btn btn-lg">
          🏆 Leaderboard
        </button>
      </PauseMenu>
    );
    const buttons = screen.getByTestId("pause-menu-buttons");
    expect(buttons.className).toMatch(/(^|\s)short:grid(\s|$)/);
    expect(buttons.className).toMatch(/(^|\s)short:grid-cols-2(\s|$)/);
    for (const name of [/Resume/, "Restart game", /Go Home/]) {
      const button = screen.getByRole("button", { name });
      expect(buttons).toContainElement(button);
      expect(button.className).toMatch(/(^|\s)short:min-h-11(\s|$)/);
    }
    // The child button is a grid cell too (display: contents wrapper).
    expect(screen.getByRole("button", { name: /Leaderboard/ }).parentElement).toHaveClass("contents");
    // The heading is smaller, so the grid has room.
    expect(screen.getByRole("heading", { name: "Paused" }).className).toMatch(/(^|\s)short:text-2xl(\s|$)/);
  });

  it("drops the install tip: no break slot on a short screen", () => {
    mockScreen({ short: true });
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    expect(screen.queryByTestId("pause-menu-break-slot")).toBeNull();
    expect(useGameBreaks.getState().slots).toEqual([]);
  });

  it("keeps the break slot on a tall screen", () => {
    mockScreen({ short: false });
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    expect(screen.getByTestId("pause-menu-break-slot")).toBeInTheDocument();
  });

  it("shows a scroll cue when the menu is taller than the screen", () => {
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    const overlay = screen.getByTestId("pause-menu");
    expect(overlay.className).toMatch(/(^|\s)scroll-cue(\s|$)/);
    expect(overlay.className).toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    // jsdom has no layout: a menu that fits shows no cue.
    expect(overlay).not.toHaveAttribute("data-more-below");
  });
});

describe("PauseMenu break slot", () => {
  it("registers its slot while open and removes it when closed", () => {
    const { rerender } = render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />
    );
    const slot = screen.getByTestId("pause-menu-break-slot");
    // The menu holds every note: the install tip and a trophy celebration.
    expect(useGameBreaks.getState().slots).toEqual([{ el: slot, holds: ALL_NOTES }]);

    rerender(<PauseMenu isOpen={false} onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    expect(useGameBreaks.getState().slots).toEqual([]);
  });
});
