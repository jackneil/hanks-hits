import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";
import { RetroArcadeGame } from "../Game";
import { useRetroArcadeStore } from "../lib/store";
import { RETRO_ARCADE_INSTRUCTIONS } from "../lib/readAloud";
import { toSpeakable } from "@/shared/hooks/useReadAloud";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, syncStatus: "idle" }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

describe("retro arcade read aloud", () => {
  beforeEach(() => {
    // The console picker is the first screen: no console chosen, nothing playing.
    useRetroArcadeStore.setState({
      currentSystem: null,
      currentRomUrl: null,
      currentRomName: null,
      isPlaying: false,
    });
  });

  afterEach(() => {
    removeSpeechMock();
  });

  it("shows the read-aloud button on the console picker", async () => {
    installSpeechMock();
    render(<RetroArcadeGame />);

    expect(await screen.findByTestId("read-aloud-button")).toBeInTheDocument();
  });

  it("speaks the console picker instructions when tapped", async () => {
    const speech = installSpeechMock();
    render(<RetroArcadeGame />);

    fireEvent.click(await screen.findByTestId("read-aloud-button"));

    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.lastUtterance().text).toBe(toSpeakable(RETRO_ARCADE_INSTRUCTIONS));
  });

  it("hides the button when the browser cannot speak", () => {
    removeSpeechMock();
    render(<RetroArcadeGame />);

    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });

  it("keeps the button off the emulator screen", async () => {
    installSpeechMock();
    useRetroArcadeStore.setState({
      currentSystem: "snes",
      currentRomUrl: "blob:rom",
      currentRomName: "Test ROM",
      isPlaying: true,
    });
    render(<RetroArcadeGame />);

    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });
});
