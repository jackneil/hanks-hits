import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";
import { CATALOG_COUNTS, PICKER_ORDER, RetroArcadeGame, prettyRomName } from "../Game";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { SYSTEMS, SYSTEM_IDS } from "../lib/constants";
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

describe("retro arcade console cards", () => {
  beforeEach(() => {
    useRetroArcadeStore.setState({
      currentSystem: null,
      currentRom: null,
      currentRomName: null,
      isPlaying: false,
      recentlyPlayed: [],
    });
  });

  const card = (id: (typeof SYSTEM_IDS)[number]) => screen.getByTestId(`console-${id}`);

  it("draws each card flat: its own solid color, no gradient, no heavy colored border", () => {
    render(<RetroArcadeGame />);
    for (const id of SYSTEM_IDS) {
      const classes = card(id).className.split(/\s+/);
      expect(classes, id).toContain(SYSTEMS[id].cardColor);
      expect(classes.filter((c) => /gradient|^from-|^via-|^to-|^border(-|$)|^hover:border/.test(c)), id).toEqual([]);
      // White text on the color (no faded text).
      expect(classes, id).toContain("text-white");
    }
  });

  it("gives every console its own solid color", () => {
    const colors = SYSTEM_IDS.map((id) => SYSTEMS[id].cardColor);
    for (const color of colors) expect(color).toMatch(/^bg-[a-z]+-\d{3}$/);
    expect(new Set(colors).size).toBe(SYSTEM_IDS.length);
  });

  it("opens a console when its card is tapped", () => {
    render(<RetroArcadeGame />);
    fireEvent.click(card("n64"));
    expect(useRetroArcadeStore.getState().currentSystem).toBe("n64");
  });

  it("names each card by the console, with its game count or the file it needs", () => {
    render(<RetroArcadeGame />);
    expect(card("snes")).toHaveAccessibleName(new RegExp(`^${SYSTEMS.snes.name} .*🎮 ${CATALOG_COUNTS.snes} games$`));
    expect(card("n64")).toHaveAccessibleName(/📁 Your own file$/);
  });

  it("puts the consoles with games first (Atari was last, under the fold)", () => {
    expect(PICKER_ORDER.slice(0, 2).sort()).toEqual(["atari2600", "snes"]);
    expect(new Set(PICKER_ORDER)).toEqual(new Set(SYSTEM_IDS));
  });

  it("on a phone, folds the consoles that need a game file until the kid asks", () => {
    mockPointer(true);
    render(<RetroArcadeGame />);
    expect(card("snes")).toBeInTheDocument();
    expect(card("atari2600")).toBeInTheDocument();
    expect(screen.queryByTestId("console-nes")).toBeNull();
    fireEvent.click(screen.getByTestId("show-file-consoles"));
    expect(card("nes")).toBeInTheDocument();
    expect(screen.queryByTestId("show-file-consoles")).toBeNull();
    resetPointerMock();
  });
});

describe("retro arcade game names", () => {
  it("shows a file's name as a title, and a catalog name as it is", () => {
    expect(prettyRomName("bucket.smc")).toBe("Bucket");
    expect(prettyRomName("super_mario_world.sfc")).toBe("Super Mario World");
    expect(prettyRomName("Mandelbrot.n64")).toBe("Mandelbrot");
    expect(prettyRomName("Super Boss Gaiden")).toBe("Super Boss Gaiden");
  });
});
