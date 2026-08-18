import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("shows the sign-in control in the game header for guests", () => {
    render(
      <GameShell gameName="2048">
        <div>Game content</div>
      </GameShell>
    );

    // LoginButton renders a Sign In link to the login page when signed out.
    const signIn = screen.getByRole("link", { name: /sign in/i });

    expect(signIn).toHaveAttribute("href", "/login");
    expect(signIn.querySelector("span")).not.toHaveClass("hidden");
  });

  it("hides the sign-in control when showLoginButton is false", () => {
    render(
      <GameShell gameName="2048" showLoginButton={false}>
        <div>Game content</div>
      </GameShell>
    );

    expect(
      screen.queryByRole("link", { name: /sign in/i })
    ).not.toBeInTheDocument();
  });

  it("renders a restart control and asks for confirmation while playing", async () => {
    const onRestart = vi.fn();
    render(
      <GameShell gameName="2048" onRestart={onRestart}>
        <div>Game content</div>
      </GameShell>
    );

    const restart = screen.getByRole("button", { name: /restart game/i });
    expect(restart).toHaveClass("min-w-[44px]");
    fireEvent.click(restart);

    expect(await screen.findByRole("dialog", { name: /restart game/i })).toBeInTheDocument();
    expect(onRestart).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirm restart/i }));
    await waitFor(() => expect(onRestart).toHaveBeenCalledTimes(1));
  });

  it("cancels restart without invoking the callback", async () => {
    const onRestart = vi.fn();
    render(
      <GameShell gameName="2048" onRestart={onRestart}>
        <div>Game content</div>
      </GameShell>
    );

    fireEvent.click(screen.getByRole("button", { name: /restart game/i }));
    await screen.findByRole("dialog", { name: /restart game/i });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onRestart).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
