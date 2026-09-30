import { readFileSync } from "node:fs";
import path from "node:path";
import { useLayoutEffect } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IOSInstallPrompt,
  IOS_INSTALL_PILL_LABEL,
  IOS_INSTALL_SHEET_SPOKEN,
  IOS_INSTALL_SPOKEN,
  IOS_INSTALL_TIP_SPOKEN,
  SESSION_KEY,
} from "../IOSInstallPrompt";
import { GameShell } from "../GameShell";
import { GameStartOverlay } from "../GameStartOverlay";
import { useStartOverlayPresence } from "../../lib/startOverlayPresence";
import { useGameBreaks } from "../../lib/gameBreaks";
import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  // No router in a test: the placement reads window.location instead.
  usePathname: () => null,
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

const pill = () => screen.getByTestId("ios-install-pill");
const queryPill = () => screen.queryByTestId("ios-install-pill");
const querySheet = () => screen.queryByTestId("ios-install-sheet");

describe("IOSInstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useStartOverlayPresence.setState({ count: 0, enteredOn: null, leftOn: null });
    useGameBreaks.setState({ shells: 0, slots: [] });
    setUserAgent(IPHONE_UA);
  });

  afterEach(() => {
    window.matchMedia = DEFAULT_MATCH_MEDIA;
    removeSpeechMock();
    window.history.pushState({}, "", "/");
  });

  it("sits on the start screen OUTSIDE the card, then becomes a pill after Play on a page with no game", () => {
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
    expect(querySheet()).not.toBeInTheDocument();
    expect(queryPill()).not.toBeInTheDocument();
    const play = within(card).getByRole("button", { name: "▶ Play!" });
    expect(play.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The card unmounts on a page that is not an app and has no game
    // shell (a page with no play): the pill shows, never the sheet.
    rerender(<IOSInstallPrompt />);

    expect(pill()).toBeInTheDocument();
    expect(querySheet()).not.toBeInTheDocument();
    expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();
  });

  it("a start card counts before paint, so the pill never paints beside it for one frame", () => {
    // Live, on /apps/trivia: the sheet and the start card mounted in the
    // same commit, and the card counted itself in a passive effect, after
    // paint. For about 4 ms one frame showed the sheet over the card. A
    // layout effect of a later sibling runs after the card's layout
    // effects and before paint: by then the card must be counted, so the
    // page form leaves in the sync render before paint (as the GameShell
    // count does).
    const countsBeforePaint: number[] = [];
    function PaintProbe() {
      useLayoutEffect(() => {
        countsBeforePaint.push(useStartOverlayPresence.getState().count);
      }, []);
      return null;
    }

    render(
      <>
        <GameStartOverlay title="Trivia" onStart={() => {}} />
        <IOSInstallPrompt />
        <PaintProbe />
      </>
    );

    expect(countsBeforePaint).toEqual([1]);
    expect(querySheet()).not.toBeInTheDocument();
    expect(queryPill()).not.toBeInTheDocument();
  });

  it("is not in the page in the commit where a start card mounts beside it", () => {
    // The store hook subscribes after paint, so the prompt did not see the
    // count that the card set in its layout effect: the first commit held
    // the sheet, and it left only after paint. The prompt now decides in a
    // second render before paint, when the counts are set.
    const formInFirstCommit: boolean[] = [];
    function FirstCommitProbe() {
      useLayoutEffect(() => {
        formInFirstCommit.push(
          !!document.querySelector('[data-testid="ios-install-sheet"], [data-testid="ios-install-pill"]')
        );
      }, []);
      return null;
    }

    render(
      <>
        <IOSInstallPrompt />
        <GameStartOverlay title="Trivia" onStart={() => {}} />
        <FirstCommitProbe />
      </>
    );

    expect(formInFirstCommit).toEqual([false]);
    expect(querySheet()).not.toBeInTheDocument();
    expect(queryPill()).not.toBeInTheDocument();
  });

  it("still shows the pill before paint on a page with no start card", () => {
    render(<IOSInstallPrompt />);
    expect(pill()).toBeInTheDocument();
  });

  it("shows on iPhone browsers when not dismissed", () => {
    render(<IOSInstallPrompt />);

    expect(screen.getByRole("button", { name: IOS_INSTALL_PILL_LABEL })).toBeInTheDocument();
  });

  it("does not show on non-iPhone browsers", () => {
    setUserAgent(MAC_UA);

    render(<IOSInstallPrompt />);

    expect(queryPill()).not.toBeInTheDocument();
    expect(querySheet()).not.toBeInTheDocument();
  });

  it("does not show in the installed Home Screen app", () => {
    window.matchMedia = ((query: string) => ({
      ...DEFAULT_MATCH_MEDIA(query),
      matches: query.includes("display-mode: standalone"),
    })) as typeof window.matchMedia;

    render(<IOSInstallPrompt />);

    expect(queryPill()).not.toBeInTheDocument();
    expect(querySheet()).not.toBeInTheDocument();
  });

  it("persists the don't-show-again dismissal from the steps", () => {
    render(<IOSInstallPrompt />);
    fireEvent.click(screen.getByRole("button", { name: IOS_INSTALL_PILL_LABEL }));
    fireEvent.click(screen.getByText("Don't show this again"));

    expect(localStorage.getItem("ios-install-prompt-dismissed")).toBe("true");
    expect(querySheet()).not.toBeInTheDocument();
    expect(queryPill()).not.toBeInTheDocument();
  });

  it("uses a solid surface with 44 px controls (no gradient) for the sheet", () => {
    render(<IOSInstallPrompt />);
    fireEvent.click(screen.getByRole("button", { name: IOS_INSTALL_PILL_LABEL }));

    const sheet = screen.getByTestId("ios-install-sheet");
    expect(sheet.innerHTML).not.toMatch(/bg-gradient|backdrop-blur|shadow-2xl/);
    expect(within(sheet).getByRole("button", { name: "Close" })).toHaveClass("w-11", "h-11");
    expect(within(sheet).getByText("Don't show this again")).toHaveClass("min-h-[44px]");
  });

  describe("the pill on a page with no play", () => {
    it("is in the flow of the page, 44 px, with the words and a Close, and no fixed sheet", () => {
      // On an iPhone SE the sheet was 232 px tall, 42% of the screen, over
      // every tool of the drawing app on open (phone UX audit, S10). The
      // pill is one 44 px row where the app mounts it, so it covers
      // nothing.
      const { container } = render(<IOSInstallPrompt />);
      const row = pill();
      expect(container).toContainElement(row);
      expect(row.className).not.toMatch(/\bfixed\b|\babsolute\b|\bz-\[/);
      // m-2: its own inset, so a root with no padding (the drawing app)
      // never shows it flush against the corner of the screen.
      expect(row).toHaveClass("min-h-11", "w-fit", "max-w-full", "m-2");
      expect(row.className).not.toMatch(/bg-gradient|backdrop-blur/);
      const show = within(row).getByRole("button", { name: IOS_INSTALL_PILL_LABEL });
      expect(show).toHaveClass("min-h-11");
      const close = within(row).getByRole("button", { name: "Close" });
      expect(close).toHaveClass("h-11", "w-11");
      expect(querySheet()).not.toBeInTheDocument();
    });

    it("opens the steps as the requested sheet; closing the steps ends the pill for the session", () => {
      render(<IOSInstallPrompt />);
      fireEvent.click(within(pill()).getByRole("button", { name: IOS_INSTALL_PILL_LABEL }));

      const sheet = screen.getByTestId("ios-install-sheet");
      expect(sheet.parentElement).toBe(document.body);
      expect(sheet).toHaveAttribute("data-layer", "requested");
      expect(sheet).toHaveClass("z-[2500]");
      expect(queryPill()).not.toBeInTheDocument();

      fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
      expect(querySheet()).not.toBeInTheDocument();
      expect(queryPill()).not.toBeInTheDocument();
      expect(sessionStorage.getItem(SESSION_KEY)).toBe("true");
    });

    it("Close hides the pill and remembers it for the session: it does not return on the next page", () => {
      const first = render(<IOSInstallPrompt />);
      fireEvent.click(within(pill()).getByRole("button", { name: "Close" }));
      expect(queryPill()).not.toBeInTheDocument();
      expect(sessionStorage.getItem(SESSION_KEY)).toBe("true");
      first.unmount();

      // Before this, `closed` was per-mount state: the next app page
      // showed the sheet again.
      render(<IOSInstallPrompt />);
      expect(queryPill()).not.toBeInTheDocument();
      expect(querySheet()).not.toBeInTheDocument();
    });

    it("shows once per session: a pill the kid did not close still counts as shown", () => {
      const first = render(<IOSInstallPrompt />);
      expect(pill()).toBeInTheDocument();
      expect(sessionStorage.getItem(SESSION_KEY)).toBe("true");
      // This page keeps its pill.
      first.rerender(<IOSInstallPrompt />);
      expect(pill()).toBeInTheDocument();
      first.unmount();

      render(<IOSInstallPrompt />);
      expect(queryPill()).not.toBeInTheDocument();
    });

    it("a new session shows the pill again, unless the kid chose Don't show this again", () => {
      sessionStorage.setItem(SESSION_KEY, "true");
      const first = render(<IOSInstallPrompt />);
      expect(queryPill()).not.toBeInTheDocument();
      first.unmount();

      sessionStorage.clear();
      const second = render(<IOSInstallPrompt />);
      expect(pill()).toBeInTheDocument();
      second.unmount();

      localStorage.setItem("ios-install-prompt-dismissed", "true");
      sessionStorage.clear();
      render(<IOSInstallPrompt />);
      expect(queryPill()).not.toBeInTheDocument();
    });

    it("does not mark the session while the tip shows in a break surface", () => {
      render(
        <>
          <GameStartOverlay title="Snake" onStart={() => {}} />
          <IOSInstallPrompt />
        </>
      );
      expect(screen.getByTestId("ios-install-tip")).toBeInTheDocument();
      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    });
  });

  describe("during a game (issue #32)", () => {
    it("never shows during active play", () => {
      renderGameWithPrompt();

      expect(screen.getByText("game")).toBeInTheDocument();
      expect(screen.queryByText("Play Fullscreen!")).not.toBeInTheDocument();
      expect(querySheet()).not.toBeInTheDocument();
      expect(queryPill()).not.toBeInTheDocument();
    });

    it("shows inside the pause menu while the game is paused, then leaves with it", () => {
      renderGameWithPrompt();

      fireEvent.click(screen.getByRole("button", { name: "Pause game" }));

      const slot = screen.getByTestId("pause-menu-tip-slot");
      const tip = within(slot).getByTestId("ios-install-tip");
      expect(within(tip).getByText("Play Fullscreen!")).toBeInTheDocument();
      // It is part of the menu, not a sheet floating over it.
      expect(querySheet()).not.toBeInTheDocument();
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
      expect(querySheet()).not.toBeInTheDocument();

      fireEvent.click(within(overlay).getByTestId("read-aloud-button"));
      // The voice skips the ▶ picture.
      expect(synth.lastUtterance().text).toBe(
        `Flappy Bird. Then tap Play! to start. ${IOS_INSTALL_TIP_SPOKEN}`
      );

      // Play starts: the card goes, and the tip goes with it. No sheet or
      // pill covers the game.
      rerender(
        <GameShell gameName="Flappy Bird" appId="flappy-bird" canPause={false}>
          <div>game</div>
          <IOSInstallPrompt />
        </GameShell>
      );
      expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();
      expect(querySheet()).not.toBeInTheDocument();
      expect(queryPill()).not.toBeInTheDocument();
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
        within(screen.getByTestId("pause-menu-tip-slot")).getByTestId("ios-install-tip")
      ).toBeInTheDocument();
      expect(screen.getAllByTestId("ios-install-tip")).toHaveLength(1);

      fireEvent.click(
        within(screen.getByTestId("pause-menu")).getByRole("button", { name: /Resume/ })
      );
      expect(
        within(screen.getByTestId("start-overlay-break-slot")).getByTestId("ios-install-tip")
      ).toBeInTheDocument();
    });

    it("stays out of the result chip: its slot holds celebrations only", () => {
      // With the chip's buttons, the 150 px tip would cover most of a
      // phone held sideways at the moment the kid wants Play again.
      const slot = document.createElement("div");
      document.body.appendChild(slot);
      try {
        useGameBreaks.setState({ shells: 1, slots: [{ el: slot, holds: ["celebration"] }] });
        render(<IOSInstallPrompt />);
        expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();
        expect(querySheet()).not.toBeInTheDocument();
        expect(queryPill()).not.toBeInTheDocument();
      } finally {
        slot.remove();
      }
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
        // It is not a sheet or a pill over Play either.
        expect(querySheet()).not.toBeInTheDocument();
        expect(queryPill()).not.toBeInTheDocument();

        // The late size report changes nothing: the tip stays away.
        await reportSizes();
        expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();

        // The next break shows it.
        fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
        expect(
          within(screen.getByTestId("pause-menu-tip-slot")).getByTestId("ios-install-tip")
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
        expect(querySheet()).not.toBeInTheDocument();
        expect(queryPill()).not.toBeInTheDocument();
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

  describe("on an app page", () => {
    it("is a pill in the flow of an app under its GameShell, never a sheet over the app's controls", () => {
      window.history.pushState({}, "", "/apps/weather");
      render(
        <GameShell gameName="Weather Buddy" canPause={false}>
          <div data-testid="app">
            <IOSInstallPrompt />
            <div>weather</div>
          </div>
        </GameShell>
      );

      expect(useGameBreaks.getState().shells).toBe(0);
      expect(querySheet()).not.toBeInTheDocument();
      expect(within(screen.getByTestId("app")).getByTestId("ios-install-pill")).toBeInTheDocument();
    });

    it("an app whose start card has left counts as play: no sheet and no pill mid-quiz", () => {
      // Live on Trivia: the sheet showed the moment the start card left,
      // over all four answers while the 20 s timer ran.
      window.history.pushState({}, "", "/apps/trivia");
      const { rerender } = render(
        <GameShell gameName="Trivia Quiz" appId="trivia" canPause={false}>
          <div>
            <IOSInstallPrompt />
            <GameStartOverlay title="Trivia Quiz" onStart={() => {}} />
          </div>
        </GameShell>
      );
      expect(
        within(screen.getByTestId("start-overlay-break-slot")).getByTestId("ios-install-tip")
      ).toBeInTheDocument();

      // Start Quiz: the card leaves, the quiz runs.
      rerender(
        <GameShell gameName="Trivia Quiz" appId="trivia" canPause={false}>
          <div>
            <IOSInstallPrompt />
            <div>Question 1/10</div>
          </div>
        </GameShell>
      );
      expect(useStartOverlayPresence.getState().leftOn).toBe("/apps/trivia");
      expect(querySheet()).not.toBeInTheDocument();
      expect(queryPill()).not.toBeInTheDocument();
      expect(screen.queryByTestId("ios-install-tip")).not.toBeInTheDocument();

      // Play again: the start card returns with the tip.
      rerender(
        <GameShell gameName="Trivia Quiz" appId="trivia" canPause={false}>
          <div>
            <IOSInstallPrompt />
            <GameStartOverlay title="Trivia Quiz" onStart={() => {}} />
          </div>
        </GameShell>
      );
      expect(
        within(screen.getByTestId("start-overlay-break-slot")).getByTestId("ios-install-tip")
      ).toBeInTheDocument();
    });

    it("names both of the sheet's buttons when read out loud", async () => {
      const synth = installSpeechMock();
      render(<IOSInstallPrompt />);
      fireEvent.click(within(pill()).getByRole("button", { name: IOS_INSTALL_PILL_LABEL }));

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
      expect(querySheet()).not.toBeInTheDocument();
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

    it("does not mark the session: the header button is not the pill", () => {
      render(
        <GameShell gameName="Snake" appId="snake">
          <IOSInstallPrompt requested />
        </GameShell>
      );
      expect(screen.getByTestId("ios-install-sheet")).toBeInTheDocument();
      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    });
  });

  // A phone held sideways is about 320 to 430 px tall. The full sheet was
  // 200 px tall there: over half of the screen. On a short screen (the
  // short: variant) the sheet is one row. jsdom has no layout, so these
  // cases pin the class contract and the order; e2e/install-sheet measures
  // the real row on 844x390, 667x375, 568x320 and 932x430.
  describe("sideways (short screen): one short row", () => {
    const readCss = () =>
      readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");

    function renderSheet() {
      installSpeechMock();
      render(<IOSInstallPrompt requested />);
      const sheet = screen.getByTestId("ios-install-sheet");
      const card = sheet.querySelector<HTMLElement>(":scope > div")!;
      return { sheet, card };
    }

    it("the short: variant covers every phone held sideways and no phone held upright", () => {
      const variant = readCss().match(/@custom-variant short \(@media \(max-height: (\d+)px\)\);/);
      expect(variant).not.toBeNull();
      const maxHeight = Number(variant![1]);
      // iPhone SE (1st) 320, SE 375, 13 390, Pro Max 430 tall when sideways.
      for (const sideways of [320, 375, 390, 430]) expect(sideways).toBeLessThanOrEqual(maxHeight);
      // The shortest upright iPhone is 568 tall: it keeps the full sheet.
      expect(568).toBeGreaterThan(maxHeight);
    });

    it("lays the card out as one row on a short screen", () => {
      const { card } = renderSheet();
      expect(card).toHaveClass("short:flex", "short:items-center", "short:p-2");
      // Upright it stays the full card.
      expect(card).toHaveClass("p-4");
    });

    it("keeps the icon, the steps, Read it to me, Don't show this again and Close, in that order", async () => {
      const { card } = renderSheet();
      const icon = within(card).getByText("📲");
      const steps = within(card).getByText("Add to Home Screen").parentElement!;
      const readAloud = await within(card).findByTestId("read-aloud-button");
      const dontShow = within(card).getByRole("button", { name: "Don't show this again" });
      const close = within(card).getByRole("button", { name: "Close" });

      const row = [icon, steps, readAloud, dontShow, close];
      for (let i = 1; i < row.length; i++) {
        // Each part comes after the one before it, so the row reads (and
        // tabs) from left to right.
        expect(
          row[i - 1].compareDocumentPosition(row[i]) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
      }
    });

    it("drops the title and the second line, and keeps the steps in the row", () => {
      const { card } = renderSheet();
      const title = within(card).getByText("Play Fullscreen!");
      expect(title.parentElement).toHaveClass("short:hidden");
      expect(title.parentElement).toContainElement(
        within(card).getByText("Add this game to your Home Screen:")
      );
      // The steps take the free width of the row, and wrap inside it
      // before they push the buttons off the row.
      const steps = within(card).getByText("Add to Home Screen").parentElement!;
      expect(steps).toHaveClass("short:mb-0", "short:flex-1", "short:min-w-40");
      // The label of the button does not break over two lines.
      expect(within(card).getByRole("button", { name: "Don't show this again" })).toHaveClass(
        "short:whitespace-nowrap"
      );
    });

    it("puts Close at the end of the row, still a 44 px target", () => {
      const { card } = renderSheet();
      const close = within(card).getByRole("button", { name: "Close" });
      // Upright it sits in the corner; sideways it joins the row.
      expect(close).toHaveClass("absolute", "short:static", "short:shrink-0", "w-11", "h-11");
      expect(card.lastElementChild).toBe(close);
    });

    it("keeps clear of the side safe areas (the notch when the phone is sideways)", () => {
      const { sheet } = renderSheet();
      expect(sheet).toHaveClass(
        "pl-[max(0.5rem,env(safe-area-inset-left))]",
        "pr-[max(0.5rem,env(safe-area-inset-right))]",
        "pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      );
    });

    it("the tip inside a break surface keeps its own layout", () => {
      renderGameWithPrompt();
      fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
      const tip = screen.getByTestId("ios-install-tip");
      expect(tip.className).not.toMatch(/short:/);
      expect(within(tip).getByText("Add to Home Screen").parentElement).toHaveClass("mb-3");
    });
  });

  // The sheet is fixed to the bottom of the screen, so it covered the last
  // thing on a page (the Atari 2600 card at the bottom of the Retro Arcade
  // console grid: a tap there hit the sheet). While a sheet shows, the page
  // gets that much extra space at its end, so every element can scroll
  // clear of it.
  describe("bottom space: the page can scroll every element clear of the sheet", () => {
    const SPACE = "--bottom-sheet-space";
    const root = document.documentElement;
    const setupResizeObserver = global.ResizeObserver;
    let observers: {
      callback: ResizeObserverCallback;
      targets: Element[];
      options: ResizeObserverOptions | undefined;
    }[];
    /** The measured height of each sheet on screen, in DOM order. */
    let heights: number[];

    const space = () => root.style.getPropertyValue(SPACE);
    const sheets = () => Array.from(document.querySelectorAll('[data-testid="ios-install-sheet"]'));

    /** The browser reports a new sheet size: every observer of a sheet calls back. */
    async function resizeSheets(next: number[]) {
      heights = next;
      await act(async () => {
        for (const observer of [...observers]) {
          if (observer.targets.length > 0) observer.callback([], {} as ResizeObserver);
        }
      });
    }

    beforeEach(() => {
      heights = [212.4, 260];
      observers = [];
      global.ResizeObserver = class {
        private entry: (typeof observers)[number];
        constructor(callback: ResizeObserverCallback) {
          this.entry = { callback, targets: [], options: undefined };
          observers.push(this.entry);
        }
        observe(target: Element, options?: ResizeObserverOptions) {
          this.entry.targets.push(target);
          this.entry.options = options;
        }
        unobserve() {}
        disconnect() {
          this.entry.targets = [];
        }
      };
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
        this: Element
      ) {
        const index = sheets().indexOf(this);
        const height = index === -1 ? 0 : (heights[index] ?? 0);
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 390,
          bottom: height,
          width: 390,
          height,
          toJSON: () => ({}),
        } as DOMRect;
      });
    });

    afterEach(() => {
      global.ResizeObserver = setupResizeObserver;
      vi.restoreAllMocks();
      root.style.removeProperty(SPACE);
    });

    it("reserves the sheet's measured height (whole pixels, rounded up) while it shows", () => {
      expect(space()).toBe("");

      render(<IOSInstallPrompt requested />);

      expect(screen.getByTestId("ios-install-sheet")).toHaveAttribute("data-layer", "requested");
      expect(space()).toBe("213px");
      // The border box: the safe-area padding at the bottom of the sheet
      // counts too, and a change to it alone must report.
      const sheetObserver = observers.find((o) =>
        o.targets.includes(screen.getByTestId("ios-install-sheet"))
      );
      expect(sheetObserver?.options).toEqual({ box: "border-box" });
    });

    it("follows the sheet when its size changes (the phone turns, the words wrap)", async () => {
      render(<IOSInstallPrompt requested />);
      expect(space()).toBe("213px");

      await resizeSheets([150]);

      expect(space()).toBe("150px");
    });

    it("gives the space back when the kid closes the sheet", () => {
      render(<IOSInstallPrompt requested />);
      expect(space()).toBe("213px");

      fireEvent.click(
        within(screen.getByTestId("ios-install-sheet")).getByRole("button", { name: "Close" })
      );

      expect(querySheet()).not.toBeInTheDocument();
      expect(space()).toBe("");
    });

    it("gives the space back on Don't show this again, and when the page goes away", () => {
      const first = render(<IOSInstallPrompt requested />);
      fireEvent.click(screen.getByText("Don't show this again"));
      expect(space()).toBe("");
      first.unmount();

      localStorage.clear();
      const second = render(<IOSInstallPrompt requested />);
      expect(space()).toBe("213px");
      second.unmount();
      expect(space()).toBe("");
    });

    it("keeps the space for the sheet that is still up when two show at once", () => {
      // The pill's steps and the 📲 button's steps, both up.
      render(
        <>
          <IOSInstallPrompt />
          <IOSInstallPrompt requested />
        </>
      );
      fireEvent.click(within(pill()).getByRole("button", { name: IOS_INSTALL_PILL_LABEL }));
      const [pillSheet, requestedSheet] = screen.getAllByTestId("ios-install-sheet");
      // The taller sheet decides.
      expect(space()).toBe("260px");

      fireEvent.click(within(requestedSheet).getByRole("button", { name: "Close" }));
      expect(space()).toBe("213px");

      fireEvent.click(within(pillSheet).getByRole("button", { name: "Close" }));
      expect(space()).toBe("");
    });

    it("reserves nothing for the tip inside a break surface, during play, or for the pill", () => {
      renderGameWithPrompt();
      expect(space()).toBe("");

      fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
      expect(screen.getByTestId("ios-install-tip")).toBeInTheDocument();
      expect(space()).toBe("");
    });

    it("the pill is in the flow, so it reserves no space", () => {
      render(<IOSInstallPrompt />);
      expect(pill()).toBeInTheDocument();
      expect(space()).toBe("");
    });

    it("the page adds the space at its end, and the space shows the sheet's own blue", () => {
      const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");
      const rule = (selector: string) =>
        css.match(new RegExp(`(?:^|\\n)${selector} \\{([^}]*)\\}`))?.[1] ?? "";

      // The document is the scroll box of every page: extra space at the
      // end of the body lets the last element scroll up past the sheet.
      expect(rule("body")).toMatch(/padding-bottom: var\(--bottom-sheet-space, 0px\);/);
      // Focus and scrollIntoView keep an element clear of the sheet too.
      expect(rule("html")).toMatch(/scroll-padding-bottom: var\(--bottom-sheet-space, 0px\);/);
      // Under the sheet's side and bottom margins, the space is the sheet's
      // blue (bg-blue-700), not a white band on a dark page.
      expect(rule("body")).toMatch(
        /background-image: linear-gradient\(\s*to top,\s*var\(--color-blue-700\) var\(--bottom-sheet-space, 0px\),\s*transparent var\(--bottom-sheet-space, 0px\)\s*\);/
      );
      // The sheet the rule is painted for is that blue.
      render(<IOSInstallPrompt requested />);
      expect(
        screen.getByTestId("ios-install-sheet").querySelector(":scope > div")
      ).toHaveClass("bg-blue-700");
    });
  });
});
