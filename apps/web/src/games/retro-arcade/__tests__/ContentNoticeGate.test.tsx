import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { toSpeakable } from "@/shared/hooks/useReadAloud";
import { RetroArcadeGame } from "../Game";
import { CONTENT_NOTICE_TEXT } from "../lib/contentNotice";
import { SNES_CATALOG, getRomUrl as getSnesRomUrl } from "../lib/snes-catalog";
import { ATARI_2600_CATALOG, getRomUrl as getAtariRomUrl } from "../lib/atari-2600-catalog";
import { useRetroArcadeStore, type CustomRom } from "../lib/store";
import { AchievementCelebrations } from "@/shared/components/AchievementCelebrations";
import { useAchievementsStore } from "@/shared/lib/achievements";

/**
 * The heads-up card (Jack, 2026-10-02): a mainstream violent classic opens
 * behind a short card, each time, from every way to open a game. Play starts
 * the game; "Pick another game" never does. Every other game starts at once.
 */

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, syncStatus: "idle" }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

// The trophy layer reads the route; with no router it reads window.location.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => null,
}));

type StartGame = ReturnType<typeof useRetroArcadeStore.getState>["startGame"];

const realStartGame: StartGame = useRetroArcadeStore.getState().startGame;
let startGame: ReturnType<typeof vi.fn<StartGame>>;

const originalUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

function catalogGame<T extends { id: string }>(catalog: readonly T[], id: string): T {
  const game = catalog.find((entry) => entry.id === id);
  if (!game) throw new Error(`no catalog entry ${id}`);
  return game;
}

function openConsole(system: "snes" | "atari2600" | "nes", extra: Record<string, unknown> = {}) {
  useRetroArcadeStore.setState({ currentSystem: system, ...extra });
  return render(<RetroArcadeGame />);
}

/** Taps a game card in the list and waits for its 100 ms loading delay. */
async function tapGame(name: string) {
  const card = screen
    .getAllByTestId("catalog-game")
    .find((element) => within(element).queryByRole("heading", { name }));
  if (!card) throw new Error(`no card for ${name}`);
  const open = within(card)
    .getAllByRole("button")
    .find((button) => !button.getAttribute("aria-label"));
  if (!open) throw new Error(`no open button for ${name}`);
  fireEvent.click(open);
  await act(async () => {
    vi.advanceTimersByTime(150);
  });
}

function noticeCard() {
  return screen.queryByRole("dialog", { name: CONTENT_NOTICE_TEXT.heading });
}

function cardButton(name: string) {
  const card = noticeCard();
  if (!card) throw new Error("the heads-up card is not open");
  return within(card).getByRole("button", { name });
}

beforeEach(() => {
  vi.useFakeTimers();
  startGame = vi.fn<StartGame>((...args) => realStartGame(...args));
  useRetroArcadeStore.setState({
    currentSystem: null,
    currentRom: null,
    currentRomName: null,
    isPlaying: false,
    restartNonce: 0,
    favorites: [],
    recentlyPlayed: [],
    customRoms: [],
    startGame,
  });
  // EmulatorView makes an object URL for an uploaded file; jsdom has none.
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-rom") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  useRetroArcadeStore.setState({ startGame: realStartGame, isPlaying: false, currentRom: null });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalUrl.create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalUrl.revoke });
  removeSpeechMock();
  resetPointerMock();
});

describe("the heads-up card in front of a violent classic", () => {
  it("shows the card, not the game, when a kid taps Mortal Kombat 1", async () => {
    openConsole("snes");
    await tapGame("Mortal Kombat 1");

    const card = noticeCard();
    expect(card).not.toBeNull();
    expect(within(card!).getByRole("heading", { name: CONTENT_NOTICE_TEXT.heading })).toBeInTheDocument();
    expect(within(card!).getByText(CONTENT_NOTICE_TEXT.body)).toBeInTheDocument();
    expect(within(card!).getByText(CONTENT_NOTICE_TEXT.advice)).toBeInTheDocument();
    expect(startGame).not.toHaveBeenCalled();
    expect(screen.queryByTestId("emulator-view")).toBeNull();
    // The list stays under the card.
    expect(screen.getByTestId("retro-catalog")).toBeInTheDocument();
  });

  it("starts the game when the kid taps Play", async () => {
    openConsole("snes");
    await tapGame("Mortal Kombat 1");
    fireEvent.click(cardButton(CONTENT_NOTICE_TEXT.play));

    const game = catalogGame(SNES_CATALOG, "snes-mortal-kombat-1");
    expect(startGame).toHaveBeenCalledTimes(1);
    expect(startGame).toHaveBeenCalledWith(getSnesRomUrl(game), "Mortal Kombat 1", "snes");
    expect(noticeCard()).toBeNull();
    expect(screen.getByTestId("emulator-view")).toBeInTheDocument();
    expect(useRetroArcadeStore.getState().isPlaying).toBe(true);
  });

  it("never starts the game when the kid taps Pick another game, and the list is as before", async () => {
    openConsole("snes");
    const card = () =>
      screen
        .getAllByTestId("catalog-game")
        .find((element) => within(element).queryByRole("heading", { name: "Mortal Kombat 1" }))!;
    const before = card().outerHTML;

    await tapGame("Mortal Kombat 1");
    fireEvent.click(cardButton(CONTENT_NOTICE_TEXT.pickAnother));

    expect(noticeCard()).toBeNull();
    expect(startGame).not.toHaveBeenCalled();
    expect(useRetroArcadeStore.getState().isPlaying).toBe(false);
    expect(useRetroArcadeStore.getState().recentlyPlayed).toEqual([]);
    expect(screen.getByTestId("retro-catalog")).toBeInTheDocument();
    // No spinner, no disabled button: the card in the list is as before.
    expect(card().outerHTML).toBe(before);
  });

  it("shows the card each time the title is opened", async () => {
    openConsole("snes");
    for (let i = 0; i < 3; i++) {
      await tapGame("Mortal Kombat 1");
      expect(noticeCard(), `open ${i + 1}`).not.toBeNull();
      fireEvent.click(cardButton(CONTENT_NOTICE_TEXT.pickAnother));
    }
    expect(startGame).not.toHaveBeenCalled();
  });

  it("shows the card for every SNES and Atari classic that a notice rule matches", async () => {
    const classics: [("snes" | "atari2600"), string][] = [
      ["snes", "Alien 3"],
      ["snes", "Alien vs. Predator"],
      ["snes", "Cannon Fodder"],
      ["snes", "Doom"],
      ["snes", "Killer Instinct"],
      ["snes", "Mortal Kombat 1"],
      ["snes", "Mortal Kombat 2"],
      ["snes", "Mortal Kombat 3"],
      ["snes", "Samurai Showdown"],
      ["snes", "Super Fire Pro Wrestling X Premium"],
      ["snes", "Super Smash TV"],
      ["snes", "Wolfenstein 3D"],
      ["atari2600", "BloodyHumanFreeway_NTSC"],
      ["atari2600", "Halloween"],
      ["atari2600", "Texas Chainsaw Massacre"],
      ["atari2600", "Texas Chainsaw Massacre, The"],
    ];
    for (const [system, name] of classics) {
      const view = openConsole(system);
      await tapGame(name);
      expect(noticeCard(), name).not.toBeNull();
      fireEvent.click(cardButton(CONTENT_NOTICE_TEXT.pickAnother));
      view.unmount();
    }
    expect(startGame).not.toHaveBeenCalled();
  });

  it("starts an Atari classic with its ROM URL after Play", async () => {
    openConsole("atari2600");
    await tapGame("Halloween");
    expect(startGame).not.toHaveBeenCalled();
    fireEvent.click(cardButton(CONTENT_NOTICE_TEXT.play));

    const game = catalogGame(ATARI_2600_CATALOG, "atari2600-halloween");
    expect(startGame).toHaveBeenCalledWith(getAtariRomUrl(game), "Halloween", "atari2600");
  });

  it("starts a normal game at once, with no card", async () => {
    openConsole("snes");
    await tapGame("Super Mario World");

    expect(noticeCard()).toBeNull();
    const game = catalogGame(SNES_CATALOG, "snes-super-mario-world");
    expect(startGame).toHaveBeenCalledWith(getSnesRomUrl(game), "Super Mario World", "snes");
  });

  it("gates a classic opened from the Favorites tab", async () => {
    openConsole("snes", { favorites: ["snes-doom"] });
    fireEvent.click(screen.getByRole("button", { name: /^Favorites \(1\)$/ }));
    expect(screen.getAllByTestId("catalog-game")).toHaveLength(1);
    await tapGame("Doom");

    expect(noticeCard()).not.toBeNull();
    expect(startGame).not.toHaveBeenCalled();
  });

  it("gates a classic opened from a search", async () => {
    openConsole("snes");
    fireEvent.change(screen.getByPlaceholderText("Search SNES games..."), { target: { value: "kombat" } });
    expect(screen.getAllByTestId("catalog-game")).toHaveLength(3);
    await tapGame("Mortal Kombat 2");

    expect(noticeCard()).not.toBeNull();
    expect(startGame).not.toHaveBeenCalled();
  });

  it("gates a file that the kid uploads, by its file name", () => {
    const view = openConsole("nes");
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array(16)], "Mortal Kombat (USA).nes");
    fireEvent.change(input, { target: { files: [file] } });

    expect(noticeCard()).not.toBeNull();
    expect(startGame).not.toHaveBeenCalled();
    fireEvent.click(cardButton(CONTENT_NOTICE_TEXT.play));
    expect(startGame).toHaveBeenCalledWith(file, "Mortal Kombat (USA).nes", "nes");
  });

  it("starts a normal uploaded file at once", () => {
    const view = openConsole("nes");
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array(16)], "bucket.nes");
    fireEvent.change(input, { target: { files: [file] } });

    expect(noticeCard()).toBeNull();
    expect(startGame).toHaveBeenCalledWith(file, "bucket.nes", "nes");
  });

  it("gates a classic replayed from the Your ROMs list", () => {
    const file = new Blob([new Uint8Array(16)]);
    const rom: CustomRom = { id: "nes-doom", name: "doom.nes", system: "nes", addedAt: 1, file };
    openConsole("nes", { customRoms: [rom] });
    fireEvent.click(screen.getByRole("button", { name: /doom\.nes/ }));

    expect(noticeCard()).not.toBeNull();
    expect(startGame).not.toHaveBeenCalled();
    fireEvent.click(cardButton(CONTENT_NOTICE_TEXT.pickAnother));
    expect(noticeCard()).toBeNull();
    expect(startGame).not.toHaveBeenCalled();
    expect(screen.getByTestId("retro-uploader")).toBeInTheDocument();
  });

  it("gives Play and Pick another game the same size and look", async () => {
    openConsole("snes");
    await tapGame("Mortal Kombat 1");
    const play = cardButton(CONTENT_NOTICE_TEXT.play);
    const back = cardButton(CONTENT_NOTICE_TEXT.pickAnother);
    expect(play.className).toBe(back.className);
    expect(play.className).toMatch(/min-h-\[44px\]/);
    expect(play.className).not.toMatch(/btn-primary|btn-error|btn-warning|bg-red|border-l-|border-t-/);
  });

  it("starts a new visit at the list, so a classic left running never skips the card", async () => {
    // The older kid plays Mortal Kombat, leaves by the browser's back
    // button (a client-side page change: the store stays in memory), and
    // the younger kid opens Retro Arcade again.
    const first = openConsole("snes");
    await tapGame("Mortal Kombat 1");
    fireEvent.click(cardButton(CONTENT_NOTICE_TEXT.play));
    expect(screen.getByTestId("emulator-view")).toBeInTheDocument();
    first.unmount();
    startGame.mockClear();

    render(<RetroArcadeGame />);
    expect(screen.queryByTestId("emulator-view")).toBeNull();
    expect(useRetroArcadeStore.getState().isPlaying).toBe(false);
    expect(screen.getByTestId("retro-catalog")).toBeInTheDocument();
    expect(startGame).not.toHaveBeenCalled();

    // Mortal Kombat opens behind the card again.
    await tapGame("Mortal Kombat 1");
    expect(noticeCard()).not.toBeNull();
    expect(startGame).not.toHaveBeenCalled();
  });

  it("drops a waiting card when another game starts, so it never comes back by itself", async () => {
    openConsole("snes");
    await tapGame("Mortal Kombat 1");
    expect(noticeCard()).not.toBeNull();
    // Another game starts while the card waits (a list card under it).
    await tapGame("Super Mario World");
    expect(startGame).toHaveBeenCalledTimes(1);
    expect(startGame).toHaveBeenLastCalledWith(
      getSnesRomUrl(catalogGame(SNES_CATALOG, "snes-super-mario-world")),
      "Super Mario World",
      "snes"
    );
    expect(noticeCard()).toBeNull();

    // Back to the list: no card, and nothing starts.
    fireEvent.click(screen.getByRole("button", { name: /Back to Games/ }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId("retro-catalog")).toBeInTheDocument();
    expect(noticeCard()).toBeNull();
    expect(startGame).toHaveBeenCalledTimes(1);
  });

  it("forgets a tap when the kid leaves the list before the game opens", async () => {
    openConsole("snes");
    const tapWithoutWaiting = (name: string) => {
      const card = screen
        .getAllByTestId("catalog-game")
        .find((element) => within(element).queryByRole("heading", { name }))!;
      fireEvent.click(within(card).getAllByRole("button").find((button) => !button.getAttribute("aria-label"))!);
    };
    // Mortal Kombat, then Back inside the 100 ms loading delay.
    tapWithoutWaiting("Mortal Kombat 1");
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("retro-picker")).toBeInTheDocument();
    expect(startGame).not.toHaveBeenCalled();
    // The next console shows its list, with no card from the old tap.
    fireEvent.click(screen.getByTestId("console-atari2600"));
    expect(screen.getByTestId("retro-catalog")).toBeInTheDocument();
    expect(noticeCard()).toBeNull();

    // The same for a normal game: Back means no game starts.
    tapWithoutWaiting("Adventure");
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(startGame).not.toHaveBeenCalled();
    expect(screen.queryByTestId("emulator-view")).toBeNull();
  });

  it("puts keyboard focus on Play, keeps Tab in the card, and closes it on Escape", async () => {
    mockPointer(false);
    installSpeechMock();
    openConsole("snes");
    await tapGame("Mortal Kombat 1");
    const card = noticeCard()!;
    const play = cardButton(CONTENT_NOTICE_TEXT.play);
    const back = cardButton(CONTENT_NOTICE_TEXT.pickAnother);
    expect(play).toHaveFocus();

    // Tab and Shift+Tab go around the card's own buttons only.
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(back).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(within(card).getByTestId("read-aloud-button")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(back).toHaveFocus();

    // Escape is "Pick another game": the card closes and no game starts.
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(noticeCard()).toBeNull();
    expect(startGame).not.toHaveBeenCalled();
    expect(screen.getByTestId("retro-catalog")).toBeInTheDocument();
  });

  it("holds no trophy card: a queued trophy waits, and the voice reads the card only", async () => {
    // Live run, 2026-10-02: after a first game, the gold "First Play!"
    // trophy card with its big Yay! button showed under the heads-up card,
    // and Read it to me read the trophy as part of the card.
    mockPointer(true);
    const speech = installSpeechMock();
    useAchievementsStore.setState({ celebrationQueue: ["first-play:retro-arcade"] });
    useRetroArcadeStore.setState({ currentSystem: "snes" });
    render(
      <>
        <RetroArcadeGame />
        <AchievementCelebrations />
      </>
    );
    await tapGame("Mortal Kombat 1");
    const card = noticeCard()!;
    expect(card).not.toBeNull();
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
    expect(useAchievementsStore.getState().celebrationQueue).toEqual(["first-play:retro-arcade"]);

    fireEvent.click(within(card).getByTestId("read-aloud-button"));
    expect(speech.lastUtterance().text).toBe(
      toSpeakable(
        [
          CONTENT_NOTICE_TEXT.heading,
          CONTENT_NOTICE_TEXT.body,
          CONTENT_NOTICE_TEXT.advice,
          CONTENT_NOTICE_TEXT.spokenChoices,
        ].join(". ")
      )
    );
    useAchievementsStore.setState({ celebrationQueue: [] });
  });

  it("reads the card out loud", async () => {
    mockPointer(true);
    const speech = installSpeechMock();
    openConsole("snes");
    await tapGame("Mortal Kombat 1");

    fireEvent.click(within(noticeCard()!).getByTestId("read-aloud-button"));

    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.lastUtterance().text).toBe(
      toSpeakable(
        [
          CONTENT_NOTICE_TEXT.heading,
          CONTENT_NOTICE_TEXT.body,
          CONTENT_NOTICE_TEXT.advice,
          CONTENT_NOTICE_TEXT.spokenChoices,
        ].join(". ")
      )
    );
  });
});
