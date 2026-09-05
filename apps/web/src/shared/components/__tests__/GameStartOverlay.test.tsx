import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GameStartOverlay, GameStartOverlayButton } from "../GameStartOverlay";

/**
 * The setup file installs a matchMedia stub that always returns
 * matches: false. These helpers swap in a stub where "(pointer: coarse)"
 * resolves to the requested value so we can simulate touch vs
 * keyboard/mouse viewports.
 */
function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
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
  mockPointer(false);
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

type SpeechFake = {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
};

/** jsdom has no Web Speech API — install a fake one. */
function installSpeechMock() {
  const synth = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: vi.fn(() => [] as SpeechSynthesisVoice[]),
    speaking: false,
    paused: false,
    pending: false,
  };
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    writable: true,
    value: synth,
  });
  class FakeUtterance {
    text: string;
    rate?: number;
    pitch?: number;
    lang?: string;
    voice?: unknown;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });
  return synth as unknown as SpeechFake;
}

function removeSpeechMock() {
  // @ts-expect-error - removing the fake API to simulate an old browser
  delete window.speechSynthesis;
  // @ts-expect-error - removing the fake API to simulate an old browser
  delete window.SpeechSynthesisUtterance;
}

/** The text handed to the most recent speak() call. */
function spokenText(synth: SpeechFake): string {
  const last = synth.speak.mock.calls[synth.speak.mock.calls.length - 1];
  return (last[0] as { text: string }).text;
}

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

    expect(spokenText(synth)).toBe(
      "Asteroids. Blast the rocks. Tap FIRE to shoot. Tap ⟲ ⟳ to rotate"
    );
    expect(spokenText(synth)).not.toContain("Press SPACE");
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

    expect(spokenText(synth)).toBe(
      "Asteroids. Blast the rocks. Press SPACE to shoot. Arrow keys to rotate"
    );
    expect(spokenText(synth)).not.toContain("Tap FIRE");
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
