import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GameShell } from "../GameShell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("../LocalWordRecovery", () => ({ LocalWordRecovery: () => <button>Words</button> }));

describe("GameShell", () => {
  it("keeps app recovery in the header without shrinking the play box", () => {
    render(<GameShell gameName="Virtual Pet" appId="virtual-pet"><div>Pet content</div></GameShell>);
    const trigger = screen.getByRole("button", { name: "Words" });
    const bar = screen.getByTestId("game-shell-header");
    const play = screen.getByTestId("game-shell-play-box");
    expect(bar).toContainElement(trigger);
    expect(play).not.toContainElement(trigger);
    expect(screen.queryByTestId("game-share-bar")).not.toBeInTheDocument();
    expect(play.style.height).toBe("");
  });
  it("keeps game recovery in the existing share bar outside gameplay", () => {
    render(<GameShell gameName="Oregon Trail" appId="oregon-trail"><div>Trail content</div></GameShell>);
    expect(screen.getByTestId("game-share-bar")).toContainElement(screen.getByRole("button", { name: "Words" }));
    expect(screen.getByTestId("game-shell-play-box").style.height).toContain("44px");
  });
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

  it("resumes exactly once when paused restart is confirmed", async () => {
    const onRestart = vi.fn();
    const onResume = vi.fn();
    render(
      <GameShell gameName="2048" onRestart={onRestart} onResume={onResume}>
        <div>Game content</div>
      </GameShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Restart game" })[1]);
    fireEvent.click(await screen.findByRole("button", { name: /confirm restart/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("holds a running game under the restart question and lets it go before the restart, never after", async () => {
    // The question is a shell overlay: the game is paused under it (it
    // used to keep running). On confirm the old run is let go first, then
    // restarted; no resume reaches the new run.
    const order: string[] = [];
    const onRestart = vi.fn(() => order.push("restart"));
    const onPause = vi.fn(() => order.push("pause"));
    const onResume = vi.fn(() => order.push("resume"));
    render(
      <GameShell gameName="2048" onRestart={onRestart} onPause={onPause} onResume={onResume}>
        <div>Game content</div>
      </GameShell>
    );
    fireEvent.click(screen.getByRole("button", { name: /restart game/i }));
    expect(order).toEqual(["pause"]);
    fireEvent.click(await screen.findByRole("button", { name: /confirm restart/i }));
    expect(order).toEqual(["pause", "resume", "restart"]);
    expect(screen.queryByTestId("pause-menu")).not.toBeInTheDocument();
  });

  it("Escape cancels the dialog without opening the pause menu", async () => {
    const onRestart = vi.fn();
    render(
      <GameShell gameName="2048" onRestart={onRestart}>
        <div>Game content</div>
      </GameShell>
    );
    fireEvent.click(screen.getByRole("button", { name: /restart game/i }));
    await screen.findByRole("dialog", { name: /restart game/i });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pause-menu")).not.toBeInTheDocument();
    expect(onRestart).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("button", { name: /keep playing/i }));

    expect(onRestart).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
