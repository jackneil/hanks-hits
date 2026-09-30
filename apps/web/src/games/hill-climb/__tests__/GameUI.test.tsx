import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { GameUI } from "../ui/GameUI";
import { PauseSheet } from "../ui/PauseSheet";
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

describe("hill-climb pause sheet copy", () => {
  it("never shows keyboard words, on a touch screen or with a mouse", () => {
    // The old pause menu told a finger to "Press Escape to resume". The
    // sheet's actions are big buttons, so it needs no hint at all.
    for (const coarse of [true, false]) {
      mockPointer(coarse);
      const view = render(<PauseSheet onGoToGarage={() => {}} />);
      expect(screen.queryByText(/escape|press /i)).not.toBeInTheDocument();
      view.unmount();
    }
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
    // CLAUDE.md promises a read-aloud button on every pause screen. This sheet
    // is the game's own, not the shared PauseMenu, so it needs its own.
    render(<PauseSheet onGoToGarage={() => {}} />);

    const speaker = screen.getByRole("button", { name: /read it to me/i });
    fireEvent.click(speaker);

    const spoken = speech.lastUtterance().text;
    expect(spoken).toContain("Paused");
    expect(spoken).toContain("Hill Climb Racing");
    expect(spoken).toContain("Keep driving");
    expect(spoken).toContain("Garage");
    expect(spoken).toContain("Go Home");
    // The settings live in the sheet now, so the voice names them too.
    expect(spoken).toContain("Lean speed");
    expect(spoken).toContain("Sound");
  });
});
