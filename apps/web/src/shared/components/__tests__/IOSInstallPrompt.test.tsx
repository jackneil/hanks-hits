import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IOSInstallPrompt,
  IOS_INSTALL_SHEET_SPOKEN,
  IOS_INSTALL_SPOKEN,
  IOS_INSTALL_TIP_SPOKEN,
} from "../IOSInstallPrompt";
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

  it("sits on the start screen OUTSIDE the card, then becomes a sheet after Play on a page with no game", () => {
    const { rerender } = render(
      <>
        <GameStartOverlay title="Snake" onStart={() => {}} />
        <IOSInstallPrompt />
      </>
    );

    // A sheet would sit over the Play button, so the tip is part of the
    // start screen instead. It is NOT in the card: inside the card it
    // pushed Play down and sat in the card's scroll box, cut off on an
    // iPhone (verify finding swe17/ui22).
    const overlay = screen.getByTestId("game-start-overlay");
    const card = within(overlay).getByTestId("start-card");
    const slot = within(overlay).getByTestId("start-overlay-break-slot");
    const tip = within(slot).getByTestId("ios-install-tip");
    expect(card).not.toContainElement(tip);
    expect(card).not.toContainElement(slot);
    expect(screen.queryByTestId("ios-install-sheet")).not.toBeInTheDocument();
    const play = within(card).getByRole("button", { name: "▶ Play!" });
    expect(play.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The card unmounts. No game shell is on screen, so the sheet may show.
    rerender(<IOSInstallPrompt />);

    expect(screen.getByTestId("ios-install-sheet")).toBeInTheDocument();
    expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();
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

    it("is read out loud with the pause menu, its button included", async () => {
      const synth = installSpeechMock();
      renderGameWithPrompt();

      fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
      const menu = screen.getByTestId("pause-menu");
      fireEvent.click(await within(menu).findByTestId("read-aloud-button"));

      expect(synth.lastUtterance().text).toBe(
        `Paused. Snake. Resume. Leaderboard. Go Home. ${IOS_INSTALL_TIP_SPOKEN}`
      );
      expect(IOS_INSTALL_TIP_SPOKEN).toBe(
        `${IOS_INSTALL_SPOKEN} To hide this tip for good, tap Don't show this again.`
      );
    });

    it("shows on the start screen of a game that cannot pause, and is read with it", async () => {
      const synth = installSpeechMock();
      const { rerender } = render(
        <GameShell gameName="Flappy Bird" appId="flappy-bird" canPause={false}>
          <div className="relative">
            <GameStartOverlay title="Flappy Bird" onStart={() => {}} />
          </div>
          <IOSInstallPrompt />
        </GameShell>
      );

      const overlay = screen.getByTestId("game-start-overlay");
      expect(
        within(within(overlay).getByTestId("start-overlay-break-slot")).getByTestId("ios-install-tip")
      ).toBeInTheDocument();
      expect(screen.queryByTestId("ios-install-sheet")).not.toBeInTheDocument();

      fireEvent.click(within(overlay).getByTestId("read-aloud-button"));
      // The voice skips the ▶ picture.
      expect(synth.lastUtterance().text).toBe(
        `Flappy Bird. Then tap Play! to start. ${IOS_INSTALL_TIP_SPOKEN}`
      );

      // Play starts: the card goes, and the tip goes with it. No sheet
      // covers the game.
      rerender(
        <GameShell gameName="Flappy Bird" appId="flappy-bird" canPause={false}>
          <div>game</div>
          <IOSInstallPrompt />
        </GameShell>
      );
      expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();
      expect(screen.queryByTestId("ios-install-sheet")).not.toBeInTheDocument();
    });

    it("moves from the start screen into the pause menu, the newest break", () => {
      render(
        <GameShell gameName="Snake" appId="snake">
          <div className="relative">
            <GameStartOverlay title="Snake" onStart={() => {}} />
          </div>
          <IOSInstallPrompt />
        </GameShell>
      );
      expect(
        within(screen.getByTestId("start-overlay-break-slot")).getByTestId("ios-install-tip")
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
      expect(
        within(screen.getByTestId("pause-menu-break-slot")).getByTestId("ios-install-tip")
      ).toBeInTheDocument();
      expect(screen.getAllByTestId("ios-install-tip")).toHaveLength(1);

      fireEvent.click(
        within(screen.getByTestId("pause-menu")).getByRole("button", { name: /Resume/ })
      );
      expect(
        within(screen.getByTestId("start-overlay-break-slot")).getByTestId("ios-install-tip")
      ).toBeInTheDocument();
    });

    describe("when the start card has no room for it", () => {
      // jsdom has no layout: fake the card body's scroll box. "Overflows"
      // means the body holds more than it shows, so the kid would have to
      // scroll the card to see all of it.
      //
      // The ResizeObserver fake calls back only when a test calls
      // reportSizes(), which is LATE: after the tip is already in the slot.
      // So a test that checks the tip before reportSizes() proves that the
      // MutationObserver (with flushSync) removed it before the browser
      // painted. With a fake that reported on a microtask, the
      // ResizeObserver alone removed the tip and hid a broken
      // MutationObserver (verify finding R11).
      let bodyOverflows: () => boolean;
      const setupResizeObserver = global.ResizeObserver;
      const setupMutationObserver = global.MutationObserver;
      let resizeObservers: { callback: ResizeObserverCallback; connected: boolean }[];

      /** The browser reports sizes: every connected ResizeObserver calls back. */
      async function reportSizes() {
        await act(async () => {
          for (const observer of [...resizeObservers]) {
            if (observer.connected) observer.callback([], {} as ResizeObserver);
          }
        });
      }

      beforeEach(() => {
        bodyOverflows = () => false;
        resizeObservers = [];
        global.ResizeObserver = class {
          private entry: { callback: ResizeObserverCallback; connected: boolean };
          constructor(callback: ResizeObserverCallback) {
            this.entry = { callback, connected: false };
            resizeObservers.push(this.entry);
          }
          observe() {
            this.entry.connected = true;
          }
          unobserve() {}
          disconnect() {
            this.entry.connected = false;
          }
        };
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
          configurable: true,
          get(this: HTMLElement) {
            return this.dataset.testid === "start-card-body" && bodyOverflows() ? 900 : 300;
          },
        });
        Object.defineProperty(HTMLElement.prototype, "clientHeight", {
          configurable: true,
          get() {
            return 300;
          },
        });
      });

      afterEach(() => {
        global.ResizeObserver = setupResizeObserver;
        global.MutationObserver = setupMutationObserver;
        // Back to jsdom's own Element.prototype getters.
        delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
        delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
      });

      function renderSnakeStart() {
        return render(
          <GameShell gameName="Snake" appId="snake">
            <GameStartOverlay title="Snake" onStart={() => {}} />
            <IOSInstallPrompt />
          </GameShell>
        );
      }

      /** The card fits alone, but not with the tip next to it (a phone with a short screen). */
      const overflowsOnlyWithTheTip = () =>
        !!document.querySelector(
          '[data-testid="start-overlay-break-slot"] [data-testid="ios-install-tip"]'
        );

      it("leaves the start screen before paint when it would make the card scroll, and waits for the pause menu", async () => {
        bodyOverflows = overflowsOnlyWithTheTip;
        renderSnakeStart();
        // Only microtasks have run: no ResizeObserver has reported yet. The
        // MutationObserver saw the tip arrive and removed it at once.
        await act(async () => {});

        expect(screen.queryByTestId("start-overlay-break-slot")).not.toBeInTheDocument();
        expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();
        // It is not a sheet over Play either.
        expect(screen.queryByTestId("ios-install-sheet")).not.toBeInTheDocument();

        // The late size report changes nothing: the tip stays away.
        await reportSizes();
        expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();

        // The next break shows it.
        fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
        expect(
          within(screen.getByTestId("pause-menu-break-slot")).getByTestId("ios-install-tip")
        ).toBeInTheDocument();
      });

      it("with no MutationObserver, the ResizeObserver still removes the tip, also on a later size change", async () => {
        // The mirror of the test above: the ResizeObserver path on its own.
        // @ts-expect-error: a browser with no MutationObserver
        global.MutationObserver = undefined;
        let bodyGrew = false;
        bodyOverflows = () => bodyGrew && overflowsOnlyWithTheTip();
        renderSnakeStart();
        await act(async () => {});
        await reportSizes();

        // The card fits with the tip: the tip stays.
        expect(
          within(screen.getByTestId("start-overlay-break-slot")).getByTestId("ios-install-tip")
        ).toBeInTheDocument();

        // Later the body grows (a font loads, the phone turns), so the card
        // no longer fits with the tip. The next size report removes it.
        bodyGrew = true;
        await reportSizes();
        expect(screen.queryByTestId("start-overlay-break-slot")).not.toBeInTheDocument();
        expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();
        expect(screen.queryByTestId("ios-install-sheet")).not.toBeInTheDocument();
      });

      it("gives no slot when the card body must scroll even without the tip", async () => {
        bodyOverflows = () => true;
        // No tip on screen yet (another phone): the slot still goes.
        render(<GameStartOverlay title="Snake" onStart={() => {}} />);
        await reportSizes();
        expect(screen.queryByTestId("start-overlay-break-slot")).not.toBeInTheDocument();
        expect(useGameBreaks.getState().slots).toEqual([]);
      });

      it("never shows the tip on a start card that must scroll", async () => {
        bodyOverflows = () => true;
        renderSnakeStart();
        await act(async () => {});

        expect(screen.queryByTestId("start-overlay-break-slot")).not.toBeInTheDocument();
        expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "▶ Play!" })).toBeInTheDocument();
      });

      it("keeps the tip on the start screen when the card fits with it", async () => {
        renderSnakeStart();
        await act(async () => {});
        await reportSizes();

        expect(
          within(screen.getByTestId("start-overlay-break-slot")).getByTestId("ios-install-tip")
        ).toBeInTheDocument();
      });
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

  describe("on an app page (no play to cover)", () => {
    it("is a bottom sheet under an app's GameShell, as on a page with no game", () => {
      window.history.pushState({}, "", "/apps/weather");
      try {
        render(
          <GameShell gameName="Weather Buddy" canPause={false}>
            <div>weather</div>
            <IOSInstallPrompt />
          </GameShell>
        );

        expect(useGameBreaks.getState().shells).toBe(0);
        expect(screen.getByTestId("ios-install-sheet")).toBeInTheDocument();
      } finally {
        window.history.pushState({}, "", "/");
      }
    });

    it("names both of the sheet's buttons when read out loud", async () => {
      const synth = installSpeechMock();
      render(<IOSInstallPrompt />);

      fireEvent.click(
        await within(screen.getByTestId("ios-install-sheet")).findByTestId("read-aloud-button")
      );

      expect(synth.lastUtterance().text).toBe(IOS_INSTALL_SHEET_SPOKEN);
      expect(IOS_INSTALL_SHEET_SPOKEN).toBe(
        `${IOS_INSTALL_SPOKEN} Tap the X to close it. To hide this tip for good, tap Don't show this again.`
      );
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
