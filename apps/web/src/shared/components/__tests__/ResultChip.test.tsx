import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { SECONDARY_ACTION } from "../buttonStyles";
import { RESULT_CHIP_LABELS, RESULT_CHIP_Z_INDEX, ResultChip } from "../ResultChip";

vi.mock("../Leaderboard", () => ({
  Leaderboard: () => <div>Leaderboard content</div>,
}));

let clock = 100_000;

beforeEach(() => {
  clock = 100_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  removeSpeechMock();
  vi.restoreAllMocks();
});

/** Let the 600 ms grace after the chip appears run out. */
function passGrace() {
  clock += 600;
}

function chip() {
  return screen.getByTestId("result-chip");
}

describe("ResultChip layout contract", () => {
  it("portals to document.body at z-index 1200, over a game container", () => {
    render(
      <div className="relative z-10" data-testid="game">
        <ResultChip resultText="Game over! 12 points." onRestart={vi.fn()} />
      </div>
    );
    expect(RESULT_CHIP_Z_INDEX).toBe(1200);
    expect(chip().parentElement).toBe(document.body);
    expect(chip().className).toContain("z-[1200]");
    expect(chip().className).toContain("fixed");
    expect(within(screen.getByTestId("game")).queryByTestId("result-chip")).toBeNull();
  });

  it("gives every button a 56 px target, and 44 px on a short screen", () => {
    installSpeechMock();
    render(
      <ResultChip resultText="Game over!" appId="snake" onRestart={vi.fn()} />
    );
    const buttons = within(chip()).getAllByRole("button");
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.className).toMatch(/(^|\s)min-h-14(\s|$)/);
      expect(button.className).toMatch(/(^|\s)short:min-h-11(\s|$)/);
    }
  });

  it("uses the big labelled read-aloud button, sized to its label", () => {
    installSpeechMock();
    render(<ResultChip resultText="Game over!" onRestart={vi.fn()} />);
    const readAloud = within(chip()).getByTestId("read-aloud-button");
    // The same words as the start card and the pause menu, not a bare icon.
    expect(readAloud).toHaveTextContent("Read it to me");
    expect(readAloud.className).not.toContain("btn-circle");
    // In a row, the column-width button must not push the other buttons out.
    expect(readAloud.className).toMatch(/(^|\s)w-auto!(\s|$)/);
  });

  it("uses a solid surface with no AI-slop tells", () => {
    render(<ResultChip resultText="Game over!" onRestart={vi.fn()} />);
    const surface = within(chip()).getByRole("group");
    const classes = `${chip().className} ${surface.className}`;
    expect(surface.className).toContain("bg-base-100");
    expect(classes).not.toMatch(/gradient|backdrop-blur|border-l-|border-t-|glow|\/\d+\b(?!\])/);
  });

  it("names the group with the result text for screen readers", () => {
    render(<ResultChip resultText="You win! 3 stars." onRestart={vi.fn()} />);
    expect(screen.getByRole("group", { name: "You win! 3 stars." })).toBeInTheDocument();
  });

  it("pairs each action with a word, not only an emoji", () => {
    render(<ResultChip resultText="Game over!" appId="snake" onRestart={vi.fn()} />);
    expect(screen.getByRole("button", { name: RESULT_CHIP_LABELS.playAgain })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: RESULT_CHIP_LABELS.leaderboard })).toBeInTheDocument();
  });
});

describe("ResultChip actions", () => {
  it("shows no Play again button without onRestart", () => {
    render(<ResultChip resultText="Game over!" />);
    expect(screen.queryByRole("button", { name: /play again/i })).toBeNull();
  });

  it("shows Leaderboard only for a game that has a leaderboard", () => {
    const { unmount } = render(<ResultChip resultText="Game over!" appId="not-a-game" />);
    expect(screen.queryByRole("button", { name: /leaderboard/i })).toBeNull();
    unmount();

    render(<ResultChip resultText="Game over!" />);
    expect(screen.queryByRole("button", { name: /leaderboard/i })).toBeNull();
  });

  it("opens the leaderboard above the chip", () => {
    render(<ResultChip resultText="Game over!" appId="snake" />);
    passGrace();
    // A white button on the white chip: it needs a visible edge.
    expect(screen.getByRole("button", { name: /leaderboard/i }).className.split(/\s+/)).toEqual(
      expect.arrayContaining(SECONDARY_ACTION.split(" "))
    );
    fireEvent.click(screen.getByRole("button", { name: /leaderboard/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("z-[1500]");
    expect(screen.getByText("Leaderboard content")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close leaderboard/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("restarts once on Play again after the grace", () => {
    const onRestart = vi.fn();
    render(<ResultChip resultText="Game over!" onRestart={onRestart} />);
    passGrace();
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("starts only one run when Play again is mashed", () => {
    const onRestart = vi.fn();
    render(<ResultChip resultText="Game over!" onRestart={onRestart} />);
    passGrace();
    const button = screen.getByRole("button", { name: /play again/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("renders the children slot for later clip buttons", () => {
    render(
      <ResultChip resultText="Game over!">
        <button type="button" className="btn min-h-11">
          🎬 Watch
        </button>
      </ResultChip>
    );
    expect(within(chip()).getByRole("button", { name: /watch/i })).toBeInTheDocument();
  });
});

describe("ResultChip restart grace", () => {
  it("ignores Play again for 600 ms after it appears", () => {
    const onRestart = vi.fn();
    render(<ResultChip resultText="Game over!" onRestart={onRestart} />);
    const button = screen.getByRole("button", { name: /play again/i });

    fireEvent.click(button);
    clock += 599;
    fireEvent.click(button);
    expect(onRestart).not.toHaveBeenCalled();

    clock += 1;
    fireEvent.click(button);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("keeps ignoring a press that started inside the grace", () => {
    const onRestart = vi.fn();
    render(<ResultChip resultText="Game over!" onRestart={onRestart} />);
    const button = screen.getByRole("button", { name: /play again/i });

    clock += 590;
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "touch", button: 0 });
    clock += 30; // the finger lifts after the grace ended
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", button: 0 });
    fireEvent.click(button, { detail: 1 });
    expect(onRestart).not.toHaveBeenCalled();

    // The next tap is a new, deliberate one.
    clock += 200;
    fireEvent.pointerDown(button, { pointerId: 2, pointerType: "touch", button: 0 });
    fireEvent.pointerUp(button, { pointerId: 2, pointerType: "touch", button: 0 });
    fireEvent.click(button, { detail: 1 });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("guards the children slot too", () => {
    const onWatch = vi.fn();
    render(
      <ResultChip resultText="Game over!">
        <button type="button" onClick={onWatch}>
          🎬 Watch
        </button>
      </ResultChip>
    );
    const watch = screen.getByRole("button", { name: /watch/i });
    fireEvent.click(watch);
    expect(onWatch).not.toHaveBeenCalled();
    passGrace();
    fireEvent.click(watch);
    expect(onWatch).toHaveBeenCalledTimes(1);
  });

  it("uses a custom grace length", () => {
    const onRestart = vi.fn();
    render(<ResultChip resultText="Game over!" onRestart={onRestart} graceMs={100} />);
    clock += 100;
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("keeps ignoring a press that started inside the grace, even when held past 1 s", () => {
    const onRestart = vi.fn();
    render(<ResultChip resultText="Game over!" onRestart={onRestart} />);
    const button = screen.getByRole("button", { name: /play again/i });

    clock += 100;
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "mouse", button: 0 });
    clock += 1100; // a slow press: the grace ended long ago
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "mouse", button: 0 });
    fireEvent.click(button, { detail: 1 });
    expect(onRestart).not.toHaveBeenCalled();

    clock += 100;
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "mouse", button: 0 });
    fireEvent.click(button, { detail: 1 });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("a blocked press that the browser cancels does not eat the next tap", () => {
    const onRestart = vi.fn();
    render(<ResultChip resultText="Game over!" onRestart={onRestart} />);
    const button = screen.getByRole("button", { name: /play again/i });

    clock += 500;
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "touch", button: 0 });
    // The finger scrolled or long-pressed: pointercancel, and no click.
    fireEvent.pointerCancel(button, { pointerId: 1, pointerType: "touch", button: 0 });

    clock += 200; // a deliberate tap soon after the grace
    fireEvent.pointerDown(button, { pointerId: 2, pointerType: "touch", button: 0 });
    fireEvent.pointerUp(button, { pointerId: 2, pointerType: "touch", button: 0 });
    clock += 60;
    fireEvent.click(button, { detail: 1 });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("a blocked press that slides off the button does not eat the next tap", () => {
    const onRestart = vi.fn();
    render(<ResultChip resultText="Game over!" onRestart={onRestart} />);
    const button = screen.getByRole("button", { name: /play again/i });

    clock += 500;
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "touch", button: 0 });
    // The finger lifts somewhere else, so this button gets no click.

    clock += 200;
    fireEvent.pointerDown(button, { pointerId: 2, pointerType: "touch", button: 0 });
    fireEvent.pointerUp(button, { pointerId: 2, pointerType: "touch", button: 0 });
    fireEvent.click(button, { detail: 1 });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("a key press after an abandoned blocked press still works", () => {
    const onRestart = vi.fn();
    render(<ResultChip resultText="Game over!" onRestart={onRestart} />);
    const button = screen.getByRole("button", { name: /play again/i });

    clock += 500;
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "mouse", button: 0 });

    clock += 300;
    // Enter on the focused button: keydown, then the click it makes.
    fireEvent.keyDown(button, { key: "Enter", repeat: false });
    fireEvent.click(button, { detail: 0 });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("stops a held Enter from repeating a button", () => {
    render(<ResultChip resultText="Game over!" onRestart={vi.fn()} />);
    const button = screen.getByRole("button", { name: /play again/i });
    expect(fireEvent.keyDown(button, { key: "Enter", repeat: true })).toBe(false);
    expect(fireEvent.keyDown(button, { key: "Enter", repeat: false })).toBe(true);
  });
});

describe("ResultChip keeps taps away from the game", () => {
  it("a tap on the chip never reaches the game's own handlers", () => {
    const gameTap = vi.fn();
    const gameClick = vi.fn();
    const onRestart = vi.fn();
    render(
      // A canvas game that restarts on any tap at game over.
      <div onPointerDown={gameTap} onClick={gameClick} onTouchStart={gameTap}>
        <ResultChip resultText="Game over!" onRestart={onRestart} />
      </div>
    );
    passGrace();
    const button = screen.getByRole("button", { name: /play again/i });
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "touch", button: 0 });
    fireEvent.touchStart(button);
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", button: 0 });
    fireEvent.click(button, { detail: 1 });

    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(gameTap).not.toHaveBeenCalled();
    expect(gameClick).not.toHaveBeenCalled();
  });

  it("keeps its own presses from the game's window listeners, and lets a press from the game end over it", () => {
    const heard: string[] = [];
    const listener = (event: Event) => heard.push(event.type);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) window.addEventListener(type, listener);
    try {
      const onRestart = vi.fn();
      render(
        <>
          <div data-testid="game" />
          <ResultChip resultText="Game over!" onRestart={onRestart} />
        </>
      );
      passGrace();
      const button = screen.getByRole("button", { name: /play again/i });
      // A press that started on the chip stays with the chip.
      fireEvent.pointerDown(button, { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.mouseDown(button);
      fireEvent.pointerUp(button, { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.mouseUp(button);
      expect(heard).toEqual([]);
      // A finger that held the game's thrust when the run ended lifts over the chip.
      fireEvent.pointerDown(screen.getByTestId("game"), { pointerId: 7, pointerType: "touch", button: 0 });
      fireEvent.pointerUp(button, { pointerId: 7, pointerType: "touch", button: 0 });
      // A mouse drag from the game ends over the chip.
      fireEvent.mouseDown(screen.getByTestId("game"));
      fireEvent.mouseUp(button);
      expect(heard).toEqual(["pointerdown", "pointerup", "mousedown", "mouseup"]);
      expect(onRestart).not.toHaveBeenCalled();
    } finally {
      for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) window.removeEventListener(type, listener);
    }
  });

  it("taps blocked by the grace do not fall through to the game either", () => {
    const gameClick = vi.fn();
    render(
      <div onClick={gameClick}>
        <ResultChip resultText="Game over!" onRestart={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(gameClick).not.toHaveBeenCalled();
  });

  it("a tap beside the chip's surface still reaches the game", () => {
    render(<ResultChip resultText="Game over!" onRestart={vi.fn()} />);
    expect(chip().className).toContain("pointer-events-none");
    expect(within(chip()).getByRole("group").className).toContain("pointer-events-auto");
  });
});

describe("ResultChip read aloud", () => {
  it("reads the result, then every visible action in screen order", async () => {
    const synth = installSpeechMock();
    render(
      <ResultChip resultText="Game over! You got 12 points." appId="snake" onRestart={vi.fn()} />
    );
    passGrace();
    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe(
      "Game over! You got 12 points. Play again. Leaderboard"
    );
  });

  it("names the children slot buttons from spokenExtras", async () => {
    const synth = installSpeechMock();
    render(
      <ResultChip resultText="You win!" onRestart={vi.fn()} spokenExtras={["Watch", "Take a picture"]}>
        <button type="button">🎬 Watch</button>
        <button type="button">📸 Take a picture</button>
      </ResultChip>
    );
    passGrace();
    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe("You win! Play again. Watch. Take a picture");
  });

  it("leaves out actions that are not on screen", async () => {
    const synth = installSpeechMock();
    render(<ResultChip resultText="Game over!" />);
    passGrace();
    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe("Game over!");
  });

  it("never speaks on its own", () => {
    const synth = installSpeechMock();
    render(<ResultChip resultText="Game over!" onRestart={vi.fn()} />);
    passGrace();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("hides the read-aloud button when the browser cannot speak", () => {
    removeSpeechMock();
    render(<ResultChip resultText="Game over!" onRestart={vi.fn()} />);
    expect(screen.queryByTestId("read-aloud-button")).toBeNull();
    expect(screen.getByRole("button", { name: /play again/i })).toBeInTheDocument();
  });
});
