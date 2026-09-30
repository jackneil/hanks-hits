import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PLAY_BOX_ATTR, PLAY_BOX_FITTED_ATTR, usePlayBox } from "../../hooks/usePlayBox";
import { GameShell, HEADER_HEIGHT_CLASSES, PLAY_BOX_CLASSES } from "../GameShell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * The play box contract (phone UX audit 2026-09-29, S1 and S11): the page
 * is exactly one screen in dvh, the box under the header scrolls instead
 * of the page, a game can make the box fitted (no scroll, no browser touch
 * gestures), and nothing in the box is selectable.
 */

function shellRoot(): HTMLElement {
  return screen.getByTestId("game-shell-header").parentElement as HTMLElement;
}

describe("GameShell play box", () => {
  it("sizes the page in dvh, never in vh or screen units", () => {
    render(
      <GameShell gameName="Snake">
        <div>game</div>
      </GameShell>
    );
    const root = shellRoot();
    expect(root.className).toContain("min-h-[calc(100dvh-var(--bottom-sheet-space,0px))]");
    expect(root.className).not.toMatch(/min-h-screen|100vh/);
    // The header room: 48 px, 40 px on a short screen (a phone sideways).
    expect(root.className).toMatch(/(^|\s)pt-12(\s|$)/);
    expect(root.className).toMatch(/(^|\s)short:pt-10(\s|$)/);
    expect(root.className).not.toMatch(/md:pt-14/);
  });

  it("leaves a bottom sheet its room, so the page is still one screen with a sheet up", () => {
    // globals.css gives the body padding-bottom: var(--bottom-sheet-space)
    // while a sheet fixed to the bottom shows (the install tip on an app
    // page). A root of a full 100dvh plus that padding made the page 232
    // px taller than an iPhone screen, so every app route scrolled and the
    // play box slid under the header. The root gives the sheet its room;
    // the root and the padding together are one screen.
    render(
      <GameShell gameName="Weather Buddy" canPause={false}>
        <div>app</div>
      </GameShell>
    );
    const root = shellRoot();
    expect(root.className).toContain("min-h-[calc(100dvh-var(--bottom-sheet-space,0px))]");
    expect(root.className).not.toMatch(/(^|\s)min-h-dvh(\s|$)/);
  });

  it("puts the game in a box that is the screen under the header, in dvh, and scrolls inside it", () => {
    render(
      <GameShell gameName="Snake">
        <div data-testid="game">game</div>
      </GameShell>
    );
    const box = screen.getByTestId("game-shell-play-box");
    expect(box).toHaveAttribute(PLAY_BOX_ATTR);
    expect(within(box).getByTestId("game")).toBeInTheDocument();
    expect(box.className).toBe(PLAY_BOX_CLASSES);
    expect(box.className).toContain("h-[calc(100dvh-3rem-var(--bottom-sheet-space,0px))]");
    expect(box.className).toContain("short:h-[calc(100dvh-2.5rem-var(--bottom-sheet-space,0px))]");
    expect(box.className).not.toMatch(/md:h-|100vh|h-full/);
    expect(box.className).toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(box.className).toMatch(/(^|\s)overscroll-contain(\s|$)/);
  });

  it("lets no text in the box be selected or long-pressed into the iOS callout", () => {
    render(
      <GameShell gameName="Snake">
        <div>game</div>
      </GameShell>
    );
    const box = screen.getByTestId("game-shell-play-box");
    expect(box.className).toMatch(/(^|\s)select-none(\s|$)/);
    expect(box.className).toContain("[-webkit-touch-callout:none]");
  });

  it("stops scrolling and gives every touch to the game while a game fits itself to the box", () => {
    function Fitted() {
      usePlayBox({ fit: true });
      return <canvas />;
    }
    render(
      <GameShell gameName="Snake">
        <Fitted />
      </GameShell>
    );
    const box = screen.getByTestId("game-shell-play-box");
    expect(box).toHaveAttribute(PLAY_BOX_FITTED_ATTR);
    expect(box.className).toContain("data-[fitted]:overflow-hidden");
    expect(box.className).toContain("data-[fitted]:touch-none");
  });

  it("gives a game the box size through usePlayBox, with no context wiring in the game", () => {
    // The hook watches the shell's own box: a ResizeObserver on that
    // element, so a game follows the box when the phone turns.
    const observed: Element[] = [];
    const RealResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe(el: Element) {
        observed.push(el);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      function Game() {
        usePlayBox();
        return null;
      }
      render(
        <GameShell gameName="Snake">
          <Game />
        </GameShell>
      );
      expect(observed).toEqual([screen.getByTestId("game-shell-play-box")]);
    } finally {
      globalThis.ResizeObserver = RealResizeObserver;
    }
  });
});

describe("GameShell header height", () => {
  it("is 48 px, and 40 px on a short screen, never keyed on the width", () => {
    render(
      <GameShell gameName="Snake">
        <div>game</div>
      </GameShell>
    );
    const header = screen.getByTestId("game-shell-header");
    expect(HEADER_HEIGHT_CLASSES).toBe("h-12 short:h-10");
    expect(header.className).toMatch(/(^|\s)h-12(\s|$)/);
    expect(header.className).toMatch(/(^|\s)short:h-10(\s|$)/);
    // An 844 px wide phone held sideways is not a tablet: the md: (768 px)
    // key made the header 56 px there.
    expect(header.className).not.toMatch(/md:h-14/);
  });

  it("gives every header button touch-action manipulation, so a double tap never zooms", () => {
    render(
      <GameShell gameName="Snake" onRestart={vi.fn()}>
        <div>game</div>
      </GameShell>
    );
    const header = screen.getByTestId("game-shell-header");
    for (const name of ["Back to games", "Pause game"]) {
      expect(within(header).getByRole("button", { name })).toHaveClass("touch-manipulation");
    }
  });
});
