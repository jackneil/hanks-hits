import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";
import { installAudioMock, removeAudioMock } from "@/__tests__/audio-mock";
import { useGameBreaks } from "../../lib/gameBreaks";

import { GameStartOverlay, GameStartOverlayButton } from "../GameStartOverlay";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

afterEach(() => {
  resetPointerMock();
  // Also resets the shared game-audio bus, so no test sees another test's bus.
  removeAudioMock();
});

describe("GameStartOverlay", () => {
  it("shows touch instructions (not keyboard copy) on coarse-pointer viewports", () => {
    mockPointer(true);
    render(
      <GameStartOverlay
        title="Asteroids"
        touchHints={["Tap FIRE to shoot", "Tap ⟲ ⟳ to rotate"]}
        keyboardHints={["Press SPACE to shoot", "Arrow keys to rotate"]}
        onStart={() => {}}
      />
    );

    expect(screen.getByText("Tap FIRE to shoot")).toBeInTheDocument();
    expect(screen.getByText("Tap ⟲ ⟳ to rotate")).toBeInTheDocument();
    expect(screen.queryByText("Press SPACE to shoot")).not.toBeInTheDocument();
    expect(screen.queryByText("Arrow keys to rotate")).not.toBeInTheDocument();
  });

  it("shows keyboard instructions (not touch copy) on fine-pointer viewports", () => {
    mockPointer(false);
    render(
      <GameStartOverlay
        title="Asteroids"
        touchHints={["Tap FIRE to shoot"]}
        keyboardHints={["Press SPACE to shoot"]}
        onStart={() => {}}
      />
    );

    expect(screen.getByText("Press SPACE to shoot")).toBeInTheDocument();
    expect(screen.queryByText("Tap FIRE to shoot")).not.toBeInTheDocument();
  });

  it("renders the title exactly once, as a heading", () => {
    render(
      <GameStartOverlay title="Blitz Bomber" onStart={() => {}} />
    );

    const headings = screen.getAllByRole("heading", { name: "Blitz Bomber" });
    expect(headings).toHaveLength(1);
    expect(screen.getAllByText("Blitz Bomber")).toHaveLength(1);
  });

  it("forwards aria-pressed on picker buttons so the selection is announced", () => {
    render(
      <GameStartOverlay title="Racer" onStart={() => {}} showStartButton={false}>
        <GameStartOverlayButton onClick={() => {}} aria-pressed={true}>
          Easy
        </GameStartOverlayButton>
        <GameStartOverlayButton onClick={() => {}} aria-pressed={false}>
          Medium
        </GameStartOverlayButton>
        <GameStartOverlayButton onClick={() => {}}>Hard</GameStartOverlayButton>
      </GameStartOverlay>
    );

    // aria-pressed={true} is forwarded verbatim: queryable as a pressed toggle.
    expect(
      screen.getByRole("button", { name: "Easy", pressed: true })
    ).toBeInTheDocument();

    // aria-pressed={false} is forwarded as an explicit unpressed toggle.
    expect(
      screen.getByRole("button", { name: "Medium", pressed: false })
    ).toBeInTheDocument();
    // ...and the pressed query is exclusive — it must not match the false one.
    expect(
      screen.queryByRole("button", { name: "Medium", pressed: true })
    ).not.toBeInTheDocument();

    // Omitting the prop leaves the attribute off entirely (not a toggle button).
    expect(screen.getByRole("button", { name: "Hard" })).not.toHaveAttribute(
      "aria-pressed"
    );
  });

  it("renders the picker slot between the hints and the start button", () => {
    render(
      <GameStartOverlay title="Platformer" onStart={() => {}}>
        <GameStartOverlayButton onClick={() => {}}>
          Level 1
        </GameStartOverlayButton>
        <GameStartOverlayButton onClick={() => {}}>
          Level 2
        </GameStartOverlayButton>
      </GameStartOverlay>
    );

    expect(screen.getByRole("button", { name: "Level 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Level 2" })).toBeInTheDocument();
  });

  it("fires onStart exactly once even when the start button is mashed", () => {
    const onStart = vi.fn();
    render(<GameStartOverlay title="Snake" onStart={onStart} />);

    const start = screen.getByRole("button", { name: /play/i });
    fireEvent.click(start);
    fireEvent.click(start);
    fireEvent.click(start);

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("uses a custom start label when provided", () => {
    render(
      <GameStartOverlay title="Snake" startLabel="Start Racing!" onStart={() => {}} />
    );
    expect(
      screen.getByRole("button", { name: "Start Racing!" })
    ).toBeInTheDocument();
  });

  it("hides the built-in start button when the picker starts the game", () => {
    render(
      <GameStartOverlay title="Blitz Bomber" onStart={() => {}} showStartButton={false}>
        <GameStartOverlayButton onClick={() => {}}>Easy</GameStartOverlayButton>
      </GameStartOverlay>
    );

    expect(screen.queryByRole("button", { name: /play/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Easy" })).toBeInTheDocument();
  });

  it("keeps every interactive target at >=44px (touch-target classes)", () => {
    render(
      <GameStartOverlay title="Snake" onStart={() => {}}>
        <GameStartOverlayButton onClick={() => {}}>Easy</GameStartOverlayButton>
      </GameStartOverlay>
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toMatch(/min-h-\[44px\]/);
    }
  });

  it("is a DOM overlay, not canvas: renders no canvas element", () => {
    const { container } = render(
      <GameStartOverlay title="Snake" onStart={() => {}} />
    );
    expect(container.querySelector("canvas")).toBeNull();
  });
});

describe("GameStartOverlay game sound", () => {
  it("starts the shared game sound inside the Play tap, before onStart", () => {
    const audio = installAudioMock();
    let resumeCallsWhenStarted = -1;
    const onStart = vi.fn(() => {
      resumeCallsWhenStarted = audio.lastContext().resume.mock.calls.length;
    });
    render(<GameStartOverlay title="Snake" onStart={onStart} />);
    expect(audio.contexts).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /play/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(audio.contexts).toHaveLength(1);
    // resume() already ran, in the same tap, when the game started.
    expect(resumeCallsWhenStarted).toBeGreaterThan(0);
  });

  it("also starts the sound when a picker choice starts the game", () => {
    const audio = installAudioMock();
    const pick = vi.fn();
    render(
      <GameStartOverlay title="Blitz Bomber" onStart={() => {}} showStartButton={false}>
        <GameStartOverlayButton onClick={pick}>Easy</GameStartOverlayButton>
      </GameStartOverlay>
    );

    fireEvent.click(screen.getByRole("button", { name: "Easy" }));

    expect(pick).toHaveBeenCalledTimes(1);
    expect(audio.lastContext().resume).toHaveBeenCalled();
  });

  it("still starts the game in a browser with no Web Audio", () => {
    removeAudioMock();
    const onStart = vi.fn();
    render(<GameStartOverlay title="Snake" onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("still starts the game when the browser refuses an AudioContext", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installAudioMock({ constructorThrows: true });
    const onStart = vi.fn();
    render(<GameStartOverlay title="Snake" onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("makes no game sound when the kid only taps read-aloud", async () => {
    installSpeechMock();
    const audio = installAudioMock();
    render(<GameStartOverlay title="Snake" onStart={() => {}} />);

    fireEvent.click(await screen.findByTestId("read-aloud-button"));

    expect(audio.contexts).toHaveLength(0);
    removeSpeechMock();
  });
});


describe("GameStartOverlay layout: the start action is always on screen", () => {
  // Regression (verify finding swe19): the card's scroll box was capped at
  // the game's own box, so on a phone Play (or every choice) sat below the
  // visible part of the card with no hint. jsdom has no layout, so these
  // tests pin the structure that makes it work. The Playwright check in
  // e2e/start-cards (pnpm e2e:start-cards <base-url>) tests it on real
  // screens, for every route on the home page.
  afterEach(() => {
    removeSpeechMock();
  });

  it("covers the page from document.body, so a small game box cannot clip it", () => {
    render(
      <div data-testid="game-box" className="relative overflow-hidden" style={{ height: 200 }}>
        <GameStartOverlay title="Platformer" onStart={() => {}} />
      </div>
    );

    const overlay = screen.getByTestId("game-start-overlay");
    expect(overlay.parentElement).toBe(document.body);
    expect(screen.getByTestId("game-box")).not.toContainElement(overlay);
    expect(overlay.className).toMatch(/\bfixed\b/);
    expect(overlay.className).toMatch(/\binset-0\b/);
  });

  it("pins Play and Read it to me in an action row under the scrolling body", async () => {
    installSpeechMock();
    render(
      <GameStartOverlay
        title="Trivia"
        touchHints={["Tap the right answer"]}
        keyboardHints={["Click the right answer"]}
        onStart={() => {}}
      >
        <div>How old are you?</div>
        <GameStartOverlayButton onClick={() => {}}>Easy</GameStartOverlayButton>
      </GameStartOverlay>
    );

    const card = screen.getByTestId("start-card");
    const body = screen.getByTestId("start-card-body");
    const actions = screen.getByTestId("start-card-actions");
    const play = screen.getByRole("button", { name: /play/i });

    // Play and the read-aloud button never scroll out of view.
    expect(actions).toContainElement(play);
    expect(actions).toContainElement(await screen.findByTestId("read-aloud-button"));
    expect(body).not.toContainElement(play);
    expect(actions.className).toMatch(/\bshrink-0\b/);

    // The words and the optional picker scroll in the body, above the row.
    expect(body).toContainElement(screen.getByText("Click the right answer"));
    expect(body).toContainElement(screen.getByRole("button", { name: "Easy" }));
    expect(body.className).toMatch(/\boverflow-y-auto\b/);
    expect(body.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card).toContainElement(body);
    expect(card).toContainElement(actions);
  });

  it("puts the action row beside the body on a short screen (a phone held sideways)", () => {
    // On a 390 px tall screen, a stacked card left the body about 70 px:
    // Platformer's title was cut in half above its level buttons. Side by
    // side, the words and the choices each get the card's full height.
    render(
      <GameStartOverlay title="Platformer" onStart={() => {}} showStartButton={false}>
        <GameStartOverlayButton onClick={() => {}}>Level 1</GameStartOverlayButton>
      </GameStartOverlay>
    );

    const card = screen.getByTestId("start-card");
    const body = screen.getByTestId("start-card-body");
    const actions = screen.getByTestId("start-card-actions");
    expect(card.className).toMatch(/(^|\s)short:flex-row(\s|$)/);
    expect(body.className).toMatch(/(^|\s)short:flex-1(\s|$)/);
    expect(actions.className).toMatch(/(^|\s)short:w-\[45%\](\s|$)/);
    // "safe" centering: a row taller than the card starts at the top, where
    // the card's own scroll can reach it.
    expect(actions.className).toMatch(/(^|\s)short:\[align-self:safe_center\](\s|$)/);
  });

  describe("the body's scroll cue", () => {
    // Regression (verify finding R8): the cue was pure CSS and drew a gray
    // "more below" line under the hints on a 375x667 iPhone, on cards whose
    // body did not scroll at all. It is measured now (useScrollCue).
    let bodyScrollHeight = 300;
    beforeEach(() => {
      bodyScrollHeight = 300;
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get(this: HTMLElement) {
          return this.dataset.testid === "start-card-body" ? bodyScrollHeight : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get(this: HTMLElement) {
          return this.dataset.testid === "start-card-body" ? 300 : 0;
        },
      });
    });
    afterEach(() => {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    });

    it("shows no cue on a body that fits", () => {
      render(<GameStartOverlay title="2048" touchHints={["Swipe to move"]} onStart={() => {}} />);
      const body = screen.getByTestId("start-card-body");
      expect(body).toHaveClass("scroll-cue");
      expect(body).not.toHaveAttribute("data-more-below");
      expect(body).not.toHaveAttribute("data-more-above");
    });

    it("shows the more-below cue on a body that scrolls", () => {
      bodyScrollHeight = 520;
      render(<GameStartOverlay title="Oregon Trail" touchHints={["Tap to pick"]} onStart={() => {}} />);
      const body = screen.getByTestId("start-card-body");
      expect(body).toHaveAttribute("data-more-below");
      expect(body).not.toHaveAttribute("data-more-above");
    });
  });

  it("pins a single picker child into the action row, above Play", () => {
    // Hill Climb's Garage button sat at the end of the scrolling body,
    // under the fold at 375x549: a centre tap hit Read it to me (S12).
    render(
      <GameStartOverlay title="Hill Climb Racing" keyboardHints={["Tap gas", "Tap brake"]} onStart={() => {}}>
        <GameStartOverlayButton onClick={() => {}}>🚗 Garage</GameStartOverlayButton>
      </GameStartOverlay>
    );
    const actions = screen.getByTestId("start-card-actions");
    const body = screen.getByTestId("start-card-body");
    const garage = screen.getByRole("button", { name: /Garage/ });
    const play = screen.getByRole("button", { name: /play/i });
    expect(actions).toContainElement(garage);
    expect(body).not.toContainElement(garage);
    expect(garage.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The hints stay in the body.
    expect(body).toContainElement(screen.getByText("Tap gas"));
  });

  describe("the picker's place in the body", () => {
    // A phone upright (375x549) put the age picker under the hints, so
    // Wordle showed "How old are you?" with the choices under the fold and
    // Math Attack showed the heading and no choice at all (phone UX audit
    // 2026-09-29, S12). On a touch screen, and on any short screen, the
    // choices come before the hints: a choice is never under the fold
    // while a hint is on screen. A desktop with a mouse keeps the reading
    // order: how to play, then the choices.
    const realMatchMedia = window.matchMedia;
    function mockMedia({ coarse, short }: { coarse: boolean; short: boolean }) {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
          matches: query.includes("pointer: coarse") ? coarse : query.includes("max-height: 480px") ? short : false,
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
    afterEach(() => {
      Object.defineProperty(window, "matchMedia", { writable: true, value: realMatchMedia });
    });

    function renderSnake() {
      render(
        <GameStartOverlay
          title="Snake"
          emoji="🐍"
          touchHints={["Swipe to turn", "Eat the apples"]}
          keyboardHints={["Arrows to turn", "Eat the apples"]}
          onStart={() => {}}
        >
          <div>How fast?</div>
          <GameStartOverlayButton onClick={() => {}}>Slow</GameStartOverlayButton>
        </GameStartOverlay>
      );
      const hints = screen.getByTestId("start-card-hints");
      const pickers = screen.getByTestId("start-card-pickers");
      const pickerBeforeHints = !!(pickers.compareDocumentPosition(hints) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { hints, pickers, pickerBeforeHints, body: screen.getByTestId("start-card-body") };
    }

    it("keeps the hints before the picker on a desktop with a mouse", () => {
      mockMedia({ coarse: false, short: false });
      const { pickerBeforeHints, body, pickers, hints } = renderSnake();
      expect(pickerBeforeHints).toBe(false);
      expect(body).toContainElement(pickers);
      expect(body).toContainElement(hints);
    });

    it("puts the picker before the hints on a touch screen, upright too", () => {
      mockMedia({ coarse: true, short: false });
      const { pickerBeforeHints, body, pickers } = renderSnake();
      expect(pickerBeforeHints).toBe(true);
      expect(body).toContainElement(pickers);
      // Still in the body, above the pinned action row.
      expect(screen.getByTestId("start-card-actions")).not.toContainElement(pickers);
    });

    it("puts the picker before the hints on a short screen (a phone held sideways)", () => {
      mockMedia({ coarse: false, short: true });
      const { pickerBeforeHints } = renderSnake();
      expect(pickerBeforeHints).toBe(true);
    });

    it("draws a smaller emoji on a touch screen, so one more row of choices fits", () => {
      mockMedia({ coarse: true, short: false });
      renderSnake();
      const emoji = screen.getByText("🐍");
      expect(emoji.className).toMatch(/(^|\s)text-4xl(\s|$)/);
      expect(emoji.className).not.toMatch(/(^|\s)text-5xl(\s|$)/);
    });

    it("keeps the big emoji on a desktop with a mouse", () => {
      mockMedia({ coarse: false, short: false });
      renderSnake();
      expect(screen.getByText("🐍").className).toMatch(/(^|\s)text-5xl(\s|$)/);
    });
  });

  it("gives the card the whole width on a short screen: no break slot beside it", () => {
    // The install tip beside the card took 288 px of a 667 px screen, so
    // one hint wrapped to two lines; the tip waits for a taller break.
    const realMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query.includes("max-height: 480px"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      render(<GameStartOverlay title="Blitz Bomber" keyboardHints={["Space to drop a bomb"]} onStart={() => {}} />);
      expect(screen.queryByTestId("start-overlay-break-slot")).toBeNull();
    } finally {
      Object.defineProperty(window, "matchMedia", { writable: true, value: realMatchMedia });
    }
    render(<GameStartOverlay title="Blitz Bomber" keyboardHints={["Space to drop a bomb"]} onStart={() => {}} />);
    expect(screen.getByTestId("start-overlay-break-slot")).toBeInTheDocument();
  });

  it("uses two hint columns on a short screen only with two or more hints", () => {
    const one = render(
      <GameStartOverlay title="Blitz Bomber" keyboardHints={["Space to drop a bomb"]} onStart={() => {}} />
    );
    expect(screen.getByTestId("start-card-hints").className).not.toMatch(/short:grid-cols-2/);
    one.unmount();

    render(
      <GameStartOverlay title="Blitz Bomber" keyboardHints={["Space to drop", "Hit the ground"]} onStart={() => {}} />
    );
    expect(screen.getByTestId("start-card-hints").className).toMatch(/(^|\s)short:grid-cols-2(\s|$)/);
  });

  it("pins every choice in the action row when the picker starts the game", () => {
    render(
      <GameStartOverlay title="Space Invaders" onStart={() => {}} showStartButton={false}>
        <GameStartOverlayButton onClick={() => {}}>4yo</GameStartOverlayButton>
        <GameStartOverlayButton onClick={() => {}}>8yo</GameStartOverlayButton>
        <GameStartOverlayButton onClick={() => {}}>12yo</GameStartOverlayButton>
      </GameStartOverlay>
    );

    const actions = screen.getByTestId("start-card-actions");
    const body = screen.getByTestId("start-card-body");
    for (const name of ["4yo", "8yo", "12yo"]) {
      const choice = screen.getByRole("button", { name });
      expect(actions).toContainElement(choice);
      expect(body).not.toContainElement(choice);
    }
  });
});

describe("GameStartOverlay read aloud", () => {
  afterEach(() => {
    removeSpeechMock();
    vi.restoreAllMocks();
  });

  it("reads the title, subtitle and the TOUCH hints on a coarse-pointer viewport", async () => {
    mockPointer(true);
    const synth = installSpeechMock();
    render(
      <GameStartOverlay
        title="Asteroids"
        subtitle="Blast the rocks"
        touchHints={["Tap FIRE to shoot", "Tap ⟲ ⟳ to rotate"]}
        keyboardHints={["Press SPACE to shoot"]}
        onStart={() => {}}
      />
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));

    expect(synth.lastUtterance().text).toBe(
      "Asteroids. Blast the rocks. Tap FIRE to shoot. Tap ⟲ ⟳ to rotate. Then tap Play! to start."
    );
    expect(synth.lastUtterance().text).not.toContain("Press SPACE");
  });

  it("reads the KEYBOARD hints on a fine-pointer viewport", async () => {
    mockPointer(false);
    const synth = installSpeechMock();
    render(
      <GameStartOverlay
        title="Asteroids"
        subtitle="Blast the rocks"
        touchHints={["Tap FIRE to shoot"]}
        keyboardHints={["Press SPACE to shoot", "Arrow keys to rotate"]}
        onStart={() => {}}
      />
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));

    expect(synth.lastUtterance().text).toBe(
      "Asteroids. Blast the rocks. Press SPACE to shoot. Arrow keys to rotate. Then tap Play! to start."
    );
    expect(synth.lastUtterance().text).not.toContain("Tap FIRE");
  });

  it("speaks the picker choices and the tap that starts a picker-only game", async () => {
    mockPointer(true);
    const synth = installSpeechMock();
    render(
      <GameStartOverlay
        title="Space Invaders"
        touchHints={["Tap to shoot"]}
        spokenChoices="Pick how old you are: 4, 8, or 12."
        showStartButton={false}
        onStart={() => {}}
      >
        <button type="button">👶 4yo</button>
      </GameStartOverlay>
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));

    expect(synth.lastUtterance().text).toBe(
      "Space Invaders. Tap to shoot. Pick how old you are: 4, 8, or 12. Then tap one of the choices to start."
    );
  });

  it("is a labelled dialog that lands keyboard focus on the start button", () => {
    render(
      <GameStartOverlay title="Snake" onStart={() => {}}>
        <button type="button">Slow</button>
      </GameStartOverlay>
    );

    const overlay = screen.getByTestId("game-start-overlay");
    expect(overlay).toHaveAttribute("role", "dialog");
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("dialog", { name: "Snake" })).toBe(overlay);
    expect(screen.getByRole("button", { name: /play/i })).toHaveFocus();
  });

  it("shows no read-aloud button when the browser cannot speak", () => {
    removeSpeechMock();
    render(<GameStartOverlay title="Snake" onStart={() => {}} />);
    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });

  it("does not start the game when the read-aloud button is tapped", async () => {
    installSpeechMock();
    const onStart = vi.fn();
    render(<GameStartOverlay title="Snake" onStart={onStart} />);

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("GameStartOverlay celebration slot on a short screen", () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { writable: true, value: realMatchMedia });
    useGameBreaks.setState({ shells: 0, slots: [] });
  });

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

  it("holds a trophy (one row) at the top of the action column, and no tip", () => {
    // On a short screen the slot beside the card is gone, so a trophy
    // earned sideways had no break in any game but Asteroids and showed
    // only on the home page strip.
    mockShort(true);
    render(<GameStartOverlay title="Snake" onStart={() => {}} />);
    expect(screen.queryByTestId("start-overlay-break-slot")).toBeNull();
    const slot = screen.getByTestId("start-overlay-short-slot");
    expect(screen.getByTestId("start-card-actions")).toContainElement(slot);
    expect(screen.getByTestId("start-card-actions").firstElementChild).toBe(slot);
    expect(useGameBreaks.getState().slots).toEqual([{ el: slot, holds: ["celebration"] }]);
  });

  it("reads a trophy in that slot with the card's own words", async () => {
    mockShort(true);
    const synth = installSpeechMock();
    render(<GameStartOverlay title="Snake" onStart={() => {}} />);
    const note = document.createElement("div");
    note.setAttribute("data-read-aloud", "New trophy! First Play!");
    screen.getByTestId("start-overlay-short-slot").appendChild(note);
    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toContain("New trophy! First Play!");
  });

  it("has no short slot on a tall screen: the slot beside the card holds every note", () => {
    mockShort(false);
    render(<GameStartOverlay title="Snake" onStart={() => {}} />);
    expect(screen.queryByTestId("start-overlay-short-slot")).toBeNull();
    const slot = screen.getByTestId("start-overlay-break-slot");
    expect(useGameBreaks.getState().slots).toEqual([{ el: slot, holds: ["tip", "celebration"] }]);
  });
});
