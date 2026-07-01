import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { IOSInstallPrompt } from "../IOSInstallPrompt";

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
}

describe("IOSInstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
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
