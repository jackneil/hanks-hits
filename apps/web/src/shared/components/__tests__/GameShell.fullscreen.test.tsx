import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GameShell } from "../GameShell";

vi.mock("../../hooks/useFullscreen", () => ({
  useFullscreen: () => ({
    isSupported: true,
    isFullscreen: false,
    isIPhone: false,
    isPWA: false,
    toggle: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("GameShell header fullscreen button", () => {
  it("renders fullscreen INSIDE the header row, next to pause", () => {
    render(
      <GameShell gameName="Test Game">
        <div>game</div>
      </GameShell>
    );

    const fullscreen = screen.getByRole("button", { name: /enter fullscreen/i });
    const pause = screen.getByRole("button", { name: /pause game/i });

    // Same header container: the old floating copy was absolutely positioned
    // at top-4 and rendered half-underneath the sticky header.
    expect(fullscreen.parentElement).toBe(pause.parentElement);
  });
});
