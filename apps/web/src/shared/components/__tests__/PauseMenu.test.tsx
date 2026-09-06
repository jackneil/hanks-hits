import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";
import { PauseMenu } from "../PauseMenu";

describe("PauseMenu restart", () => {
  it("shows restart and forwards a confirmed restart", async () => {
    const onRestart = vi.fn();
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} onRestart={onRestart} gameName="2048" />
    );

    fireEvent.click(screen.getByRole("button", { name: /restart game/i }));
    expect(await screen.findByRole("dialog", { name: /restart game/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm restart/i }));

    await waitFor(() => expect(onRestart).toHaveBeenCalledTimes(1));
  });
});


describe("PauseMenu read aloud", () => {
  afterEach(() => {
    removeSpeechMock();
    vi.restoreAllMocks();
  });

  it("reads the whole pause menu, restart included", async () => {
    const synth = installSpeechMock();
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} onRestart={vi.fn()} gameName="Snake" />
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe("Paused. Snake. Resume. Restart. Go Home");
  });

  it("names the extra buttons in the slot, in screen order", async () => {
    const synth = installSpeechMock();
    render(
      <PauseMenu
        isOpen
        onResume={vi.fn()}
        onHome={vi.fn()}
        onRestart={vi.fn()}
        gameName="Snake"
        spokenExtras={["Leaderboard"]}
      >
        <button type="button">🏆 Leaderboard</button>
      </PauseMenu>
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe(
      "Paused. Snake. Resume. Leaderboard. Restart. Go Home"
    );
  });

  it("leaves Restart out when the game has no restart action", async () => {
    const synth = installSpeechMock();
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe("Paused. Snake. Resume. Go Home");
  });

  it("shows no read-aloud button when the browser cannot speak", () => {
    removeSpeechMock();
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });
});
