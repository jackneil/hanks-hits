import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";

import { GameStartOverlay, GameStartOverlayButton } from "../GameStartOverlay";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

afterEach(() => {
  resetPointerMock();
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
