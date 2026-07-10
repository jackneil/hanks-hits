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
