import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IOSInstallPrompt, IOS_INSTALL_SPOKEN } from "../IOSInstallPrompt";
import { GameShell } from "../GameShell";
import { GameStartOverlay } from "../GameStartOverlay";
import { useStartOverlayPresence } from "../../lib/startOverlayPresence";
import { useGameBreaks } from "../../lib/gameBreaks";
import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)";
const DEFAULT_MATCH_MEDIA = window.matchMedia;

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
}

/** A game on screen: the shell plus the game's own prompt mount. */
function renderGameWithPrompt() {
  return render(
    <GameShell gameName="Snake" appId="snake">
      <div>game</div>
      <IOSInstallPrompt />
    </GameShell>
  );
}

describe("IOSInstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    useStartOverlayPresence.setState({ count: 0 });
    useGameBreaks.setState({ shells: 0, slots: [] });
    setUserAgent(IPHONE_UA);
  });

  afterEach(() => {
    window.matchMedia = DEFAULT_MATCH_MEDIA;
    removeSpeechMock();
  });

  it("stays hidden while a start card is on screen, then appears after Play on a page with no game", () => {
    const { rerender } = render(
      <>
        <GameStartOverlay title="Snake" onStart={() => {}} />
        <IOSInstallPrompt />
      </>
    );

    // The sheet would sit over the Play button, so it waits.
    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.queryByText("Play Fullscreen!")).not.toBeInTheDocument();

    // The card unmounts. No game shell is on screen, so the sheet may show.
    rerender(<IOSInstallPrompt />);

    expect(screen.getByText("Play Fullscreen!")).toBeInTheDocument();
  });

  it("shows on iPhone browsers when not dismissed", () => {
    render(<IOSInstallPrompt />);

    expect(screen.getByText("Play Fullscreen!")).toBeInTheDocument();
  });

  it("does not show on non-iPhone browsers", () => {
    setUserAgent(MAC_UA);

    render(<IOSInstallPrompt />);

    expect(screen.queryByText("Play Fullscreen!")).not.toBeInTheDocument();
  });

  it("does not show in the installed Home Screen app", () => {
    window.matchMedia = ((query: string) => ({
      ...DEFAULT_MATCH_MEDIA(query),
      matches: query.includes("display-mode: standalone"),
    })) as typeof window.matchMedia;

    render(<IOSInstallPrompt />);

    expect(screen.queryByText("Play Fullscreen!")).not.toBeInTheDocument();
  });

  it("persists the don't-show-again dismissal", () => {
    render(<IOSInstallPrompt />);
    fireEvent.click(screen.getByText("Don't show this again"));

    expect(localStorage.getItem("ios-install-prompt-dismissed")).toBe("true");
    expect(screen.queryByText("Play Fullscreen!")).not.toBeInTheDocument();
  });

  it("uses a solid surface with 44 px controls (no gradient)", () => {
    render(<IOSInstallPrompt />);

    const sheet = screen.getByTestId("ios-install-sheet");
    expect(sheet.innerHTML).not.toMatch(/bg-gradient|backdrop-blur|shadow-2xl/);
    expect(within(sheet).getByRole("button", { name: "Close" })).toHaveClass("w-11", "h-11");
    expect(within(sheet).getByText("Don't show this again")).toHaveClass("min-h-[44px]");
  });

  describe("during a game (issue #32)", () => {
    it("never shows during active play", () => {
      renderGameWithPrompt();

      expect(screen.getByText("game")).toBeInTheDocument();
      expect(screen.queryByText("Play Fullscreen!")).not.toBeInTheDocument();
      expect(screen.queryByTestId("ios-install-sheet")).not.toBeInTheDocument();
    });

    it("shows inside the pause menu while the game is paused, then leaves with it", () => {
      renderGameWithPrompt();

      fireEvent.click(screen.getByRole("button", { name: "Pause game" }));

      const slot = screen.getByTestId("pause-menu-break-slot");
      const tip = within(slot).getByTestId("ios-install-tip");
      expect(within(tip).getByText("Play Fullscreen!")).toBeInTheDocument();
      // It is part of the menu, not a sheet floating over it.
      expect(screen.queryByTestId("ios-install-sheet")).not.toBeInTheDocument();
      expect(tip.className).not.toMatch(/fixed|bg-gradient/);

      fireEvent.click(
        within(screen.getByTestId("pause-menu")).getByRole("button", { name: /Resume/ })
      );

      expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();
      expect(screen.queryByText("Play Fullscreen!")).not.toBeInTheDocument();
    });

    it("is read out loud with the pause menu", async () => {
      const synth = installSpeechMock();
      renderGameWithPrompt();

      fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
      const menu = screen.getByTestId("pause-menu");
      fireEvent.click(await within(menu).findByTestId("read-aloud-button"));

      expect(synth.lastUtterance().text).toBe(
        `Paused. Snake. Resume. Leaderboard. Go Home. ${IOS_INSTALL_SPOKEN}`
      );
    });

    it("remembers don't-show-again from the pause menu", () => {
      renderGameWithPrompt();
      fireEvent.click(screen.getByRole("button", { name: "Pause game" }));

      fireEvent.click(
        within(screen.getByTestId("ios-install-tip")).getByText("Don't show this again")
      );

      expect(localStorage.getItem("ios-install-prompt-dismissed")).toBe("true");
      expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();
    });
  });

  describe("requested by the kid (the 📲 button)", () => {
    it("shows during play, above the pause menu, even after don't-show-again", () => {
      localStorage.setItem("ios-install-prompt-dismissed", "true");
      const onClose = vi.fn();

      render(
        <GameShell gameName="Snake" appId="snake">
          <IOSInstallPrompt requested onClose={onClose} />
        </GameShell>
      );

      const sheet = screen.getByTestId("ios-install-sheet");
      // Portaled to the body, so no header or game container can trap it.
      expect(sheet.parentElement).toBe(document.body);
      expect(sheet).toHaveClass("z-[2500]");

      fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("ios-install-sheet")).not.toBeInTheDocument();
    });

    it("opens from the header's 📲 button on an iPhone", () => {
      render(
        <GameShell gameName="Snake" appId="snake">
          <div>game</div>
        </GameShell>
      );

      fireEvent.click(screen.getByRole("button", { name: "Install app for fullscreen" }));

      expect(screen.getByTestId("ios-install-sheet").parentElement).toBe(document.body);
    });
  });
});
