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
      currentRom: null,
      currentRomName: null,
      isPlaying: false,
      recentlyPlayed: [],
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
      currentRom: "/api/roms/snes/test.sfc",
      currentRomName: "Test ROM",
      isPlaying: true,
    });
    render(<RetroArcadeGame />);

    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });
});

describe("retro arcade recently played", () => {
  beforeEach(() => {
    useRetroArcadeStore.setState({
      currentSystem: null,
      currentRom: null,
      currentRomName: null,
      isPlaying: false,
    });
  });

  it("does not show a removed title in Recently Played", () => {
    // Saved progress from before issue #25 can still name a removed title.
    useRetroArcadeStore.setState({
      recentlyPlayed: [
        { gameId: "snes-Mortal Kombat 1", name: "Mortal Kombat 1", system: "snes", lastPlayed: 3 },
        { gameId: "atari2600-X-Man", name: "X-Man", system: "atari2600", lastPlayed: 2 },
        { gameId: "snes-Super Mario World", name: "Super Mario World", system: "snes", lastPlayed: 1 },
      ],
      customRoms: [],
    });
    render(<RetroArcadeGame />);

    expect(screen.getByText("Recently Played")).toBeInTheDocument();
    expect(screen.getByText("Super Mario World")).toBeInTheDocument();
    expect(screen.queryByText("Mortal Kombat 1")).not.toBeInTheDocument();
    expect(screen.queryByText("X-Man")).not.toBeInTheDocument();
  });
});
