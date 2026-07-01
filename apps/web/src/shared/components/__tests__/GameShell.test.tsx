import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GameShell } from "../GameShell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe("GameShell", () => {
  it("labels emoji-only header controls with descriptive accessible names", () => {
    render(
      <GameShell gameName="2048">
        <div>Game content</div>
      </GameShell>
    );

    expect(
      screen.getByRole("button", { name: "Back to games" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pause game" })
    ).toBeInTheDocument();
  });
});
