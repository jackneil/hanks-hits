import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { GameUI } from "../ui/GameUI";
import { PauseMenu } from "../ui/PauseMenu";
import { mockPointer } from "@/__tests__/pointer-mock";

describe("hill-climb GameUI HUD layer", () => {
  it("anchors below the GameShell header instead of inset-0 (pause button was buried)", () => {
    // Regression: the HUD layer was `fixed inset-0`, which put its top-4 pause
    // button underneath the shell's fixed 48px z-[1000] header — unreachable
    // by touch AND mouse. The layer must start below the header.
    const { container } = render(
      <GameUI
        fuel={100}
        maxFuel={100}
        nitro={100}
        maxNitro={100}
        nitroActive={false}
        distance={0}
        speed={0}
      />
    );
    const layer = container.firstElementChild as HTMLElement;
    expect(layer.className).toContain("top-12");
    expect(layer.className).not.toContain("inset-0");

    const pause = screen.getByRole("button", { name: "Pause game" });
    // Real touch target (w-12 h-12 = 48px) that accepts pointer events inside
    // the pointer-events-none HUD layer.
    expect(pause.className).toContain("w-12");
    expect(pause.className).toContain("pointer-events-auto");
  });
});

describe("hill-climb PauseMenu hint copy", () => {
  it("shows touch copy on coarse pointers, Escape copy on fine pointers", () => {
    mockPointer(true);
    const touch = render(<PauseMenu onGoToGarage={() => {}} />);
    expect(screen.getByText("Tap Continue to keep driving")).toBeInTheDocument();
    expect(screen.queryByText("Press Escape to resume")).not.toBeInTheDocument();
    touch.unmount();

    mockPointer(false);
    render(<PauseMenu onGoToGarage={() => {}} />);
    expect(screen.getByText("Press Escape to resume")).toBeInTheDocument();
    expect(
      screen.queryByText("Tap Continue to keep driving")
    ).not.toBeInTheDocument();
  });
});

describe("hill-climb pause menu read aloud", () => {
  let speech: ReturnType<typeof installSpeechMock>;

  beforeEach(() => {
    speech = installSpeechMock();
  });

  afterEach(() => {
    removeSpeechMock();
  });

  it("reads the pause menu out loud, naming every button", () => {
    // CLAUDE.md promises a read-aloud button on every pause screen. This menu
    // is the game's own, not the shared PauseMenu, so it needs its own.
    render(<PauseMenu onGoToGarage={() => {}} />);

    const speaker = screen.getByRole("button", { name: /read it to me/i });
    fireEvent.click(speaker);

    const spoken = speech.lastUtterance().text;
    expect(spoken).toContain("Paused");
    expect(spoken).toContain("Hill Climb Racing");
    expect(spoken).toContain("Continue");
    expect(spoken).toContain("Settings");
    expect(spoken).toContain("Garage");
    expect(spoken).toContain("Quit to Main");
  });
});
