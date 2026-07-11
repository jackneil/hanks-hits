import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { GameUI } from "../ui/GameUI";
import { PauseMenu } from "../ui/PauseMenu";

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
