import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FourWheelerAdventureGame } from "../Game";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

/**
 * Start-moment tests for the shared GameStartOverlay migration.
 *
 * The game itself is a static HTML document in a srcDoc iframe, and it has a
 * start panel of its own. The React overlay is the one the kid sees; on load
 * we press the in-document play button for them, so Play is a single press.
 */

const gameHtml = "<!doctype html><html><body>four-wheeler</body></html>";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(gameHtml) })
  );
});

afterEach(() => {
  resetPointerMock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("four-wheeler start overlay", () => {
  it("renders the shared overlay with the title exactly once", () => {
    render(<FourWheelerAdventureGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.getAllByText("Four-Wheeler Adventure")).toHaveLength(1);
  });

  it("shows the touch instructions on a coarse-pointer viewport", () => {
    mockPointer(true);
    render(<FourWheelerAdventureGame />);

    expect(
      screen.getByText("🦶 Tap GAS to go, BRAKE to stop")
    ).toBeInTheDocument();
    expect(screen.getByText("👈👉 Tap the arrows to steer")).toBeInTheDocument();
    expect(screen.getByText("🤸 Tap JUMP for a stunt")).toBeInTheDocument();
    expect(
      screen.queryByText("👈👉 Press A and D to steer")
    ).not.toBeInTheDocument();
  });

  it("keeps the game out of the page until Play is pressed", () => {
    const view = render(<FourWheelerAdventureGame />);

    expect(view.container.querySelector("iframe")).toBeNull();
  });

  it("mounts the game once on Play and hides the overlay", async () => {
    const view = render(<FourWheelerAdventureGame />);

    const play = screen.getByRole("button", { name: /Play/ });
    fireEvent.click(play);
    fireEvent.click(play);

    await waitFor(() => {
      expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
    });
    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
  });

  it("presses the in-document play button when the game loads", async () => {
    const view = render(<FourWheelerAdventureGame />);
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    const iframe = await waitFor(() => {
      const found = view.container.querySelector("iframe");
      expect(found).not.toBeNull();
      return found as HTMLIFrameElement;
    });

    // jsdom does not parse srcDoc content, so stand a play button in for the
    // one inside Hank's game document.
    const playBtn = document.createElement("button");
    playBtn.id = "playBtn";
    const click = vi.fn();
    playBtn.addEventListener("click", click);
    const doc = iframe.contentDocument;
    expect(doc).not.toBeNull();
    doc!.body.appendChild(playBtn);

    // Desktop keys only reach the game when its own window has focus.
    const focus = vi.fn();
    Object.defineProperty(iframe.contentWindow!, "focus", {
      configurable: true,
      value: focus,
    });

    fireEvent.load(iframe);

    expect(click).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
