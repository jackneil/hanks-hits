import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { useGameBreaks } from "../../lib/gameBreaks";
import { GAME_SHEET_ACTION, GAME_SHEET_Z_INDEX, GameSheet } from "../GameSheet";

/**
 * The shared card for a game's own screens between runs (phone UX audit
 * 2026-09-29, S3): it fits a phone held sideways, its actions never
 * scroll out of view, and it reads itself out loud.
 */

/** matchMedia where (max-height: 480px) matches `short`. */
function mockShort(short: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("max-height: 480px") ? short : false,
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

beforeEach(() => {
  mockShort(false);
  useGameBreaks.setState({ shells: 0, slots: [] });
});

afterEach(() => {
  removeSpeechMock();
});

function renderGameOver(props: Partial<React.ComponentProps<typeof GameSheet>> = {}) {
  const onRetry = vi.fn();
  const onGarage = vi.fn();
  render(
    <div data-testid="game-root" className="fixed inset-0">
      <GameSheet
        title="You crashed!"
        emoji="💥"
        actions={
          <>
            <button type="button" className={GAME_SHEET_ACTION} onClick={onRetry}>
              🔁 Try again
            </button>
            <button type="button" className={GAME_SHEET_ACTION} onClick={onGarage}>
              🚗 Garage
            </button>
          </>
        }
        {...props}
      >
        <p>You drove 213 m.</p>
        <p>Best: 890 m.</p>
      </GameSheet>
    </div>
  );
  return { onRetry, onGarage };
}

describe("GameSheet", () => {
  it("covers the screen under the header, at the game tier, from document.body", () => {
    renderGameOver();
    const sheet = screen.getByTestId("game-sheet");
    expect(GAME_SHEET_Z_INDEX).toBe(60);
    expect(sheet.className).toContain("z-[60]");
    expect(sheet.className).toMatch(/(^|\s)fixed(\s|$)/);
    expect(sheet.className).toMatch(/(^|\s)top-12(\s|$)/);
    expect(sheet.className).toMatch(/(^|\s)short:top-10(\s|$)/);
    expect(sheet.className).not.toMatch(/inset-0|items-center/);
    expect(sheet.className).toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(sheet.parentElement).toBe(document.body);
    expect(screen.getByTestId("game-root")).not.toContainElement(sheet);
    expect(sheet).toHaveAttribute("role", "dialog");
    expect(sheet).toHaveAccessibleName("You crashed!");
  });

  it("keeps the actions pinned under a scrolling body, and beside it on a short screen", () => {
    installSpeechMock();
    renderGameOver();
    const card = screen.getByTestId("game-sheet-card");
    const body = screen.getByTestId("game-sheet-body");
    const actions = screen.getByTestId("game-sheet-actions");
    expect(card).toContainElement(body);
    expect(card).toContainElement(actions);
    expect(body.className).toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(actions.className).toMatch(/(^|\s)shrink-0(\s|$)/);
    expect(card.className).toMatch(/(^|\s)short:flex-row(\s|$)/);
    expect(body.className).toMatch(/(^|\s)short:flex-1(\s|$)/);
    expect(actions.className).toMatch(/(^|\s)short:w-\[45%\](\s|$)/);
    expect(body).toContainElement(screen.getByText("You drove 213 m."));
    expect(actions).toContainElement(screen.getByRole("button", { name: /Try again/ }));
    // The main action first: Try again before Garage.
    const buttons = within(actions).getAllByRole("button");
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      expect.stringMatching(/Read it to me|Stop/),
      "🔁 Try again",
      "🚗 Garage",
    ]);
  });

  it("gives every action a 44 px target, also on a short screen", () => {
    renderGameOver();
    for (const name of [/Try again/, /Garage/]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("min-h-[44px]");
      expect(button.className).toMatch(/(^|\s)short:min-h-11(\s|$)/);
      expect(button.className).toMatch(/(^|\s)w-full(\s|$)/);
    }
  });

  it("fires the actions on a tap", () => {
    const { onRetry, onGarage } = renderGameOver();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    fireEvent.click(screen.getByRole("button", { name: /Garage/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onGarage).toHaveBeenCalledTimes(1);
  });

  it("reads the title, the words and every action, in screen order", async () => {
    const synth = installSpeechMock();
    renderGameOver();
    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    // Sentences, not "m..": a part that ends a sentence gets no extra period.
    expect(synth.lastUtterance().text).toBe("You crashed! You drove 213 m. Best: 890 m. Try again. Garage.");
  });

  it("says the given words instead, and the break-slot notes after them", async () => {
    const synth = installSpeechMock();
    renderGameOver({ spokenText: "You crashed after 213 meters. Try again, or go to the garage." });
    const slot = screen.getByTestId("game-sheet-break-slot");
    const note = document.createElement("div");
    note.setAttribute("data-read-aloud", "Play full screen!");
    slot.appendChild(note);
    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe(
      "You crashed after 213 meters. Try again, or go to the garage. Play full screen!"
    );
  });

  it("skips hidden parts of the body and says a stat made of several nodes as one line", async () => {
    const synth = installSpeechMock();
    render(
      <GameSheet title="Level 3 done!" actions={<button type="button">Next level</button>}>
        <p>
          <span aria-hidden="true">⭐⭐⭐</span> You got <b>3</b> stars
        </p>
        <p hidden>secret</p>
      </GameSheet>
    );
    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe("Level 3 done! You got 3 stars. Next level.");
  });

  it("is a break: it registers a slot for the install tip, but not on a short screen", () => {
    const { unmount } = render(<GameSheet title="Settings" actions={<button type="button">Back</button>} />);
    const slot = screen.getByTestId("game-sheet-break-slot");
    expect(useGameBreaks.getState().slots).toEqual([slot]);
    unmount();
    expect(useGameBreaks.getState().slots).toEqual([]);

    mockShort(true);
    render(<GameSheet title="Settings" actions={<button type="button">Back</button>} />);
    expect(screen.queryByTestId("game-sheet-break-slot")).toBeNull();
    expect(useGameBreaks.getState().slots).toEqual([]);
  });

  it("keeps a press on the sheet from reaching the game under it", () => {
    const gameTap = vi.fn();
    render(
      <div onPointerDown={gameTap} onClick={gameTap} onTouchStart={gameTap}>
        <GameSheet title="Paused" actions={<button type="button">Resume</button>} />
      </div>
    );
    const resume = screen.getByRole("button", { name: "Resume" });
    fireEvent.pointerDown(resume);
    fireEvent.touchStart(resume);
    fireEvent.click(resume);
    expect(gameTap).not.toHaveBeenCalled();
  });

  it("uses a solid card with no decoration tells", () => {
    renderGameOver();
    const sheet = screen.getByTestId("game-sheet");
    const classes = [sheet, ...Array.from(sheet.querySelectorAll("*"))].map((el) => el.className).join(" ");
    expect(classes).toContain("bg-base-100");
    expect(classes).not.toMatch(/gradient|backdrop-blur|border-l-|border-t-|purple|violet/);
  });
});
