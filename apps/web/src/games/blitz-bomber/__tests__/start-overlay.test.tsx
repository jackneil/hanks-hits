import { render, screen, within, act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useAuthSync calls next-auth's useSession, which requires a SessionProvider.
// Stub it to guest/unauthenticated so the Game can render standalone.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import BlitzBomberGame from "../Game";
import { useBlitzBomberStore } from "../lib/store";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

beforeEach(() => {
  // Keep the rAF game loop from ticking during assertions.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useBlitzBomberStore.setState({ gameState: "ready" });
    useBlitzBomberStore.getState().setDifficulty("normal");
  });
});

afterEach(() => {
  resetPointerMock();
  vi.unstubAllGlobals();
  act(() => {
    useBlitzBomberStore.setState({ gameState: "ready" });
  });
});

describe("Blitz Bomber start overlay", () => {
  it("renders the game title exactly once, as the single heading", () => {
    render(<BlitzBomberGame />);

    const headings = screen.getAllByRole("heading", { name: "Blitz Bomber" });
    expect(headings).toHaveLength(1);
    expect(screen.getAllByText("Blitz Bomber")).toHaveLength(1);
  });

  it("renders the three difficulty choices as real DOM buttons", () => {
    render(<BlitzBomberGame />);

    expect(screen.getByRole("button", { name: /Easy/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Normal/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hard/ })).toBeInTheDocument();
  });

  it("start overlay cannot clip on tall phones: the choices are not in the small board box", () => {
    // 2026-07-11 mobile audit: the aspect-[4/3] board is only ~270px tall on
    // a 390x844 phone, which clipped the Easy/Normal/Hard buttons below the
    // fold (the game looked unstartable). The shared overlay now portals to
    // document.body and pins the choices in the card's action row, so the
    // board box cannot clip them and needs no extra height.
    const { container } = render(<BlitzBomberGame />);

    const easy = screen.getByRole("button", { name: /Easy/ });
    const board = container.querySelector("canvas")!.parentElement!;
    expect(board.className).toContain("aspect-[4/3]");
    expect(board).not.toContainElement(easy);
    expect(screen.getByTestId("game-start-overlay").parentElement).toBe(document.body);
    expect(screen.getByTestId("start-card-actions")).toContainElement(easy);
  });

  it("picking a difficulty sets it and starts the game", () => {
    render(<BlitzBomberGame />);

    expect(useBlitzBomberStore.getState().gameState).toBe("ready");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Hard/ }));
    });

    const state = useBlitzBomberStore.getState();
    expect(state.progress.settings.difficulty).toBe("hard");
    expect(state.gameState).toBe("playing");
  });

  // The below-canvas play hints (kept as-is) also contain touch copy, so scope
  // these assertions to the overlay card to test only what the overlay renders.
  it("shows touch hints (not keyboard copy) on coarse-pointer viewports", () => {
    mockPointer(true);
    render(<BlitzBomberGame />);

    const card = screen
      .getByRole("heading", { name: "Blitz Bomber" })
      .closest("div") as HTMLElement;

    expect(
      within(card).getByText("Tap anywhere to drop bombs")
    ).toBeInTheDocument();
    expect(
      within(card).queryByText("SPACE or any key drops bombs")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine-pointer viewports", () => {
    mockPointer(false);
    render(<BlitzBomberGame />);

    const card = screen
      .getByRole("heading", { name: "Blitz Bomber" })
      .closest("div") as HTMLElement;

    expect(
      within(card).getByText("SPACE or any key drops bombs")
    ).toBeInTheDocument();
    expect(
      within(card).getByText("R restarts from level 1")
    ).toBeInTheDocument();
    expect(
      within(card).queryByText("Tap anywhere to drop bombs")
    ).not.toBeInTheDocument();
  });
});

describe("blitz-bomber spoken choices", () => {
  it("says the picker choices out loud, so a kid who cannot read hears them", () => {
    const speech = installSpeechMock();
    render(<BlitzBomberGame  />);

    fireEvent.click(screen.getByTestId("read-aloud-button"));

    const spoken = speech.lastUtterance().text;
    expect(spoken).toContain("Easy");
    expect(spoken).toContain("Normal");
    expect(spoken).toContain("Hard");
    expect(spoken).toContain("and the game starts");
    removeSpeechMock();
  });
});
