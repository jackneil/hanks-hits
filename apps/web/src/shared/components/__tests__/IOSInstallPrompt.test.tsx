import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { IOSInstallPrompt } from "../IOSInstallPrompt";
import { GameStartOverlay } from "../GameStartOverlay";
import { useStartOverlayPresence } from "../../lib/startOverlayPresence";

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
}

describe("IOSInstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    useStartOverlayPresence.setState({ count: 0 });
  });

  it("stays hidden while a start card is on screen, then appears after Play", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");

    const { rerender } = render(
      <>
        <GameStartOverlay title="Snake" onStart={() => {}} />
        <IOSInstallPrompt />
      </>
    );

    // The sheet would sit over the Play button, so it waits.
    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.queryByText("Play Fullscreen!")).not.toBeInTheDocument();

    // The game starts: the card unmounts and the sheet may show.
    rerender(<IOSInstallPrompt />);

    expect(screen.getByText("Play Fullscreen!")).toBeInTheDocument();
  });

  it("shows on iPhone browsers when not dismissed", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");

    render(<IOSInstallPrompt />);

    expect(screen.getByText("Play Fullscreen!")).toBeInTheDocument();
  });

  it("does not show on non-iPhone browsers", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");

    render(<IOSInstallPrompt />);

    expect(screen.queryByText("Play Fullscreen!")).not.toBeInTheDocument();
  });

  it("persists the don't-show-again dismissal", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");

    render(<IOSInstallPrompt />);
    fireEvent.click(screen.getByText("Don't show this again"));

    expect(localStorage.getItem("ios-install-prompt-dismissed")).toBe("true");
    expect(screen.queryByText("Play Fullscreen!")).not.toBeInTheDocument();
  });
});
